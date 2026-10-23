/**
 * 技能管理业务层（v0.5）：list / detail / 六动作 / 回收站。
 *
 * 负责：
 * - 把可写磁盘技能（skill-files）与只读来源（插件/预设/runtime，由 index 注入）
 *   合并成 UI 需要的 SkillRow；
 * - disable/enable 只写 state.skillAdmin，不动源文件；
 * - 所有写动作后落盘 state + invalidate 所有 provider；
 * - 错误统一成 { ok:false, code, message }，由 http-api 决定 HTTP 状态。
 *
 * 安全：路径只来自 skill-files 的 scope+name+projectRoot，绝不接受任意路径。
 */

import fsDefault from 'node:fs'
import path from 'node:path'

import { isProjectAllowed } from './paths.js'
import {
  addDisabled,
  isDisabled,
  listDeletions,
  recordDeletion,
  removeDisabled,
  MAX_DELETIONS,
} from './state.js'
import { KEBAB_SKILL_NAME } from './skill-files.js'

export const SKILL_ACTIONS = Object.freeze(['create', 'save', 'delete', 'restore', 'disable', 'enable'])
export const SKILL_MAX_BODY_BYTES = 256 * 1024
export const SKILL_DESCRIPTION_MAX = 400
const LIST_CACHE_MS = 2000

const ORIGIN_BY_SOURCE = {
  'user-dsh': 'user',
  'project-dsh': 'project',
  custom: 'preset',
  bundled: 'bundled',
  runtime: 'runtime',
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function originOf(record) {
  if (record?.isRuntime) return 'runtime'
  return ORIGIN_BY_SOURCE[record?.source] ?? (record?.source === 'custom' ? 'preset' : 'plugin')
}

function readOnlyReasonOf(origin) {
  return origin === 'preset' ? 'preset' : origin === 'bundled' ? 'bundled' : origin === 'runtime' ? 'runtime' : 'plugin'
}

function validateName(name) {
  return typeof name === 'string' && KEBAB_SKILL_NAME.test(name) && !name.endsWith('-')
}

function validateDescription(description) {
  if (typeof description !== 'string') return 'description 必须是字符串'
  if (description.trim().length === 0) return 'description 不能为空'
  if (description.length > SKILL_DESCRIPTION_MAX) return `description 不能超过 ${SKILL_DESCRIPTION_MAX} 字符`
  if (/[\r\n]/u.test(description)) return 'description 必须是单行'
  return null
}

function codeForError(error) {
  const code = error?.code
  if (code === 'ENOENT') return 'not-found'
  if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'ENOTDIR') return 'conflict'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'not-writable'
  if (code === 'ENOSPC') return 'internal'
  return 'internal'
}

/**
 * @param {{
 *   paths: object,
 *   config?: object,
 *   skillFiles: object,
 *   state?: object,
 *   getState?: () => object,
 *   saveState?: (state:object, options?:object) => any,
 *   invalidate?: () => void,
 *   readOnlyRows?: () => object[],
 *   logger?: object,
 *   now?: () => Date,
 * }} options
 */
export function createSkillAdmin(options = {}) {
  const {
    paths,
    config = {},
    skillFiles,
    state,
    getState,
    saveState,
    invalidate,
    readOnlyRows,
    logger = {},
    now = () => new Date(),
    fs = fsDefault,
  } = options
  if (!paths) throw new TypeError('createSkillAdmin: 缺少 paths')
  if (!skillFiles) throw new TypeError('createSkillAdmin: 缺少 skillFiles')
  const stateOf = typeof getState === 'function' ? getState : () => state
  const allowlist = Array.isArray(config.projectAllowlist) ? config.projectAllowlist : []
  const userSkillsDir = path.join(paths.home, '.dsh', 'skills')
  const cache = new Map()

  function currentState() {
    return stateOf()
  }

  function commit(reason) {
    const current = currentState()
    if (!current) return { ok: false, code: 'internal', message: '状态未加载' }
    try {
      invalidate?.()
    } catch (error) {
      logger.warn?.(`技能管理 invalidate 失败：${error?.message ?? error}`)
    }
    cache.clear()
    if (typeof saveState !== 'function') return { ok: true }
    try {
      const saved = saveState(current, { reason })
      if (saved && saved.ok === false) {
        return { ok: false, code: 'internal', message: saved.warning ?? '状态保存失败' }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'internal', message: `状态保存失败：${error?.message ?? error}` }
    }
  }

  function projectPermission(projectRoot) {
    if (!projectRoot) return { allowed: false, reason: '当前会话没有项目根' }
    if (!path.isAbsolute(projectRoot)) return { allowed: false, reason: 'projectRoot 必须是绝对路径' }
    // 延迟 import 会引入循环，这里直接复用 paths 的判定。
    // eslint-disable-next-line global-require
    const allowed = (() => {
      try {
        return skillsAllowed(projectRoot)
      } catch {
        return false
      }
    })()
    return allowed
      ? { allowed: true, reason: null }
      : { allowed: false, reason: '项目根不在 $HOME 下且未命中 projectAllowlist' }
  }

  // 由 makeSkillAdmin 时注入，避免顶层与 paths 形成副作用。
  let skillsAllowed = () => false
  function configurePermission(fn) {
    if (typeof fn === 'function') skillsAllowed = fn
  }

  function normalizeRow(entry) {
    const source = entry.scope === 'user' ? 'user-dsh' : 'project-dsh'
    const fp = entry.description != null ? `sha256:${skillFiles.fileFingerprint(entry.path, entry.relativePath)}` : null
    const saved = currentState()?.skills?.[entry.name]
    const translated = Boolean(saved && typeof saved.zh === 'string' && saved.en === entry.description)
    return {
      name: entry.name,
      scope: entry.scope,
      source,
      origin: entry.scope,
      description: entry.description ?? '',
      dir: entry.relativePath?.endsWith('/SKILL.md') ? path.dirname(entry.path) : null,
      editable: Boolean(entry.writable && entry.description != null),
      deletable: Boolean(entry.writable && entry.description != null),
      disableable: Boolean(entry.writable && entry.description != null),
      disabled: Boolean(entry.disabled),
      readOnlyReason: entry.writable ? null : 'not-writable',
      mtimeMs: entry.mtimeMs ?? 0,
      size: entry.size ?? 0,
      fingerprint: fp,
      translation: { engine: translated ? saved.engine ?? 'cached' : 'none', zh: translated },
      warnings: entry.error ? [entry.error] : [],
    }
  }

  function normalizeReadOnlyRow(record) {
    const origin = originOf(record)
    const reason = readOnlyReasonOf(origin)
    const english = typeof record.description === 'string' ? record.description : ''
    // F3：只读来源若已有当前英文原文对应的中文译文，则展示中文。
    const saved = currentState()?.skills?.[record.name]
    const translated = Boolean(saved && typeof saved.zh === 'string' && saved.zh.length > 0 && saved.en === english)
    return {
      name: record.name,
      // F2：只读行的 scope 必须是其来源（plugin/preset/bundled/runtime），
      // 不能伪装成 user/project，否则设置页会把只读来源混进可写分组。
      scope: origin,
      source: record.source ?? 'bundled',
      origin,
      description: translated ? saved.zh : english,
      dir: null,
      editable: false,
      deletable: false,
      disableable: false,
      disabled: false,
      readOnlyReason: reason,
      mtimeMs: 0,
      size: 0,
      fingerprint: null,
      translation: { engine: translated ? saved.engine ?? 'cached' : 'none', zh: translated },
      warnings: [],
    }
  }

  function sourcesFor(projectRoot) {
    const userStat = statOf(userSkillsDir)
    const userExists = Boolean(userStat?.isDirectory?.())
    const user = { dir: userSkillsDir, exists: userExists, writable: true }
    if (!projectRoot) return { user, project: null }
    const permission = projectPermission(projectRoot)
    if (!permission.allowed) {
      return { user, project: null }
    }
    const dir = path.join(projectRoot, '.dsh', 'skills')
    const st = statOf(dir)
    return { user, project: { dir, exists: Boolean(st), writable: true, allowed: true } }
  }

  function statOf(file) {
    try {
      return fs.statSync(file)
    } catch {
      return undefined
    }
  }

  function list(args = {}, context = {}) {
    const nowMs = now().getTime()
    const projectRoot = context.projectRoot ?? null
    const permission = projectRoot ? projectPermission(projectRoot) : { allowed: false }
    const effectiveRoot = permission.allowed ? projectRoot : null
    const source = args.source === 'user' || args.source === 'project' ? args.source : 'all'
    const key = `${effectiveRoot ?? ''}\u0000${source}\u0000${args.refresh === '1' || args.refresh === true ? '1' : '0'}`
    if (args.refresh !== '1' && args.refresh !== true) {
      const cached = cache.get(key)
      if (cached && nowMs - cached.at < LIST_CACHE_MS) return { ...cached.value, cached: true }
    }
    let scanned
    try {
      scanned = skillFiles.scan({ projectRoot: effectiveRoot })
    } catch (error) {
      return fail('internal', `扫描技能失败：${error?.message ?? error}`)
    }
    const rows = []
    const seen = new Set()
    for (const entry of scanned.skills ?? []) {
      if (source !== 'all' && entry.scope !== source) continue
      const row = normalizeRow(entry)
      rows.push(row)
      seen.add(row.name)
    }
    // 只读来源（插件/预设/内置）只在 source=all 时追加展示；同名可写技能优先。
    if (source === 'all') {
      let readOnly = []
      try {
        readOnly = typeof readOnlyRows === 'function' ? readOnlyRows() ?? [] : []
      } catch (error) {
        logger.warn?.(`读取只读技能失败：${error?.message ?? error}`)
      }
      for (const record of readOnly) {
        if (!record || typeof record.name !== 'string') continue
        if (seen.has(record.name)) continue
        seen.add(record.name)
        rows.push(normalizeReadOnlyRow(record))
      }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name))
    const deletionRows = (currentState() ? listDeletions(currentState()) : []).map((entry) => ({
      ...entry,
      size: Number.isFinite(entry.size) ? entry.size : 0,
      restorable: entry.restoredAt == null && typeof entry.to === 'string' && Boolean(statOf(entry.to)),
    }))
    const warnings = Array.isArray(scanned.warnings) ? [...scanned.warnings] : []
    const value = {
      ok: true,
      projectRoot: effectiveRoot,
      projectSource: effectiveRoot ? (context.projectSource ?? 'explicit') : 'none',
      sources: sourcesFor(effectiveRoot),
      skills: rows,
      trash: { count: deletionRows.length, items: deletionRows },
      warnings,
      checkedAt: now().toISOString(),
    }
    cache.set(key, { at: nowMs, value })
    return value
  }

  function detail(args = {}, context = {}) {
    const scope = args.scope
    const name = args.name
    if (scope !== 'user' && scope !== 'project') return fail('invalid', 'scope 必须是 user 或 project')
    if (!validateName(name)) return fail('invalid', 'name 必须是 kebab-case（≤64 字符）')
    const projectRoot = context.projectRoot ?? null
    if (scope === 'project' && !projectRoot) return fail('unsupported-source', '当前会话没有项目根')
    if (scope === 'project' && !projectPermission(projectRoot).allowed) {
      return fail('unsupported-source', '项目根不在允许范围内')
    }
    const result = skillFiles.detail({ scope, name, projectRoot })
    if (!result.ok) return fail(result.code ?? 'internal', result.reason ?? '读取技能失败')
    const skill = result.skill
    const rawOmitted = (skill.size ?? 0) > 256 * 1024 ? 'too-large' : null
    const state = currentState()
    const disabled = Boolean(state && isDisabled(state, { scope, name: skill.name, projectRoot: scope === 'project' ? projectRoot : null }))
    const warnings = []
    if (skill.description == null) warnings.push('frontmatter 缺少 description')
    return {
      ok: true,
      scope,
      name: skill.name,
      dir: skill.path ? path.dirname(skill.path) : null,
      description: skill.description,
      frontmatter: skill.frontmatter ?? {},
      body: skill.body ?? '',
      raw: rawOmitted ? null : skill.raw ?? null,
      rawOmitted,
      fingerprint: `sha256:${skillFiles.fileFingerprint(skill.path, skill.relativePath)}`,
      mtimeMs: skill.mtimeMs ?? 0,
      size: skill.size ?? 0,
      editable: Boolean(skill.writable),
      disableable: Boolean(skill.writable),
      disabled,
      readOnlyReason: skill.writable ? null : 'not-writable',
      warnings,
    }
  }

  function mapFileFailure(result) {
    const code = result?.code ?? 'internal'
    return fail(code === 'invalid-arguments' ? 'invalid' : code, result?.reason ?? '操作失败')
  }

  function action(args = {}, context = {}) {
    const actionName = args.action
    if (!SKILL_ACTIONS.includes(actionName)) return fail('invalid', `未知 action：${String(actionName)}`)
    const projectRoot = context.projectRoot ?? null
    if (args.projectRoot !== undefined && args.projectRoot !== null && typeof args.projectRoot !== 'string') {
      return fail('invalid', 'projectRoot 必须是字符串')
    }
    if (projectRoot && !path.isAbsolute(projectRoot)) return fail('invalid', 'projectRoot 必须是绝对路径')
    const permission = projectRoot ? projectPermission(projectRoot) : { allowed: false }
    const state = currentState()
    if (!state) return fail('internal', '状态未加载')
    const scope = args.scope
    if ((actionName === 'create' || actionName === 'save' || actionName === 'delete' || actionName === 'disable' || actionName === 'enable') && scope !== 'user' && scope !== 'project') {
      return fail('invalid', 'scope 必须是 user 或 project')
    }
    if (scope === 'project' && !permission.allowed) {
      return fail('unsupported-source', permission.reason ?? '项目根不允许写入')
    }
    if (scope === 'project' && !projectRoot) return fail('unsupported-source', '当前会话没有项目根')

    if (actionName === 'restore') {
      // F5：按 id 恢复时，删除记录里登记的 projectRoot 也必须重新过 allowlist，
      // 防止项目被移出白名单后仍通过旧记录写回磁盘。
      if (typeof args.id === 'string' && args.id.length > 0) {
        const deletion = (listDeletions(state) ?? []).find((item) => item?.id === args.id)
        if (deletion && deletion.scope === 'project') {
          if (!deletion.projectRoot || !path.isAbsolute(deletion.projectRoot)) {
            return fail('unsupported-source', '删除记录缺少合法的项目根，拒绝恢复')
          }
          const deletionPermission = projectPermission(deletion.projectRoot)
          if (!deletionPermission.allowed) {
            return fail('unsupported-source', deletionPermission.reason ?? '删除记录的项目根不在允许范围内')
          }
        }
      }
      const restored = skillFiles.restore({
        id: args.id,
        scope: args.restoreScope ?? args.scope,
        name: args.name,
        projectRoot,
        intent: args.intent === 'copy' ? 'copy' : 'move',
        dryRun: args.dryRun === true,
      })
      if (!restored.ok) return mapFileFailure(restored)
      if (restored.dryRun === true) {
        return { ok: true, action: 'restore', result: { restored: { id: restored.id, from: restored.from, to: restored.to, via: restored.via }, dryRun: true } }
      }
      const saved = commit('skills.restore')
      if (!saved.ok) return saved
      return { ok: true, action: 'restore', result: { restored: { id: restored.id, from: restored.from, to: restored.to, via: restored.via }, dryRun: restored.dryRun === true } }
    }

    if (actionName === 'disable' || actionName === 'enable') {
      if (!validateName(args.name)) return fail('invalid', 'name 必须是 kebab-case（≤64 字符）')
      const target = skillFiles.readTarget({ scope, name: args.name, projectRoot })
      if (!target.ok) return fail(target.code === 'not-found' ? 'not-found' : target.code ?? 'internal', target.reason ?? '技能不存在')
      if (!target.writable) return fail('unsupported-source', '只读来源不可禁用')
      const entry = { scope, name: args.name, projectRoot: scope === 'project' ? projectRoot : null }
      if (actionName === 'disable') {
        addDisabled(state, { ...entry, reason: 'user', disabledAt: now().toISOString() }, { now })
      } else {
        removeDisabled(state, entry, { now })
      }
      const saved = commit(`skills.${actionName}`)
      if (!saved.ok) return saved
      const result = actionName === 'disable'
        ? { disabled: { ...entry, disabledAt: now().toISOString() } }
        : { enabled: { ...entry, removed: true } }
      return { ok: true, action: actionName, result }
    }

    if (!validateName(args.name)) return fail('invalid', 'name 必须是 kebab-case（≤64 字符）')
    const projectForSkill = scope === 'project' ? projectRoot : null
    if (actionName === 'create') {
      const descError = validateDescription(args.description)
      if (descError) return fail('invalid', descError)
      if (args.body !== undefined && (typeof args.body !== 'string' || Buffer.byteLength(args.body, 'utf8') > 200 * 1024)) {
        return fail('too-large', '正文超过 200KiB')
      }
      const created = skillFiles.create({ scope, name: args.name, description: args.description.trim(), body: args.body, projectRoot: projectForSkill })
      if (!created.ok) return mapFileFailure(created)
      const saved = commit('skills.create')
      if (!saved.ok) return saved
      return { ok: true, action: 'create', result: { skill: created.skill } }
    }
    if (actionName === 'save') {
      const descError = validateDescription(args.description)
      if (descError) return fail('invalid', descError)
      if (args.body !== undefined && (typeof args.body !== 'string' || Buffer.byteLength(args.body, 'utf8') > 200 * 1024)) {
        return fail('too-large', '正文超过 200KiB')
      }
      const savedSkill = skillFiles.save({
        scope,
        name: args.name,
        description: args.description.trim(),
        body: args.body,
        projectRoot: projectForSkill,
        args: { body: args.body, fingerprint: args.expectedFingerprint },
      })
      if (!savedSkill.ok) return mapFileFailure(savedSkill)
      const saved = commit('skills.save')
      if (!saved.ok) return saved
      return { ok: true, action: 'save', result: { skill: savedSkill.skill, changed: savedSkill.changed !== false } }
    }
    if (actionName === 'delete') {
      const deleted = skillFiles.delete({ scope, name: args.name, projectRoot: projectForSkill, dryRun: args.dryRun === true })
      if (!deleted.ok) return mapFileFailure(deleted)
      if (args.dryRun === true) {
        return { ok: true, action: 'delete', result: { dryRun: true, deletion: deleted.deletion } }
      }
      const saved = commit('skills.delete')
      if (!saved.ok) return saved
      return { ok: true, action: 'delete', result: { deletion: deleted.deletion } }
    }
    return fail('invalid', `未处理的 action：${actionName}`)
  }

  function trashList() {
    const state = currentState()
    const items = (state ? listDeletions(state) : []).map((entry) => ({
      ...entry,
      restorable: entry.restoredAt == null && typeof entry.to === 'string' && Boolean(statOf(entry.to)),
    }))
    return { ok: true, count: items.length, items }
  }

  function statusSummary(projectRoot = null) {
    let scanned
    try {
      scanned = skillFiles.scan({ projectRoot: projectRoot && projectPermission(projectRoot).allowed ? projectRoot : null })
    } catch {
      scanned = { skills: [] }
    }
    const rows = scanned.skills ?? []
    const state = currentState()
    const disabled = state?.skillAdmin?.disabled?.length ?? 0
    const trash = state?.skillAdmin?.deletions?.filter((entry) => entry.restoredAt == null).length ?? 0
    let readOnlySkills = 0
    try {
      const records = typeof readOnlyRows === 'function' ? readOnlyRows() ?? [] : []
      const seen = new Set(rows.map((row) => row.name))
      for (const record of records) {
        if (!record || typeof record.name !== 'string') continue
        if (seen.has(record.name)) continue
        seen.add(record.name)
        readOnlySkills += 1
      }
    } catch (error) {
      logger.warn?.(`统计只读技能失败：${error?.message ?? error}`)
    }
    return {
      userSkills: rows.filter((row) => row.scope === 'user').length,
      projectSkills: rows.filter((row) => row.scope === 'project').length,
      readOnlySkills,
      disabledCount: disabled,
      trashCount: trash,
      deletions: trash,
      maxDeletions: MAX_DELETIONS,
      userDir: userSkillsDir,
    }
  }

  configurePermission((projectRoot) => isProjectAllowed(projectRoot, { home: paths.home, allowlist, env: process.env }))

  return {
    list,
    detail,
    action,
    trashList,
    statusSummary,
    commit,
    clearCache: () => cache.clear(),
    resolveProjectPermission: projectPermission,
    isInside,
    _internal: { normalizeRow, normalizeReadOnlyRow, originOf, validateName, validateDescription, fail, codeForError },
  }
}
