/**
 * agent 层覆盖通道：覆盖在 agent scope 里注册的 runtime 技能（如 browser-skill）。
 *
 * 宿主合并规则（app.asar 内 @deepseek-ai/dsh-skill/lib/index.js）：读目录时把
 * global 层与查看者 scope 链合并，**最近层的同名条目直接获胜**，rank 只决定同
 * 一层内的先后。runtime 技能由各插件在 `agent/created` 里用
 * `agent.ctx.get('skills').register()` 写进该 agent 的 scope 层（rank 250），
 * 因此 global provider（rank 50）压不过它；必须同样经 `agent.ctx` 注册一个
 * 落在该 agent 层的 provider，并用更小的 rank（50 < 250）在同层胜出。
 *
 * cordis 的 traceable 机制会把服务方法里的 `this.ctx` 重绑到调用方 ctx
 * （@deepseek-ai/cordis/lib/index.js 的 createTraceable / createShadowMethod），
 * 所以只要从 `agent.ctx` 取 skills 服务再调 registerProvider，注册就落进
 * agent 层 —— browser-skill 自己也是用同样的方式注册的。
 *
 * 防自噬与 global provider 一致：未就绪 / 捕获中 / 禁用时 list() 返回空。
 */

import path from 'node:path'

import { createProvider } from './provider.js'

export const AGENT_PROVIDER_NAME = 'skill-desc-zh-agent'
export const AGENT_PROVIDER_RANK = 50
/** runtime 技能的注册 rank（仅用于文档/自检说明）。 */
export const RUNTIME_SKILL_RANK = 250

/** 发现阶段只把 runtime 技能标记成 isRuntime，agent 层 provider 只列这些记录。 */
export function isRuntimeRecord(record) {
  return record?.isRuntime === true
}

/**
 * 创建 agent 层 provider：与 global provider 同一套候选/定义逻辑，但只服务
 * runtime 记录，并使用不同的 provider 名与更小的 rank。
 *
 * @param {{
 *   captured: Map<string, object>,
 *   isEnabled: () => boolean,
 *   isReady: () => boolean,
 *   isCapturing?: () => boolean,
 *   translationFor?: (record: object) => {zh?: string, engine?: string} | undefined,
 *   logger?: {debug?: Function, warn?: Function},
 *   filter?: (record: object) => boolean,
 * }} options
 */
export function createAgentProvider(options = {}) {
  return createProvider({
    ...options,
    providerName: AGENT_PROVIDER_NAME,
    rank: AGENT_PROVIDER_RANK,
    filter: typeof options.filter === 'function' ? options.filter : isRuntimeRecord,
  })
}

/**
 * 通过某个 agent 的 scoped ctx 注册 agent 层 provider。
 *
 * 注册写在 agent 自己的生命周期里：agent 销毁时宿主自动移除，不需要我们手动
 * 反注册；`control` 交回给调用方用于级联 invalidate。
 *
 * @param {{
 *   agent: object,
 *   provider: object,
 *   onControl?: (control: object) => void,
 *   logger?: {debug?: Function, warn?: Function},
 * }} options
 */
export function registerAgentLayerProvider(options = {}) {
  const { agent, provider, onControl, logger = {} } = options
  let agentSkills
  try {
    agentSkills = agent?.ctx?.get?.('skills')
  } catch (error) {
    return {
      ok: false,
      skipped: true,
      reason: `读取 agent.ctx 的 skills 服务失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!agentSkills || typeof agentSkills.registerProvider !== 'function') {
    return { ok: false, skipped: true, reason: 'agent.ctx 上没有可用的 skills 服务' }
  }
  if (!provider || typeof provider.list !== 'function' || typeof provider.get !== 'function') {
    return { ok: false, skipped: true, reason: 'agent 层 provider 不可用' }
  }
  try {
    const disposer = agentSkills.registerProvider((control) => {
      try {
        onControl?.(control)
      } catch (error) {
        logger.warn?.(`agent 层 control 回调失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return provider
    })
    logger.debug?.(`agent 层 provider ${provider.name} 已注册（rank ${AGENT_PROVIDER_RANK}）`)
    return {
      ok: true,
      providerName: provider.name,
      provider,
      dispose: () => {
        try {
          disposer?.()
        } catch {
          /* agent 已销毁时反注册可能抛错，忽略 */
        }
      },
    }
  } catch (error) {
    return {
      ok: false,
      reason: `注册 agent 层 provider 失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * 禁用影子（v0.5）：在 agent 层注册同名候选，description 加「（已禁用）」、
 * invocation 全 false、rank 40（同层压过 filesystem 的 100/200/300/400/500）。
 * content 每次从磁盘现读（D4），不缓存；不改源文件。
 */
export const AGENT_DISABLED_PROVIDER_NAME = 'skill-desc-zh-disabled'
export const AGENT_DISABLED_RANK = 40
export const DISABLED_PREFIX = '（已禁用）'

export function hasDisabledEntries(state) {
  return Array.isArray(state?.skillAdmin?.disabled) && state.skillAdmin.disabled.length > 0
}

function cwdMatches(cwd, projectRoot) {
  if (typeof cwd !== 'string' || typeof projectRoot !== 'string') return false
  const relative = path.relative(path.resolve(projectRoot), path.resolve(cwd))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * @param {{
 *   state: object,
 *   readTarget: (entry: {scope:string,name:string,projectRoot:string|null}) => object | undefined,
 *   isEnabled?: () => boolean,
 *   isReady?: () => boolean,
 *   logger?: object,
 * }} options
 */
export function createDisabledProvider(options = {}) {
  const { state, readTarget, logger = {} } = options
  const providerName = AGENT_DISABLED_PROVIDER_NAME
  const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true
  const isReady = typeof options.isReady === 'function' ? options.isReady : () => true

  function entriesFor(optionsArg = {}) {
    if (!isEnabled() || !isReady() || !hasDisabledEntries(state)) return []
    const cwd = optionsArg.cwd
    const out = []
    for (const entry of state.skillAdmin.disabled) {
      if (!entry || typeof entry.name !== 'string') continue
      if (entry.scope === 'project') {
        if (!cwdMatches(cwd, entry.projectRoot)) continue
      } else if (entry.scope !== 'user') {
        continue
      }
      let target
      try {
        target = readTarget?.({ scope: entry.scope, name: entry.name, projectRoot: entry.projectRoot ?? null })
      } catch (error) {
        logger.warn?.(`禁用影子读取 ${entry.name} 失败：${error?.message ?? error}`)
        continue
      }
      if (!target || target.ok === false) continue
      const content = typeof target.content === 'string' ? target.content : target.body
      if (typeof content !== 'string' || content.length === 0) continue
      const description = typeof target.description === 'string' ? target.description : ''
      out.push({
        entry,
        candidate: {
          name: entry.name,
          description: `${DISABLED_PREFIX}${description}`,
          invocation: { modelInvocable: false, userInvocable: false },
          source: entry.scope === 'user' ? 'user-dsh' : 'project-dsh',
          provider: providerName,
          rank: AGENT_DISABLED_RANK,
          metadata: { disabled: true, scope: entry.scope, disabledAt: entry.disabledAt, ...(entry.projectRoot ? { projectRoot: entry.projectRoot } : {}) },
          ...(target.dir ? { resourceBase: { kind: 'directory', path: target.dir } } : {}),
        },
        definition: {
          content,
          // F4：definition 必须与 candidate 语义一致，不能把原始 description /
          // invocation 暴露给直接消费 definition 的代码。
          description: `${DISABLED_PREFIX}${description}`,
          ...(target.whenToUse ? { whenToUse: target.whenToUse } : {}),
          invocation: { modelInvocable: false, userInvocable: false },
          ...(target.dir ? { resourceBase: { kind: 'directory', path: target.dir } } : {}),
        },
      })
    }
    return out
  }

  function list(optionsArg = {}) {
    return { candidates: entriesFor(optionsArg).map((item) => item.candidate), complete: true }
  }

  function get(candidate = {}) {
    const name = candidate?.name
    const projectRoot = typeof candidate?.metadata?.projectRoot === 'string' ? candidate.metadata.projectRoot : null
    const scope = candidate?.metadata?.scope
    // F6：projectRoot 是匹配的一部分；用户条目只匹配空 projectRoot，项目条目
    // 必须精确匹配登记的 projectRoot，绝不 fallback 到其它项目的同名条目。
    const entries = entriesFor(projectRoot ? { cwd: projectRoot } : {})
    const found = entries.find((item) => {
      if (item.candidate.name !== name) return false
      if (scope !== undefined && item.entry.scope !== scope) return false
      if (projectRoot) return item.entry.scope === 'project' && item.entry.projectRoot === projectRoot
      return item.entry.scope === 'user'
    })
    return found?.definition
  }

  return { name: providerName, list, get }
}

export function registerDisabledProvider(options = {}) {
  return registerAgentLayerProvider(options)
}
