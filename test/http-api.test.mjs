import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import test from 'node:test'

import {
  API_ACTIONS,
  API_PATHS,
  API_PLUGIN_PATHS,
  API_PREFIX,
  API_SKILL_ACTIONS,
  API_SKILL_PATHS,
  MAX_NAMES,
  SKILL_MAX_BODY_BYTES,
  parseSkillActionRequest,
  parseActionRequest,
  registerHttpApi,
  resolveRequestProjectRoot,
} from '../lib/http-api.js'

const VERSION = '0.2.1'

class FakeResponse {
  constructor() {
    this.statusCode = 200
    this.headers = {}
    this.body = ''
    this.headersSent = false
    this.writableEnded = false
  }

  writeHead(status, headers = {}) {
    this.statusCode = status
    this.headers = { ...headers }
    this.headersSent = true
  }

  end(chunk = '') {
    this.body += chunk
    this.writableEnded = true
  }

  json() {
    return JSON.parse(this.body)
  }
}

class FakeRequest extends EventEmitter {
  constructor({ method = 'GET', url = '/', headers = {} } = {}) {
    super()
    this.method = method
    this.url = url
    this.headers = headers
  }
}

function createServer() {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }
}

function authGate(rejection) {
  return { requestRejection: () => rejection }
}

async function call(server, method, url, { body, headers = {}, connection } = {}) {
  const route = server.routes[0]
  assert.ok(route, 'route is registered')
  const req = new FakeRequest({
    method,
    url,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
  })
  const res = new FakeResponse()
  const pending = route.handler(req, res)
  if (body !== undefined) {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    req.emit('data', Buffer.from(text))
    req.emit('end')
  }
  if (connection) {
    // gate 在 register 时已固定；connection 参数仅用于显式断言可读性。
  }
  await pending
  return res
}

function fakeController(overrides = {}) {
  const calls = []
  const controller = {
    calls,
    state: () => ({ projects: {}, skills: {} }),
    async status(args) {
      calls.push({ method: 'status', args })
      return { ok: true, action: 'status', summary: 'state-ok', targets: [], ...(await overrides.status?.(args)) }
    },
    async doctor(args) {
      calls.push({ method: 'doctor', args })
      return { ok: true, action: 'doctor', summary: 'doctor-ok', ...(await overrides.doctor?.(args)) }
    },
    async apply(args) {
      calls.push({ method: 'apply', args })
      return { ok: true, action: 'apply', summary: 'applied', ...(await overrides.apply?.(args)) }
    },
    async restore(args) {
      calls.push({ method: 'restore', args })
      return { ok: true, action: 'restore', summary: 'restored', ...(await overrides.restore?.(args)) }
    },
    async retranslate(args) {
      calls.push({ method: 'retranslate', args })
      return { ok: true, action: 'retranslate', summary: 'retranslated', ...(await overrides.retranslate?.(args)) }
    },
    async refresh(args) {
      calls.push({ method: 'refresh', args })
      return { ok: true, action: 'refresh', summary: 'refreshed', ...(await overrides.refresh?.(args)) }
    },
    async skills(args) {
      calls.push({ method: 'skills', args })
      return { ok: true, projectRoot: null, sources: { user: [], project: null }, skills: [], warnings: [], ...(await overrides.skills?.(args)) }
    },
    async skillDetail(args) {
      calls.push({ method: 'skillDetail', args })
      return { ok: true, scope: args.scope, name: args.name, description: 'Demo.', ...(await overrides.skillDetail?.(args)) }
    },
    async skillAction(args) {
      calls.push({ method: 'skillAction', args })
      return { ok: true, action: args.action, result: {}, ...(await overrides.skillAction?.(args)) }
    },
  }
  return controller
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('T1 parseActionRequest：action 白名单 / names / projectRoot / 布尔值 / 体积', () => {
  assert.deepEqual(API_ACTIONS, ['apply', 'restore', 'retranslate', 'refresh', 'doctor'])
  assert.equal(API_PREFIX, '/plugins/skill-desc-zh')

  const valid = parseActionRequest({ action: 'apply', names: ['acp', 'office'], projectRoot: '/work/proj', dryRun: true })
  assert.equal(valid.ok, true)
  assert.deepEqual(valid.value, {
    action: 'apply',
    names: ['acp', 'office'],
    projectRoot: path.resolve('/work/proj'),
    dryRun: true,
  })

  assert.equal(parseActionRequest({ action: 'status' }).ok, false, 'status 只能 GET')
  assert.equal(parseActionRequest({ action: 'delete-all' }).ok, false)
  assert.equal(parseActionRequest({ action: 'apply', names: 'acp' }).ok, false)
  assert.equal(parseActionRequest({ action: 'apply', names: ['Bad Name'] }).ok, false)
  assert.equal(parseActionRequest({ action: 'apply', names: Array.from({ length: MAX_NAMES + 1 }, (_, i) => `n${i}`) }).ok, false)
  assert.equal(parseActionRequest({ action: 'apply', projectRoot: 'relative/path' }).ok, false)
  assert.equal(parseActionRequest({ action: 'apply', dryRun: 'yes' }).ok, false)
  assert.equal(parseActionRequest('{bad json').ok, false)
  assert.equal(parseActionRequest('x'.repeat(65 * 1024)).status, 413)

  const known = parseActionRequest({ action: 'apply', names: ['acp'] }, { knownNames: new Set(['acp']) })
  assert.equal(known.ok, true)
  const unknown = parseActionRequest({ action: 'apply', names: ['nope'] }, { knownNames: new Set(['acp']) })
  assert.equal(unknown.ok, false)
  assert.match(unknown.message, /unknown target name/u)
})

test('T2 路由：未知路径 404、方法不符 405 + Allow', async () => {
  const server = createServer()
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller: fakeController(),
    version: VERSION,
    exists: () => true,
  })
  assert.equal(api.ok, true)
  assert.equal(api.prefix, API_PREFIX)
  assert.equal(server.routes.length, 1)
  assert.equal(server.routes[0].kind, 'prefix')
  assert.equal(server.routes[0].path, API_PREFIX)

  const missing = await call(server, 'GET', `${API_PREFIX}/nope`)
  assert.equal(missing.statusCode, 404)
  assert.equal(missing.json().error.code, 'not-found')

  const wrong = await call(server, 'POST', API_PATHS.state, { body: { action: 'apply' } })
  assert.equal(wrong.statusCode, 405)
  assert.equal(wrong.headers.allow, 'GET')
  assert.equal(wrong.headers['cache-control'], 'no-store')

  const wrongAction = await call(server, 'GET', API_PATHS.action)
  assert.equal(wrongAction.statusCode, 405)
  assert.equal(wrongAction.headers.allow, 'POST')
  api.dispose()
})

test('T3/T4 认证围栏：connection 缺失 503，401/403 原样', async () => {
  const controller = fakeController()

  const missingServer = createServer()
  const missingApi = registerHttpApi({
    server: missingServer,
    gate: () => undefined,
    controller,
    exists: () => true,
  })
  const missing = await call(missingServer, 'GET', API_PATHS.state)
  assert.equal(missing.statusCode, 503)
  assert.equal(missing.json().error, 'authentication unavailable')
  assert.equal(missing.headers['cache-control'], 'no-store')
  assert.equal(controller.calls.length, 0, '认证失败不触达 controller')
  missingApi.dispose()

  for (const rejection of [401, 403]) {
    const server = createServer()
    const api = registerHttpApi({
      server,
      gate: () => authGate(rejection),
      controller,
      exists: () => true,
    })
    const res = await call(server, 'GET', API_PATHS.state)
    assert.equal(res.statusCode, rejection)
    assert.equal(res.json().error, rejection === 401 ? 'unauthorized' : 'forbidden')
    assert.equal(controller.calls.length, 0)
    api.dispose()
  }
})

test('T5 GET state：200 + plugin/version + state + no-store', async () => {
  const server = createServer()
  const controller = fakeController({
    status: (args) => ({
      projectRoot: args.projectRoot,
      projectRootSource: args.projectRootSource,
      targets: [{ id: 'skill:office', kind: 'skill', name: 'office', current: 'zh' }],
      api: { version: VERSION, prefix: API_PREFIX, actions: API_ACTIONS },
    }),
  })
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller,
    version: VERSION,
    exists: () => true,
    now: () => 12345,
  })

  const res = await call(server, 'GET', `${API_PATHS.state}?projectRoot=${encodeURIComponent('/work/proj')}`)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  const body = res.json()
  assert.equal(body.ok, true)
  assert.equal(body.plugin.name, 'dsh-skill-desc-zh')
  assert.equal(body.plugin.version, VERSION)
  assert.equal(body.serverTime, 12345)
  assert.equal(body.busy, null)
  assert.equal(body.lastAction, null)
  assert.equal(body.state.projectRoot, '/work/proj')
  assert.equal(body.state.projectRootSource, 'explicit')
  assert.equal(body.state.targets[0].id, 'skill:office')
  assert.deepEqual(controller.calls.at(-1), {
    method: 'status',
    args: { projectRoot: '/work/proj', projectRootSource: 'explicit', readOnly: true },
  })

  // GET /state 后，POST names 用刚看到的 target id/name 校验；未知名字 400。
  const known = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'refresh', names: ['office'], projectRoot: '/work/proj' },
  })
  assert.equal(known.statusCode, 200)
  const unknown = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'refresh', names: ['nope'], projectRoot: '/work/proj' },
  })
  assert.equal(unknown.statusCode, 400)
  assert.match(unknown.json().error.message, /unknown target name/u)
  api.dispose()
})

test('T6 busy：动作执行中第二个 POST 立即 409，不排队', async () => {
  const server = createServer()
  const gate = deferred()
  const controller = fakeController({
    apply: async () => {
      await gate.promise
      return { ok: true, action: 'apply', summary: 'slow-applied' }
    },
  })
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller,
    version: VERSION,
    exists: () => true,
  })

  const route = server.routes[0]
  const firstReq = new FakeRequest({
    method: 'POST',
    url: API_PATHS.action,
    headers: { 'content-type': 'application/json' },
  })
  const firstRes = new FakeResponse()
  const firstPending = route.handler(firstReq, firstRes)
  firstReq.emit('data', Buffer.from(JSON.stringify({ action: 'apply', projectRoot: '/work/proj' })))
  firstReq.emit('end')
  await new Promise((resolve) => setImmediate(resolve))

  const second = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'apply', projectRoot: '/work/proj' },
  })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'busy')
  assert.equal(second.json().busy.action, 'apply')

  gate.resolve()
  await firstPending
  assert.equal(firstRes.statusCode, 200)
  assert.equal(firstRes.json().action, 'apply')

  const third = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'refresh', projectRoot: '/work/proj' },
  })
  assert.equal(third.statusCode, 200, '前一个动作结束后恢复可用')
  api.dispose()
})

test('T7 POST action：参数透传 controller，返回同源 result + state', async () => {
  const server = createServer()
  const controller = fakeController()
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller,
    version: VERSION,
    exists: () => true,
  })

  const res = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'apply', names: ['acp'], force: true, projectRoot: '/work/proj' },
  })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.ok, true)
  assert.equal(body.action, 'apply')
  assert.equal(body.result.summary, 'applied')
  assert.equal(body.state.summary, 'state-ok')
  assert.deepEqual(controller.calls[0], {
    method: 'apply',
    args: { names: ['acp'], projectRoot: '/work/proj', force: true },
  })
  assert.equal(controller.calls[1].method, 'status')

  const missingType = await call(server, 'POST', API_PATHS.action, {
    body: '{}',
    headers: { 'content-type': '' },
  })
  assert.equal(missingType.statusCode, 400)
  assert.match(missingType.json().error.message, /Content-Type/u)

  const restore = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'restore', dryRun: true, projectRoot: '/work/proj' },
  })
  assert.equal(restore.statusCode, 200)
  assert.equal(restore.json().result.summary, 'restored')
  api.dispose()
})

test('T8 动作异常：500 通用错误，响应不泄漏堆栈，日志保留细节', async () => {
  const server = createServer()
  const logs = []
  const controller = fakeController({
    apply: async () => {
      throw new Error('secret stack /Users/private/path')
    },
  })
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller,
    version: VERSION,
    exists: () => true,
    logger: { error: (message) => logs.push(message) },
  })

  const res = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'apply', projectRoot: '/work/proj' },
  })
  assert.equal(res.statusCode, 500)
  assert.equal(res.json().ok, false)
  assert.equal(res.json().error.code, 'internal')
  assert.equal(res.json().error.message, 'internal error')
  assert.doesNotMatch(res.body, /secret|private|at /u)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /secret stack/u)
  api.dispose()
})

test('T9 projectRoot 解析：explicit → state → session → cwd', () => {
  const exists = (value) => ['/work/explicit', '/work/state-new', '/work/session'].includes(value)
  assert.deepEqual(
    resolveRequestProjectRoot({ explicit: '/work/explicit', exists }),
    { ok: true, projectRoot: '/work/explicit', source: 'explicit' },
  )
  assert.equal(resolveRequestProjectRoot({ explicit: '/work/missing', exists }).ok, false)

  const state = {
    projects: {
      '/work/state-old': { updatedAt: 1 },
      '/work/state-new': { updatedAt: 5 },
      '/work/state-gone': { updatedAt: 9 },
    },
  }
  assert.deepEqual(
    resolveRequestProjectRoot({ state, exists }),
    { ok: true, projectRoot: '/work/state-new', source: 'state' },
  )

  const agents = { list: () => [{ session: { id: 's1' }, updatedAt: 2 }, { session: { id: 's2' }, updatedAt: 4 }] }
  const workingDirectory = { get: (session) => (session.id === 's2' ? '/work/session' : undefined) }
  assert.deepEqual(
    resolveRequestProjectRoot({ state: { projects: {} }, agents, workingDirectory, exists }),
    { ok: true, projectRoot: '/work/session', source: 'session' },
  )

  assert.deepEqual(
    resolveRequestProjectRoot({ state: { projects: {} }, agents: { list: () => [] }, cwd: '/work/cwd', exists }),
    { ok: true, projectRoot: '/work/cwd', source: 'cwd' },
  )
})

test('T10 dispose：路由与 internal/service 监听都被释放；无 server 时惰性等待', () => {
  const server = createServer()
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller: fakeController(),
    version: VERSION,
  })
  assert.equal(server.routes.length, 1)
  api.dispose()
  assert.equal(server.routes.length, 0)
  api.dispose()
  assert.equal(server.routes.length, 0, '重复 dispose 幂等')

  const listeners = new Map()
  let lateServer
  const ctx = {
    get: (name) => (name === 'webServer' ? lateServer : undefined),
    on(name, handler) {
      listeners.set(name, handler)
      return () => listeners.delete(name)
    },
  }
  const lazy = registerHttpApi({ ctx, controller: fakeController(), version: VERSION })
  assert.equal(lazy.ok, false)
  assert.match(lazy.reason, /webServer/u)
  assert.equal(typeof listeners.get('internal/service'), 'function')

  lateServer = createServer()
  listeners.get('internal/service')('webServer')
  assert.equal(lateServer.routes.length, 1, '服务晚到时补注册路由')
  assert.equal(listeners.size, 0, '补注册后摘掉 internal/service 监听')
  lazy.dispose()
  assert.equal(lateServer.routes.length, 0)
})

test('T11 动作 throw 后释放 busy：500 后 GET/POST 不再 409', async () => {
  const server = createServer()
  const controller = fakeController({
    apply: async () => {
      throw new Error('boom')
    },
  })
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller,
    version: VERSION,
    exists: () => true,
  })

  const failed = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'apply', projectRoot: '/work/proj' },
  })
  assert.equal(failed.statusCode, 500)
  assert.equal(failed.json().error.code, 'internal')

  const state = await call(server, 'GET', `${API_PATHS.state}?projectRoot=${encodeURIComponent('/work/proj')}`)
  assert.equal(state.statusCode, 200, 'throw 后 GET 不应被 busy 拦截')
  assert.equal(state.json().busy, null, 'busy 已释放')

  const next = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'refresh', projectRoot: '/work/proj' },
  })
  assert.equal(next.statusCode, 200, 'throw 后下一次 POST 应正常执行')
  api.dispose()
})

test('T12 慢动作超时 504，且迟到 rejection 不产生 unhandledRejection', async () => {
  const server = createServer()
  const controller = fakeController({
    apply: () => new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('late boom')), 60)
    }),
  })
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller,
    version: VERSION,
    exists: () => true,
    timeoutMs: 20,
  })

  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const res = await call(server, 'POST', API_PATHS.action, {
      body: { action: 'apply', projectRoot: '/work/proj' },
    })
    assert.equal(res.statusCode, 504)
    assert.equal(res.json().error.code, 'timeout')
    assert.equal(res.json().busy, null, '超时收口后 busy 立即释放')

    const state = await call(server, 'GET', `${API_PATHS.state}?projectRoot=${encodeURIComponent('/work/proj')}`)
    assert.equal(state.statusCode, 200, '超时后 GET 不应被 busy 拦截')

    // 等迟到的 rejection 真正发生，确认没有 unhandledRejection。
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.deepEqual(unhandled, [], '迟到的 rejection 必须被消费')
  } finally {
    process.off('unhandledRejection', onUnhandled)
    api.dispose()
  }
})

test('T13 正常动作结束后释放 busy：后续 POST/GET 不被 409 拦截', async () => {
  const server = createServer()
  const gate = deferred()
  const controller = fakeController({
    apply: async () => {
      await gate.promise
      return { ok: true, action: 'apply', summary: 'slow-applied' }
    },
  })
  const api = registerHttpApi({
    server,
    gate: () => authGate(undefined),
    controller,
    version: VERSION,
    exists: () => true,
  })

  const route = server.routes[0]
  const firstReq = new FakeRequest({
    method: 'POST',
    url: API_PATHS.action,
    headers: { 'content-type': 'application/json' },
  })
  const firstRes = new FakeResponse()
  const firstPending = route.handler(firstReq, firstRes)
  firstReq.emit('data', Buffer.from(JSON.stringify({ action: 'apply', projectRoot: '/work/proj' })))
  firstReq.emit('end')
  await new Promise((resolve) => setImmediate(resolve))

  gate.resolve()
  await firstPending
  assert.equal(firstRes.statusCode, 200)

  const next = await call(server, 'POST', API_PATHS.action, {
    body: { action: 'refresh', projectRoot: '/work/proj' },
  })
  assert.equal(next.statusCode, 200, '正常结束后 busy 已释放')

  const state = await call(server, 'GET', `${API_PATHS.state}?projectRoot=${encodeURIComponent('/work/proj')}`)
  assert.equal(state.statusCode, 200)
  assert.equal(state.json().busy, null)
  api.dispose()
})


function fakePluginAdmin(overrides = {}) {
  const calls = { list: [], update: [] }
  const admin = {
    calls,
    version: 1,
    async list(args = {}) {
      calls.list.push(args)
      return {
        ok: true,
        profile: { name: 'desktop', dir: '/Users/tester/.dsh/profiles/desktop', source: 'desktopProfiles' },
        registry: 'https://registry.npmjs.org/',
        pluginManager: true,
        checkedAt: 1_700_000_000_000,
        officialCount: 3,
        plugins: [
          { name: 'dshmarket', version: '1.66.44', latestVersion: '1.66.45', updateAvailable: true, updateable: true, kind: 'npm', local: false, enabled: true },
          { name: 'dsh-skill-desc-zh', version: '0.4.0', updateAvailable: false, updateable: false, kind: 'local', local: true, enabled: true },
        ],
        warnings: [],
        ...(overrides.list ? await overrides.list(args) : {}),
      }
    },
    async update(args = {}) {
      calls.update.push(args)
      return {
        ok: true,
        name: args.name,
        from: '1.66.44',
        to: '1.66.45',
        application: 'restart-required',
        restartRequired: true,
        warnings: [],
        ...(overrides.update ? await overrides.update(args) : {}),
      }
    },
  }
  return admin
}

test('T14 GET /plugins：返回插件列表与 profile 信息，force 由 refresh=1 触发', async () => {
  const server = createServer()
  const admin = fakePluginAdmin()
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true, pluginAdmin: admin })

  const res = await call(server, 'GET', API_PLUGIN_PATHS.list)
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.ok, true)
  assert.equal(body.profile.name, 'desktop')
  assert.equal(body.plugins.length, 2)
  assert.equal(typeof body.serverTime, 'number')
  assert.deepEqual(admin.calls.list, [{ force: false }])

  const forced = await call(server, 'GET', `${API_PLUGIN_PATHS.list}?refresh=1`)
  assert.equal(forced.statusCode, 200)
  assert.deepEqual(admin.calls.list.at(-1), { force: true })
  api.dispose()
})

test('T15 插件管理后台缺失时返回 503 unavailable', async () => {
  const server = createServer()
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true })

  const list = await call(server, 'GET', API_PLUGIN_PATHS.list)
  assert.equal(list.statusCode, 503)
  assert.equal(list.json().error.code, 'unavailable')

  const update = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'update', name: 'dshmarket' } })
  assert.equal(update.statusCode, 503)
  assert.equal(update.json().error.code, 'unavailable')
  api.dispose()
})

test('T16 POST /plugins/action：check 强制刷新、update 透传 name', async () => {
  const server = createServer()
  const admin = fakePluginAdmin()
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true, pluginAdmin: admin })

  const check = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'check' } })
  assert.equal(check.statusCode, 200)
  assert.equal(check.json().action, 'check')
  assert.deepEqual(admin.calls.list.at(-1), { force: true })

  const update = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'update', name: 'dshmarket' } })
  assert.equal(update.statusCode, 200)
  const body = update.json()
  assert.equal(body.ok, true)
  assert.equal(body.action, 'update')
  assert.equal(body.result.to, '1.66.45')
  assert.equal(body.result.restartRequired, true)
  assert.deepEqual(admin.calls.update, [{ name: 'dshmarket' }])
  api.dispose()
})

test('T17 更新失败（业务失败）以 200 + ok:false 透传，不当作 5xx', async () => {
  const server = createServer()
  const admin = fakePluginAdmin({
    update: async () => ({ ok: false, code: 'quarantine', message: '仍在依赖供应链隔离期内' }),
  })
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true, pluginAdmin: admin })

  const res = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'update', name: 'dshmarket' } })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.ok, false)
  assert.equal(body.result.code, 'quarantine')
  assert.match(body.result.message, /隔离期/u)
  api.dispose()
})

test('T18 插件路由的 400/405：缺 name、未知 action、非 JSON、方法不符', async () => {
  const server = createServer()
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true, pluginAdmin: fakePluginAdmin() })

  const noName = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'update' } })
  assert.equal(noName.statusCode, 400)
  assert.match(noName.json().error.message, /缺少要更新的插件名/u)

  const unknown = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'delete-all' } })
  assert.equal(unknown.statusCode, 400)
  assert.equal(unknown.json().error.code, 'bad-request')

  const notJson = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'check' }, headers: { 'content-type': 'text/plain' } })
  assert.equal(notJson.statusCode, 400)
  assert.match(notJson.json().error.message, /Content-Type/u)

  const wrongMethod = await call(server, 'GET', API_PLUGIN_PATHS.action)
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.headers.allow, 'POST')

  const wrongMethod2 = await call(server, 'POST', API_PLUGIN_PATHS.list, { body: { action: 'check' } })
  assert.equal(wrongMethod2.statusCode, 405)
  assert.equal(wrongMethod2.headers.allow, 'GET')
  api.dispose()
})

test('T19 插件操作串行化：列表在途时其它请求 409，结束后恢复', async () => {
  const server = createServer()
  const gate = deferred()
  let started
  const startedPromise = new Promise((resolve) => { started = resolve })
  const admin = fakePluginAdmin({
    list: async () => {
      started()
      await gate.promise
      return {}
    },
  })
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true, pluginAdmin: admin })
  const route = server.routes[0]

  const listReq = new FakeRequest({ method: 'GET', url: API_PLUGIN_PATHS.list })
  const listRes = new FakeResponse()
  const pending = route.handler(listReq, listRes)
  await startedPromise

  const second = await call(server, 'GET', API_PLUGIN_PATHS.list)
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().busy.action, 'list')
  const third = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'check' } })
  assert.equal(third.statusCode, 409)

  gate.resolve()
  await pending
  assert.equal(listRes.statusCode, 200)
  const after = await call(server, 'GET', API_PLUGIN_PATHS.list)
  assert.equal(after.statusCode, 200)
  api.dispose()
})

test('T20 并发插件 POST：单飞在首个 await 前占用，第二个请求 409 busy', async () => {
  const server = createServer()
  const gate = deferred()
  let started
  const startedPromise = new Promise((resolve) => { started = resolve })
  const admin = fakePluginAdmin({
    update: async () => {
      started()
      await gate.promise
      return { ok: true, name: 'dshmarket', to: '1.66.45', restartRequired: false }
    },
  })
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true, pluginAdmin: admin })
  const route = server.routes[0]

  const firstReq = new FakeRequest({ method: 'POST', url: API_PLUGIN_PATHS.action, headers: { 'content-type': 'application/json' } })
  const firstRes = new FakeResponse()
  const pending = route.handler(firstReq, firstRes)
  firstReq.emit('data', Buffer.from(JSON.stringify({ action: 'update', name: 'dshmarket' })))
  firstReq.emit('end')
  await startedPromise

  const second = await call(server, 'POST', API_PLUGIN_PATHS.action, { body: { action: 'update', name: 'dshmarket' } })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'busy')

  gate.resolve()
  await pending
  assert.equal(firstRes.statusCode, 200)
  assert.equal(firstRes.json().ok, true)
  api.dispose()
})


test('K1 parseSkillActionRequest：动作/字段/scope/体积白名单', () => {
  assert.deepEqual(API_SKILL_ACTIONS, ['create', 'save', 'delete', 'restore', 'disable', 'enable'])
  assert.equal(API_SKILL_PATHS.list, `${API_PREFIX}/skills`)
  const valid = parseSkillActionRequest({ action: 'save', scope: 'user', name: 'demo', description: '中文描述', body: '# 正文', expectedFingerprint: 'sha256:abc', dryRun: true })
  assert.equal(valid.ok, true)
  assert.equal(valid.value.projectRoot, null)
  assert.equal(parseSkillActionRequest({ action: 'create', scope: 'global', name: 'demo', description: 'x' }).ok, false)
  assert.equal(parseSkillActionRequest({ action: 'create', scope: 'user', name: '../x', description: 'x' }).ok, false)
  assert.equal(parseSkillActionRequest({ action: 'create', scope: 'user', name: 'demo', description: 'a\nb' }).ok, false)
  assert.equal(parseSkillActionRequest({ action: 'create', scope: 'user', name: 'demo', description: 'x'.repeat(401) }).ok, false)
  assert.equal(parseSkillActionRequest({ action: 'restore' }).ok, false)
  assert.equal(parseSkillActionRequest({ action: 'delete', scope: 'project', name: 'x' }).ok, true)
  assert.equal(parseSkillActionRequest('x'.repeat(SKILL_MAX_BODY_BYTES + 1)).status, 413)
  assert.equal(parseSkillActionRequest({ action: 'save', projectRoot: 'relative' }).status, 400)
})

test('K2 skills 路由：GET list/detail、POST action，方法不符 405', async () => {
  const server = createServer()
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true })
  const list = await call(server, 'GET', API_SKILL_PATHS.list)
  assert.equal(list.statusCode, 200)
  assert.equal(list.json().ok, true)
  assert.deepEqual(list.json().skills, [])
  const wrong = await call(server, 'POST', API_SKILL_PATHS.list, { body: {} })
  assert.equal(wrong.statusCode, 405)
  assert.equal(wrong.headers.allow, 'GET')
  const wrongAction = await call(server, 'GET', API_SKILL_PATHS.action)
  assert.equal(wrongAction.statusCode, 405)
  assert.equal(wrongAction.headers.allow, 'POST')
  api.dispose()
})

test('K3 skills list 透传 projectRoot/source/refresh，并返回 sources 与 cache 头', async () => {
  const server = createServer()
  const controller = fakeController()
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller, version: VERSION, exists: () => true })
  const res = await call(server, 'GET', `${API_SKILL_PATHS.list}?projectRoot=/Users/tester/work/proj&source=user&refresh=1`)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  const args = controller.calls.find((entry) => entry.method === 'skills').args
  assert.equal(args.source, 'user')
  assert.equal(args.refresh, true)
  assert.equal(args.projectRoot, path.resolve('/Users/tester/work/proj'))
  assert.equal(args.projectRootSource, 'explicit')
  api.dispose()
})

test('K4 skills detail 缺 name → 400；正常透传 scope/name', async () => {
  const server = createServer()
  const controller = fakeController()
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller, version: VERSION, exists: () => true })
  assert.equal((await call(server, 'GET', `${API_SKILL_PATHS.detail}?scope=user`)).statusCode, 400)
  assert.equal((await call(server, 'GET', `${API_SKILL_PATHS.detail}?scope=bad&name=x`)).statusCode, 400)
  const ok = await call(server, 'GET', `${API_SKILL_PATHS.detail}?scope=user&name=demo`)
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().name, 'demo')
  api.dispose()
})

test('K5 skills action 成功/业务失败均为 200，动作参数完整', async () => {
  const server = createServer()
  const controller = fakeController({
    skillAction: async (args) => (args.action === 'delete' ? { ok: false, code: 'conflict', message: '目标已存在' } : { ok: true, result: { created: args.name } }),
  })
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller, version: VERSION, exists: () => true })
  const created = await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'create', scope: 'user', name: 'demo', description: '新技能' } })
  assert.equal(created.statusCode, 200, created.body)
  assert.equal(created.json().ok, true)
  assert.equal(created.json().result.created, 'demo')
  const failed = await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'delete', scope: 'user', name: 'demo' } })
  assert.equal(failed.statusCode, 200)
  assert.equal(failed.json().ok, false)
  assert.equal(failed.json().error.code, 'conflict')
  api.dispose()
})

test('K6 skills action 单飞：进行中第二次 POST 409 busy，结束后 GET 正常', async () => {
  const server = createServer()
  const gate = deferred()
  let started
  const startedPromise = new Promise((resolve) => { started = resolve })
  const controller = fakeController({
    skillAction: async () => {
      started()
      await gate.promise
      return { ok: true, result: {} }
    },
  })
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller, version: VERSION, exists: () => true })
  const route = server.routes[0]
  const firstReq = new FakeRequest({ method: 'POST', url: API_SKILL_PATHS.action, headers: { 'content-type': 'application/json' } })
  const firstRes = new FakeResponse()
  const pending = route.handler(firstReq, firstRes)
  firstReq.emit('data', Buffer.from(JSON.stringify({ action: 'save', scope: 'user', name: 'demo', description: 'x' })))
  firstReq.emit('end')
  await startedPromise
  const second = await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'disable', scope: 'user', name: 'demo' } })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error.code, 'busy')
  assert.equal((await call(server, 'GET', API_SKILL_PATHS.list)).statusCode, 200)
  gate.resolve()
  await pending
  assert.equal(firstRes.statusCode, 200)
  assert.equal((await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'enable', scope: 'user', name: 'demo' } })).statusCode, 200)
  api.dispose()
})

test('K7 skills action：handler 抛错 → 500 且 busy 释放（下一次 POST 不再 409）', async () => {
  const server = createServer()
  let calls = 0
  const controller = fakeController({
    skillAction: async () => {
      calls += 1
      if (calls === 1) throw new Error('boom')
      return { ok: true, result: {} }
    },
  })
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller, version: VERSION, exists: () => true })
  const first = await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'save', scope: 'user', name: 'demo', description: 'x' } })
  assert.equal(first.statusCode, 500)
  const second = await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'enable', scope: 'user', name: 'demo' } })
  assert.equal(second.statusCode, 200)
  api.dispose()
})

test('K8 skills 路由：无 controller 方法 → 503；未授权 → 401', async () => {
  const server = createServer()
  const controller = fakeController()
  delete controller.skills
  delete controller.skillDetail
  delete controller.skillAction
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller, version: VERSION, exists: () => true })
  assert.equal((await call(server, 'GET', API_SKILL_PATHS.list)).statusCode, 503)
  assert.equal((await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'restore', id: 'x' } })).statusCode, 503)
  api.dispose()
  const gated = createServer()
  const denied = registerHttpApi({ server: gated, gate: () => authGate(401), controller: fakeController(), version: VERSION, exists: () => true })
  assert.equal((await call(gated, 'GET', API_SKILL_PATHS.list)).statusCode, 401)
  denied.dispose()
})

test('K9 skills action：非法 body 400、超大 body 413，且不占用 busy', async () => {
  const server = createServer()
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller: fakeController(), version: VERSION, exists: () => true })
  const bad = await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'nope' } })
  assert.equal(bad.statusCode, 400)
  const huge = await call(server, 'POST', API_SKILL_PATHS.action, { body: 'x'.repeat(SKILL_MAX_BODY_BYTES + 1) })
  assert.equal(huge.statusCode, 413)
  assert.equal((await call(server, 'POST', API_SKILL_PATHS.action, { body: { action: 'restore', id: 'd1' } })).statusCode, 200)
  api.dispose()
})

test('K10 描述动作与技能动作互斥：技能动作进行中描述 POST 409', async () => {
  const server = createServer()
  const gate = deferred()
  let started
  const startedPromise = new Promise((resolve) => { started = resolve })
  const controller = fakeController({
    skillAction: async () => {
      started()
      await gate.promise
      return { ok: true, result: {} }
    },
  })
  const api = registerHttpApi({ server, gate: () => authGate(undefined), controller, version: VERSION, exists: () => true })
  const route = server.routes[0]
  const req = new FakeRequest({ method: 'POST', url: API_SKILL_PATHS.action, headers: { 'content-type': 'application/json' } })
  const res = new FakeResponse()
  const pending = route.handler(req, res)
  req.emit('data', Buffer.from(JSON.stringify({ action: 'save', scope: 'user', name: 'demo', description: 'x' })))
  req.emit('end')
  await startedPromise
  const description = await call(server, 'POST', API_PATHS.action, { body: { action: 'apply' } })
  assert.equal(description.statusCode, 409)
  gate.resolve()
  await pending
  api.dispose()
})
