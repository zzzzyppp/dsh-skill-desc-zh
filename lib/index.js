/**
 * dsh-skill-desc-zh —— 技能描述中文化插件入口。
 *
 * 双通道：
 *  - L1（office ×7）：在 skills 服务注册 global 层 provider（rank 50），description 换中文，
 *    content / resourceBase 等原样透传；不写任何内置技能文件。
 *  - L2（agent-preset ×4）：把技能目录整体复制到 <project>/.dsh/skills/<name>/，
 *    只改 frontmatter 的 description；目录带 .skill-desc-zh.json 标记，还原时只搬走带标记的目录。
 *
 * 防自噬：provider 就绪前 list() 返回空；捕获原始定义期间也保持隐藏，捕获完成后再
 * invalidate，让下一次技能目录收集看到中文。
 */

import fsDefault from 'node:fs'
import path from 'node:path'

import { DEFAULT_TARGETS, createPaths, findProjectRootFS, isProjectAllowed } from './paths.js'
import { createFrontmatter } from './host-yaml.js'
import { createDiscovery } from './discover.js'
import { createShadows } from './shadow.js'
import { createTrash } from './trash.js'
import { createEventLog } from './events.js'
import {
  createStateStore,
  dropProject,
  pruneCache,
  pushHistory,
  recordCommand,
  recordProjectSkill,
  recordSkill,
  removeProjectSkill,
  resetCommands,
} from './state.js'
import { createCommandLayer } from './command-layer.js'
import { API_ACTIONS, API_PREFIX, registerHttpApi } from './http-api.js'
import { createPluginAdmin, toLosslessJson } from './plugin-admin.js'
import { createSkillFiles } from './skill-files.js'
import { createSkillAdmin } from './skill-admin.js'
import { PROVIDER_NAME, PROVIDER_RANK, createProvider } from './provider.js'
import {
  AGENT_DISABLED_PROVIDER_NAME,
  AGENT_DISABLED_RANK,
  AGENT_PROVIDER_NAME,
  AGENT_PROVIDER_RANK,
  RUNTIME_SKILL_RANK,
  createAgentProvider,
  createDisabledProvider,
  hasDisabledEntries,
  registerAgentLayerProvider,
  registerDisabledProvider,
} from './agent-layer.js'
import { TOOL_NAME, createTool } from './tool.js'
import { translateBatch } from './translate.js'

export const name = 'skill-desc-zh'
export const inject = ['skills', 'tools', 'commands']

/** 插件版本用于设置页展示；package.json 是唯一事实来源（t15 负责发布时同步）。 */
export const PLUGIN_VERSION = (() => {
  try {
    const file = new URL('../package.json', import.meta.url)
    return JSON.parse(fsDefault.readFileSync(file, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
})()

export const LIMITATIONS = [
  'runtime 技能（browser-skill）由插件在 agent scope 里注册（rank 250），本插件用 agent 层同名 provider（rank 50）覆盖；依赖宿主当前的 scope 合并语义。',
  'agent-preset 技能只在带 .git 的项目内、且项目在 $HOME 下或列入 projectAllowlist 时才中文化。',
  '宿主没有“升级前”钩子；升级后的首次启动会先还原影子再重新翻译（等价语义）。',
  '斜杠命令描述只在每个 agent 的 scope 层显示中文（全局视角永远是英文）；GUI 菜单为软刷新，已打开的菜单可能短暂显示旧文案。',
]

/**
 * 根据“实时”数据推导插件相位。bootstrap 与 status 共用同一套规则：
 * 冷启动时还没有项目根/会话，可能把相位定格为 degraded；等影子补齐、L1 捕获
 * 完成后，status 用本函数重算相位，避免展示与真实状态不一致。
 */
export function computePhase({ savedOk = true, zhCount, total, engineCounts, degradedCapture = false }) {
  let phase = 'active'
  let reason = `全部 ${zhCount} 个技能已有中文译文`
  if (savedOk === false) {
    phase = 'failed'
    reason = '状态保存失败，未启用中文覆盖'
  } else if (zhCount === 0) {
    phase = 'failed'
    reason = '没有可用中文译文，保持英文原文'
  } else if (engineCounts.none > 0 || engineCounts.dictionary > 0) {
    phase = 'degraded'
    reason = `部分技能回退（dictionary ${engineCounts.dictionary}，英文 ${engineCounts.none}），中文 ${zhCount}/${total}`
  } else if (degradedCapture) {
    phase = 'degraded'
    reason = 'office 定义只能从文件回退捕获，未通过 L1 覆盖（避免丢运行时附录）'
  } else if (zhCount < total) {
    phase = 'degraded'
    reason = `部分技能的中文未能生效（影子冲突或项目未放行），中文 ${zhCount}/${total}`
  }
  return { phase, reason, ready: savedOk !== false && phase !== 'failed' }
}

const DEFAULT_INVOCATION = Object.freeze({ modelInvocable: true, userInvocable: true })

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asStringArray(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0)
}

export function normalizeConfig(raw = {}) {
  const config = isPlainObject(raw) ? raw : {}
  const targets = isPlainObject(config.targets) ? config.targets : {}
  const llm = isPlainObject(config.llm) ? config.llm : {}
  const timeoutMs = Number.isFinite(llm.timeoutMs) && llm.timeoutMs > 0 ? llm.timeoutMs : 30_000
  return {
    enabled: config.enabled !== false,
    engine: ['auto', 'llm', 'dictionary'].includes(config.engine) ? config.engine : 'auto',
    translatePreset: config.translatePreset !== false,
    restoreOnQuit: config.restoreOnQuit === true,
    projectAllowlist: asStringArray(config.projectAllowlist, []),
    llm: {
      provider: typeof llm.provider === 'string' && llm.provider.length > 0 ? llm.provider : null,
      model: typeof llm.model === 'string' && llm.model.length > 0 ? llm.model : null,
      timeoutMs,
    },
    targets: {
      global: asStringArray(targets.global, DEFAULT_TARGETS.global),
      preset: asStringArray(targets.preset, DEFAULT_TARGETS.preset),
      commands: asStringArray(targets.commands, DEFAULT_TARGETS.commands),
    },
  }
}

function nowIso(now) {
  const value = now()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function definitionFromTarget(target) {
  const definition = {
    name: target.name,
    description: target.description,
    content: target.content,
    invocation: target.invocation ?? DEFAULT_INVOCATION,
    source: target.source,
    provider: target.provider,
  }
  if (target.whenToUse) definition.whenToUse = target.whenToUse
  if (target.resourceBase !== undefined) definition.resourceBase = target.resourceBase
  if (target.sourcePath) definition.path = target.sourcePath
  return definition
}

function shadowSummary(shadow) {
  if (!shadow || typeof shadow !== 'object') return '无'
  return `${shadow.projectRoot ?? '?'}（${shadow.dir ?? '?'}）`
}

/**
 * 纯控制器：所有副作用都通过注入的依赖完成，便于 mock 文件系统单测。
 *
 * @param {{
 *   paths: ReturnType<typeof createPaths>,
 *   config?: object,
 *   logger?: {info?: Function, warn?: Function, debug?: Function},
 *   deps?: {
 *     fs?: object, frontmatter?: object, trash?: object, stateStore?: object,
 *     shadows?: object, discovery?: object, translateBatch?: Function,
 *     now?: () => Date, services?: object, signal?: AbortSignal,
 *     pluginAdmin?: object,
 *   },
 * }} options
 */
export function createController(options) {
  const paths = options.paths
  const config = normalizeConfig(options.config)
  const logger = options.logger ?? {}
  const deps = options.deps ?? {}
  const fs = deps.fs ?? fsDefault
  const now = deps.now ?? (() => new Date())
  const frontmatter = deps.frontmatter ?? createFrontmatter({ fs })
  const trash = deps.trash ?? createTrash({ paths, fs, logger, now })
  const stateStore = deps.stateStore ?? createStateStore({ paths, fs, trash, logger, now })
  const shadows = deps.shadows ?? createShadows({ paths, frontmatter, trash, fs, logger, now })
  const discovery = deps.discovery ?? createDiscovery({ paths, frontmatter, fs, config, logger })
  const translate = deps.translateBatch ?? translateBatch
  const events = deps.events ?? createEventLog({ paths, fs, logger, now })
  const pluginAdmin = deps.pluginAdmin

  let state
  let control
  let ready = false
  let capturing = false
  let disposed = false
  let startupStarted = false
  let queue = Promise.resolve()
  let phase = 'booting'
  let phaseReason = '尚未启动'
  const captured = new Map()
  const agentShadowRuns = new Map()

  function loadState() {
    const loaded = stateStore.load()
    state = loaded.state
    return loaded
  }

  const initial = loadState()

  function saveStateNow(current, options) {
    return stateStore.save(current, options)
  }

  function readOnlySkillRows() {
    const rows = new Map()
    for (const record of captured.values()) {
      const definition = record?.definition ?? {}
      rows.set(record.name, {
        name: record.name,
        description: definition.description ?? '',
        source: definition.source ?? 'bundled',
        isRuntime: record.isRuntime === true,
      })
    }
    for (const [name, saved] of Object.entries(state?.skills ?? {})) {
      if (rows.has(name)) continue
      if (typeof saved?.en !== 'string') continue
      rows.set(name, { name, description: saved.en, source: saved.layer === 'preset' ? 'custom' : 'bundled' })
    }
    return [...rows.values()]
  }

  const skillFiles = deps.skillFiles ?? createSkillFiles({
    paths,
    frontmatter,
    trash,
    fs,
    logger,
    now,
    allowlist: config.projectAllowlist,
    getState: () => state,
  })

  const skillAdmin = deps.skillAdmin ?? createSkillAdmin({
    paths,
    config,
    skillFiles,
    fs,
    logger,
    now,
    getState: () => state,
    saveState: saveStateNow,
    invalidate,
    readOnlyRows: readOnlySkillRows,
  })

  function getService(key) {
    const services = deps.services
    if (!services) return undefined
    try {
      const value = services[key]
      return typeof value === 'function' ? value() : value
    } catch (error) {
      logger.debug?.(`读取服务 ${key} 失败：${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  function invalidate() {
    try {
      control?.invalidate?.()
    } catch (error) {
      logger.warn?.(`skills.invalidate 失败：${error instanceof Error ? error.message : String(error)}`)
    }
    for (const agentControl of [...agentLayerControls]) {
      try {
        if (agentControl?.signal?.aborted === true) {
          agentLayerControls.delete(agentControl)
          continue
        }
        agentControl?.invalidate?.()
      } catch (error) {
        agentLayerControls.delete(agentControl)
        logger.debug?.(`agent 层 invalidate 失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  function setPhase(next, reason) {
    phase = next
    phaseReason = reason ?? ''
    logger.debug?.(`skill-desc-zh: phase=${phase}${phaseReason ? `（${phaseReason}）` : ''}`)
  }

  function phaseInfo() {
    return { phase, phaseReason, ready, capturing }
  }

  function isEnabled() {
    return config.enabled && state?.enabled !== false
  }

  function translationFor(record) {
    const saved = state?.skills?.[record?.name]
    if (!saved || typeof saved.zh !== 'string' || saved.zh.length === 0) return undefined
    const sourceHash = record?.sourceHash ?? record?.definition?.sourceHash
    if (!sourceHash || saved.fingerprint !== sourceHash) return undefined
    return saved
  }

  const provider = createProvider({
    captured,
    isEnabled,
    isReady: () => ready,
    isCapturing: () => capturing,
    translationFor,
    logger,
  })

  // agent 层通道：覆盖在 agent scope 里注册的 runtime 技能（browser-skill）。
  const agentProvider = createAgentProvider({
    captured,
    isEnabled,
    isReady: () => ready,
    isCapturing: () => capturing,
    translationFor,
    logger,
  })
  function readDisabledTarget(entry) {
    const target = skillFiles.readTarget({
      scope: entry.scope,
      name: entry.name,
      projectRoot: entry.projectRoot ?? null,
    })
    if (!target?.ok) return target
    return {
      ok: true,
      content: target.body,
      description: target.description,
      whenToUse: target.whenToUse,
      invocation: target.invocation,
      dir: target.path ? path.dirname(target.path) : null,
    }
  }

  // 禁用影子：始终注册（空列表时零开销）；rank 40 只在 agent 层压过 filesystem。
  const disabledProvider = createDisabledProvider({
    state,
    readTarget: readDisabledTarget,
    isEnabled: () => config.enabled,
    isReady: () => true,
    logger,
  })
  /** 每个 agent 注册返回的 control，invalidate 时级联刷新（下一 pre-step 重收目录）。 */
  const agentLayerControls = new Set()
  const agentLayerDisposers = new Set()
  /** 最近一次注册 agent 层的 agent，用于 status/doctor 以 agent 视角自检。 */
  let lastAgentForScope

  function agentLayerCoveredNames() {
    const names = []
    for (const record of captured.values()) {
      if (record?.isRuntime === true) names.push(record.name)
    }
    return names
  }

  /** 在某个 agent 的 scope 层注册 provider；agent 销毁时宿主自动移除。 */
  function registerForAgent(input = {}) {
    const agent = input.agent ?? input
    const result = registerAgentLayerProvider({
      agent,
      provider: agentProvider,
      onControl: (agentControl) => {
        agentLayerControls.add(agentControl)
      },
      logger,
    })
    if (result.ok) {
      lastAgentForScope = agent
      if (typeof result.dispose === 'function') agentLayerDisposers.add(result.dispose)
      invalidate()
      logger.debug?.(`skill-desc-zh: agent 层已注册（agent=${agent?.id ?? agent?.session ?? '未知'}）`)
    }
    registerDisabledForAgent(agent)
    return result
  }

  /** 单独注册/刷新某个 agent 的禁用影子；失败只告警。 */
  function registerDisabledForAgent(agent) {
    const disabled = registerDisabledProvider({
      agent,
      provider: disabledProvider,
      onControl: (agentControl) => agentLayerControls.add(agentControl),
      logger,
    })
    if (disabled.ok && typeof disabled.dispose === 'function') agentLayerDisposers.add(disabled.dispose)
    if (!disabled.ok) logger.debug?.(`skill-desc-zh: 禁用影子未注册（${disabled.reason ?? '未知原因'}）`)
    return disabled
  }

  /** 启动/手动 disable 后，把禁用影子补注册到已存在的 agent。 */
  function ensureDisabledProvidersForKnownSessions() {
    const service = getService('agents')
    let list = []
    try {
      if (service && typeof service.list === 'function') list = service.list() ?? []
    } catch (error) {
      logger.debug?.(`skill-desc-zh: 列 agent 失败：${error?.message ?? error}`)
      return { ok: false, count: 0, reason: String(error?.message ?? error) }
    }
    let count = 0
    for (const agent of Array.isArray(list) ? list : []) {
      if (!agent) continue
      const result = registerDisabledForAgent(agent)
      if (result.ok) count += 1
    }
    if (lastAgentForScope) registerDisabledForAgent(lastAgentForScope)
    return { ok: true, count, agents: Array.isArray(list) ? list.length : 0 }
  }

  /**
   * 以最近注册的 agent 视角读一次技能目录，确认 agent 层候选确实压过 runtime 条目。
   * 只读：用于 status / doctor 的如实报告，失败不影响中文化本身。
   */
  async function agentLayerCheck() {
    const skills = getService('skills')
    const names = agentLayerCoveredNames()
    const base = {
      provider: AGENT_PROVIDER_NAME,
      rank: AGENT_PROVIDER_RANK,
      runtimeRank: RUNTIME_SKILL_RANK,
      registrations: agentLayerControls.size,
      covered: names,
    }
    if (!isEnabled() || !ready) {
      return { ...base, checked: { ok: false, reason: '插件未就绪或已处于还原状态' } }
    }
    if (!lastAgentForScope) {
      return { ...base, checked: { ok: false, reason: '本次进程还没有 agent 注册 agent 层 provider' } }
    }
    if (!skills || typeof skills.list !== 'function') {
      return { ...base, checked: { ok: false, reason: 'skills 服务不可用' } }
    }
    try {
      const listed = await skills.list({ scope: lastAgentForScope })
      const entries = Array.isArray(listed)
        ? listed
        : (Array.isArray(listed?.candidates) ? listed.candidates : [])
      const results = []
      for (const name of names) {
        const entry = entries.find((item) => item?.name === name)
        const expected = translationFor(captured.get(name))?.zh
        results.push({
          name,
          provider: entry?.provider ?? null,
          ok: Boolean(entry && entry.provider === AGENT_PROVIDER_NAME && typeof expected === 'string'),
          description: typeof entry?.description === 'string' ? entry.description.slice(0, 40) : undefined,
        })
      }
      return {
        ...base,
        checked: {
          ok: results.length > 0 && results.every((item) => item.ok),
          results,
        },
      }
    } catch (error) {
      return {
        ...base,
        checked: {
          ok: false,
          reason: `以 agent 视角读取技能目录失败：${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
  }

  const commandLayer = deps.commandLayer ?? createCommandLayer({ logger, now })

  function commandTargets() {
    return config.targets.commands ?? []
  }

  function commandsFeatureEnabled() {
    return config.enabled && state?.enabled !== false && commandTargets().length > 0
  }

  /** 参与命令影子的 agent：本进程注册过的 + agents 服务已知的。 */
  function commandAgentList() {
    const agents = new Set(commandLayer.knownAgents())
    if (lastAgentForScope) agents.add(lastAgentForScope)
    const service = getService('agents')
    if (service && typeof service.list === 'function') {
      try {
        const listed = service.list()
        if (Array.isArray(listed)) {
          for (const agent of listed) {
            if (agent) agents.add(agent)
          }
        }
      } catch (error) {
        logger.debug?.(`读取 agent 列表失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return [...agents]
  }

  /**
   * 捕获全局命令 + 翻译 + 给已知 agent 注册影子。
   * 任何失败都只降级为 warning（命令保持英文），不影响技能中文化。
   */
  async function prepareCommands({ hostVersion, reason = 'bootstrap', force = false, signal } = {}) {
    const targets = commandTargets()
    if (!commandsFeatureEnabled()) {
      commandLayer.restore()
      return {
        ok: true,
        skipped: true,
        reason: '命令描述中文化未启用',
        targets,
        counts: { zh: 0, total: 0 },
        warnings: [],
      }
    }
    const commands = getService('commands')
    if (!commands || typeof commands.list !== 'function' || typeof commands.find !== 'function') {
      commandLayer.restore()
      return {
        ok: false,
        skipped: true,
        reason: 'commands 服务不可用',
        targets,
        counts: { zh: 0, total: 0 },
        warnings: ['commands 服务不可用；命令描述保持英文'],
      }
    }

    try {
      if (!state.commands || typeof state.commands !== 'object') {
        state.commands = { byName: {}, updatedAt: nowIso(now), restoredAt: null }
      }
      if (force) {
        for (const record of Object.values(state.commands.byName ?? {})) {
          if (typeof record?.fingerprint === 'string') delete state.cache[record.fingerprint]
        }
        commandLayer.clear()
        state.commands.byName = {}
      }

      const result = await commandLayer.prepare({
        commands,
        targets,
        hostVersion,
        cache: state.cache,
        translate: deps.commandTranslate ?? translate,
        engine: config.engine,
        llm: config.engine === 'dictionary' ? undefined : getService('llm'),
        model: config.llm.provider && config.llm.model
          ? { provider: config.llm.provider, model: config.llm.model }
          : undefined,
        agentDefaultModel: getService('agentDefaultModel'),
        signal: signal ?? deps.signal,
        timeoutMs: config.llm.timeoutMs,
        logger,
        now,
      })
      state.cache = result.cache && typeof result.cache === 'object' ? result.cache : state.cache
      const translatedAt = nowIso(now)
      state.commands.byName = {}
      for (const capture of result.captures ?? []) {
        const translated = result.translations?.[capture.name]
        recordCommand(
          state,
          capture.name,
          {
            en: capture.en,
            hint: capture.hint,
            definitionId: capture.definitionId,
            fingerprint: capture.fingerprint,
            zh: translated?.zh ?? null,
            engine: translated?.engine ?? 'none',
            ...(translated?.model ? { model: translated.model } : {}),
            ...(translated?.skip ? { skip: true } : {}),
            translatedAt,
          },
          { now },
        )
      }
      for (const name of result.missing ?? []) {
        recordCommand(
          state,
          name,
          { en: null, zh: null, engine: 'none', missing: true, fingerprint: null },
          { now },
        )
      }
      state.commands.updatedAt = nowIso(now)
      state.commands.restoredAt = null
      const registration = commandLayer.registerAgents(commandAgentList())
      const counts = result.counts ?? { zh: 0, total: 0 }
      return {
        ...result,
        ok: result.ok !== false,
        targets,
        registration,
        summary: `命令中文 ${counts.zh ?? 0}/${counts.total ?? 0}`,
      }
    } catch (error) {
      commandLayer.restore()
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        targets,
        counts: { zh: 0, total: 0 },
        warnings: [`命令描述中文化失败：${message}；命令描述保持英文`],
      }
    }
  }

  /** 同步给单个 agent 注册命令影子；agent/created 回调里直接调用。 */
  function ensureCommandShadows({ agent } = {}) {
    if (!agent) return { ok: false, reason: '缺少 agent', registered: 0 }
    if (!commandsFeatureEnabled()) {
      commandLayer.forgetAgent(agent)
      return { ok: true, skipped: true, registered: 0, reason: '命令描述中文化未启用' }
    }
    try {
      const result = commandLayer.ensure(agent)
      if (result.failed > 0) {
        logger.warn?.(`skill-desc-zh: ${result.failed} 条命令影子注册失败`)
      }
      return result
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 注册命令影子失败：${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, registered: 0, reason: String(error?.message ?? error) }
    }
  }

  function ensureCommandShadowsForKnownSessions() {
    if (!commandsFeatureEnabled()) return { ok: true, count: 0, skipped: true }
    const agents = commandAgentList()
    const result = commandLayer.registerAgents(agents)
    return { ok: result.ok, count: result.registered, agents: agents.length, failed: result.failed }
  }

  /** 一键还原：注销全部命令影子（全局与执行语义都不变）。 */
  function disposeCommandShadows() {
    const result = commandLayer.restore()
    if (state?.commands) state.commands.restoredAt = nowIso(now)
    return result
  }

  function commandsStatus() {
    const status = commandLayer.status()
    const persisted = {}
    const translations = { ...status.translations }
    for (const [name, record] of Object.entries(state?.commands?.byName ?? {})) {
      persisted[name] = {
        zh: record?.zh ?? null,
        engine: record?.engine ?? 'none',
        ...(record?.missing ? { missing: true } : {}),
      }
      // 尚未注册（missing）或本次进程还没捕获到的目标，也要在 status 里可见。
      if (!translations[name]) {
        translations[name] = {
          en: record?.en ?? null,
          zh: record?.zh ?? null,
          engine: record?.engine ?? 'none',
          stale: record?.missing === true,
          missing: record?.missing === true,
          fingerprint: record?.fingerprint ?? null,
        }
      }
    }
    return {
      enabled: commandsFeatureEnabled(),
      targets: commandTargets(),
      ...status,
      translations,
      restoredAt: status.restoredAt ?? state?.commands?.restoredAt ?? null,
      restored: Boolean(status.restoredAt ?? state?.commands?.restoredAt),
      active: status.registered > 0,
      persisted,
    }
  }

  async function commandCheck() {
    if (!commandsFeatureEnabled()) {
      return { checked: { ok: false, reason: '命令描述中文化未启用' }, registered: 0, sample: [] }
    }
    return commandLayer.check(lastAgentForScope ?? commandAgentList()[0])
  }

  /**
   * commands/change：只在全局视角的 digest 变化时才重建。
   * 影子注册不会改变全局列表，所以自身注册不会造成重入。
   */
  async function handleCommandsChange() {
    if (disposed || !commandsFeatureEnabled()) {
      return { ok: true, skipped: true, reason: '命令描述中文化未启用' }
    }
    if (!commandLayer.globalSignature()) {
      return { ok: true, skipped: true, reason: '命令层尚未预热' }
    }
    let changed = false
    try {
      changed = await commandLayer.globalChanged()
    } catch (error) {
      logger.debug?.(`比较全局命令描述失败：${String(error?.message ?? error)}`)
    }
    if (!changed) return { ok: true, skipped: true, reason: '全局命令描述未变化' }
    return runExclusive(async () => {
      if (disposed || !commandsFeatureEnabled()) {
        return { ok: true, skipped: true, reason: '命令描述中文化未启用' }
      }
      const result = await prepareCommands({ hostVersion: paths.hostVersion(), reason: 'commands-change' })
      if (!result.skipped) {
        pruneCache(state)
        const saved = stateStore.save(state, { reason: 'commands-change' })
        result.warnings = [...(result.warnings ?? []), ...(saved.warnings ?? [])]
        events.append({
          action: 'commands-change',
          ok: result.ok !== false,
          zhCount: result.counts?.zh ?? 0,
          missing: result.missing ?? [],
          warnings: (result.warnings ?? []).slice(0, 20),
        })
      }
      return result
    })
  }

  function resolveCwd(exec) {
    const session = exec?.agent?.session
    const workingDirectory = getService('workingDirectory')
    if (workingDirectory && typeof workingDirectory.get === 'function') {
      try {
        const cwd = workingDirectory.get(session)
        if (typeof cwd === 'string' && cwd.length > 0) return cwd
      } catch {
        /* 没有已提交工作目录时回退 */
      }
    }
    const fromServices = getService('cwd')
    if (typeof fromServices === 'string' && fromServices.length > 0) return fromServices
    return process.cwd()
  }

  function resolveProjectRoot(explicit, cwd) {
    if (typeof explicit === 'string' && explicit.trim().length > 0) return path.resolve(explicit.trim())
    if (!cwd) return undefined
    return findProjectRootFS(cwd, fs)
  }

  function projectAllowed(projectRoot) {
    if (!projectRoot) return { allowed: false, reason: '没有项目根' }
    const allowed = isProjectAllowed(projectRoot, {
      home: paths.home,
      allowlist: config.projectAllowlist,
      env: process.env,
    })
    return {
      allowed,
      reason: allowed
        ? '项目在 $HOME 下或已列入 projectAllowlist'
        : '项目不在 $HOME 下且未列入 projectAllowlist',
    }
  }

  function selection() {
    const service = getService('agentDefaultModel')
    if (!service || typeof service.currentSelection !== 'function') return undefined
    try {
      const value = service.currentSelection()
      return isPlainObject(value) ? value : undefined
    } catch {
      return undefined
    }
  }

  function runExclusive(task) {
    const next = queue.then(task, task)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** 还原 state 里登记过的所有项目影子；dryRun 时不动任何文件。 */
  async function restoreProjects({ dryRun = false, names, projectRoot } = {}) {
    const roots = new Set(Object.keys(state.projects ?? {}))
    if (projectRoot) roots.add(projectRoot)
    const results = []
    const warnings = []
    let ok = true
    for (const root of roots) {
      let result
      try {
        result = shadows.restoreProject(root, { dryRun, names })
      } catch (error) {
        ok = false
        results.push({ projectRoot: root, ok: false, error: String(error?.message ?? error) })
        warnings.push(`还原 ${root} 的影子失败：${String(error?.message ?? error)}`)
        continue
      }
      results.push({ projectRoot: root, ...result })
      if (!result.ok) {
        ok = false
        warnings.push(`还原 ${root} 的部分影子失败：${result.error ?? '见结果明细'}`)
        continue
      }
      if (dryRun) continue
      const items = result.results ?? []
      const allTrashed = items.every((item) => item.status === 'trashed')
      if (!allTrashed) {
        ok = false
        warnings.push(`还原 ${root} 时有影子未能移入废纸篓，保留状态待下次重试`)
        continue
      }
      if (Array.isArray(names) && names.length > 0) {
        for (const item of items) {
          if (item.name) removeProjectSkill(state, root, item.name)
        }
      } else {
        dropProject(state, root)
      }
    }
    return { ok, results, warnings }
  }

  async function captureAndDiscover({ cwd, signal, hostVersion, force, known, knownHostVersion }) {
    const skills = getService('skills')
    capturing = true
    if (ready) {
      ready = false
      invalidate()
    }
    let found
    try {
      found = await discovery.discover({ cwd, skills, signal, hostVersion, known, knownHostVersion })
    } finally {
      capturing = false
    }

    const officeTargets = found.targets.filter((item) => item.layer === 'global')
    // 文件回退捕获不到 office 运行时附录（如 “## Installed LibreOffice Kit”），
    // 用它顶替宿主 provider 会丢正文附录，所以只翻译、不通过 L1 覆盖。
    const providerTargets = officeTargets.filter((item) => item.capturedVia !== 'file')
    if (providerTargets.length > 0) {
      captured.clear()
      for (const target of providerTargets) {
        captured.set(target.name, {
          name: target.name,
          isRuntime: target.isRuntime === true,
          sourceHash: target.sourceHash,
          fingerprint: target.fingerprint,
          definition: definitionFromTarget(target),
        })
      }
    } else if (captured.size > 0) {
      // 没有 global 目标时也清空旧捕获，避免服务短暂缺位时继续供应过期中文。
      captured.clear()
    }
    return found
  }

  async function bootstrap(input = {}) {
    const {
      reason = 'apply',
      force = false,
      names,
      projectRoot: projectRootArg,
      exec,
      cwd: cwdArg,
      signal = deps.signal,
    } = input
    const warnings = []
    if (disposed) {
      ready = false
      return {
        ok: false,
        phase,
        phaseReason,
        warnings: ['插件已卸载，忽略本次翻译'],
        targets: [],
        shadows: [],
      }
    }
    if (!config.enabled) {
      ready = false
      commandLayer.restore()
      setPhase('failed', '插件在配置里被禁用')
      invalidate()
      return { ok: false, phase, phaseReason, warnings: ['插件在配置里被禁用（enabled=false）'], targets: [], shadows: [] }
    }
    if (state.enabled === false) {
      ready = false
      commandLayer.restore()
      setPhase('restored', '已还原为英文原文')
      invalidate()
      return {
        ok: false,
        phase,
        phaseReason,
        warnings: ['当前是“英文原文”状态；先执行 skill_desc_zh(action="apply") 再翻译'],
        targets: [],
        shadows: [],
      }
    }

    const cwd = typeof cwdArg === 'string' && cwdArg.trim().length > 0 ? cwdArg : resolveCwd(exec)
    const hostVersion = paths.hostVersion()
    const only = Array.isArray(names) && names.length > 0 ? new Set(names) : undefined

    // 记录调用前的可用状态：只有真正开始重建时才 fail-closed；
    // 如果 names 全部拼错，不能把已经生效的中文整体下架。
    const wasReady = ready
    const previousPhase = phase
    const previousPhaseReason = phaseReason

    // 重新捕获期间绝不继续提供旧译文：先 fail-closed，成功后再 ready。
    if (ready || captured.size > 0) {
      ready = false
      invalidate()
    }
    setPhase('booting', `重新捕获技能定义（${reason}）`)

    const cwdRoot = resolveProjectRoot(undefined, cwd)
    const explicitRoot = typeof projectRootArg === 'string' && projectRootArg.length > 0
      ? path.resolve(projectRootArg)
      : undefined
    const diskRoot = explicitRoot ?? cwdRoot
    const trackedProjects = Object.keys(state.projects ?? {})
    const knownVersion = typeof state.hostVersion === 'string' && state.hostVersion !== 'unknown'
    const diskShadows = diskRoot ? shadows.list(diskRoot).filter((item) => item.marked) : []
    // 宿主版本探测失败（unknown）时不能当成“升级”，否则每次启动都会误删影子。
    const versionKnown = hostVersion !== 'unknown'
    const versionChanged = versionKnown && knownVersion && state.hostVersion !== hostVersion
    const missingVersionWithShadows = versionKnown && !knownVersion
      && (trackedProjects.length > 0 || diskShadows.length > 0)
    let healedThisRun = false
    if (versionChanged || missingVersionWithShadows) {
      const fromVersion = state.hostVersion ?? 'unknown'
      setPhase('stale', `宿主版本变化（${fromVersion} → ${hostVersion}），先还原影子`)
      const cleaned = await restoreProjects({ names: undefined, projectRoot: diskRoot })
      warnings.push(...cleaned.warnings)
      if (!cleaned.ok) {
        ready = false
        setPhase('failed', '宿主升级前还原影子失败，已中止翻译')
        invalidate()
        events.append({
          action: 'host-version-heal',
          ok: false,
          from: fromVersion,
          to: hostVersion,
          error: cleaned.warnings[0],
        })
        return {
          ok: false,
          phase,
          phaseReason,
          warnings: [
            ...warnings,
            `检测到宿主版本变化（${fromVersion} → ${hostVersion}），但旧影子未能全部还原；为避免半成品已中止`,
          ],
          targets: [],
          shadows: [],
          hostVersion,
        }
      }

      // 双保险：确认磁盘上确实没有残留的带标记影子（防止 state 丢失后漏还原）。
      const remaining = []
      const roots = new Set([
        ...trackedProjects,
        ...(cwdRoot ? [cwdRoot] : []),
        ...(explicitRoot ? [explicitRoot] : []),
      ])
      for (const root of roots) {
        for (const item of shadows.list(root)) {
          if (item.marked) remaining.push(item.dir)
        }
      }
      if (remaining.length > 0) {
        ready = false
        setPhase('failed', '仍有影子未还原，已中止翻译')
        invalidate()
        events.append({
          action: 'host-version-heal',
          ok: false,
          from: fromVersion,
          to: hostVersion,
          remaining,
        })
        return {
          ok: false,
          phase,
          phaseReason,
          warnings: [...warnings, `仍有 ${remaining.length} 个影子目录未还原，已中止翻译：${remaining.join(', ')}`],
          targets: [],
          shadows: [],
          hostVersion,
        }
      }

      state.cache = {}
      state.skills = {}
      resetCommands(state)
      commandLayer.clear()
      const healed = stateStore.save(state, { reason: 'host-version-heal' })
      warnings.push(...(healed.warnings ?? []))
      warnings.push(
        `检测到宿主版本变化（${fromVersion} → ${hostVersion}）：已还原旧影子并清空旧译文缓存，开始重新翻译`,
      )
      healedThisRun = true
      events.append({
        action: 'host-version-heal',
        ok: healed.ok !== false,
        from: fromVersion,
        to: hostVersion,
        restored: cleaned.results.reduce(
          (sum, item) => sum + (item.results ?? []).filter((entry) => entry.status === 'trashed').length,
          0,
        ),
      })
    }

    let found
    try {
      found = await captureAndDiscover({
        cwd,
        signal,
        hostVersion,
        force,
        known: state.skills,
        knownHostVersion: state.hostVersion,
      })
    } catch (error) {
      const message = String(error?.message ?? error)
      ready = false
      setPhase('failed', `发现技能失败：${message}`)
      invalidate()
      events.append({ action: reason, ok: false, phase, phaseReason, hostVersion, error: message, warnings: warnings.slice(0, 20) })
      return {
        ok: false,
        phase,
        phaseReason,
        warnings: [...warnings, `发现技能失败：${String(error?.message ?? error)}`],
        targets: [],
        shadows: [],
        hostVersion,
      }
    }
    if (disposed) {
      ready = false
      invalidate()
      return {
        ok: false,
        phase,
        phaseReason,
        warnings: [...warnings, '插件已卸载，忽略本次翻译'],
        targets: [],
        shadows: [],
        hostVersion,
      }
    }
    warnings.push(...found.warnings)

    // 命令描述与技能相互独立：技能失败不应阻止已注册命令的中文化，反之亦然。
    const commandPrep = await prepareCommands({ hostVersion, reason, force, signal })
    warnings.push(...(commandPrep.warnings ?? []))

    if (found.targets.length === 0) {
      ready = false
      setPhase('failed', '没有发现可翻译的技能目标')
      invalidate()
      if (commandPrep.ok && !commandPrep.skipped) {
        pruneCache(state)
        const commandSaved = stateStore.save(state, { reason: 'commands-only' })
        warnings.push(...(commandSaved.warnings ?? []))
      }
      events.append({ action: reason, ok: false, phase, phaseReason, hostVersion, error: 'no-targets', warnings: warnings.slice(0, 20) })
      return {
        ok: false,
        phase,
        phaseReason,
        warnings: [...warnings, '没有发现可翻译的技能目标'],
        targets: [],
        shadows: [],
        projectRoot: found.projectRoot,
        hostVersion,
        commands: { ...commandLayer.status(), enabled: commandsFeatureEnabled(), targets: commandTargets(), summary: commandPrep.summary },
      }
    }

    if (only) {
      const known = new Set(found.targets.map((item) => item.name))
      for (const item of only) {
        if (!known.has(item)) warnings.push(`未知技能名：${item}`)
      }
    }
    const targets = only ? found.targets.filter((item) => only.has(item.name)) : found.targets

    // 只给了不存在的 name：这是调用错误，不应把已经在生效的中文整体下架。
    if (only && targets.length === 0) {
      warnings.push('没有匹配到任何目标技能；保持当前状态不变')
      // 宿主版本刚变化时旧译文已经清空，不能再恢复“已覆盖”状态。
      ready = healedThisRun ? false : wasReady
      setPhase(healedThisRun ? 'failed' : previousPhase, healedThisRun ? '未知技能名，且宿主版本变化后尚未重译' : previousPhaseReason)
      if (ready) invalidate()
      return {
        ok: true,
        phase,
        phaseReason,
        warnings,
        targets: [],
        shadows: [],
        hostVersion,
        projectRoot: found.projectRoot,
      }
    }

    const staleTargets = targets.filter((target) => {
      const saved = state.skills?.[target.name]
      return Boolean(saved?.fingerprint) && saved.fingerprint !== target.sourceHash
    })
    if (staleTargets.length > 0) {
      setPhase('stale', `${staleTargets.length} 个技能内容或宿主版本变化，旧译文作废`)
      warnings.push(
        `${staleTargets.map((item) => item.name).join(', ')}: 指纹变化，旧译文已作废，正在重新翻译`,
      )
    } else if (force) {
      setPhase('stale', '强制重译')
    }

    const items = targets.map((target) => ({
      name: target.name,
      description: target.description,
      content: target.content,
      resourceBase: target.resourceBase,
      hostVersion,
      fingerprint: target.fingerprint,
    }))
    if (force) {
      for (const item of items) delete state.cache[item.fingerprint]
    }

    const llm = getService('llm')
    let batch
    try {
      batch = await translate({
        items,
        llm: config.engine === 'dictionary' ? undefined : llm,
        model: config.llm.provider && config.llm.model
          ? { provider: config.llm.provider, model: config.llm.model }
          : undefined,
        agentDefaultModel: getService('agentDefaultModel'),
        hostVersion,
        cache: state.cache,
        engine: config.engine,
        signal,
        timeoutMs: config.llm.timeoutMs,
        logger,
        now,
      })
    } catch (error) {
      const message = String(error?.message ?? error)
      ready = false
      setPhase('failed', `翻译失败：${message}`)
      invalidate()
      events.append({
        action: reason,
        ok: false,
        phase,
        phaseReason,
        hostVersion,
        error: message,
        warnings: warnings.slice(0, 20),
      })
      return {
        ok: false,
        phase,
        phaseReason,
        warnings: [...warnings, `翻译失败：${message}`],
        targets: [],
        shadows: [],
        hostVersion,
      }
    }
    if (disposed) {
      ready = false
      invalidate()
      return {
        ok: false,
        phase,
        phaseReason,
        warnings: [...warnings, '插件已卸载，忽略本次翻译'],
        targets: [],
        shadows: [],
        hostVersion,
      }
    }
    state.cache = batch.cache ?? state.cache
    warnings.push(...(batch.warnings ?? []))

    // engine=source 表示源 description 本来就是中文；它不是“翻译失败”，
    // 也不需要影子。把它计入已覆盖，避免整个插件被误判为 failed。
    const chineseFor = (target) => {
      const result = batch.results?.[target.name]
      if (result?.engine === 'source') return target.description
      return typeof result?.zh === 'string' && result.zh.length > 0 && result.engine !== 'none'
        ? result.zh
        : null
    }

    const translatedAt = nowIso(now)
    for (const target of targets) {
      const result = batch.results?.[target.name]
      const zh = chineseFor(target)
      const previous = state.skills?.[target.name]
      recordSkill(
        state,
        target.name,
        {
          layer: target.layer,
          mechanism: target.mechanism,
          sourcePath: target.sourcePath,
          sourceDir: target.sourceDir,
          capturedVia: target.capturedVia,
          size: target.size,
          mtimeMs: target.mtimeMs,
          sourceHash: target.sourceHash,
          fingerprint: target.fingerprint,
          enHash: target.contentHash,
          en: target.description,
          zh,
          engine: result?.engine ?? 'none',
          ...(result?.model ? { model: result.model } : {}),
          translatedAt,
          ...(previous?.shadow ? { shadow: previous.shadow } : {}),
        },
        { now },
      )
      if (!zh && result?.engine !== 'source') {
        warnings.push(`${target.name}: 没有拿到中文译文，保持英文原文`)
      }
    }

    const projectRoot = projectRootArg
      ? path.resolve(projectRootArg)
      : (found.projectRoot ?? resolveProjectRoot(undefined, cwd))
    const allowed = projectAllowed(projectRoot)
    const shadowResults = []
    const presetTargets = targets.filter((item) => item.layer === 'preset')
    if (presetTargets.length > 0) {
      if (!projectRoot) {
        warnings.push('没有项目根：跳过 agent-preset 的项目级影子（office 不受影响）')
      } else if (!allowed.allowed) {
        warnings.push(
          `项目 ${projectRoot} ${allowed.reason}；跳过 agent-preset 影子，office 不受影响`,
        )
      } else {
        for (const target of presetTargets) {
          if (disposed) {
            warnings.push('插件在重建影子过程中被卸载，停止后续影子写入')
            break
          }
          const result = batch.results?.[target.name]
          const zh = chineseFor(target)
          const previous = state.skills?.[target.name]?.shadow
          if (result?.engine === 'source') {
            // 原文已是中文：无需项目影子；清掉以前英文版本留下的影子。
            if (previous && previous.projectRoot === projectRoot) {
              const cleaned = shadows.restoreProject(projectRoot, { names: [target.name] })
              if (cleaned.ok) {
                removeProjectSkill(state, projectRoot, target.name)
                delete state.skills[target.name].shadow
              } else {
                warnings.push(`${target.name}: 清理旧影子失败（原文已是中文，${cleaned.error ?? '见 restore 结果'}）`)
              }
            }
            shadowResults.push({ name: target.name, status: 'skipped', reason: '原文已是中文' })
            continue
          }
          if (!zh) {
            if (previous && previous.projectRoot === projectRoot) {
              const cleaned = shadows.restoreProject(projectRoot, { names: [target.name] })
              if (cleaned.ok) {
                removeProjectSkill(state, projectRoot, target.name)
                delete state.skills[target.name].shadow
              } else {
                warnings.push(`${target.name}: 清理过期影子失败（${cleaned.error ?? '见 restore 结果'}）`)
              }
            }
            shadowResults.push({ name: target.name, status: 'skipped', reason: '没有中文译文' })
            continue
          }
          let ensured
          try {
            ensured = shadows.ensure({
              projectRoot,
              name: target.name,
              sourceDir: target.sourceDir,
              sourcePath: target.sourcePath,
              description: zh,
              sourceHash: target.sourceHash,
              enHash: target.contentHash,
              hostVersion,
              force,
            })
          } catch (error) {
            ensured = { status: 'error', reason: String(error?.message ?? error) }
          }
          shadowResults.push({ name: target.name, ...ensured })
          if (['created', 'replaced', 'unchanged'].includes(ensured.status)) {
            const shadow = {
              projectRoot,
              dir: ensured.dir,
              resources: ensured.resources ?? [],
              createdAt: previous?.createdAt ?? ensured.marker?.createdAt ?? translatedAt,
              shadowHash: ensured.shadowHash,
            }
            recordProjectSkill(
              state,
              projectRoot,
              target.name,
              {
                sourceHash: target.sourceHash,
                dir: ensured.dir,
                resources: shadow.resources,
                createdAt: shadow.createdAt,
                shadowHash: ensured.shadowHash,
              },
              { now },
            )
            state.skills[target.name].shadow = shadow
          } else if (ensured.status === 'conflict' || ensured.status === 'error' || ensured.status === 'skipped') {
            warnings.push(`${target.name}: 影子未建立（${ensured.reason ?? ensured.status}）`)
          }
        }
      }
    }

    if (projectRoot && Array.isArray(names) && names.length > 0) {
      // 定向重建时，把本次未涉及、但旧 state 仍指向该项目的影子保留，避免误删。
    }

    if (disposed) {
      ready = false
      setPhase('failed', '插件在翻译/重建影子过程中被卸载')
      invalidate()
      return {
        ok: false,
        phase,
        phaseReason,
        warnings: [...warnings, '插件已卸载，本次结果未提交'],
        targets: [],
        shadows: shadowResults,
        hostVersion,
      }
    }

    // 只保留仍在用的指纹，避免 state.cache 随宿主升级无限膨胀。
    pruneCache(state)
    state.hostVersion = hostVersion
    pushHistory(
      state,
      {
        action: reason,
        actor: 'plugin',
        names: targets.map((item) => item.name),
        note: `zh=${targets.filter((item) => state.skills[item.name]?.zh).length}/${targets.length}`,
      },
      { now },
    )
    const saved = stateStore.save(state, { reason })
    warnings.push(...(saved.warnings ?? []))

    // 只统计“真正会呈现给模型”的中文：office 必须有 L1 捕获，preset 必须有本次建立/确认的影子。
    const effectiveZh = targets.filter((target) => {
      const record = state.skills?.[target.name]
      if (record?.engine === 'source') {
        return target.layer === 'preset' || captured.has(target.name)
      }
      if (typeof record?.zh !== 'string' || record.zh.length === 0) return false
      if (target.layer === 'preset') {
        const shadow = shadowResults.find((item) => item.name === target.name)
        return Boolean(shadow && ['created', 'replaced', 'unchanged'].includes(shadow.status))
      }
      return captured.has(target.name)
    })
    const zhCount = effectiveZh.length
    const engineCounts = { llm: 0, dictionary: 0, source: 0, none: 0 }
    for (const target of targets) {
      const engine = state.skills?.[target.name]?.engine
      if (engine === 'llm' || engine === 'dictionary' || engine === 'source') engineCounts[engine] += 1
      else engineCounts.none += 1
    }
    const officeCount = targets.filter((item) => item.layer === 'global').length
    const presetCount = presetTargets.length

    const phaseResult = computePhase({
      savedOk: saved.ok !== false,
      zhCount,
      total: targets.length,
      engineCounts,
      degradedCapture: found.targets.some((item) => item.capturedVia === 'file' && item.layer === 'global'),
    })
    ready = phaseResult.ready
    setPhase(phaseResult.phase, phaseResult.reason)
    invalidate()

    const result = {
      ok: saved.ok !== false,
      reason,
      phase,
      phaseReason,
      targets,
      results: batch.results ?? {},
      counts: batch.counts ?? {},
      engine: batch.engine ?? 'none',
      shadows: shadowResults,
      projectRoot,
      allowed,
      warnings,
      hostVersion,
      degradedCapture: found.targets.some((item) => item.capturedVia === 'file' && item.layer === 'global'),
      commands: {
        ...commandLayer.status(),
        enabled: commandsFeatureEnabled(),
        targets: commandTargets(),
        summary: commandPrep.summary,
        counts: commandPrep.counts,
        missing: commandPrep.missing ?? [],
        skipped: commandPrep.skipped ?? false,
        reason: commandPrep.reason,
      },
      summary: {
        zhCount,
        total: targets.length,
        officeCount,
        presetCount,
        commandZh: commandPrep.counts?.zh ?? 0,
        commandTotal: commandPrep.counts?.total ?? 0,
      },
    }
    events.append({
      action: reason,
      ok: result.ok,
      phase,
      phaseReason,
      hostVersion,
      projectRoot,
      targets: targets.map((item) => item.name),
      zhCount,
      engineCounts,
      shadows: shadowResults.map((item) => ({ name: item.name, status: item.status })),
      warnings: warnings.slice(0, 20),
    })
    return result
  }

  function summarizeBootstrap(result, action) {
    const warnings = result.warnings ?? []
    const summary = result.summary ?? { zhCount: 0, total: 0, officeCount: 0, presetCount: 0 }
    const commandZh = result.commands?.counts?.zh ?? summary.commandZh ?? 0
    const commandTotal = result.commands?.counts?.total ?? summary.commandTotal ?? 0
    const shadowOk = (result.shadows ?? []).filter((item) =>
      ['created', 'replaced', 'unchanged'].includes(item.status)).length
    const head = result.ok
      ? `${action} 完成：中文 ${summary.zhCount}/${summary.total}（office ${summary.officeCount}，preset ${summary.presetCount}），影子 ${shadowOk}/${summary.presetCount}，命令 ${commandZh}/${commandTotal}；宿主 ${result.hostVersion}`
      : `${action} 未完成：${warnings[0] ?? '未知原因'}`
    return {
      ok: result.ok !== false,
      action,
      summary: head,
      phase: result.phase ?? phase,
      phaseReason: result.phaseReason ?? phaseReason,
      counts: result.counts,
      engine: result.engine,
      projectRoot: result.projectRoot,
      allowed: result.allowed,
      hostVersion: result.hostVersion,
      shadows: result.shadows,
      warnings,
    }
  }

  async function apply(args = {}, exec) {
    loadState()
    if (!config.enabled) {
      ready = false
      setPhase('failed', '插件在配置里被禁用')
      invalidate()
      return { ok: false, action: 'apply', summary: '插件在配置里被禁用（enabled=false），无法启用' }
    }
    if (state.enabled === false) {
      state.enabled = true
      const saved = stateStore.save(state, { reason: 'enable' })
      if (!saved.ok) {
        return { ok: false, action: 'apply', summary: '无法写入启用状态', warnings: saved.warnings }
      }
    }
    const result = await bootstrap({
      reason: 'apply',
      force: args.force === true,
      names: args.names,
      projectRoot: args.projectRoot,
      exec,
    })
    return summarizeBootstrap(result, 'apply')
  }

  async function retranslate(args = {}, exec) {
    if (!config.enabled) {
      return { ok: false, action: 'retranslate', summary: '插件在配置里被禁用（enabled=false）' }
    }
    if (state.enabled === false) {
      return {
        ok: false,
        action: 'retranslate',
        summary: '当前是英文原文状态；先执行 skill_desc_zh(action="apply") 再重译',
      }
    }
    const result = await bootstrap({
      reason: 'retranslate',
      force: true,
      names: args.names,
      projectRoot: args.projectRoot,
      exec,
    })
    return summarizeBootstrap(result, 'retranslate')
  }

  async function refresh(args = {}, exec) {
    if (!config.enabled) {
      return { ok: false, action: 'refresh', summary: '插件在配置里被禁用（enabled=false）' }
    }
    if (state.enabled === false) {
      return {
        ok: false,
        action: 'refresh',
        summary: '当前是英文原文状态；先执行 skill_desc_zh(action="apply") 再刷新',
      }
    }
    const result = await bootstrap({
      reason: 'refresh',
      force: false,
      names: args.names,
      projectRoot: args.projectRoot,
      exec,
    })
    return summarizeBootstrap(result, 'refresh')
  }

  async function restore(args = {}, exec) {
    const dryRun = args.dryRun === true
    const cwd = resolveCwd(exec)
    const projectRoot = resolveProjectRoot(args.projectRoot, cwd)
    const names = Array.isArray(args.names) && names.length > 0 ? args.names : undefined

    let commandDisposed = 0
    let commandRegistered = commandLayer.status().registered
    if (!dryRun) {
      state.enabled = false
      ready = false
      setPhase('restored', '已还原为英文原文')
      const disposed = disposeCommandShadows()
      commandDisposed = disposed.disposed ?? 0
      commandRegistered = 0
      invalidate()
    }

    const cleaned = await restoreProjects({ dryRun, names, projectRoot })
    const warnings = [...cleaned.warnings]
    let saved = { ok: true, warnings: [] }
    if (!dryRun) {
      for (const project of cleaned.results) {
        for (const item of project.results ?? []) {
          if (item.name && item.status === 'trashed') {
            if (state.skills[item.name]) delete state.skills[item.name].shadow
          }
        }
      }
      pushHistory(
        state,
        { action: 'restore', actor: 'plugin', ...(names ? { names } : {}), note: 'trashed' },
        { now },
      )
      saved = stateStore.save(state, { reason: 'restore' })
      warnings.push(...(saved.warnings ?? []))
    }

    const trashed = cleaned.results.reduce(
      (sum, item) => sum + (item.results ?? []).filter((entry) => entry.status === 'trashed').length,
      0,
    )
    const wouldTrash = cleaned.results.reduce(
      (sum, item) => sum + (item.results ?? []).filter((entry) => entry.status === 'would-trash').length,
      0,
    )
    const ok = cleaned.ok && saved.ok !== false
    if (!dryRun && !ok) {
      setPhase('failed', '还原未完全成功，部分影子可能仍在；可重试 restore')
    }
    if (!dryRun) {
      events.append({
        action: 'restore',
        ok,
        trashed,
        wouldTrash,
        projects: cleaned.results.map((item) => item.projectRoot),
        phase,
        warnings: warnings.slice(0, 20),
      })
    }
    return {
      ok,
      action: 'restore',
      phase,
      phaseReason,
      summary: dryRun
        ? `restore 预演：将移入废纸篓 ${wouldTrash} 个影子目录、下架 ${commandRegistered} 条命令影子；当前状态不变`
        : ok
          ? `已恢复英文原文：${trashed} 个影子目录移入废纸篓；provider 已下架，下一步技能列表为英文；命令描述已恢复英文（${commandDisposed} 条影子）`
          : `还原未完全成功：${warnings[0] ?? '部分影子仍在或状态未保存'}；已下架 provider，可重试 restore`,
      dryRun,
      enabled: dryRun ? config.enabled && state.enabled !== false : false,
      commands: { disposed: commandDisposed, registered: commandRegistered },
      results: cleaned.results,
      warnings,
    }
  }

  async function status(args = {}, exec) {
    const loaded = loadState()
    const warnings = [...loaded.warnings]
    const cwd = resolveCwd(exec)
    const projectRoot = resolveProjectRoot(args.projectRoot, findProjectRootFS(cwd, fs))
    const allowed = projectAllowed(projectRoot)
    const hostVersion = paths.hostVersion()
    const skills = getService('skills')

    // 只读探测：优先用已捕获的原始定义，避免读到本插件自己的中文候选。
    const readSkills = skills && typeof skills.get === 'function'
      ? {
          get: async (skillName, opts) => {
            const saved = captured.get(skillName)
            if (saved) return saved.definition
            return skills.get(skillName, opts)
          },
        }
      : undefined

    let found
    try {
      found = await discovery.discover({ cwd, skills: readSkills, hostVersion })
    } catch (error) {
      return {
        ok: false,
        action: 'status',
        summary: `status 失败：${String(error?.message ?? error)}`,
        warnings,
      }
    }
    warnings.push(...found.warnings)
    const agentLayer = await agentLayerCheck()
    const commands = commandsStatus()
    const pluginAdminInfo = pluginAdminStatus()

    const details = []
    const uiTargets = []
    let zhEffective = 0
    for (const target of found.targets) {
      const record = state.skills?.[target.name]
      const fresh = record?.fingerprint === target.sourceHash && typeof record?.zh === 'string'
      let effective = 'en'
      let extra = ''
      let shadowInfo = null
      if (target.layer === 'global') {
        const l1Covered = captured.has(target.name)
        const agentCovered = target.isRuntime ? agentLayer.checked?.ok === true : true
        if (config.enabled && state.enabled !== false && ready && fresh && l1Covered && agentCovered) {
          effective = 'zh'
          zhEffective += 1
        } else if (config.enabled && state.enabled !== false && !ready) {
          extra = '（provider 未就绪，当前仍显示英文）'
        } else if (target.isRuntime && config.enabled && state.enabled !== false && !agentCovered) {
          extra = `（agent 层自检未通过：${agentLayer.checked?.reason ?? '未通过'}，当前可能仍显示英文）`
        } else if (config.enabled && state.enabled !== false && !l1Covered) {
          extra = '（未通过 L1 覆盖，当前仍显示英文；仅缓存了译文）'
        } else if (config.enabled && state.enabled !== false && l1Covered) {
          extra = '（L1 已捕获，但当前没有可用中文译文）'
        }
      } else {
        shadowInfo = projectRoot ? shadows.inspect(projectRoot, target.name) : { exists: false, marked: false }
        const info = shadowInfo
        if (info.marked) {
          const healthy = info.marker?.sourceHash === target.sourceHash && !info.stale
          if (config.enabled && state.enabled !== false && fresh && healthy) {
            effective = 'zh'
            zhEffective += 1
          }
          extra = healthy ? `影子 ${info.dir}` : `影子过期：${info.dir}`
        } else if (info.exists) {
          extra = `同名目录被占用且无标记（不会覆盖）：${info.dir}`
        } else {
          extra = projectRoot
            ? (allowed.allowed ? '无影子' : `无影子（项目 ${allowed.reason}）`)
            : '无项目根'
        }
      }
      const engine = record?.engine ?? '—'
      const hash = (target.sourceHash ?? '').slice(0, 12)
      details.push(
        `${target.name} [${target.layer}/${target.mechanism}] ${effective === 'zh' ? '中文' : '英文'}`
        + ` · engine=${engine} · hash=${hash || '—'}${target.isRuntime ? ' · agent层覆盖' : ''}${extra ? ` · ${extra}` : ''}`,
      )
      uiTargets.push({
        id: `skill:${target.name}`,
        kind: 'skill',
        layer: target.layer,
        name: target.name,
        current: effective,
        engine: record?.engine ?? null,
        stale: Boolean(record && record.fingerprint !== target.sourceHash)
          || (shadowInfo?.marked === true && shadowInfo.stale === true),
        missing: false,
        sourcePath: target.sourcePath ?? null,
        shadowPath: shadowInfo?.marked ? shadowInfo.dir : null,
        rank: target.rank ?? null,
        note: extra || null,
      })
    }

    for (const [name, item] of Object.entries(commands.translations ?? {})) {
      const persisted = commands.persisted?.[name]
      const zh = item?.zh ?? persisted?.zh
      const engine = item?.engine ?? persisted?.engine ?? 'none'
      const stale = item?.stale === true
      const missing = item?.missing === true || persisted?.missing === true
      const effective = zh
        ? (commands.active === true ? '中文' : (commands.restored === true ? '英文（已还原）' : '英文（待 agent 注册）'))
        : '英文'
      details.push(
        `/${name} [command/agent] ${effective} · engine=${engine}`
        + `${stale ? ' · stale' : ''}${missing ? ' · 尚未注册' : ''}`,
      )
      uiTargets.push({
        id: `command:${name}`,
        kind: 'command',
        layer: 'agent',
        name,
        current: zh ? (commands.active === true ? 'zh' : 'en') : 'en',
        engine,
        stale,
        missing,
        sourcePath: null,
        shadowPath: null,
        rank: null,
        note: missing ? '尚未注册' : (commands.restored === true && zh ? '已还原英文' : null),
      })
    }

    const enabled = config.enabled && state.enabled !== false
    const total = found.targets.length
    // 相位纠偏：冷启动瞬间可能还没有项目根/会话，phase 被定格为 degraded；
    // 之后影子补齐、L1 捕获完成，实时计数已全部生效。这里用与 bootstrap 相同的
    // 规则重算一次相位（仅当相位确实变化时记事件），避免 status 与真实状态不一致。
    const liveEngineCounts = { llm: 0, dictionary: 0, source: 0, none: 0 }
    for (const target of found.targets) {
      const engine = state.skills?.[target.name]?.engine
      if (engine === 'llm' || engine === 'dictionary' || engine === 'source') liveEngineCounts[engine] += 1
      else liveEngineCounts.none += 1
    }
    const livePhase = computePhase({
      savedOk: true,
      zhCount: zhEffective,
      total,
      engineCounts: liveEngineCounts,
      degradedCapture: found.targets.some((item) => item.capturedVia === 'file' && item.layer === 'global'),
    })
    if (ready && phase !== 'failed' && phase !== 'restored' && livePhase.phase !== 'failed' && livePhase.phase !== phase) {
      const previousPhase = phase
      const previousReason = phaseReason
      setPhase(livePhase.phase, livePhase.reason)
      // 设置页 GET /state 传 readOnly:true：只纠内存相位，不写审计日志，
      // 保证只读入口没有磁盘副作用；工具与内部调用仍保留 phase-reconciled 事件。
      if (args.readOnly !== true) {
        events.append({
          action: 'phase-reconciled',
          ok: true,
          from: `${previousPhase}（${previousReason}）`,
          to: livePhase.phase,
          reason: livePhase.reason,
        })
      }
    }
    const commandCounts = {
      zh: Object.values(commands.translations ?? {}).filter((item) => item?.zh && !item?.skip).length,
      total: Object.keys(commands.translations ?? {}).length || commandTargets().length,
    }
    // v0.5：技能管理状态摘要（只读；不改变现有 status 字段语义）。
    let skillAdminInfo
    try {
      const listing = skillAdmin.list({ source: 'all' }, {
        projectRoot,
        projectSource: args.projectRootSource ?? (projectRoot ? 'cwd' : 'none'),
      })
      const rows = Array.isArray(listing.skills) ? listing.skills : []
      skillAdminInfo = {
        sources: listing.sources ?? null,
        counts: {
          total: rows.length,
          user: rows.filter((row) => row?.scope === 'user').length,
          project: rows.filter((row) => row?.scope === 'project').length,
          writable: rows.filter((row) => row?.editable === true).length,
          readOnly: rows.filter((row) => row?.editable !== true).length,
        },
        disabledCount: Array.isArray(state?.skillAdmin?.disabled) ? state.skillAdmin.disabled.length : 0,
        trashCount: Array.isArray(state?.skillAdmin?.deletions)
          ? state.skillAdmin.deletions.filter((item) => item?.restoredAt == null).length
          : 0,
        ...(listing.ok === false ? { error: listing.message ?? '技能列表不可用' } : {}),
      }
    } catch (error) {
      skillAdminInfo = {
        sources: null,
        counts: null,
        disabledCount: 0,
        trashCount: 0,
        error: String(error?.message ?? error),
      }
    }
    const summary = !config.enabled
      ? '插件已在配置中禁用；技能列表保持英文'
      : state.enabled === false
        ? `已还原英文原文（state.enabled=false）；当前无中文覆盖${total ? `；发现 ${total} 个目标` : ''}`
        : enabled
          ? `技能描述中文化已${ready ? '生效' : '启用但未就绪'}（phase=${phase}）：中文 ${zhEffective}/${total}；命令 ${commandCounts.zh}/${commandCounts.total}；项目 ${projectRoot ?? '—'}${allowed.allowed ? '' : '（L2 未放行）'}；宿主 ${hostVersion}`
          : `未启用；发现 ${total} 个目标`

    return {
      ok: true,
      action: 'status',
      summary,
      enabled,
      restored: state.enabled === false,
      ready,
      phase,
      phaseReason,
      hostVersion,
      projectRoot,
      projectAllowed: allowed,
      stateFile: stateStore.file,
      eventsFile: events.file,
      counts: { zh: zhEffective, total },
      engineCounts: liveEngineCounts,
      projectRootSource: args.projectRootSource
        ?? (typeof args.projectRoot === 'string' && args.projectRoot.length > 0 ? 'explicit' : 'cwd'),
      targets: uiTargets,
      api: {
        version: PLUGIN_VERSION,
        prefix: API_PREFIX,
        actions: [...API_ACTIONS],
      },
      commands,
      agentLayer,
      pluginAdmin: pluginAdminInfo,
      skillAdmin: skillAdminInfo,
      details,
      limitations: LIMITATIONS,
      warnings,
    }
  }

  async function doctor(args = {}, exec) {
    const loaded = loadState()
    const warnings = [...loaded.warnings]
    const cwd = resolveCwd(exec)
    const projectRoot = resolveProjectRoot(args.projectRoot, findProjectRootFS(cwd, fs))
    const allowed = projectAllowed(projectRoot)
    const checks = []
    const check = (key, ok, detail, mandatory = true) => {
      checks.push({ key, ok, detail, mandatory })
      return ok
    }

    const hostVersion = paths.hostVersion()
    check('host-version', hostVersion !== 'unknown', `宿主版本：${hostVersion}`)
    check('yaml', frontmatter.available(), `frontmatter YAML：${frontmatter.yamlPath?.() ?? '不可用'}`)
    const officeDir = paths.officeSkillsDir()
    check('office-dir', Boolean(officeDir), `office 源目录：${officeDir ?? '未找到'}`)
    const presetDir = paths.presetSkillsDir()
    check(
      'preset-dir',
      Boolean(presetDir),
      `agent-preset 源目录：${presetDir ?? '未找到'}`,
      config.translatePreset,
    )
    check('trash-script', Boolean(paths.trashScript()), `废纸篓脚本：${paths.trashScript() ?? '未找到（将用内建 rename 兜底）'}`)
    check('dsh-home', fs.existsSync(paths.dshHome), `DSH_HOME：${paths.dshHome}`)
    check('state-dir', fs.existsSync(paths.stateDir), `状态目录：${paths.stateDir}（首次 apply 时创建）`, false)
    check(
      'state-file',
      !loaded.corrupt,
      `状态文件：${stateStore.file}${loaded.exists ? '' : '（尚未创建）'}`,
    )
    check('provider-rank', PROVIDER_RANK < 600, `L1 provider rank ${PROVIDER_RANK} < dsh-office rank 600`)
    check('shadow-rank', 100 < 300, 'L2 项目影子 rank 100 < agent-preset rank 300')
    const skillRoots = skillFiles.roots(projectRoot)
    check(
      'skill-admin',
      Boolean(skillAdmin && typeof skillAdmin.list === 'function' && typeof skillAdmin.action === 'function'),
      '技能管理后台：list/detail/action 可用',
      false,
    )
    check(
      'skill-roots',
      skillRoots.some((root) => root.kind === 'user' && root.root),
      `可写技能根：${skillRoots.filter((root) => root.root).map((root) => `${root.kind}=${root.root}`).join('；') || '未找到'}`,
      false,
    )
    check(
      'trash-restore',
      typeof trash.available === 'function' && trash.available() === true && typeof trash.snapshot === 'function',
      `废纸篓/恢复通道：${trash.available?.() === true ? '可用（trash.mjs）' : '不可用'}`,
      false,
    )
    const runtimeNames = agentLayerCoveredNames()
    const agentLayerInfo = await agentLayerCheck()
    check('runtime-target', runtimeNames.length > 0, `runtime 技能目标：${runtimeNames.join(', ') || '未捕获'}`, false)
    check('agent-layer', agentLayerInfo.registrations > 0, `agent 层 provider 注册数：${agentLayerInfo.registrations}`, false)
    check(
      'agent-layer-wins',
      agentLayerInfo.checked?.ok === true,
      `agent 层覆盖自检：${agentLayerInfo.checked?.ok === true ? '通过' : (agentLayerInfo.checked?.reason ?? '未通过')}`,
      false,
    )

    const skills = getService('skills')
    const readSkills = skills && typeof skills.get === 'function'
      ? {
          get: async (skillName, opts) => {
            const saved = captured.get(skillName)
            if (saved) return saved.definition
            return skills.get(skillName, opts)
          },
        }
      : undefined
    let found
    try {
      found = await discovery.discover({ cwd, skills: readSkills, hostVersion })
    } catch (error) {
      found = { targets: [], warnings: [String(error?.message ?? error)] }
    }
    warnings.push(...(found.warnings ?? []))
    check('targets', (found.targets?.length ?? 0) > 0, `发现 ${found.targets?.length ?? 0} 个目标`)

    const llm = getService('llm')
    check('llm', Boolean(llm && typeof llm.prepareCall === 'function'), 'LLM 服务可用（不可用时用内置词典）', false)
    const selected = selection()
    check(
      'model',
      Boolean(selected?.provider && selected?.model),
      `默认模型：${selected ? `${selected.provider}/${selected.model}` : '未知（可用 config.llm 显式指定）'}`,
      false,
    )
    check('project', Boolean(projectRoot), `项目根：${projectRoot ?? '未找到（L2 不可用）'}`, false)
    check(
      'project-allowed',
      allowed.allowed,
      `${allowed.reason}；allowlist=${config.projectAllowlist.join(',') || '空'}`,
      false,
    )
    check('captured-office', captured.size > 0, `已捕获 office 原始定义：${captured.size} 个`, false)
    const commandsService = getService('commands')
    check(
      'commands-service',
      Boolean(commandsService && typeof commandsService.register === 'function' && typeof commandsService.list === 'function'),
      `commands 服务：${commandsService ? '可用' : '不可用'}（不可用时命令保持英文）`,
      false,
    )
    check('commands-targets', commandTargets().length > 0, `命令目标：${commandTargets().join(', ') || '未配置'}`, false)
    const commandInfo = await commandCheck()
    check(
      'command-layer',
      commandInfo.checked?.ok === true,
      `命令影子自检：${commandInfo.checked?.ok === true ? '通过' : (commandInfo.checked?.reason ?? '未通过')}`,
      false,
    )

    let pluginAdminInfo = null
    try {
      pluginAdminInfo = pluginAdmin && typeof pluginAdmin.describe === 'function' ? pluginAdmin.describe() : null
    } catch (error) {
      pluginAdminInfo = { ok: false, reason: String(error?.message ?? error) }
    }
    check(
      'plugin-admin',
      Boolean(pluginAdminInfo?.ok),
      pluginAdminInfo
        ? `插件管理：profile ${pluginAdminInfo.profile?.name ?? '未知'}（${pluginAdminInfo.profile?.dir ?? '—'}） · 宿主 pluginManager ${pluginAdminInfo.pluginManager ? '可用' : '不可用'}`
        : '插件管理后台未就绪（需要重启 DSH 加载 0.4.0）',
      false,
    )

    const mandatoryFailed = checks.filter((item) => item.mandatory && !item.ok)
    return {
      ok: mandatoryFailed.length === 0,
      action: 'doctor',
      summary: mandatoryFailed.length === 0
        ? `自检通过 ${checks.length} 项（${checks.filter((item) => !item.ok).length} 个提示）`
        : `自检失败：${mandatoryFailed.map((item) => item.key).join(', ')}`,
      checks,
      limitations: LIMITATIONS,
      details: checks.map((item) => `${item.ok ? '✓' : '✗'} ${item.key}：${item.detail}`),
      warnings,
      hostVersion,
      projectRoot,
    }
  }

  /** 插件管理后台的只读摘要（status 用；绝不触发网络请求）。 */
  function pluginAdminStatus() {
    if (!pluginAdmin || typeof pluginAdmin.describe !== 'function') {
      return { available: false, reason: '插件管理后台未就绪（需要重启 DSH 加载 0.4.0）' }
    }
    try {
      const info = pluginAdmin.describe()
      return { available: info?.ok === true, ...(info && typeof info === 'object' ? info : {}) }
    } catch (error) {
      return { available: false, reason: String(error?.message ?? error) }
    }
  }

  /**
   * 插件管理（v0.4.0）：列出当前 profile 的第三方插件并检查 npm 更新。
   * 只读，不写 profile / 不改插件；更新动作只经设置页 HTTP 路由（POST）。
   */
  async function plugins(args = {}) {
    if (!pluginAdmin || typeof pluginAdmin.list !== 'function') {
      return {
        ok: false,
        action: 'plugins',
        summary: '插件管理后台未就绪（需要重启 DSH 加载 0.4.0）',
        warnings: [],
      }
    }
    let data
    try {
      data = await pluginAdmin.list({ force: args.force === true })
    } catch (error) {
      return {
        ok: false,
        action: 'plugins',
        summary: `检查插件更新失败：${String(error?.message ?? error)}`,
        warnings: [],
      }
    }
    if (!data || data.ok === false) {
      return {
        ok: false,
        action: 'plugins',
        summary: `检查插件更新失败：${data?.message ?? data?.code ?? '未知原因'}`,
        warnings: [],
      }
    }
    const list = Array.isArray(data.plugins) ? data.plugins : []
    const updates = list.filter((plugin) => plugin.updateAvailable === true)
    const details = [
      `profile：${data.profile?.name ?? '?'}（${data.profile?.dir ?? '—'}） · registry：${data.registry ?? '—'}`,
      `第三方插件 ${list.length} 个，可更新 ${updates.length} 个；官方 bundle ${data.officialCount ?? 0} 个不参与更新`,
      '—',
      ...list.map((plugin) => {
        const source = plugin.local ? `本地/${plugin.kind}` : 'npm'
        const version = plugin.version ? `v${plugin.version}` : '版本未知'
        const state = plugin.updateAvailable
          ? `可更新 → v${plugin.latestVersion}`
          : plugin.latestError
            ? `检查失败：${plugin.latestError}`
            : plugin.updateable
              ? '已是最新'
              : '不参与更新'
        return `${plugin.name} · ${version} · ${source} · ${plugin.enabled === false ? '已禁用' : '已启用'} · ${state}`
      }),
    ]
    return toLosslessJson({
      ok: true,
      action: 'plugins',
      summary: `已检查 ${list.length} 个第三方插件，其中 ${updates.length} 个可更新；更新请到「设置 → 插件管理」页操作。`,
      profile: data.profile,
      registry: data.registry,
      checkedAt: data.checkedAt,
      officialCount: data.officialCount,
      plugins: list.map((plugin) => ({
        name: plugin.name,
        version: plugin.version,
        latestVersion: plugin.latestVersion,
        updateAvailable: plugin.updateAvailable === true,
        kind: plugin.kind,
        local: plugin.local === true,
        enabled: plugin.enabled !== false,
        self: plugin.self === true,
        latestError: plugin.latestError,
      })),
      details,
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    })
  }

  function projectShadowsHealthy(projectRoot, hostVersion) {
    if (!projectRoot) return false
    if (config.translatePreset === false) return true
    const project = state.projects?.[projectRoot]
    if (!project || state.hostVersion !== hostVersion) return false
    const names = config.targets.preset ?? []
    if (names.length === 0) return true
    for (const name of names) {
      const saved = project.skills?.[name]
      if (!saved && state.skills?.[name]?.engine === 'source') continue
      const info = shadows.inspect(projectRoot, name)
      if (!saved || !info.marked || info.stale) return false
      if (!info.marker?.shadowHash || !info.shadowHash) return false
      if (info.marker.shadowHash !== info.shadowHash) return false
      if (info.marker?.hostVersion !== hostVersion) return false
      if (saved.sourceHash && info.marker?.sourceHash !== saved.sourceHash) return false
    }
    return true
  }

  /**
   * 为一个新会话确保 L2 影子：workingDirectory → 项目根 → 放行检查 → bootstrap。
   * 同一项目已有健康影子时直接跳过，避免每次新建会话都重新翻译。
   */
  async function ensureShadowsForAgent({ agent, cwd } = {}) {
    if (!isEnabled() || disposed || phase === 'failed' || phase === 'restored') {
      return { ok: false, skipped: true, reason: '插件未启用、处于失败/还原状态或已卸载' }
    }
    let working = typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
    if (!working) {
      const session = agent?.session ?? agent?.id
      const service = getService('workingDirectory')
      if (service && typeof service.get === 'function') {
        try {
          const value = service.get(session)
          if (typeof value === 'string' && value.length > 0) working = value
        } catch {
          /* 新会话可能还没有已提交的工作目录 */
        }
      }
    }
    if (!working) {
      return { ok: false, skipped: true, reason: '会话没有已提交的工作目录' }
    }
    const projectRoot = resolveProjectRoot(undefined, working)
    if (!projectRoot) {
      return { ok: false, skipped: true, reason: '没有项目根' }
    }
    const allowed = projectAllowed(projectRoot)
    if (!allowed.allowed) {
      warningsForAgent(projectRoot, allowed.reason)
      events.append({ action: 'agent-created', ok: true, skipped: true, projectRoot, reason: allowed.reason })
      return { ok: true, skipped: true, reason: allowed.reason, projectRoot }
    }
    const hostVersion = paths.hostVersion()
    if (projectShadowsHealthy(projectRoot, hostVersion)) {
      events.append({ action: 'agent-created', ok: true, skipped: true, projectRoot, reason: '影子已是最新' })
      return { ok: true, skipped: true, reason: '影子已是最新', projectRoot }
    }
    if (agentShadowRuns.has(projectRoot)) return agentShadowRuns.get(projectRoot)
    const run = runExclusive(() => bootstrap({
      reason: 'agent-created',
      projectRoot,
      cwd: working,
      force: false,
    })).finally(() => agentShadowRuns.delete(projectRoot))
    agentShadowRuns.set(projectRoot, run)
    return run
  }

  function warningsForAgent(projectRoot, reason) {
    logger.debug?.(`skill-desc-zh: 跳过 ${projectRoot} 的 L2 影子：${reason}`)
  }

  async function ensureShadowsForKnownSessions() {
    const service = getService('agents')
    if (!service || typeof service.list !== 'function') return { ok: true, count: 0 }
    let agents
    try {
      agents = service.list()
    } catch (error) {
      logger.debug?.(`skill-desc-zh: 枚举已有会话失败：${String(error?.message ?? error)}`)
      return { ok: false, count: 0 }
    }
    let count = 0
    for (const agent of Array.isArray(agents) ? agents : []) {
      try {
        const result = await ensureShadowsForAgent({ agent })
        if (result && result.ok) count += 1
      } catch (error) {
        logger.warn?.(`skill-desc-zh: 为已有会话创建影子失败：${String(error?.message ?? error)}`)
      }
    }
    return { ok: true, count }
  }

  /** 同步还原所有 state 登记的项目影子（仅用于退出/卸载，不阻塞事件循环）。 */
  function restoreProjectsSync(reason) {
    const warnings = []
    let ok = true
    let trashed = 0
    const restoredProjects = Object.keys(state.projects ?? {})
    for (const projectRoot of restoredProjects) {
      let result
      try {
        result = shadows.restoreProject(projectRoot)
      } catch (error) {
        ok = false
        warnings.push(`退出还原 ${projectRoot} 失败：${String(error?.message ?? error)}`)
        continue
      }
      if (!result.ok) {
        ok = false
        warnings.push(`退出还原 ${projectRoot} 的部分影子失败：${result.error ?? '见结果明细'}`)
        continue
      }
      const items = result.results ?? []
      const allTrashed = items.every((item) => item.status === 'trashed')
      if (!allTrashed) {
        ok = false
        warnings.push(`退出还原 ${projectRoot} 时有影子未能移入废纸篓，保留状态待下次重试`)
        continue
      }
      for (const item of items) {
        if (item.status === 'trashed') {
          trashed += 1
          if (item.name && state.skills?.[item.name]) delete state.skills[item.name].shadow
        }
      }
      dropProject(state, projectRoot)
    }
    let saved = { ok: true, warnings: [] }
    if (ok) {
      const entry = { action: 'restore-on-quit', actor: 'plugin', note: `trashed=${trashed}` }
      pushHistory(state, entry, { now })
      saved = stateStore.save(state, { reason })
      warnings.push(...(saved.warnings ?? []))
    }
    events.append({
      action: 'restore-on-quit',
      ok: ok && saved.ok !== false,
      trashed,
      projects: restoredProjects,
      warnings: warnings.slice(0, 20),
    })
    return { ok: ok && saved.ok !== false, trashed, warnings }
  }

  function resolveSkillContext(args = {}, exec) {
    const cwd = resolveCwd(exec)
    // HTTP 层已经解析过项目根；显式 null 表示“没有项目根”，不要再按 session
    // cwd 重新找 .git，否则 source 会被错误地改写成 session。
    if (args.projectRoot === null && typeof args.projectRootSource === 'string' && args.projectRootSource.length > 0) {
      return { cwd, projectRoot: null, projectSource: args.projectRootSource }
    }
    let projectRoot = typeof args.projectRoot === 'string' && args.projectRoot.trim().length > 0
      ? path.resolve(args.projectRoot.trim())
      : undefined
    let projectSource = args.projectRootSource ?? (projectRoot ? 'explicit' : 'none')
    if (!projectRoot) {
      const found = resolveProjectRoot(undefined, cwd)
      if (found) {
        projectRoot = found
        projectSource = 'session'
      }
    }
    return { cwd, projectRoot: projectRoot ?? null, projectSource }
  }

  async function skillsList(args = {}, exec) {
    const context = resolveSkillContext(args, exec)
    try {
      return skillAdmin.list(args, context)
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 技能列表失败：${String(error?.stack ?? error)}`)
      return { ok: false, code: 'internal', message: `技能列表失败：${error?.message ?? error}` }
    }
  }

  async function skillsDetail(args = {}, exec) {
    const context = resolveSkillContext(args, exec)
    try {
      const result = skillAdmin.detail(args, context)
      return { ...result, projectRoot: context.projectRoot }
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 技能详情失败：${String(error?.stack ?? error)}`)
      return { ok: false, code: 'internal', message: `技能详情失败：${error?.message ?? error}` }
    }
  }

  async function skillsAction(args = {}, exec) {
    const context = resolveSkillContext(args, exec)
    try {
      const result = skillAdmin.action(args, context)
      if (result?.ok && (args.action === 'disable' || args.action === 'enable')) {
        // 禁用状态改变后必须级联 invalidate，否则 agent 作用域里已有的 skills
        // 目录缓存仍会显示旧候选（disable 不生效 / enable 不恢复）。
        ensureDisabledProvidersForKnownSessions()
        invalidate()
      }
      return { ...result, projectRoot: context.projectRoot }
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 技能管理动作 ${args.action} 失败：${String(error?.stack ?? error)}`)
      return { ok: false, code: 'internal', message: `技能管理动作失败：${error?.message ?? error}` }
    }
  }

  async function startup() {
    if (startupStarted || disposed) return undefined
    startupStarted = true
    if (!config.enabled) {
      ready = false
      commandLayer.restore()
      setPhase('failed', '插件在配置里被禁用')
      invalidate()
      logger.info?.('skill-desc-zh: 配置禁用，跳过启动自动翻译')
      return undefined
    }
    if (state.enabled === false) {
      ready = false
      commandLayer.restore()
      let residual = 0
      for (const root of Object.keys(state.projects ?? {})) {
        try {
          if (shadows.list(root).some((item) => item.marked)) residual += 1
        } catch {
          /* 残留检查失败不影响“保持英文”的主语义 */
        }
      }
      setPhase(residual > 0 ? 'failed' : 'restored', residual > 0
        ? `处于还原状态，但仍有 ${residual} 个项目存在影子残留，可重试 restore`
        : '已还原为英文原文')
      invalidate()
      logger.info?.('skill-desc-zh: 处于还原状态，跳过启动自动翻译')
      return undefined
    }
    let last
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (disposed) return last
      try {
        last = await runExclusive(() => bootstrap({ reason: 'startup' }))
      } catch (error) {
        logger.warn?.(`skill-desc-zh 启动翻译失败：${String(error?.message ?? error)}`)
        return undefined
      }
      if (last?.ok && !last.degradedCapture) break
      if (!last?.degradedCapture) break
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
    }
    if (last?.ok && last.phase !== 'failed') {
      try {
        await ensureShadowsForKnownSessions()
      } catch (error) {
        logger.warn?.(`skill-desc-zh: 启动时补齐 L2 影子失败：${String(error?.message ?? error)}`)
      }
    }
    // 命令描述与技能相互独立：即使技能发现失败/没有技能目标，
    // 已翻译好的命令影子也要补注册到启动时已经存在的 agent。
    try {
      ensureCommandShadowsForKnownSessions()
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 启动时补齐命令影子失败：${String(error?.message ?? error)}`)
    }
    try {
      ensureDisabledProvidersForKnownSessions()
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 启动时补注册禁用影子失败：${String(error?.message ?? error)}`)
    }
    return last
  }

  return {
    provider,
    agentProvider,
    state: () => state,
    isReady: () => ready,
    phase: phaseInfo,
    isEnabled,
    attach(providerControl) {
      control = providerControl
    },
    invalidate,
    apply: (args, exec) => runExclusive(() => apply(args, exec)),
    restore: (args, exec) => runExclusive(() => restore(args, exec)),
    retranslate: (args, exec) => runExclusive(() => retranslate(args, exec)),
    refresh: (args, exec) => runExclusive(() => refresh(args, exec)),
    plugins: (args, exec) => runExclusive(() => plugins(args, exec)),
    status: (args, exec) => runExclusive(() => status(args, exec)),
    doctor: (args, exec) => runExclusive(() => doctor(args, exec)),
    ensureShadowsForAgent: (input) => ensureShadowsForAgent(input),
    ensureCommandShadows,
    disposeCommandShadows,
    commandsStatus,
    commandCheck,
    handleCommandsChange,
    ensureCommandShadowsForKnownSessions,
    skills: (args, exec) => runExclusive(() => skillsList(args, exec)),
    skillDetail: (args, exec) => runExclusive(() => skillsDetail(args, exec)),
    skillAction: (args, exec) => runExclusive(() => skillsAction(args, exec)),
    skillTrash: () => skillAdmin.trashList(),
    skillsSummary: () => skillAdmin.statusSummary(),
    ensureDisabledProviders: ensureDisabledProvidersForKnownSessions,
    registerForAgent,
    agentLayerCheck,
    ensureShadowsForKnownSessions,
    runExclusive,
    startup,
    bootstrap,
    dispose() {
      if (disposed) return
      disposed = true
      ready = false
      setPhase('failed', '插件已卸载')
      for (const dispose of [...agentLayerDisposers]) {
        try {
          dispose()
        } catch {
          /* agent 已销毁时反注册可能抛错，忽略 */
        }
      }
      agentLayerDisposers.clear()
      agentLayerControls.clear()
      try {
        pluginAdmin?.dispose?.()
      } catch {
        /* 插件管理缓存清理失败不影响卸载 */
      }
      captured.clear()
      try {
        commandLayer.dispose()
      } catch (error) {
        logger.debug?.(`skill-desc-zh: 注销命令影子失败：${String(error?.message ?? error)}`)
      }
      if (config.restoreOnQuit && state?.commands) state.commands.restoredAt = nowIso(now)
      invalidate()
      if (config.restoreOnQuit) {
        try {
          const result = restoreProjectsSync('restore-on-quit')
          if (!result.ok) logger.warn?.(`skill-desc-zh: 退出还原未全部成功：${result.warnings[0] ?? '见 events.ndjson'}`)
        } catch (error) {
          logger.warn?.(`skill-desc-zh: 退出还原异常：${String(error?.message ?? error)}`)
        }
      }
    },
    warningsOnLoad: initial.warnings,
    /** 测试用：当前工程可见的内部对象。 */
    internals: { captured, shadows, stateStore, trash, frontmatter, discovery, events, commandLayer, skillFiles, skillAdmin, disabledProvider },
  }
}

/**
 * Cordis 插件入口。
 * @param {object} ctx
 * @param {object} [rawConfig]
 */
export function apply(ctx, rawConfig = {}) {
  const logger = ctx.logger ?? {}
  const config = normalizeConfig(rawConfig)
  const paths = createPaths({
    env: process.env,
    resourcesPath: typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined,
    execPath: process.execPath,
    isElectron: process.versions.electron !== undefined,
  })

  const services = {
    skills: () => ctx.get('skills'),
    tools: () => ctx.get('tools'),
    commands: () => ctx.get('commands'),
    llm: () => ctx.get('llm'),
    agentDefaultModel: () => ctx.get('agentDefaultModel'),
    workingDirectory: () => ctx.get('workingDirectory'),
    agents: () => ctx.get('agents'),
  }
  const pluginAdmin = createPluginAdmin({ ctx, logger })
  const controller = createController({ paths, config, logger, deps: { services, pluginAdmin } })

  // 设置页 Host 桥接：认证 HTTP 路由。webServer 可能晚于插件出现，模块内部会
  // 通过 internal/service 惰性重试；卸载时随 ctx.effect 一并释放。
  let httpApi
  try {
    httpApi = registerHttpApi({ ctx, controller, logger, version: PLUGIN_VERSION, pluginAdmin })
    if (!httpApi.ok) logger.debug?.(`skill-desc-zh: 设置页路由未就绪（${httpApi.reason ?? '未知原因'}）`)
  } catch (error) {
    logger.warn?.(`skill-desc-zh: 注册设置页路由失败：${String(error?.message ?? error)}`)
  }

  let control
  try {
    ctx.skills.registerProvider((providerControl) => {
      control = providerControl
      controller.attach(providerControl)
      return controller.provider
    })
  } catch (error) {
    logger.warn?.(`skill-desc-zh: 注册 provider 失败：${String(error?.message ?? error)}`)
    throw error
  }

  let toolDisposer
  try {
    toolDisposer = ctx.tools.register(createTool({ controller, logger }))
  } catch (error) {
    logger.warn?.(`skill-desc-zh: 注册工具 ${TOOL_NAME} 失败：${String(error?.message ?? error)}`)
  }

  let agentCreatedDisposer
  if (typeof ctx.on === 'function') {
    try {
      agentCreatedDisposer = ctx.on('agent/created', (payload) => {
        const agent = payload?.agent ?? payload
        try {
          const registered = controller.registerForAgent({ agent })
          if (!registered.ok) {
            logger.debug?.(`skill-desc-zh: agent 层 provider 未注册（${registered.reason ?? '未知原因'}）`)
          }
        } catch (error) {
          logger.warn?.(`skill-desc-zh: 注册 agent 层 provider 异常：${String(error?.message ?? error)}`)
        }
        try {
          controller.ensureCommandShadows({ agent })
        } catch (error) {
          logger.warn?.(`skill-desc-zh: 注册命令影子异常：${String(error?.message ?? error)}`)
        }
        controller.ensureShadowsForAgent({ agent }).catch((error) => {
          logger.warn?.(`skill-desc-zh: agent/created 后创建影子失败：${String(error?.message ?? error)}`)
        })
      })
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 监听 agent/created 失败：${String(error?.message ?? error)}`)
    }
  }

  let commandsChangeDisposer
  let commandsChangeTimer
  if (typeof ctx.on === 'function') {
    try {
      commandsChangeDisposer = ctx.on('commands/change', () => {
        if (commandsChangeTimer) clearTimeout(commandsChangeTimer)
        commandsChangeTimer = setTimeout(() => {
          commandsChangeTimer = undefined
          controller.handleCommandsChange().catch((error) => {
            logger.warn?.(`skill-desc-zh: 处理 commands/change 失败：${String(error?.message ?? error)}`)
          })
        }, 50)
        commandsChangeTimer.unref?.()
      })
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 监听 commands/change 失败：${String(error?.message ?? error)}`)
    }
  }

  ctx.effect(() => {
    const timer = setTimeout(() => {
      controller.startup().catch((error) => {
        logger.warn?.(`skill-desc-zh: 启动任务异常：${String(error?.message ?? error)}`)
      })
    }, 0)
    return () => {
      clearTimeout(timer)
      if (commandsChangeTimer) clearTimeout(commandsChangeTimer)
      for (const disposer of [toolDisposer, agentCreatedDisposer, commandsChangeDisposer, httpApi]) {
        if (typeof disposer === 'function') {
          try {
            disposer()
          } catch {
            /* 清理失败不阻塞卸载 */
          }
        } else if (disposer && typeof disposer.dispose === 'function') {
          try {
            disposer.dispose()
          } catch {
            /* 同上 */
          }
        }
      }
      controller.dispose()
    }
  })

  logger.info?.(
    `skill-desc-zh: 已加载（provider ${PROVIDER_NAME} rank ${PROVIDER_RANK}；`
    + `agent 层 ${AGENT_PROVIDER_NAME} rank ${AGENT_PROVIDER_RANK} 覆盖 runtime 技能；`
    + `命令影子 ${config.targets.commands.join(',') || '未启用'}；`
    + `设置页 API ${API_PREFIX}；插件管理 API ${API_PREFIX}/plugins）`,
  )
  return controller
}

export default { name, inject, apply }
