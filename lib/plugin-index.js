/**
 * 插件索引：读取宿主 pluginMarket 已配置的索引源，并把索引条目交给宿主
 * pluginManager 安装。
 *
 * 所有网络与安装动作都在宿主侧完成：浏览器端只调用本插件的认证路由，
 * 不直接访问索引源，也不自行拼装 pnpm 参数。
 */
import { toLosslessJson } from './plugin-admin.js'

export const PLUGIN_INDEX_VERSION = 1

const MAX_QUERY_LENGTH = 120
const MAX_PAGE_LIMIT = 50

function clampInt(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function failure(code, message, extra = {}) {
  return toLosslessJson({ ok: false, code, message, ...extra })
}

function resolveService(getter) {
  try {
    return typeof getter === 'function' ? getter() : undefined
  } catch {
    return undefined
  }
}

function normalizeEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    name: entry?.name,
    title: entry?.title,
    description: entry?.description,
    icon: entry?.icon,
    author: entry?.author,
    versions: Array.isArray(entry?.versions)
      ? entry.versions.map((version) => ({
          version: version?.version,
          publishTimestamp: version?.publishTimestamp,
          compatibility: version?.compatibility,
          install: version?.install,
        }))
      : [],
    defaultVersion: entry?.defaultVersion,
    installation: entry?.installation,
  }))
}

function normalizeInstallResult(result, { name, version }) {
  if (!result || typeof result !== 'object') {
    return failure('install-failed', '宿主插件管理器没有返回结果', { name, version })
  }
  const error = result.error && typeof result.error === 'object'
    ? {
        code: result.error.code,
        message: result.error.diagnostic?.message ?? result.error.code,
        incompatible: result.error.incompatible,
      }
    : null
  const pendingBuilds = Array.isArray(result.pendingBuilds) ? result.pendingBuilds : []
  return toLosslessJson({
    ok: result.application !== 'failed' && result.application !== 'cancelled' && !error,
    name,
    version,
    changed: result.changed === true,
    application: result.application,
    restartRequired: result.application === 'restart-required'
      || result.application === 'applied'
      || result.application === 'overridden',
    restartReason: result.restartReason,
    stage: result.stage,
    enabled: result.enabled,
    pendingBuilds,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    error,
  })
}

/**
 * @param {object} options
 * @param {(name: string) => unknown} options.getService 按名字取宿主服务
 * @param {object} [options.logger]
 */
export function createPluginIndex({ getService, logger = {} } = {}) {
  let running = null

  function market() {
    return resolveService(() => getService?.('pluginMarket'))
  }

  function manager() {
    return resolveService(() => getService?.('pluginManager'))
  }

  function describe() {
    const marketService = market()
    const managerService = manager()
    return toLosslessJson({
      version: PLUGIN_INDEX_VERSION,
      market: Boolean(marketService && typeof marketService.listIndexes === 'function'),
      manager: Boolean(managerService && typeof managerService.installBundle === 'function'),
    })
  }

  async function sources() {
    const service = market()
    if (!service || typeof service.listIndexes !== 'function') {
      return failure('market-unavailable', '宿主未提供插件索引服务')
    }
    try {
      const list = await service.listIndexes()
      return toLosslessJson({
        ok: true,
        action: 'sources',
        sources: (Array.isArray(list) ? list : []).map((source) => ({
          url: source?.url,
          title: source?.title,
          description: source?.description,
          error: source?.error,
        })),
      })
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 读取插件索引源失败：${String(error?.message ?? error)}`)
      return failure('market-failed', String(error?.message ?? error))
    }
  }

  async function search({ url, text, offset, limit, refresh } = {}) {
    const service = market()
    if (!service || typeof service.search !== 'function') {
      return failure('market-unavailable', '宿主未提供插件索引服务')
    }
    if (typeof url !== 'string' || url.length === 0) {
      return failure('invalid-query', '缺少索引源 URL')
    }
    const query = {
      sort: { kind: 'relevance' },
      offset: clampInt(offset, 0, 0, 10000),
      limit: clampInt(limit, 20, 1, MAX_PAGE_LIMIT),
    }
    const term = typeof text === 'string' ? text.trim().slice(0, MAX_QUERY_LENGTH) : ''
    if (term.length > 0) query.text = term
    if (refresh === true) query.refresh = true
    try {
      const page = await service.search(url, query)
      return toLosslessJson({
        ok: true,
        action: 'search',
        url: page?.url ?? url,
        title: page?.title,
        description: page?.description,
        metadata: page?.metadata,
        fetchedAt: page?.fetchedAt,
        total: page?.total,
        nextOffset: page?.nextOffset,
        entries: normalizeEntries(page?.entries),
      })
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 插件索引搜索失败：${String(error?.message ?? error)}`)
      return failure('market-failed', String(error?.message ?? error), { url })
    }
  }

  async function locate(url, name) {
    const service = market()
    if (!service) return undefined
    if (typeof service.entry === 'function') {
      const entry = await service.entry(url, name)
      if (entry) return entry
    }
    if (typeof service.search === 'function') {
      const page = await service.search(url, {
        text: typeof name === 'string' ? name : '',
        sort: { kind: 'relevance' },
        offset: 0,
        limit: 50,
      })
      const entries = Array.isArray(page?.entries) ? page.entries : []
      return entries.find((entry) => entry?.name === name)
    }
    return undefined
  }

  async function install({ url, name, version } = {}) {
    if (typeof name !== 'string' || name.length === 0) {
      return failure('invalid-query', '缺少插件名')
    }
    if (running) return failure('busy', '已有安装任务在运行，请稍后再试', { name })
    const managerService = manager()
    if (!managerService || typeof managerService.installBundle !== 'function') {
      return failure('plugin-manager-unavailable', '宿主未提供插件管理器')
    }
    running = { name, startedAt: Date.now() }
    try {
      let target
      try {
        const entry = await locate(url, name)
        if (!entry) return failure('not-found', `索引源中没有 ${name}`, { name })
        const versions = Array.isArray(entry.versions) ? entry.versions : []
        const chosen = typeof version === 'string' && version.length > 0
          ? versions.find((item) => item?.version === version)
          : versions.find((item) => item?.version === entry.defaultVersion) ?? versions[0]
        target = chosen?.install
        if (!target || typeof target.spec !== 'string') {
          return failure('no-install-target', '该条目没有可安装的版本', { name, version })
        }
      } catch (error) {
        return failure('market-failed', String(error?.message ?? error), { name })
      }
      const options = {}
      if (typeof target.registry === 'string' && target.registry.length > 0) options.registry = target.registry
      let result
      try {
        result = await managerService.installBundle(target.spec, options)
      } catch (error) {
        return failure('install-failed', String(error?.message ?? error), {
          name,
          version: target.spec,
        })
      }
      return normalizeInstallResult(result, {
        name,
        version: typeof target.spec === 'string' ? target.spec : name,
      })
    } finally {
      running = null
    }
  }

  return {
    version: PLUGIN_INDEX_VERSION,
    describe,
    sources,
    search,
    install,
    get busy() {
      return running !== null
    },
  }
}
