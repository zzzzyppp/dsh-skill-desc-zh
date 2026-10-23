/**
 * L1 覆盖通道：在 skills 服务上注册一个 provider。
 *
 * 默认用于 global 层（office 七个技能 + 捕获到的 runtime 技能）；也可传入
 * `providerName` / `rank` / `filter` 复用同一套逻辑去注册 agent 层 provider
 * （见 agent-layer.js）。description 换成中文，其余字段（content、resourceBase、
 * invocation、source 等）从捕获到的宿主定义原样透传。这样 office-render /
 * office-recalculate / office-export-pdf 的 “## Installed LibreOffice Kit”
 * 运行时附录不会丢。
 *
 * 防自噬：就绪前（以及刷新捕获期间）list() 返回空且 complete=false；
 * 捕获完成后再 invalidate，让下一次 pre-step 读到中文目录。
 */

export const PROVIDER_NAME = 'skill-desc-zh'
export const PROVIDER_RANK = 50

/**
 * @param {{
 *   captured: Map<string, object>,
 *   isEnabled: () => boolean,
 *   isReady: () => boolean,
 *   isCapturing?: () => boolean,
 *   translationFor?: (record: object) => {zh?: string, engine?: string} | undefined,
 *   logger?: {debug?: Function, warn?: Function},
 *   providerName?: string,
 *   rank?: number,
 *   filter?: (record: object) => boolean,
 * }} options
 */
export function createProvider(options) {
  const captured = options.captured
  const isEnabled = options.isEnabled
  const isReady = options.isReady
  const isCapturing = options.isCapturing ?? (() => false)
  const translationFor = options.translationFor ?? (() => undefined)
  const logger = options.logger ?? {}
  const providerName = options.providerName ?? PROVIDER_NAME
  const rank = Number.isFinite(options.rank) ? options.rank : PROVIDER_RANK
  const filter = typeof options.filter === 'function' ? options.filter : () => true

  function displayDescription(record) {
    const translated = translationFor(record)
    const zh = typeof translated?.zh === 'string' ? translated.zh.trim() : ''
    if (zh.length > 0) return zh
    return record.definition.description
  }

  function candidateFor(record) {
    const definition = record.definition
    const candidate = {
      name: record.name,
      description: displayDescription(record),
      invocation: definition.invocation,
      source: definition.source,
      provider: providerName,
      rank,
    }
    if (typeof definition.whenToUse === 'string' && definition.whenToUse.length > 0) {
      candidate.whenToUse = definition.whenToUse
    }
    if (definition.resourceBase !== undefined) candidate.resourceBase = definition.resourceBase
    if (typeof definition.path === 'string') candidate.path = definition.path
    return candidate
  }

  const provider = {
    name: providerName,

    list() {
      if (!isEnabled() || isCapturing() || !isReady()) {
        return { candidates: [], complete: false }
      }
      const candidates = []
      for (const record of captured.values()) {
        if (!filter(record)) continue
        try {
          candidates.push(candidateFor(record))
        } catch (error) {
          logger.warn?.(`provider 候选生成失败 ${record?.name ?? '?'}：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return { candidates, complete: true }
    },

    async get(candidate) {
      if (!isEnabled() || !isReady()) return undefined
      const record = captured.get(candidate?.name)
      if (!record || !filter(record)) return undefined
      const definition = record.definition
      const description = displayDescription(record)
      if (typeof description !== 'string' || description.length === 0) return undefined
      return {
        name: record.name,
        description,
        invocation: definition.invocation,
        source: definition.source,
        provider: providerName,
        content: definition.content,
        ...(definition.resourceBase !== undefined ? { resourceBase: definition.resourceBase } : {}),
        ...(typeof definition.whenToUse === 'string' ? { whenToUse: definition.whenToUse } : {}),
        ...(typeof definition.path === 'string' ? { path: definition.path } : {}),
      }
    },
  }

  return provider
}
