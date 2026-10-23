/**
 * 插件管理后台（v0.4.0）：列出当前 profile 的第三方插件、检查 npm 更新、一键更新。
 *
 * 设计边界（与 skills-manager 的差异，全部为有意收紧）：
 *  - 更新走宿主 pluginManager.installBundle()（宿主自带兼容性闸门、构建脚本批准、
 *    安装日志），不绕过 pnpm 的 minimumReleaseAge（供应链隔离期）：失败时如实提示。
 *  - 绝不自动写入 profile 的 minimumReleaseAgeExclude 白名单（该文件被污染会让
 *    profile 之后所有 pnpm 安装失败，见 pnpm-workspace.yaml 内注释）。
 *  - 不 fetch 完整 packument 取发布时间（corgi 缩写文档没有 time 字段），只请求
 *    `/<pkg>/latest` 判断是否有更新；隔离期交给安装期错误分类。
 *  - 官方 bundle（@deepseek-ai/*）与本地 link 插件不参与更新；本插件自身是
 *    `link:` 安装，天然不可更新。
 *
 * 本模块不 import 宿主包，只依赖 node 内建，便于单测（fs / fetch 均可注入）。
 */

import fsDefault from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export const ADMIN_VERSION = 1
export const SELF_PLUGIN_NAME = 'dsh-skill-desc-zh'
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'
export const LATEST_TTL_MS = 5 * 60 * 1000
export const LATEST_TIMEOUT_MS = 8_000
export const MAX_LATEST_CONCURRENCY = 6
export const MAX_DETAIL_CHARS = 500

/**
 * 把任意值递归转换成语义无损的 JSON 值。
 *
 * 宿主工具层用 `snapshotJsonValue()` 校验结果：含 `undefined`（哪怕只是属性值）、
 * NaN/Infinity/-0、BigInt、Date、类实例或稀疏数组时，整条工具结果会被判为
 * “value is not lossless JSON”。本函数在返回边界统一清洗，保证：
 * - undefined 属性被丢弃、数组中的 undefined 变 null；
 * - NaN / Infinity / -0 变 null；BigInt 变十进制字符串；Date 变 ISO 字符串；
 * - 只保留普通对象与稠密数组（类实例按自有可枚举属性展开）。
 */
export function toLosslessJson(value) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : null
  if (type === 'bigint') return value.toString()
  if (type !== 'object') return undefined
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = toLosslessJson(item)
      return next === undefined ? null : next
    })
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const out = {}
  for (const key of Object.keys(value)) {
    const next = toLosslessJson(value[key])
    if (next !== undefined) out[key] = next
  }
  return out
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u
const RELEASE_AGE = /MINIMUM_RELEASE_AGE|minimumReleaseAge|ERR_PNPM_MINIMUM/u
const IGNORED_BUILDS = /ERR_PNPM_IGNORED_BUILDS|ignored build scripts|approve-builds|build scripts? (?:are |is )?not (?:yet )?approved/iu

function safeGet(ctx, name) {
  try {
    return ctx?.get?.(name)
  } catch {
    return undefined
  }
}

function clipText(text, limit = MAX_DETAIL_CHARS) {
  const value = String(text ?? '').replace(/\s+/gu, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function failed(code, message) {
  return { ok: false, code, message }
}

/** 依赖声明 → 来源类型。npm 之外的来源一律视为“不可在本页更新”。 */
export function classifySource(spec) {
  if (typeof spec !== 'string' || spec.trim().length === 0) return 'unknown'
  const value = spec.trim()
  if (/^(?:link|file|portal):/u.test(value)) return 'local'
  if (/^workspace:/u.test(value)) return 'workspace'
  if (/^(?:git\+|github:|gitlab:|bitbucket:|git@)/u.test(value)) return 'git'
  if (/^https?:/u.test(value) || /\.tgz$/u.test(value)) return 'tarball'
  // 其余一律视为 npm 源：package.json 里可能是精确版本、范围（^1.2.3 / ~1.2.3）、
  // 通配符或 npm: 别名，这些都由 registry 解析；不认识的写法也交给宿主报错。
  return 'npm'
}

export function parseVersion(value) {
  if (typeof value !== 'string') return undefined
  const match = VERSION.exec(value.trim())
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    raw: value.trim(),
  }
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/u.test(left)
  const rightNumeric = /^\d+$/u.test(right)
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const size = Math.max(left.length, right.length)
  for (let index = 0; index < size; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const diff = compareIdentifiers(a, b)
    if (diff !== 0) return diff
  }
  return 0
}

/** 语义化版本比较；无法解析时返回 0（调用方应视为“不确定”）。 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  return comparePrerelease(a.prerelease, b.prerelease)
}

export function isNewerVersion(candidate, current) {
  if (typeof candidate !== 'string' || typeof current !== 'string') return false
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  return compareVersions(candidate, current) > 0
}

export function isReleaseAgeError(text) {
  return RELEASE_AGE.test(String(text ?? ''))
}

export function isIgnoredBuildsError(text) {
  return IGNORED_BUILDS.test(String(text ?? ''))
}

export function profileNameFromArgv(argv = []) {
  if (!Array.isArray(argv)) return undefined
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (typeof item !== 'string') continue
    if (item === '--profile') {
      const next = argv[index + 1]
      if (typeof next === 'string' && PROFILE_NAME.test(next)) return next
      continue
    }
    const inline = /^--profile=(.+)$/u.exec(item)
    if (inline && PROFILE_NAME.test(inline[1])) return inline[1]
  }
  return undefined
}

function readJson(fs, file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

export function installedPackageVersion(fs, profileDir, name) {
  if (typeof name !== 'string' || name.length === 0) return undefined
  const file = path.join(profileDir, 'node_modules', name, 'package.json')
  const pkg = readJson(fs, file)
  return typeof pkg?.version === 'string' ? pkg.version : undefined
}

/**
 * 解析当前进程管理的 profile。
 * 优先级：desktopProfiles.current（桌面端权威）→ profileContext（CLI 启动器）
 *        → DSH_PROFILE_DIR → --profile 参数 → web → desktop 默认目录。
 * 只有含 package.json 的目录才算命中。
 */
export function resolveProfileTarget(ctx, options = {}) {
  const fs = options.fs ?? fsDefault
  const env = options.env ?? process.env
  const argv = options.argv ?? process.argv
  const home = options.home ?? env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  const pluginManager = options.pluginManager ?? safeGet(ctx, 'pluginManager')
  const candidates = []

  const desktopProfiles = safeGet(ctx, 'desktopProfiles')
  if (desktopProfiles && typeof desktopProfiles === 'object' && desktopProfiles.current && typeof desktopProfiles.current === 'object') {
    candidates.push({ name: desktopProfiles.current.name, dir: desktopProfiles.current.dir, source: 'desktopProfiles' })
  }
  const profileContext = safeGet(ctx, 'profileContext')
  if (profileContext && typeof profileContext === 'object') {
    candidates.push({ name: profileContext.name, dir: profileContext.dir, source: 'profileContext' })
  }
  if (typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR.length > 0) {
    candidates.push({ dir: env.DSH_PROFILE_DIR, source: 'env' })
  }
  const argvName = profileNameFromArgv(argv)
  if (argvName) candidates.push({ name: argvName, source: 'argv' })
  candidates.push({ name: 'web', source: 'default' })
  candidates.push({ name: 'desktop', source: 'default' })

  const tried = []
  for (const candidate of candidates) {
    let dir
    if (typeof candidate.dir === 'string' && candidate.dir.length > 0) {
      dir = path.resolve(candidate.dir)
    }
    let name
    if (typeof candidate.name === 'string' && PROFILE_NAME.test(candidate.name)) {
      name = candidate.name
    } else if (dir) {
      const base = path.basename(dir)
      if (PROFILE_NAME.test(base)) name = base
    }
    if (!dir && name) dir = path.join(home, 'profiles', name)
    if (!dir || !name) continue
    tried.push(dir)
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue
    return {
      ok: true,
      profileName: name,
      profileDir: dir,
      source: candidate.source,
      home,
      pluginManager,
    }
  }
  return {
    ok: false,
    code: 'profile-not-found',
    message: `未找到可管理的 profile 目录（已尝试：${tried.slice(0, 4).join('、') || '无'}）`,
    home,
    pluginManager,
  }
}

function localizedMeta(meta) {
  const title = meta?.title
  const description = meta?.description
  const text = (value) => {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      for (const key of ['zh-CN', 'zh', 'en']) {
        if (typeof value[key] === 'string' && value[key].length > 0) return value[key]
      }
    }
    return undefined
  }
  return { title: text(title), description: text(description), icon: typeof meta?.icon === 'string' ? meta.icon : undefined }
}

/**
 * 汇总当前 profile 的第三方插件（只读）。bundles 由宿主 pluginManager.listBundles()
 * 提供；版本优先取 bundle.version，回退读 node_modules/<name>/package.json。
 */
export async function collectInstalledPlugins({ fs = fsDefault, profileDir, pluginManager }) {
  const pkg = readJson(fs, path.join(profileDir, 'package.json'))
  if (!pkg || typeof pkg !== 'object') {
    throw Object.assign(new Error(`无法读取 profile package.json：${path.join(profileDir, 'package.json')}`), { code: 'profile-unreadable' })
  }
  const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
  let bundles = []
  let bundleError
  if (pluginManager && typeof pluginManager.listBundles === 'function') {
    try {
      const value = await pluginManager.listBundles()
      bundles = Array.isArray(value) ? value : []
    } catch (error) {
      bundleError = String(error?.message ?? error)
    }
  } else {
    bundleError = '宿主 pluginManager 服务不可用'
  }
  const plugins = []
  let officialCount = 0
  for (const bundle of bundles) {
    if (!bundle || typeof bundle.name !== 'string' || bundle.name.length === 0) continue
    if (bundle.official === true) {
      officialCount += 1
      continue
    }
    if (bundle.installed === false) continue
    const spec = typeof deps[bundle.name] === 'string' ? deps[bundle.name] : undefined
    const kind = classifySource(spec)
    const version = typeof bundle.version === 'string' ? bundle.version : installedPackageVersion(fs, profileDir, bundle.name)
    const meta = localizedMeta(bundle.meta)
    plugins.push({
      name: bundle.name,
      version,
      title: meta.title,
      description: meta.description,
      icon: meta.icon,
      kind,
      spec,
      local: kind !== 'npm',
      self: bundle.name === SELF_PLUGIN_NAME,
      enabled: bundle.enabled !== false,
      availability: bundle.availability,
      missing: bundle.availability === 'missing',
      removable: bundle.removable,
      updateable: kind === 'npm' && bundle.name !== SELF_PLUGIN_NAME,
    })
  }
  plugins.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { plugins, deps, bundleError, officialCount }
}

export function encodePackageName(name) {
  return name.startsWith('@') ? name.replace('/', '%2f') : encodeURIComponent(name)
}

/** 查询 registry 的 latest 版本（只取 /<pkg>/latest，响应很小）。 */
export async function fetchLatestVersion(name, options = {}) {
  const registry = typeof options.registry === 'string' && options.registry.length > 0 ? options.registry : DEFAULT_REGISTRY
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? LATEST_TIMEOUT_MS
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('当前环境没有 fetch'), { code: 'network' })
  }
  const base = registry.endsWith('/') ? registry : `${registry}/`
  const url = `${base}${encodePackageName(name)}/latest`
  let response
  try {
    const init = { headers: { accept: 'application/json' } }
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(timeoutMs)
    }
    response = await fetchImpl(url, init)
  } catch (error) {
    throw Object.assign(new Error(`registry 请求失败：${String(error?.message ?? error)}`), { code: 'network' })
  }
  if (response.status === 404) {
    throw Object.assign(new Error(`registry 中不存在 ${name}`), { code: 'not-found' })
  }
  if (response.ok === false) {
    throw Object.assign(new Error(`registry 返回 HTTP ${response.status}`), { code: 'network' })
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    throw Object.assign(new Error('registry 响应不是合法 JSON'), { code: 'bad-response' })
  }
  if (typeof payload?.version !== 'string' || payload.version.length === 0) {
    throw Object.assign(new Error('registry 响应缺少 version'), { code: 'bad-response' })
  }
  return payload.version
}

async function resolveRegistry(pluginManager, fallback = DEFAULT_REGISTRY) {
  if (!pluginManager || typeof pluginManager.registries !== 'function') return fallback
  try {
    const info = await pluginManager.registries()
    const value = [info?.resolved, info?.registry, Array.isArray(info) ? info[0] : undefined]
      .find((item) => typeof item === 'string' && item.length > 0)
    return typeof value === 'string' ? value : fallback
  } catch {
    return fallback
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function installFailure(results, meta) {
  const error = results?.error ?? {}
  const output = [results?.packageResult?.output, error?.diagnostic, error?.message]
    .filter((value) => typeof value === 'string')
    .join('\n')
  if (Array.isArray(results?.pendingBuilds) && results.pendingBuilds.length > 0) {
    return {
      code: 'pending-builds',
      message: `${meta.name}@${meta.version} 需要批准构建脚本（${results.pendingBuilds.join('、')}）。本页不支持批准脚本，请在「设置 → 插件」页批准后重试。`,
    }
  }
  if (isIgnoredBuildsError(output)) {
    return {
      code: 'pending-builds',
      message: `${meta.name}@${meta.version} 的安装脚本需要批准。请在「设置 → 插件」页批准后重试。`,
    }
  }
  const incompatible = Array.isArray(error?.incompatible) ? error.incompatible : []
  if (incompatible.length > 0) {
    const detail = incompatible
      .map((item) => `${item?.name ?? '?'}@${item?.version ?? '?'}${Array.isArray(item?.requirements) && item.requirements.length > 0 ? ` 要求 ${item.requirements.join(' ')}` : ''}`)
      .join('；')
    return { code: 'incompatible', message: `宿主兼容性闸门拒绝：${clipText(detail)}` }
  }
  if (isReleaseAgeError(output)) {
    return {
      code: 'quarantine',
      message: `${meta.name}@${meta.version} 仍在依赖供应链隔离期内（minimumReleaseAge），请稍后重试（通常 24 小时内自动解除）。`,
    }
  }
  const detail = clipText(error?.diagnostic ?? error?.message ?? results?.packageResult?.output?.split('\n').slice(-3).join(' ') ?? '')
  return {
    code: error?.code === 'operation-error' ? 'operation-error' : 'install-failed',
    message: `${meta.name} 更新失败${detail ? `：${detail}` : ''}`,
  }
}

/**
 * 创建插件管理后台。
 *
 * @param {object} options
 * @param {object} [options.ctx] Cordis ctx（读取 desktopProfiles/profileContext/pluginManager）
 * @param {object} [options.logger]
 * @param {object} [options.fs] 注入 fs（测试用）
 * @param {Function} [options.fetchImpl] 注入 fetch（测试用）
 * @param {Function} [options.now]
 * @param {number} [options.cacheTtlMs]
 */
export function createPluginAdmin(options = {}) {
  const fs = options.fs ?? fsDefault
  const logger = options.logger ?? {}
  const now = options.now ?? (() => Date.now())
  const fetchImpl = options.fetchImpl
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) && options.cacheTtlMs >= 0 ? options.cacheTtlMs : LATEST_TTL_MS
  const overrides = {
    fs,
    argv: options.argv,
    env: options.env,
    home: options.home,
    pluginManager: options.pluginManager,
    ctx: options.ctx,
  }

  let cache
  let updating = null

  const target = () => resolveProfileTarget(options.ctx, overrides)
  const manager = () => overrides.pluginManager ?? safeGet(options.ctx, 'pluginManager')

  function describe() {
    const resolved = target()
    const pm = manager()
    const base = {
      version: ADMIN_VERSION,
      pluginManager: typeof pm?.installBundle === 'function',
      profile: resolved.ok ? { name: resolved.profileName, dir: resolved.profileDir, source: resolved.source } : null,
    }
    if (!resolved.ok) return toLosslessJson({ ...base, ok: false, code: resolved.code, reason: resolved.message })
    const cached = cache && cache.profileDir === resolved.profileDir && now() - cache.at < cacheTtlMs ? cache.values : undefined
    return toLosslessJson({
      ...base,
      ok: true,
      ...(cached
        ? {
            cached: {
              checkedAt: cached.checkedAt,
              total: cached.plugins.length,
              updateable: cached.plugins.filter((plugin) => plugin.updateAvailable).length,
            },
          }
        : {}),
    })
  }

  async function list(args = {}) {
    const resolved = target()
    if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message }
    const pm = manager()
    const force = args.force === true
    if (!force && cache && cache.profileDir === resolved.profileDir && now() - cache.at < cacheTtlMs) {
      return { ...cache.values, cached: true }
    }
    const collected = await collectInstalledPlugins({ fs, profileDir: resolved.profileDir, pluginManager: pm })
    const registry = await resolveRegistry(pm, typeof args.registry === 'string' ? args.registry : DEFAULT_REGISTRY)
    const warnings = []
    if (collected.bundleError) warnings.push(`无法读取宿主 bundle 列表：${collected.bundleError}`)
    const checkedAt = now()
    const plugins = await mapLimit(collected.plugins, MAX_LATEST_CONCURRENCY, async (plugin) => {
      if (!plugin.updateable || typeof plugin.version !== 'string' || plugin.version.length === 0) {
        return { ...plugin, latestVersion: undefined, updateAvailable: false }
      }
      try {
        const latestVersion = await fetchLatestVersion(plugin.name, { registry, fetchImpl, timeoutMs: options.timeoutMs })
        return { ...plugin, latestVersion, updateAvailable: isNewerVersion(latestVersion, plugin.version) }
      } catch (error) {
        return {
          ...plugin,
          latestVersion: undefined,
          updateAvailable: false,
          latestError: error?.code === 'not-found' ? 'registry 中不存在该包' : String(error?.message ?? error),
        }
      }
    })
    const latestFailures = plugins.filter((plugin) => plugin.updateable && plugin.latestError).length
    if (latestFailures > 0) {
      warnings.push(`${latestFailures} 个插件的版本检查失败（registry 不可达或包名不存在），可稍后刷新重试。`)
    }
    const values = toLosslessJson({
      ok: true,
      profile: { name: resolved.profileName, dir: resolved.profileDir, source: resolved.source },
      registry,
      pluginManager: Boolean(pm && typeof pm.installBundle === 'function'),
      checkedAt,
      officialCount: collected.officialCount,
      plugins,
      warnings,
    })
    cache = { at: checkedAt, profileDir: resolved.profileDir, values }
    return { ...values, cached: false }
  }

  async function update(args = {}) {
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (name.length === 0) return failed('bad-request', '缺少要更新的插件名')
    // 单飞：必须在任何 await 之前同步占位，否则并发 update() 会都通过检查、各自安装。
    if (updating) return failed('busy', `正在更新 ${updating.name}，请稍候`)
    const reservation = { name, startedAt: now(), token: Symbol('plugin-update') }
    updating = reservation
    try {
      const resolved = target()
      if (!resolved.ok) return failed(resolved.code, resolved.message)
      const pm = manager()
      if (!pm || typeof pm.installBundle !== 'function') {
        return failed('unavailable', '宿主 pluginManager 服务不可用，无法执行更新')
      }
      let collected
      try {
        collected = await collectInstalledPlugins({ fs, profileDir: resolved.profileDir, pluginManager: pm })
      } catch (error) {
        return failed(
          error?.code === 'profile-unreadable' ? 'profile-unreadable' : 'operation-error',
          String(error?.message ?? error),
        )
      }
      const entry = collected.plugins.find((plugin) => plugin.name === name)
      if (!entry) return failed('unknown-plugin', `${name} 不是当前 profile 可管理的第三方插件`)
      if (!entry.updateable) {
        return failed('not-updateable', `${name} 的来源是 ${entry.kind}（非 npm 安装），本页不支持更新`)
      }
      let latest
      try {
        const listed = await list({})
        latest = listed.ok ? listed.plugins.find((plugin) => plugin.name === name) : undefined
        if (!listed.ok) return failed(listed.code, listed.message)
      } catch (error) {
        return failed('network', `检查更新失败：${String(error?.message ?? error)}`)
      }
      if (!latest || !latest.updateAvailable || typeof latest.latestVersion !== 'string') {
        return failed('no-update', latest?.latestVersion ? `${name} 已是最新版本（${latest.latestVersion}）` : `${name} 没有可用的更新`)
      }
      const targetVersion = latest.latestVersion
      const fromVersion = entry.version
      const spec = `${name}@${targetVersion}`
      if (updating && updating.token === reservation.token) {
        updating = { ...reservation, name, version: targetVersion }
      }
      if (typeof pm.inspect === 'function') {
        try {
          const inspection = await pm.inspect(spec)
          if (inspection?.status === 'refused') {
            return failed(
              typeof inspection.problem === 'string' ? inspection.problem : 'inspect-refused',
              `宿主预检拒绝：${String(inspection.reason ?? inspection.problem ?? '未知原因')}`,
            )
          }
        } catch (error) {
          logger.debug?.(`skill-desc-zh: 插件预检未完成（继续安装）：${String(error?.message ?? error)}`)
        }
      }
      let result
      try {
        result = await pm.installBundle(spec)
      } catch (error) {
        const classified = installFailure({ error: { message: String(error?.message ?? error) } }, { name, version: targetVersion })
        return failed(classified.code, classified.message)
      }
      if (result && typeof result === 'object') {
        const application = result.application
        const errorCode = result.error?.code
        if (errorCode || application === 'failed' || application === 'cancelled') {
          const classified = installFailure(result, { name, version: targetVersion })
          return failed(classified.code, classified.message)
        }
        cache = undefined
        const toVersion = typeof result.version === 'string' && result.version.length > 0 ? result.version : targetVersion
        return toLosslessJson({
          ok: true,
          name,
          from: fromVersion,
          to: toVersion,
          application,
          restartRequired: application === 'restart-required',
          ...(typeof result.restartReason === 'string' && result.restartReason.length > 0 ? { restartReason: result.restartReason } : {}),
          warnings: Array.isArray(result.warnings) ? result.warnings.map((item) => clipText(item)) : [],
        })
      }
      return failed('install-failed', `${name} 更新结果无法识别`)
    } finally {
      // 幂等释放：只清掉本次预约，避免误清后来者。
      if (updating && updating.token === reservation.token) updating = null
    }
  }

  return {
    version: ADMIN_VERSION,
    describe,
    list,
    update,
    invalidate() {
      cache = undefined
    },
    dispose() {
      cache = undefined
    },
  }
}
