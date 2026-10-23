/**
 * 设置页 Host 侧桥接：认证 HTTP 路由。
 *
 * 浏览器（设置页 client 半）通过同源 fetch 访问：
 *   GET  /plugins/skill-desc-zh/state?projectRoot=<abs>
 *   GET  /plugins/skill-desc-zh/doctor?projectRoot=<abs>
 *   POST /plugins/skill-desc-zh/action
 *   GET  /plugins/skill-desc-zh/plugins?refresh=1   （插件清单 + 可用更新）
 *   POST /plugins/skill-desc-zh/plugins/action      （{"action":"check"|"update","name"?}）
 *
 * 安全边界：
 *  - 原始 webServer 路由不继承认证，统一套 connection.requestRejection（503/401/403）；
 *  - 只允许 POST 产生变更，GET 无副作用；
 *  - JSON-only、body ≤64 KiB、action 白名单；
 *  - 所有业务逻辑经 controller 现有方法（与 skill_desc_zh 工具同一实现）。
 */

import fs from 'node:fs'
import path from 'node:path'

export const API_PREFIX = '/plugins/skill-desc-zh'
export const API_ACTIONS = Object.freeze(['apply', 'restore', 'retranslate', 'refresh', 'doctor'])
export const API_PATHS = Object.freeze({
  state: `${API_PREFIX}/state`,
  doctor: `${API_PREFIX}/doctor`,
  action: `${API_PREFIX}/action`,
})
/** v0.4.0 插件管理路由（与技能描述动作分开发布，语义独立）。 */
export const API_PLUGIN_PATHS = Object.freeze({
  list: `${API_PREFIX}/plugins`,
  action: `${API_PREFIX}/plugins/action`,
})
export const API_SKILL_PATHS = Object.freeze({
  list: `${API_PREFIX}/skills`,
  detail: `${API_PREFIX}/skills/detail`,
  action: `${API_PREFIX}/skills/action`,
})
export const API_SKILL_ACTIONS = Object.freeze(['create', 'save', 'delete', 'restore', 'disable', 'enable'])
export const MAX_BODY_BYTES = 64 * 1024
export const SKILL_MAX_BODY_BYTES = 256 * 1024
export const SKILL_MAX_DESCRIPTION = 400
export const SKILL_MAX_EDIT_BODY = 200 * 1024
export const MAX_NAMES = 64
export const DEFAULT_TIMEOUT_MS = 180_000

const KEBAB_CASE = /^[a-z0-9][a-z0-9-]{0,63}$/u
const JSON_TYPE = /^application\/json(?:\s*;|$)/iu

export class RequestBodyError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'RequestBodyError'
    this.status = status
  }
}

function jsonHeaders(extra = {}) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body)
  res.writeHead(status, jsonHeaders(extraHeaders))
  res.end(text)
}

function sendAuthError(res, status) {
  const error = status === 503 ? 'authentication unavailable' : status === 401 ? 'unauthorized' : 'forbidden'
  sendJson(res, status, { error })
}

/** 读取并解析 JSON body；与服务端其它插件同构的 413/400 语义。 */
export async function readJsonRequest(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  const raw = await new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const chunks = []
    const finish = (error) => {
      if (settled) return
      settled = true
      req.off?.('data', onData)
      req.off?.('end', onEnd)
      req.off?.('aborted', onAborted)
      req.off?.('error', onError)
      if (error) {
        chunks.length = 0
        req.once?.('error', () => {})
        req.resume?.()
        reject(error)
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'))
      }
    }
    const onData = (chunk) => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > maxBytes) finish(new RequestBodyError('request body is too large', 413))
      else chunks.push(part)
    }
    const onEnd = () => finish()
    const onAborted = () => finish(new RequestBodyError('request body was aborted', 400))
    const onError = () => finish(new RequestBodyError('invalid request body', 400))
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('aborted', onAborted)
    req.once('error', onError)
  })
  let value
  try {
    value = raw.trim() === '' ? {} : JSON.parse(raw)
  } catch {
    throw new RequestBodyError('invalid JSON', 400)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestBodyError('body must be an object', 400)
  }
  return value
}

/**
 * 校验 action 请求体。纯函数，便于单测。
 * @returns {{ok:true,value:object}|{ok:false,code:string,message:string,status:number}}
 */
export function parseActionRequest(raw, { maxNames = MAX_NAMES, maxBytes = MAX_BODY_BYTES, knownNames } = {}) {
  let value = raw
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      return { ok: false, code: 'payload-too-large', message: 'request body is too large', status: 413 }
    }
    try {
      value = raw.trim() === '' ? {} : JSON.parse(raw)
    } catch {
      return { ok: false, code: 'bad-request', message: 'invalid JSON', status: 400 }
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, code: 'bad-request', message: 'body must be an object', status: 400 }
  }
  if (typeof value.action !== 'string' || !API_ACTIONS.includes(value.action)) {
    return {
      ok: false,
      code: 'bad-request',
      message: `action must be one of: ${API_ACTIONS.join(', ')}`,
      status: 400,
    }
  }

  let names
  if (value.names !== undefined) {
    if (!Array.isArray(value.names)) {
      return { ok: false, code: 'bad-request', message: 'names must be an array', status: 400 }
    }
    if (value.names.length > maxNames) {
      return { ok: false, code: 'bad-request', message: `names must contain at most ${maxNames} items`, status: 400 }
    }
    for (const name of value.names) {
      if (typeof name !== 'string' || !KEBAB_CASE.test(name)) {
        return { ok: false, code: 'bad-request', message: 'names must be kebab-case strings', status: 400 }
      }
    }
    names = [...value.names]
    if (knownNames instanceof Set) {
      const unknown = names.filter((name) => !knownNames.has(name))
      if (unknown.length > 0) {
        return {
          ok: false,
          code: 'bad-request',
          message: `unknown target name: ${unknown[0]}`,
          status: 400,
        }
      }
    }
  }

  let projectRoot
  if (value.projectRoot !== undefined && value.projectRoot !== null) {
    if (typeof value.projectRoot !== 'string' || !path.isAbsolute(value.projectRoot)) {
      return { ok: false, code: 'bad-request', message: 'projectRoot must be an absolute path', status: 400 }
    }
    projectRoot = path.resolve(value.projectRoot)
  }

  for (const key of ['dryRun', 'force']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      return { ok: false, code: 'bad-request', message: `${key} must be a boolean`, status: 400 }
    }
  }

  return {
    ok: true,
    value: {
      action: value.action,
      ...(names !== undefined ? { names } : {}),
      ...(projectRoot !== undefined ? { projectRoot } : {}),
      ...(value.dryRun !== undefined ? { dryRun: value.dryRun } : {}),
      ...(value.force !== undefined ? { force: value.force } : {}),
    },
  }
}

/**
 * 校验技能管理 action 请求体（纯函数）。
 * 只做协议/形状校验；业务合法性（目录存在、frontmatter、trash）由 skill-admin 负责。
 */
export function parseSkillActionRequest(raw, { maxBytes = SKILL_MAX_BODY_BYTES } = {}) {
  let value = raw
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      return { ok: false, code: 'too-large', message: 'request body is too large', status: 413 }
    }
    try {
      value = raw.trim() === '' ? {} : JSON.parse(raw)
    } catch {
      return { ok: false, code: 'bad-request', message: 'invalid JSON', status: 400 }
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, code: 'bad-request', message: 'body must be an object', status: 400 }
  }
  const action = value.action
  if (typeof action !== 'string' || !API_SKILL_ACTIONS.includes(action)) {
    return { ok: false, code: 'bad-request', message: `action must be one of: ${API_SKILL_ACTIONS.join(', ')}`, status: 400 }
  }
  const scope = value.scope
  if (action !== 'restore' && scope !== 'user' && scope !== 'project') {
    return { ok: false, code: 'bad-request', message: 'scope must be user or project', status: 400 }
  }
  if (value.scope !== undefined && scope !== 'user' && scope !== 'project') {
    return { ok: false, code: 'bad-request', message: 'scope must be user or project', status: 400 }
  }
  if (value.name !== undefined && (typeof value.name !== 'string' || !KEBAB_CASE.test(value.name))) {
    return { ok: false, code: 'invalid', message: 'name must be kebab-case', status: 400 }
  }
  if (value.description !== undefined) {
    if (typeof value.description !== 'string' || value.description.trim().length === 0) {
      return { ok: false, code: 'invalid', message: 'description must be a non-empty string', status: 400 }
    }
    if (value.description.length > SKILL_MAX_DESCRIPTION) {
      return { ok: false, code: 'invalid', message: `description must be at most ${SKILL_MAX_DESCRIPTION} characters`, status: 400 }
    }
    if (/[\r\n]/u.test(value.description)) {
      return { ok: false, code: 'invalid', message: 'description must be a single line', status: 400 }
    }
  }
  if (value.body !== undefined) {
    if (typeof value.body !== 'string') return { ok: false, code: 'invalid', message: 'body must be a string', status: 400 }
    if (Buffer.byteLength(value.body, 'utf8') > SKILL_MAX_EDIT_BODY) {
      return { ok: false, code: 'too-large', message: 'body is too large', status: 413 }
    }
  }
  if (value.expectedFingerprint !== undefined && typeof value.expectedFingerprint !== 'string') {
    return { ok: false, code: 'bad-request', message: 'expectedFingerprint must be a string', status: 400 }
  }
  if (value.id !== undefined && typeof value.id !== 'string') {
    return { ok: false, code: 'bad-request', message: 'id must be a string', status: 400 }
  }
  if (value.dryRun !== undefined && typeof value.dryRun !== 'boolean') {
    return { ok: false, code: 'bad-request', message: 'dryRun must be a boolean', status: 400 }
  }
  let projectRoot
  if (value.projectRoot !== undefined && value.projectRoot !== null) {
    if (typeof value.projectRoot !== 'string' || !path.isAbsolute(value.projectRoot)) {
      return { ok: false, code: 'bad-request', message: 'projectRoot must be an absolute path', status: 400 }
    }
    projectRoot = path.resolve(value.projectRoot)
  }
  if (action === 'restore' && typeof value.id !== 'string' && typeof value.name !== 'string') {
    return { ok: false, code: 'bad-request', message: 'restore requires id or name', status: 400 }
  }
  return {
    ok: true,
    value: {
      action,
      ...(value.scope !== undefined ? { scope } : {}),
      ...(value.name !== undefined ? { name: value.name } : {}),
      ...(value.description !== undefined ? { description: value.description.trim() } : {}),
      ...(value.body !== undefined ? { body: value.body } : {}),
      ...(value.expectedFingerprint !== undefined ? { expectedFingerprint: value.expectedFingerprint } : {}),
      ...(value.id !== undefined ? { id: value.id } : {}),
      ...(value.dryRun !== undefined ? { dryRun: value.dryRun } : {}),
      projectRoot: projectRoot ?? null,
    },
  }
}

function latestByTime(records) {
  let latest
  for (const record of records) {
    const time = Number(record?.updatedAt ?? record?.createdAt ?? 0)
    if (!latest || time > latest.time) latest = { record, time }
  }
  return latest?.record
}

/**
 * settings 页没有 exec，按设计 §3.4 解析项目根：
 * explicit → state.projects（最新且仍存在）→ 最近会话 cwd → process.cwd()。
 * 依赖注入便于测试。
 */
export function resolveRequestProjectRoot({
  explicit,
  state,
  agents,
  workingDirectory,
  cwd,
  exists = (value) => fs.existsSync(value),
} = {}) {
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || !path.isAbsolute(explicit)) {
      return { ok: false, code: 'bad-request', message: 'projectRoot must be an absolute path' }
    }
    const root = path.resolve(explicit)
    if (!exists(root)) {
      return { ok: false, code: 'bad-request', message: 'projectRoot does not exist' }
    }
    return { ok: true, projectRoot: root, source: 'explicit' }
  }

  const projects = state?.projects && typeof state.projects === 'object' ? state.projects : {}
  const ordered = Object.entries(projects)
    .map(([root, record]) => ({ root, updatedAt: Number(record?.updatedAt ?? 0) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const item of ordered) {
    if (path.isAbsolute(item.root) && exists(item.root)) {
      return { ok: true, projectRoot: item.root, source: 'state' }
    }
  }

  let list = []
  try {
    if (typeof agents?.list === 'function') list = agents.list() ?? []
  } catch {
    list = []
  }
  const agent = latestByTime(Array.isArray(list) ? list : [])
  if (agent) {
    try {
      const found = workingDirectory?.get?.(agent.session)
      if (typeof found === 'string' && path.isAbsolute(found) && exists(found)) {
        return { ok: true, projectRoot: found, source: 'session' }
      }
    } catch {
      /* 没有已提交工作目录时继续回退 */
    }
  }

  return {
    ok: true,
    projectRoot: typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd(),
    source: 'cwd',
  }
}

/** 原始 WebServer 路由不继承 Connection 的认证围栏。 */
export function authenticatedRoutes(server, getConnection) {
  return {
    register(route) {
      return server.register({
        ...route,
        async handler(req, res) {
          const gate = typeof getConnection === 'function' ? getConnection() : undefined
          if (gate === undefined || gate === null) {
            sendAuthError(res, 503)
            return
          }
          let rejection
          try {
            rejection = gate.requestRejection(req)
          } catch {
            sendAuthError(res, 503)
            return
          }
          if (rejection !== undefined) {
            sendAuthError(res, rejection === 401 || rejection === 403 ? rejection : 503)
            return
          }
          await route.handler(req, res)
        },
      })
    },
  }
}

/**
 * 注册设置页 API。返回 {ok, prefix, dispose, reason?}。
 *
 * @param {object} input
 * @param {object} [input.ctx] Cordis ctx（惰性等待 webServer）
 * @param {object} input.controller
 * @param {object} [input.logger]
 * @param {string} [input.version]
 * @param {object} [input.server] 显式 webServer（测试用）
 * @param {Function|object} [input.gate] connection 服务或其 getter（测试用）
 * @param {object} [input.services] 显式 agents/workingDirectory（测试用）
 * @param {Function} [input.exists] projectRoot 存在性检查（测试用）
 */
export function registerHttpApi(input = {}) {
  const {
    ctx,
    controller,
    logger = {},
    version = 'unknown',
    services = {},
    exists,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => Date.now(),
    pluginAdmin,
  } = input
  const getServer = () => input.server
    ?? ctx?.get?.('webServer')
    ?? ctx?.get?.('httpServer')
  const getConnection = () => {
    if (typeof input.gate === 'function') return input.gate()
    if (input.gate !== undefined) return input.gate
    return ctx?.get?.('connection')
  }
  const getService = (name) => services[name] ?? ctx?.get?.(name)

  let busy = null
  let pluginBusy = null
  let skillBusy = null
  let activeAction = 0
  let actionSeq = 0
  let lastAction = null
  let disposed = false
  let routeDisposer
  let serviceDisposer
  // 最近一次成功 status 的 targets；用于 POST names 白名单（防止任意字符串撞路径）。
  // UI 正常流程会先 GET /state，因此这里通常已就绪；没有缓存时退化为格式校验。
  let knownTargetIds

  const rememberTargets = (state) => {
    if (!Array.isArray(state?.targets)) return
    knownTargetIds = new Set()
    for (const target of state.targets) {
      if (typeof target?.id === 'string') knownTargetIds.add(target.id)
      if (typeof target?.name === 'string') knownTargetIds.add(target.name)
    }
  }

  const projectRootFor = (explicit) => resolveRequestProjectRoot({
    explicit,
    state: controller.state?.(),
    agents: getService('agents'),
    workingDirectory: getService('workingDirectory'),
    cwd: process.cwd(),
    ...(exists ? { exists } : {}),
  })

  const loadState = async (queryProjectRoot) => {
    const resolved = projectRootFor(queryProjectRoot)
    if (!resolved.ok) return resolved
    const state = await controller.status({
      projectRoot: resolved.projectRoot,
      projectRootSource: resolved.source,
      readOnly: true,
    })
    return { ok: true, resolved, state }
  }

  const handleState = async (req, res, url) => {
    const loaded = await loadState(url.searchParams.get('projectRoot') ?? undefined)
    if (!loaded.ok) {
      sendJson(res, 400, { ok: false, error: { code: loaded.code, message: loaded.message } })
      return
    }
    rememberTargets(loaded.state)
    sendJson(res, 200, {
      ok: true,
      plugin: { name: 'dsh-skill-desc-zh', version },
      serverTime: now(),
      busy,
      lastAction,
      state: loaded.state,
    })
  }

  const handleDoctor = async (req, res, url) => {
    const resolved = projectRootFor(url.searchParams.get('projectRoot') ?? undefined)
    if (!resolved.ok) {
      sendJson(res, 400, { ok: false, error: { code: resolved.code, message: resolved.message } })
      return
    }
    const doctor = await controller.doctor({
      projectRoot: resolved.projectRoot,
      projectRootSource: resolved.source,
    })
    sendJson(res, 200, { ok: true, serverTime: now(), doctor })
  }

  const handleAction = async (req, res) => {
    if (busy) {
      sendJson(res, 409, {
        ok: false,
        error: { code: 'busy', message: `action ${busy.action} is still running` },
        busy,
      })
      return
    }
    if (pluginBusy) {
      sendJson(res, 409, {
        ok: false,
        error: { code: 'busy', message: `plugin ${pluginBusy.action} is still running` },
        busy: pluginBusy,
      })
      return
    }
    if (skillBusy) {
      sendJson(res, 409, {
        ok: false,
        error: { code: 'busy', message: `skills ${skillBusy.action} is still running` },
        busy: skillBusy,
      })
      return
    }
    const contentType = Array.isArray(req.headers?.['content-type'])
      ? req.headers['content-type'][0]
      : req.headers?.['content-type']
    if (typeof contentType !== 'string' || !JSON_TYPE.test(contentType)) {
      sendJson(res, 400, {
        ok: false,
        error: { code: 'bad-request', message: 'Content-Type must be application/json' },
      })
      return
    }

    // 先占住单飞锁：body 读取本身是异步的，若等解析完再置 busy，
    // 两个并发 POST 会同时穿过 busy 检查。token 用于保证迟到的 settle
    // 不会误清新一次请求的 busy。
    const token = ++actionSeq
    activeAction = token
    const release = () => {
      if (activeAction !== token) return
      activeAction = 0
      busy = null
    }
    busy = { action: 'request', startedAt: now() }
    // 最外层 finally 兜底：body 解析、projectRoot 解析、status 刷新或 sendJson
    // 任何一个意外 throw，都不能把 busy 永久留在非 null。
    try {
      let body
      try {
        body = await readJsonRequest(req)
      } catch (error) {
        release()
        const status = error instanceof RequestBodyError ? error.status : 400
        sendJson(res, status, {
          ok: false,
          error: {
            code: status === 413 ? 'payload-too-large' : 'bad-request',
            message: error instanceof Error ? error.message : 'invalid request body',
          },
        })
        return
      }

      const parsed = parseActionRequest(body, knownTargetIds ? { knownNames: knownTargetIds } : {})
      if (!parsed.ok) {
        release()
        sendJson(res, parsed.status, {
          ok: false,
          error: { code: parsed.code, message: parsed.message },
        })
        return
      }
      const request = parsed.value
      const resolved = projectRootFor(request.projectRoot ?? undefined)
      if (!resolved.ok) {
        release()
        sendJson(res, 400, {
          ok: false,
          error: { code: resolved.code, message: resolved.message },
        })
        return
      }

      const args = {
        ...(request.names ? { names: request.names } : {}),
        projectRoot: resolved.projectRoot,
        ...(request.dryRun !== undefined ? { dryRun: request.dryRun } : {}),
        ...(request.force !== undefined ? { force: request.force } : {}),
      }
      busy = { action: request.action, startedAt: now() }
      const work = Promise.resolve().then(() => controller[request.action](args))
      // 把 rejection 折成 {error}，避免 race 之后留下未处理的 rejection；
      // 同时无论成功/失败/超时，HTTP 层退出时都释放 busy（控制器自身有 runExclusive）。
      const settled = work.then((value) => ({ value }), (error) => ({ error }))
      let timer
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(Symbol.for('skill-desc-zh.timeout')), timeoutMs)
        timer.unref?.()
      })
      let outcome
      try {
        outcome = await Promise.race([settled, timeout])
      } finally {
        clearTimeout(timer)
        release()
      }

      if (outcome === Symbol.for('skill-desc-zh.timeout')) {
        // 动作仍在后台跑；504 已收口，迟到的结果只记录日志，绝不能重新污染
        // 新请求的 busy/lastAction，也不能让 rejection 变成 unhandledRejection。
        lastAction = { action: request.action, ok: false, at: now(), timeout: true }
        work.then(
          () => {},
          (error) => {
            logger.error?.(`skill-desc-zh: HTTP action ${request.action} 超时后失败：${String(error?.stack ?? error)}`)
          },
        ).catch(() => {})
        sendJson(res, 504, {
          ok: false,
          error: { code: 'timeout', message: 'action did not finish in time' },
          busy,
        })
        return
      }

      if (outcome && typeof outcome === 'object' && 'value' in outcome) {
        const result = outcome.value
        lastAction = { action: request.action, ok: result?.ok !== false, at: now() }
        let state
        try {
          state = await controller.status({
            projectRoot: resolved.projectRoot,
            projectRootSource: resolved.source,
            readOnly: true,
          })
        } catch {
          state = undefined
        }
        if (state !== undefined) rememberTargets(state)
        const body = {
          ok: result?.ok !== false,
          action: request.action,
          result,
          serverTime: now(),
          ...(state !== undefined ? { state } : {}),
        }
        sendJson(res, 200, body)
        return
      }

      // controller 抛出异常：只回通用错误，堆栈只进日志。
      lastAction = { action: request.action, ok: false, at: now() }
      logger.error?.(`skill-desc-zh: HTTP action ${request.action} 失败：${String(outcome?.error?.stack ?? outcome?.error ?? outcome)}`)
      sendJson(res, 500, {
        ok: false,
        error: { code: 'internal', message: 'internal error' },
      })
    } finally {
      release()
    }
  }

  // 技能管理单飞：与描述动作 / 插件管理互斥。token 保证迟到 settle 不误清。
  const takeSkillBusy = (action) => {
    if (busy || pluginBusy || skillBusy) return null
    const token = {}
    skillBusy = { action, token, startedAt: now() }
    return token
  }
  const releaseSkillBusy = (token) => {
    if (skillBusy && skillBusy.token === token) skillBusy = null
  }
  const sendSkillBusy = (res) => {
    const active = busy ?? pluginBusy ?? skillBusy
    sendJson(res, 409, {
      ok: false,
      error: { code: 'busy', message: 'another operation is still running' },
      busy: active ? { action: active.action, startedAt: active.startedAt } : null,
    })
  }

  const skillsUnavailable = (res) => {
    if (typeof controller.skills === 'function' && typeof controller.skillDetail === 'function' && typeof controller.skillAction === 'function') return false
    sendJson(res, 503, {
      ok: false,
      error: { code: 'unavailable', message: '技能管理后台未就绪（需要重启 DSH 加载 0.5.0）' },
    })
    return true
  }

  const handleSkillsList = async (req, res, url) => {
    if (skillsUnavailable(res)) return
    const resolved = projectRootFor(url.searchParams.get('projectRoot') ?? undefined)
    if (!resolved.ok) {
      sendJson(res, 400, { ok: false, error: { code: resolved.code, message: resolved.message } })
      return
    }
    const source = url.searchParams.get('source')
    if (source !== null && !['all', 'user', 'project'].includes(source)) {
      sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'source must be all|user|project' } })
      return
    }
    const data = await controller.skills({
      projectRoot: resolved.projectRoot,
      projectRootSource: resolved.source,
      source: source ?? 'all',
      refresh: url.searchParams.get('refresh') === '1',
    })
    if (!data || data.ok === false) {
      sendJson(res, 200, {
        ok: false,
        error: { code: data?.code ?? 'internal', message: data?.message ?? '技能列表不可用' },
        serverTime: now(),
      })
      return
    }
    sendJson(res, 200, { ...data, serverTime: now() })
  }

  const handleSkillsDetail = async (req, res, url) => {
    if (skillsUnavailable(res)) return
    const resolved = projectRootFor(url.searchParams.get('projectRoot') ?? undefined)
    if (!resolved.ok) {
      sendJson(res, 400, { ok: false, error: { code: resolved.code, message: resolved.message } })
      return
    }
    const scope = url.searchParams.get('scope')
    const name = url.searchParams.get('name')
    if (scope !== 'user' && scope !== 'project') {
      sendJson(res, 400, { ok: false, error: { code: 'invalid', message: 'scope must be user or project' } })
      return
    }
    if (typeof name !== 'string' || !KEBAB_CASE.test(name)) {
      sendJson(res, 400, { ok: false, error: { code: 'invalid', message: 'name must be kebab-case' } })
      return
    }
    const data = await controller.skillDetail({ scope, name, projectRoot: resolved.projectRoot })
    if (!data || data.ok === false) {
      const status = data?.code === 'not-found' ? 404 : data?.code === 'unsupported-source' ? 400 : 200
      sendJson(res, status, {
        ok: false,
        error: { code: data?.code ?? 'internal', message: data?.message ?? '技能详情不可用' },
        serverTime: now(),
      })
      return
    }
    sendJson(res, 200, { ...data, serverTime: now() })
  }

  const handleSkillsAction = async (req, res) => {
    if (skillsUnavailable(res)) return
    const contentType = Array.isArray(req.headers?.['content-type'])
      ? req.headers['content-type'][0]
      : req.headers?.['content-type']
    if (typeof contentType !== 'string' || !JSON_TYPE.test(contentType)) {
      sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'Content-Type must be application/json' } })
      return
    }
    const probe = req.body?.action ?? req.headers?.['x-skill-action']
    const token = takeSkillBusy(typeof probe === 'string' ? probe : 'pending')
    if (!token) {
      sendSkillBusy(res)
      return
    }
    try {
      let body
      try {
        body = await readJsonRequest(req, { maxBytes: SKILL_MAX_BODY_BYTES })
      } catch (error) {
        const status = error instanceof RequestBodyError ? error.status : 400
        sendJson(res, status, {
          ok: false,
          error: { code: status === 413 ? 'too-large' : 'bad-request', message: error instanceof Error ? error.message : 'invalid request body' },
        })
        return
      }
      const parsed = parseSkillActionRequest(body)
      if (!parsed.ok) {
        sendJson(res, parsed.status, { ok: false, error: { code: parsed.code, message: parsed.message } })
        return
      }
      const request = parsed.value
      const resolved = projectRootFor(request.projectRoot ?? undefined)
      if (!resolved.ok) {
        sendJson(res, 400, { ok: false, error: { code: resolved.code, message: resolved.message } })
        return
      }
      skillBusy.action = request.action
      const result = await controller.skillAction({ ...request, projectRoot: resolved.projectRoot })
      if (!result || result.ok === false) {
        sendJson(res, 200, {
          ok: false,
          action: request.action,
          error: { code: result?.code ?? 'internal', message: result?.message ?? '操作失败' },
          ...(result?.result !== undefined ? { result: result.result } : {}),
          serverTime: now(),
        })
        return
      }
      sendJson(res, 200, {
        ok: true,
        action: request.action,
        result: result.result,
        ...(Array.isArray(result.warnings) && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        serverTime: now(),
      })
    } catch (error) {
      logger.error?.(`skill-desc-zh: 技能管理请求失败：${String(error?.stack ?? error)}`)
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, 500, { ok: false, error: { code: 'internal', message: 'internal error' } })
      }
    } finally {
      releaseSkillBusy(token)
    }
  }

  const pluginAdminUnavailable = (res) => {
    if (pluginAdmin) return false
    sendJson(res, 503, {
      ok: false,
      error: { code: 'unavailable', message: '插件管理后台未就绪（需要重启 DSH 加载 0.4.0）' },
    })
    return true
  }

  // 插件管理单飞：占位必须在首个 await 之前同步完成，否则并发 POST 会都通过 busy 检查。
  const takePluginBusy = (action) => {
    if (busy || pluginBusy || skillBusy) return null
    const token = {}
    pluginBusy = { action, token, name: undefined, startedAt: now() }
    return token
  }
  const releasePluginBusy = (token) => {
    if (pluginBusy && pluginBusy.token === token) pluginBusy = null
  }
  const sendPluginBusy = (res) => {
    sendJson(res, 409, {
      ok: false,
      error: { code: 'busy', message: 'another operation is still running' },
      busy: busy ?? pluginBusy,
    })
  }
  const markPluginBusy = (token, patch) => {
    if (pluginBusy && pluginBusy.token === token) Object.assign(pluginBusy, patch)
  }

  const handlePlugins = async (req, res, url) => {
    if (pluginAdminUnavailable(res)) return
    const token = takePluginBusy('list')
    if (!token) {
      sendPluginBusy(res)
      return
    }
    try {
      const data = await pluginAdmin.list({ force: url.searchParams.get('refresh') === '1' })
      if (!data || data.ok === false) {
        sendJson(res, 200, {
          ok: false,
          error: { code: data?.code ?? 'unavailable', message: data?.message ?? '插件列表不可用' },
          serverTime: now(),
        })
        return
      }
      sendJson(res, 200, { ...data, serverTime: now() })
    } finally {
      releasePluginBusy(token)
    }
  }

  const handlePluginsAction = async (req, res) => {
    if (pluginAdminUnavailable(res)) return
    const token = takePluginBusy('pending')
    if (!token) {
      sendPluginBusy(res)
      return
    }
    try {
      const contentType = Array.isArray(req.headers?.['content-type'])
        ? req.headers['content-type'][0]
        : req.headers?.['content-type']
      if (typeof contentType !== 'string' || !JSON_TYPE.test(contentType)) {
        sendJson(res, 400, {
          ok: false,
          error: { code: 'bad-request', message: 'Content-Type must be application/json' },
        })
        return
      }
      let body
      try {
        body = await readJsonRequest(req)
      } catch (error) {
        const status = error instanceof RequestBodyError ? error.status : 400
        sendJson(res, status, {
          ok: false,
          error: {
            code: status === 413 ? 'payload-too-large' : 'bad-request',
            message: error instanceof Error ? error.message : 'invalid request body',
          },
        })
        return
      }
      markPluginBusy(token, { action: typeof body.action === 'string' ? body.action : 'unknown' })
      if (body.action === 'check') {
        const data = await pluginAdmin.list({ force: true })
        if (!data || data.ok === false) {
          sendJson(res, 200, {
            ok: false,
            action: 'check',
            error: { code: data?.code ?? 'unavailable', message: data?.message ?? '检查更新失败' },
            serverTime: now(),
          })
          return
        }
        sendJson(res, 200, { ok: true, action: 'check', ...data, serverTime: now() })
        return
      }
      if (body.action === 'update') {
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (name.length === 0) {
          sendJson(res, 400, {
            ok: false,
            error: { code: 'bad-request', message: '缺少要更新的插件名（name）' },
          })
          return
        }
        markPluginBusy(token, { name })
        const result = await pluginAdmin.update({ name })
        sendJson(res, 200, {
          ok: result?.ok !== false,
          action: 'update',
          result,
          serverTime: now(),
        })
        return
      }
      sendJson(res, 400, {
        ok: false,
        error: { code: 'bad-request', message: 'unknown plugin action' },
      })
    } catch (error) {
      logger.error?.(`skill-desc-zh: 插件管理请求失败：${String(error?.stack ?? error)}`)
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, 500, { ok: false, error: { code: 'internal', message: 'internal error' } })
      }
    } finally {
      releasePluginBusy(token)
    }
  }

  const dispatch = async (req, res) => {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid URL' } })
      return
    }
    const route = url.pathname === API_PATHS.state
      ? { allow: 'GET', run: handleState, method: 'GET' }
      : url.pathname === API_PATHS.doctor
        ? { allow: 'GET', run: handleDoctor, method: 'GET' }
        : url.pathname === API_PATHS.action
          ? { allow: 'POST', run: handleAction, method: 'POST' }
          : url.pathname === API_PLUGIN_PATHS.list
            ? { allow: 'GET', run: handlePlugins, method: 'GET' }
            : url.pathname === API_PLUGIN_PATHS.action
              ? { allow: 'POST', run: handlePluginsAction, method: 'POST' }
              : url.pathname === API_SKILL_PATHS.list
                ? { allow: 'GET', run: handleSkillsList, method: 'GET' }
                : url.pathname === API_SKILL_PATHS.detail
                  ? { allow: 'GET', run: handleSkillsDetail, method: 'GET' }
                  : url.pathname === API_SKILL_PATHS.action
                    ? { allow: 'POST', run: handleSkillsAction, method: 'POST' }
                    : undefined
    if (!route) {
      sendJson(res, 404, { ok: false, error: { code: 'not-found', message: 'not found' } })
      return
    }
    if (req.method !== route.method) {
      res.writeHead(405, jsonHeaders({ allow: route.allow }))
      res.end(JSON.stringify({ ok: false, error: { code: 'method-not-allowed', message: 'method not allowed' } }))
      return
    }
    try {
      await route.run(req, res, url)
    } catch (error) {
      logger.error?.(`skill-desc-zh: HTTP ${url.pathname} 处理失败：${String(error?.stack ?? error)}`)
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, 500, { ok: false, error: { code: 'internal', message: 'internal error' } })
      } else {
        try {
          res.end()
        } catch {
          /* 响应已断开 */
        }
      }
    }
  }

  const tryRegister = () => {
    if (disposed || routeDisposer) return Boolean(routeDisposer)
    const server = getServer()
    if (!server || typeof server.register !== 'function') return false
    const routes = authenticatedRoutes(server, getConnection)
    routeDisposer = routes.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: dispatch,
    })
    if (typeof serviceDisposer === 'function') {
      try {
        serviceDisposer()
      } catch {
        /* 监听已随宿主卸载 */
      }
      serviceDisposer = undefined
    }
    return true
  }

  const registered = tryRegister()
  if (!registered && ctx && typeof ctx.on === 'function') {
    serviceDisposer = ctx.on('internal/service', (name) => {
      if (['webServer', 'httpServer', 'connection'].includes(name)) tryRegister()
    })
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (typeof routeDisposer === 'function') {
      try {
        routeDisposer()
      } catch {
        /* 路由已随宿主卸载 */
      }
    } else if (routeDisposer && typeof routeDisposer.dispose === 'function') {
      try {
        routeDisposer.dispose()
      } catch {
        /* 同上 */
      }
    }
    routeDisposer = undefined
    if (typeof serviceDisposer === 'function') {
      try {
        serviceDisposer()
      } catch {
        /* 同上 */
      }
    }
    serviceDisposer = undefined
  }

  return {
    ok: Boolean(routeDisposer),
    prefix: API_PREFIX,
    dispose,
    ...(routeDisposer ? {} : { reason: 'webServer 服务暂不可用，已等待 internal/service' }),
  }
}
