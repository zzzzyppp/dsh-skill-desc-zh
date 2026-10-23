import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  ADMIN_VERSION,
  DEFAULT_REGISTRY,
  LATEST_TTL_MS,
  SELF_PLUGIN_NAME,
  classifySource,
  collectInstalledPlugins,
  compareVersions,
  createPluginAdmin,
  encodePackageName,
  fetchLatestVersion,
  installedPackageVersion,
  isIgnoredBuildsError,
  isNewerVersion,
  isReleaseAgeError,
  profileNameFromArgv,
  resolveProfileTarget,
} from '../lib/plugin-admin.js'
import { createMemfs } from './helpers/memfs.mjs'

const HOME = '/Users/tester'
const PROFILE_DIR = path.join(HOME, '.dsh', 'profiles', 'desktop')
const NODE_MODULES = path.join(PROFILE_DIR, 'node_modules')
const dshHome = path.join(HOME, '.dsh')

function makeCtx(services = {}) {
  return {
    get(name) {
      return services[name]
    },
  }
}

function makeFs(extraFiles = {}) {
  const memfs = createMemfs({ cwd: HOME, now: () => 1_700_000_000_000 })
  memfs.seed({
    [path.join(PROFILE_DIR, 'package.json')]: JSON.stringify({
      name: 'profile-desktop',
      dependencies: {
        'dsh-skill-desc-zh': 'link:/Users/tester/work/skill-desc-zh',
        '@deepseek-ai/dsh-base': '0.2.1-rc.2',
        dshmarket: '1.66.44',
        '@nanmicoder/dsh-agent-teams': '0.1.25',
        'git-plugin': 'github:owner/repo',
      },
    }),
    [path.join(NODE_MODULES, '@nanmicoder', 'dsh-agent-teams', 'package.json')]: JSON.stringify({
      name: '@nanmicoder/dsh-agent-teams',
      version: '0.1.25',
    }),
    ...extraFiles,
  })
  return memfs
}

function bundle(overrides = {}) {
  return {
    name: 'dshmarket',
    official: false,
    availability: 'profile',
    version: '1.66.44',
    enabled: true,
    installed: true,
    meta: { title: '插件市场', description: '在图形界面里浏览与安装插件', icon: 'market' },
    ...overrides,
  }
}

function defaultBundles() {
  return [
    bundle(),
    bundle({ name: '@deepseek-ai/dsh-base', official: true, version: '0.2.1-rc.2', meta: undefined }),
    bundle({
      name: '@nanmicoder/dsh-agent-teams',
      version: undefined,
      meta: { title: { 'zh-CN': '智能体团队', en: 'Agent teams' }, description: { en: 'Teams' } },
    }),
    bundle({ name: 'dsh-skill-desc-zh', version: '0.4.0' }),
    bundle({ name: 'git-plugin', version: '0.1.0' }),
    bundle({ name: 'disabled-plugin', enabled: false, installed: false }),
  ]
}

function fakeManager(bundles = defaultBundles(), options = {}) {
  const calls = { listBundles: 0, registries: 0, inspect: [], installBundle: [] }
  return {
    calls,
    async listBundles() {
      calls.listBundles += 1
      if (options.listBundlesError) throw new Error(options.listBundlesError)
      return bundles
    },
    async registries() {
      calls.registries += 1
      return { registry: DEFAULT_REGISTRY, resolved: options.registry ?? DEFAULT_REGISTRY }
    },
    async inspect(spec) {
      calls.inspect.push(spec)
      return options.inspect ? options.inspect(spec) : { status: 'accepted' }
    },
    async installBundle(spec, installOptions) {
      calls.installBundle.push({ spec, installOptions })
      return options.install ? options.install(spec, installOptions) : { changed: true, application: 'applied', version: '9.9.9' }
    },
  }
}

function registryFetch(versions) {
  const calls = []
  async function fetchImpl(url, init) {
    calls.push({ url, init })
    const name = decodeURIComponent(url.slice(DEFAULT_REGISTRY.length).replace(/\/latest$/u, ''))
    if (!(name in versions)) return { ok: false, status: 404, async json() { return {} } }
    return { ok: true, status: 200, async json() { return { version: versions[name] } } }
  }
  fetchImpl.calls = calls
  return fetchImpl
}

function makeAdmin(options = {}) {
  return createPluginAdmin({
    ctx: makeCtx(options.services ?? { desktopProfiles: { current: { name: 'desktop', dir: PROFILE_DIR } } }),
    logger: { debug() {}, warn() {} },
    fs: options.fs ?? makeFs(),
    fetchImpl: options.fetchImpl ?? registryFetch({ dshmarket: '1.66.45', '@nanmicoder/dsh-agent-teams': '0.1.25' }),
    now: options.now ?? (() => 1_700_000_000_000),
    cacheTtlMs: options.cacheTtlMs ?? LATEST_TTL_MS,
    env: {},
    home: path.join(HOME, '.dsh'),
    argv: options.argv ?? ['node', 'dsh'],
    pluginManager: options.pluginManager ?? fakeManager(options.bundles, options.managerOptions),
  })
}

test('常量与 classifySource：npm 之外的来源一律不可更新', () => {
  assert.equal(ADMIN_VERSION, 1)
  assert.equal(SELF_PLUGIN_NAME, 'dsh-skill-desc-zh')
  assert.equal(DEFAULT_REGISTRY, 'https://registry.npmjs.org/')
  assert.equal(classifySource('dshmarket'), 'npm')
  assert.equal(classifySource('@scope/pkg'), 'npm')
  assert.equal(classifySource('dshmarket@1.66.44'), 'npm')
  assert.equal(classifySource('^1.66.44'), 'npm')
  assert.equal(classifySource('~0.2.1'), 'npm')
  assert.equal(classifySource('npm:alias@1.2.3'), 'npm')
  assert.equal(classifySource('0.1.25'), 'npm')
  assert.equal(classifySource('link:/Users/tester/work/plugin'), 'local')
  assert.equal(classifySource('file:../plugin'), 'local')
  assert.equal(classifySource('workspace:*'), 'workspace')
  assert.equal(classifySource('github:owner/repo'), 'git')
  assert.equal(classifySource('git+https://x/y.git'), 'git')
  assert.equal(classifySource('https://example.com/a.tgz'), 'tarball')
  assert.equal(classifySource('a.tgz'), 'tarball')
  assert.equal(classifySource(''), 'unknown')
  assert.equal(classifySource(undefined), 'unknown')
})

test('版本比较：数字段 / 预发布 / v 前缀 / 非法输入', () => {
  assert.deepEqual(compareVersions('1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1)
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.2.3-beta.1', '1.2.3'), -1)
  assert.equal(compareVersions('1.2.3-beta.2', '1.2.3-beta.1'), 1)
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('0.2.1-rc.2', '0.2.1-rc.1'), 1)
  assert.equal(isNewerVersion('1.66.45', '1.66.44'), true)
  assert.equal(isNewerVersion('1.66.44', '1.66.44'), false)
  assert.equal(isNewerVersion('0.2.1-rc.1', '0.2.1-rc.2'), false)
  assert.equal(isNewerVersion('1.0.0', undefined), false)
  assert.equal(isNewerVersion('not-a-version', '1.0.0'), false)
})

test('错误分类与 argv profile 解析', () => {
  assert.equal(isReleaseAgeError('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION: too new'), true)
  assert.equal(isReleaseAgeError('发布年龄白名单无法安全合并'), false)
  assert.equal(isIgnoredBuildsError('ERR_PNPM_IGNORED_BUILDS cpu-features'), true)
  assert.equal(isIgnoredBuildsError('all good'), false)
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile', 'desktop']), 'desktop')
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile=web']), 'web')
  assert.equal(profileNameFromArgv(['node', 'dsh']), undefined)
  assert.equal(profileNameFromArgv(['node', 'dsh', '--profile', 'bad name']), undefined)
})

test('resolveProfileTarget：desktopProfiles > profileContext > env > argv > 默认', () => {
  const fs = makeFs()
  fs.seed({ [path.join(HOME, '.dsh', 'profiles', 'web', 'package.json')]: JSON.stringify({ name: 'web' }) })

  const desktopProfiles = {
    current: { name: 'desktop', dir: PROFILE_DIR },
  }
  const first = resolveProfileTarget(makeCtx({ desktopProfiles }), { fs, env: {}, home: dshHome, argv: ['node', 'dsh'] })
  assert.equal(first.ok, true)
  assert.equal(first.profileName, 'desktop')
  assert.equal(first.profileDir, PROFILE_DIR)
  assert.equal(first.source, 'desktopProfiles')

  const context = resolveProfileTarget(makeCtx({ profileContext: { name: 'web', dir: path.join(HOME, '.dsh', 'profiles', 'web') } }), {
    fs,
    env: {},
    home: dshHome,
    argv: ['node', 'dsh'],
  })
  assert.equal(context.ok, true)
  assert.equal(context.profileName, 'web')
  assert.equal(context.source, 'profileContext')

  const fromEnv = resolveProfileTarget(makeCtx(), { fs, env: { DSH_PROFILE_DIR: path.join(HOME, '.dsh', 'profiles', 'web') }, home: dshHome, argv: ['node', 'dsh'] })
  assert.equal(fromEnv.ok, true)
  assert.equal(fromEnv.profileName, 'web')
  assert.equal(fromEnv.source, 'env')

  const fromArgv = resolveProfileTarget(makeCtx(), { fs, env: {}, home: dshHome, argv: ['node', 'dsh', '--profile', 'web'] })
  assert.equal(fromArgv.ok, true)
  assert.equal(fromArgv.profileName, 'web')
  assert.equal(fromArgv.source, 'argv')

  // 非法 --profile 不采用错误名，而是继续尝试默认 profile（此处 web 存在）。
  const fallback = resolveProfileTarget(makeCtx(), { fs, env: {}, home: dshHome, argv: ['node', 'dsh', '--profile', 'nope'] })
  assert.equal(fallback.ok, true)
  assert.equal(fallback.profileName, 'web')
  assert.equal(fallback.source, 'default')

  const emptyFs = createMemfs({ cwd: HOME })
  const missing = resolveProfileTarget(makeCtx(), { fs: emptyFs, env: {}, home: dshHome, argv: ['node', 'dsh', '--profile', 'nope'] })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'profile-not-found')
  assert.match(missing.message, /未找到可管理的 profile 目录/u)
})

test('resolveProfileTarget：ctx 服务抛错时不崩溃，继续回退', () => {
  const fs = makeFs()
  const ctx = {
    get() {
      throw new Error('inactive context')
    },
  }
  const resolved = resolveProfileTarget(ctx, { fs: createMemfs({ cwd: HOME }), env: {}, home: dshHome, argv: ['node', 'dsh'] })
  assert.equal(resolved.ok, false)
  assert.equal(resolved.code, 'profile-not-found')
})

test('collectInstalledPlugins：过滤官方/缺失、来源分类、版本回退与排序', async () => {
  const fs = makeFs({
    [path.join(NODE_MODULES, 'dsh-skill-desc-zh', 'package.json')]: JSON.stringify({ name: 'dsh-skill-desc-zh', version: '0.4.0' }),
  })
  const manager = fakeManager()
  const collected = await collectInstalledPlugins({ fs, profileDir: PROFILE_DIR, pluginManager: manager })
  assert.equal(collected.officialCount, 1)
  assert.equal(collected.bundleError, undefined)
  assert.deepEqual(collected.plugins.map((plugin) => plugin.name), [
    '@nanmicoder/dsh-agent-teams',
    'dsh-skill-desc-zh',
    'dshmarket',
    'git-plugin',
  ])
  const teams = collected.plugins.find((plugin) => plugin.name === '@nanmicoder/dsh-agent-teams')
  assert.equal(teams.version, '0.1.25', 'bundle 未给版本时回退读 node_modules')
  assert.equal(teams.title, '智能体团队')
  assert.equal(teams.kind, 'npm')
  assert.equal(teams.updateable, true)
  assert.equal(collected.plugins.find((plugin) => plugin.name === 'dsh-skill-desc-zh').self, true)
  assert.equal(collected.plugins.find((plugin) => plugin.name === 'dsh-skill-desc-zh').kind, 'local')
  assert.equal(collected.plugins.find((plugin) => plugin.name === 'dsh-skill-desc-zh').updateable, false)
  assert.equal(collected.plugins.find((plugin) => plugin.name === 'git-plugin').kind, 'git')
  assert.equal(collected.plugins.find((plugin) => plugin.name === 'git-plugin').updateable, false)
  assert.equal(collected.plugins.find((plugin) => plugin.name === 'disabled-plugin'), undefined, 'installed:false 的 bundle 被跳过')
})

test('collectInstalledPlugins：pluginManager 缺失或抛错时降级为 bundleError', async () => {
  const fs = makeFs()
  const noManager = await collectInstalledPlugins({ fs, profileDir: PROFILE_DIR })
  assert.equal(noManager.plugins.length, 0)
  assert.match(noManager.bundleError, /pluginManager/u)

  const broken = fakeManager(undefined, { listBundlesError: 'inactive context' })
  const collected = await collectInstalledPlugins({ fs, profileDir: PROFILE_DIR, pluginManager: broken })
  assert.equal(collected.plugins.length, 0)
  assert.match(collected.bundleError, /inactive context/u)

  await assert.rejects(
    collectInstalledPlugins({ fs: createMemfs({ cwd: HOME }), profileDir: path.join(HOME, 'missing') }),
    (error) => error.code === 'profile-unreadable',
  )
})

test('installedPackageVersion 与 encodePackageName', () => {
  const fs = makeFs({
    [path.join(NODE_MODULES, 'dshmarket', 'package.json')]: JSON.stringify({ name: 'dshmarket', version: '1.66.44' }),
  })
  assert.equal(installedPackageVersion(fs, PROFILE_DIR, 'dshmarket'), '1.66.44')
  assert.equal(installedPackageVersion(fs, PROFILE_DIR, 'nope'), undefined)
  assert.equal(installedPackageVersion(fs, PROFILE_DIR, ''), undefined)
  assert.equal(encodePackageName('dshmarket'), 'dshmarket')
  assert.equal(encodePackageName('@scope/pkg'), '@scope%2fpkg')
})

test('fetchLatestVersion：URL 编码、404、非 2xx、坏 JSON、无 fetch', async () => {
  const calls = []
  const okFetch = async (url) => {
    calls.push(url)
    return { ok: true, status: 200, async json() { return { version: '1.2.3' } } }
  }
  assert.equal(await fetchLatestVersion('dshmarket', { fetchImpl: okFetch }), '1.2.3')
  assert.equal(await fetchLatestVersion('@scope/pkg', { fetchImpl: okFetch }), '1.2.3')
  assert.deepEqual(calls, [
    'https://registry.npmjs.org/dshmarket/latest',
    'https://registry.npmjs.org/@scope%2fpkg/latest',
  ])

  await assert.rejects(
    fetchLatestVersion('missing', { fetchImpl: async () => ({ ok: false, status: 404, async json() { return {} } }) }),
    (error) => error.code === 'not-found',
  )
  await assert.rejects(
    fetchLatestVersion('down', { fetchImpl: async () => ({ ok: false, status: 503, async json() { return {} } }) }),
    (error) => error.code === 'network',
  )
  await assert.rejects(
    fetchLatestVersion('bad', { fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new Error('boom') } }) }),
    (error) => error.code === 'bad-response',
  )
  await assert.rejects(
    fetchLatestVersion('nofetch', { fetchImpl: 'not-a-function' }),
    (error) => error.code === 'network',
  )
})

test('list：汇总插件、标记可更新、缓存 TTL 与 force 刷新', async () => {
  const fetchImpl = registryFetch({ dshmarket: '1.66.45', '@nanmicoder/dsh-agent-teams': '0.1.25' })
  const manager = fakeManager()
  const admin = makeAdmin({ fetchImpl, pluginManager: manager })
  const first = await admin.list()
  assert.equal(first.ok, true)
  assert.equal(first.cached, false)
  assert.equal(first.profile.name, 'desktop')
  assert.equal(first.profile.source, 'desktopProfiles')
  assert.equal(first.registry, DEFAULT_REGISTRY)
  assert.equal(first.pluginManager, true)
  assert.equal(first.officialCount, 1)
  const market = first.plugins.find((plugin) => plugin.name === 'dshmarket')
  assert.equal(market.latestVersion, '1.66.45')
  assert.equal(market.updateAvailable, true)
  const teams = first.plugins.find((plugin) => plugin.name === '@nanmicoder/dsh-agent-teams')
  assert.equal(teams.updateAvailable, false)
  const self = first.plugins.find((plugin) => plugin.name === 'dsh-skill-desc-zh')
  assert.equal(self.updateable, false)
  assert.equal(self.latestVersion, undefined)
  const fetchCount = fetchImpl.calls.length
  assert.equal(fetchCount, 2, '只对 npm 第三方插件查 registry')

  const cached = await admin.list()
  assert.equal(cached.cached, true)
  assert.equal(fetchImpl.calls.length, fetchCount, 'TTL 内不重复请求')

  const forced = await admin.list({ force: true })
  assert.equal(forced.cached, false)
  assert.equal(fetchImpl.calls.length, fetchCount + 2)

  admin.invalidate()
  const again = await admin.list()
  assert.equal(again.cached, false)
})

test('list：registry 检查失败按插件记 latestError 并汇总 warnings', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('dshmarket')) return { ok: false, status: 404, async json() { return {} } }
    return { ok: false, status: 500, async json() { return {} } }
  }
  const admin = makeAdmin({ fetchImpl })
  const data = await admin.list()
  assert.equal(data.ok, true)
  assert.equal(data.plugins.find((plugin) => plugin.name === 'dshmarket').latestError, 'registry 中不存在该包')
  assert.match(data.plugins.find((plugin) => plugin.name === '@nanmicoder/dsh-agent-teams').latestError, /HTTP 500/u)
  assert.equal(data.warnings.length, 1)
  assert.match(data.warnings[0], /2 个插件的版本检查失败/u)
})

test('list：profile 无法解析时返回 ok:false，不触碰 pluginManager', async () => {
  const admin = createPluginAdmin({
    ctx: makeCtx(),
    fs: createMemfs({ cwd: HOME }),
    fetchImpl: registryFetch({}),
    env: {},
    home: dshHome,
    argv: ['node', 'dsh'],
    pluginManager: fakeManager(),
  })
  const data = await admin.list()
  assert.equal(data.ok, false)
  assert.equal(data.code, 'profile-not-found')
  const described = admin.describe()
  assert.equal(described.ok, false)
  assert.equal(described.code, 'profile-not-found')
})

test('describe：未检查前无 cached，检查后给出统计', async () => {
  const admin = makeAdmin()
  const before = admin.describe()
  assert.equal(before.ok, true)
  assert.equal(before.version, ADMIN_VERSION)
  assert.equal(before.pluginManager, true)
  assert.equal(before.profile.name, 'desktop')
  assert.equal(before.cached, undefined)
  await admin.list()
  const after = admin.describe()
  assert.equal(after.cached.total, 4)
  assert.equal(after.cached.updateable, 1)
  assert.equal(typeof after.cached.checkedAt, 'number')
})

test('update：名称缺失 / 未知插件 / 非 npm 来源 / 已是最新都被拒绝', async () => {
  const admin = makeAdmin()
  assert.equal((await admin.update({})).code, 'bad-request')
  assert.equal((await admin.update({ name: 'ghost-plugin' })).code, 'unknown-plugin')
  const local = await admin.update({ name: 'dsh-skill-desc-zh' })
  assert.equal(local.ok, false)
  assert.equal(local.code, 'not-updateable')
  const noUpdate = await admin.update({ name: '@nanmicoder/dsh-agent-teams' })
  assert.equal(noUpdate.ok, false)
  assert.equal(noUpdate.code, 'no-update')
  assert.match(noUpdate.message, /已是最新版本/u)
})

test('update：成功更新返回 from/to/restartRequired 并失效缓存', async () => {
  const installCalls = []
  const manager = fakeManager(defaultBundles(), {
    install: async (spec) => {
      installCalls.push(spec)
      return { changed: true, application: 'restart-required', restartReason: 'host-module', version: '1.66.45', warnings: ['ok'] }
    },
  })
  const admin = makeAdmin({ pluginManager: manager })
  await admin.list()
  const result = await admin.update({ name: 'dshmarket' })
  assert.equal(result.ok, true)
  assert.equal(result.name, 'dshmarket')
  assert.equal(result.from, '1.66.44')
  assert.equal(result.to, '1.66.45')
  assert.equal(result.application, 'restart-required')
  assert.equal(result.restartRequired, true)
  assert.equal(result.restartReason, 'host-module')
  assert.deepEqual(result.warnings, ['ok'])
  assert.deepEqual(installCalls, ['dshmarket@1.66.45'])
  assert.deepEqual(manager.calls.inspect, ['dshmarket@1.66.45'])
  // 缓存已失效：下次 describe 不再带 cached。
  assert.equal(admin.describe().cached, undefined)
})

test('update：inspect 拒绝时透传 problem/reason，不执行安装', async () => {
  const manager = fakeManager(defaultBundles(), {
    inspect: async () => ({ status: 'refused', problem: 'incompatible-version', reason: 'host 0.2.1-rc.2 不兼容 2.0.0' }),
  })
  const admin = makeAdmin({ pluginManager: manager })
  const result = await admin.update({ name: 'dshmarket' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'incompatible-version')
  assert.match(result.message, /宿主预检拒绝/u)
  assert.match(result.message, /host 0\.2\.1-rc\.2 不兼容/u)
  assert.equal(manager.calls.installBundle.length, 0)
})

test('update：安装失败分类为 quarantine / pending-builds / incompatible / install-failed', async () => {
  async function failureFor(install) {
    const admin = makeAdmin({ pluginManager: fakeManager(undefined, { install }) })
    return admin.update({ name: 'dshmarket' })
  }

  const quarantine = await failureFor(async () => ({
    changed: false,
    application: 'failed',
    error: { code: 'operation-error', diagnostic: 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION dshmarket@1.66.45' },
  }))
  assert.equal(quarantine.code, 'quarantine')
  assert.match(quarantine.message, /隔离期/u)

  const pending = await failureFor(async () => ({ changed: false, application: 'failed', pendingBuilds: ['cpu-features', 'ssh2'] }))
  assert.equal(pending.code, 'pending-builds')
  assert.match(pending.message, /cpu-features/u)

  const ignored = await failureFor(async () => ({
    changed: false,
    application: 'failed',
    packageResult: { exitCode: 1, output: 'ERR_PNPM_IGNORED_BUILDS ignored build scripts' },
  }))
  assert.equal(ignored.code, 'pending-builds')

  const incompatible = await failureFor(async () => ({
    application: 'cancelled',
    error: { code: 'incompatible-version', incompatible: [{ name: '@deepseek-ai/dsh-client-runtime', version: '0.1.1-rc.2', requirements: ['^0.2.0'] }] },
  }))
  assert.equal(incompatible.code, 'incompatible')
  assert.match(incompatible.message, /dsh-client-runtime/u)

  const failed = await failureFor(async () => ({ application: 'failed', error: { message: 'pnpm crashed' } }))
  assert.equal(failed.code, 'install-failed')
  assert.match(failed.message, /pnpm crashed/u)
})

test('update：并发更新时第二个请求返回 busy', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const manager = fakeManager(defaultBundles(), {
    install: async () => {
      await gate
      return { changed: true, application: 'applied', version: '1.66.45' }
    },
  })
  const admin = makeAdmin({ pluginManager: manager })
  await admin.list()
  const first = admin.update({ name: 'dshmarket' })
  for (let i = 0; i < 200 && manager.calls.installBundle.length === 0; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(manager.calls.installBundle.length, 1)
  const second = await admin.update({ name: 'dshmarket' })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'busy')
  release()
  const result = await first
  assert.equal(result.ok, true)
  assert.equal(result.application, 'applied')
  assert.equal(result.restartRequired, false)
})

test('update：pluginManager 不可用时返回 unavailable，且不误报 profile 错误', async () => {
  const admin = createPluginAdmin({
    ctx: makeCtx(),
    fs: makeFs(),
    fetchImpl: registryFetch({}),
    env: {},
    home: path.join(HOME, '.dsh'),
    argv: ['node', 'dsh'],
    pluginManager: { listBundles: async () => [] },
  })
  const result = await admin.update({ name: 'dshmarket' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unavailable')
})

test('dispose 清理缓存', async () => {
  const admin = makeAdmin()
  await admin.list()
  assert.equal(admin.describe().cached.total, 4)
  admin.dispose()
  assert.equal(admin.describe().cached, undefined)
})

test('返回值可无损 JSON 往返（宿主 snapshotJsonValue 契约）', async () => {
  const manager = fakeManager(defaultBundles(), {
    install: async () => ({ changed: true, application: 'applied', version: '1.66.45' }),
  })
  const admin = makeAdmin({ pluginManager: manager })
  const listed = await admin.list()
  assert.deepEqual(JSON.parse(JSON.stringify(listed)), listed)
  const described = admin.describe()
  assert.deepEqual(JSON.parse(JSON.stringify(described)), described)
  const updated = await admin.update({ name: 'dshmarket' })
  assert.deepEqual(JSON.parse(JSON.stringify(updated)), updated)
})

test('update：单飞在首个 await 前占用，并发调用只安装一次', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const manager = fakeManager(defaultBundles(), {
    install: async () => {
      await gate
      return { changed: true, application: 'applied', version: '1.66.45' }
    },
  })
  const admin = makeAdmin({ pluginManager: manager })
  await admin.list()
  const first = admin.update({ name: 'dshmarket' })
  const second = admin.update({ name: 'dshmarket' })
  const secondResult = await second
  assert.equal(secondResult.ok, false)
  assert.equal(secondResult.code, 'busy')
  release()
  const firstResult = await first
  assert.equal(firstResult.ok, true)
  assert.equal(manager.calls.installBundle.length, 1)
})
