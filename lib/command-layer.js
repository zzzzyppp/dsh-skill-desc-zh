/**
 * v0.2：斜杠命令描述中文化（agent scope 命令影子）。
 *
 * 机制（docs/command-desc-design.md §3）：
 *  - 全局层同名注册会直接抛错，唯一可行的是在每个 agent 的 scope 层注册同名命令；
 *  - 影子只保留宿主的七个合法字段：definitionId / name / description / input /
 *    recordInput / handler（未知字段会被宿主静默丢弃）；
 *  - handler 委托原实现：每次调用实时 `find(undefined, name)`，快照仅作兜底；
 *    不 catch、不重写返回值，执行语义完全不变；
 *  - 本模块不注册全局命令、不读写文件、不依赖 LLM 之外的服务。
 */

import { createHash } from 'node:crypto'

import {
  SYSTEM_PROMPT_COMMANDS,
  translateBatch,
  validateTranslation,
} from './translate.js'

/** 默认中文化三条第三方命令；config.targets.commands 覆盖。 */
export const DEFAULT_COMMAND_TARGETS = Object.freeze(['acp', 'acp-cache', 'agent-teams'])

/** GUI 会按 definitionId 本地化的 6 条内置命令名；影子对它们无效。 */
export const BUILTIN_COMMAND_NAMES = Object.freeze([
  'goal',
  'plan',
  'feedback',
  'compact',
  'permission',
  'export',
])

/** 与 dsh-client-ui-commands/lib/client.js:780-787 的 BUILTINS 保持逐字一致。 */
export const BUILTIN_COMMAND_IDS = Object.freeze([
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-plan-mode',
  '@deepseek-ai/dsh-command-feedback',
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-permission-presets',
  '@deepseek-ai/dsh-session-log-export',
])

/** translateBatch 的条目命名空间，避免与技能名冲突。 */
export const COMMAND_TRANSLATION_PREFIX = 'command:'

/** 动态 profile 命令的模板：不依赖 LLM/词典，离线也能中文化。 */
export const AGENT_TEAMS_PROFILE_PATTERN = /^run a goal with the AgentTeams (.+) profile$/

const DELEGATE_UNAVAILABLE = (name) =>
  `/${name} 的原始实现已不可用（skill-desc-zh 命令影子）`

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function nowIso(now) {
  const value = now()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function normalizeTargets(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * 命令译文指纹（design §4.5）：
 * sha256(hostVersion \0 'command' \0 name \0 sha256(en \0 (hint ?? '')))
 */
export function commandFingerprint(name, en, hint, hostVersion = 'unknown') {
  const enHash = sha256(`${en ?? ''}\0${hint ?? ''}`)
  return sha256(`${hostVersion ?? 'unknown'}\0command\0${name}\0${enHash}`)
}

/** `run a goal with the AgentTeams <profile> profile` → 中文；其它返回 undefined。 */
export function templateTranslation(en) {
  if (typeof en !== 'string') return undefined
  const match = AGENT_TEAMS_PROFILE_PATTERN.exec(en.trim())
  if (!match) return undefined
  const profile = match[1].trim()
  if (!profile) return undefined
  const zh = `以 AgentTeams「${profile}」配置运行一个团队目标`
  const check = validateTranslation({ name: `command:agent-teams-${profile}`, en, zh })
  if (!check.ok) return undefined
  return { zh, engine: 'template' }
}

/** 只透传宿主 normalizeDefinition 认识的字段，避免拼写错误被静默吞掉。 */
export function buildShadowDefinition({ name, original, description, commands } = {}) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('buildShadowDefinition: name 必须是非空字符串')
  if (!original || typeof original !== 'object') throw new TypeError(`buildShadowDefinition: ${name} 缺少原始定义`)
  if (typeof description !== 'string' || description.length === 0) {
    throw new TypeError(`buildShadowDefinition: ${name} 缺少中文描述`)
  }
  const shadow = {
    name,
    description,
    handler: makeDelegate(name, original, commands),
  }
  if (original.definitionId !== undefined) shadow.definitionId = original.definitionId
  if (original.input !== undefined) shadow.input = original.input
  if (original.recordInput !== undefined) shadow.recordInput = original.recordInput
  return shadow
}

/**
 * 三段式委托：实时全局定义优先 → 注册前快照兜底 → 明确错误。
 * 不 catch，保持原 handler 的抛错语义。
 */
export function makeDelegate(name, snapshot, commands) {
  return function delegate(invocation) {
    let current
    if (commands && typeof commands.find === 'function') {
      try {
        current = commands.find(undefined, name)
      } catch {
        current = undefined
      }
    }
    const target = current && typeof current.handler === 'function' ? current : snapshot
    if (!target || typeof target.handler !== 'function') {
      return { kind: 'error', text: DELEGATE_UNAVAILABLE(name) }
    }
    return target.handler.call(target, invocation)
  }
}

function disposerOf(value) {
  if (typeof value === 'function') return value
  if (value && typeof value.dispose === 'function') return () => value.dispose()
  return undefined
}

/**
 * 纯命令层：所有服务与翻译函数都可注入，便于单测。
 *
 * @param {{
 *   logger?: object,
 *   now?: () => Date,
 *   translate?: Function,
 *   builtinNames?: string[],
 *   builtinIds?: string[],
 * }} [options]
 */
export function createCommandLayer(options = {}) {
  const logger = options.logger ?? {}
  const now = options.now ?? (() => new Date())
  const translate = options.translate ?? translateBatch
  const builtinNames = new Set(options.builtinNames ?? BUILTIN_COMMAND_NAMES)
  const builtinIds = new Set(options.builtinIds ?? BUILTIN_COMMAND_IDS)

  let commands
  let targets = []
  let hostVersion = 'unknown'
  let captures = new Map()
  let translations = new Map()
  let warnings = []
  let missing = []
  let skipped = []
  let globalSignature = ''
  let preparedAt
  let restoredAt
  let lastRegisteredAt
  const records = new WeakMap()
  const knownAgents = new Set()

  function recomputeFailedAgents() {
    let failed = 0
    for (const agent of knownAgents) {
      const record = records.get(agent)
      if (record && record.failed > 0) failed += 1
    }
    return failed
  }

  function countRegistered() {
    let registered = 0
    for (const agent of knownAgents) {
      const record = records.get(agent)
      if (record) registered += record.entries.length
    }
    return registered
  }

  async function listGlobal() {
    if (!commands || typeof commands.list !== 'function') return []
    const listed = await commands.list(undefined)
    return Array.isArray(listed) ? listed.filter((item) => Boolean(item) && typeof item.name === 'string') : []
  }

  async function findGlobal(name) {
    if (!commands || typeof commands.find !== 'function') return undefined
    try {
      const found = await commands.find(undefined, name)
      return found && typeof found === 'object' ? found : undefined
    } catch (error) {
      warnings.push(`读取命令 /${name} 的原始定义失败：${String(error?.message ?? error)}`)
      return undefined
    }
  }

  function isBuiltin(name, definitionId) {
    return builtinNames.has(name) || (typeof definitionId === 'string' && builtinIds.has(definitionId))
  }

  function computeGlobalSignature(listed) {
    const configured = new Set(targets)
    const dynamic = targets.includes('agent-teams')
    const entries = []
    for (const descriptor of listed) {
      const name = descriptor.name
      const isTarget = configured.has(name) || (dynamic && /^agent-teams-.+$/.test(name))
      if (!isTarget) continue
      entries.push([
        name,
        typeof descriptor.description === 'string' ? descriptor.description : '',
        typeof descriptor.definitionId === 'string' ? descriptor.definitionId : '',
        JSON.stringify(descriptor.input ?? null),
      ].join('\0'))
    }
    entries.sort()
    return sha256(entries.join('\n'))
  }

  function makeCapture(name, original) {
    const en = typeof original.description === 'string' ? original.description : ''
    const hint = typeof original.input?.hint === 'string' ? original.input.hint : ''
    return {
      name,
      en,
      hint,
      definitionId: original.definitionId,
      input: original.input,
      recordInput: original.recordInput,
      hasHandler: typeof original.handler === 'function',
      fingerprint: commandFingerprint(name, en, hint, hostVersion),
      snapshot: original,
    }
  }

  async function capture(input = {}) {
    if (input.commands !== undefined) commands = input.commands
    if (input.targets !== undefined) targets = normalizeTargets(input.targets)
    if (typeof input.hostVersion === 'string') hostVersion = input.hostVersion
    warnings = []
    missing = []
    skipped = []
    captures = new Map()

    if (!commands || typeof commands.list !== 'function' || typeof commands.find !== 'function') {
      warnings.push('commands 服务不可用；命令描述保持英文')
      globalSignature = ''
      return { ok: false, captures: [], missing: [], skipped: [], warnings: [...warnings] }
    }

    let listed = []
    try {
      listed = await listGlobal()
    } catch (error) {
      warnings.push(`读取全局命令列表失败：${String(error?.message ?? error)}；命令描述保持英文`)
      return { ok: false, captures: [], missing: [], skipped: [], warnings: [...warnings] }
    }

    const taken = new Set()
    for (const name of targets) {
      if (builtinNames.has(name)) {
        skipped.push({ name, reason: 'builtin' })
        continue
      }
      const original = await findGlobal(name)
      if (!original) {
        missing.push(name)
        continue
      }
      if (isBuiltin(name, original.definitionId)) {
        skipped.push({ name, reason: 'builtin', definitionId: original.definitionId })
        continue
      }
      captures.set(name, makeCapture(name, original))
      taken.add(name)
    }

    // agent-teams 会按 profile 动态注册命令；随固定目标一起中文化（模板，零成本）。
    if (targets.includes('agent-teams')) {
      for (const descriptor of listed) {
        if (!/^agent-teams-.+$/.test(descriptor.name) || taken.has(descriptor.name)) continue
        if (builtinNames.has(descriptor.name)) continue
        const original = await findGlobal(descriptor.name)
        if (!original) {
          missing.push(descriptor.name)
          continue
        }
        if (isBuiltin(descriptor.name, original.definitionId)) {
          skipped.push({ name: descriptor.name, reason: 'builtin', definitionId: original.definitionId })
          continue
        }
        captures.set(descriptor.name, makeCapture(descriptor.name, original))
        taken.add(descriptor.name)
      }
    }

    globalSignature = computeGlobalSignature(listed)
    if (skipped.length > 0) {
      warnings.push(`跳过内置命令（GUI 已本地化）：${skipped.map((item) => item.name).join(', ')}`)
    }
    if (missing.length > 0) {
      warnings.push(`命令尚未注册：${missing.join(', ')}；等待 commands/change 后重试`)
    }
    for (const captureItem of captures.values()) {
      if (!captureItem.hasHandler) warnings.push(`/${captureItem.name} 没有 handler，跳过影子注册`)
    }
    return {
      ok: true,
      captures: [...captures.values()].map(publicCapture),
      missing: [...missing],
      skipped: [...skipped],
      warnings: [...warnings],
    }
  }

  function publicCapture(item) {
    return {
      name: item.name,
      en: item.en,
      hint: item.hint,
      definitionId: item.definitionId,
      fingerprint: item.fingerprint,
      hasHandler: item.hasHandler,
    }
  }

  async function prepare(input = {}) {
    const captured = await capture(input)
    // 漂移（英文/hint/宿主版本变化）时先下架旧影子：绝不在旧中文之上叠加新影子，
    // 也保证翻译期间显示英文而不是过期译文。首次 prepare 时 translations 为空，天然 no-op。
    let drift = false
    for (const item of captures.values()) {
      const previous = translations.get(item.name)
      if (!previous || previous.fingerprint !== item.fingerprint) {
        drift = true
        break
      }
    }
    if (!drift) {
      for (const name of translations.keys()) {
        if (!captures.has(name)) {
          drift = true
          break
        }
      }
    }
    if (drift) restore({ record: false })

    const cache = input.cache && typeof input.cache === 'object' ? input.cache : {}
    const callTranslate = input.translate ?? translate
    const items = []
    const itemNames = new Map()
    const nextTranslations = new Map()

    for (const item of captures.values()) {
      if (!item.en || !item.hasHandler) continue
      const template = templateTranslation(item.en)
      if (template) {
        nextTranslations.set(item.name, {
          ...template,
          fingerprint: item.fingerprint,
          translatedAt: nowIso(now),
        })
        continue
      }
      const itemName = `${COMMAND_TRANSLATION_PREFIX}${item.name}`
      items.push({
        name: itemName,
        description: item.en,
        fingerprint: item.fingerprint,
        hostVersion,
      })
      itemNames.set(itemName, item.name)
    }

    let batch
    let nextCache = cache
    if (items.length > 0) {
      try {
        batch = await callTranslate({
          items,
          systemPrompt: SYSTEM_PROMPT_COMMANDS,
          llm: input.engine === 'dictionary' ? undefined : input.llm,
          model: input.model,
          selection: input.selection,
          agentDefaultModel: input.agentDefaultModel,
          hostVersion,
          cache,
          engine: input.engine,
          signal: input.signal,
          timeoutMs: input.timeoutMs,
          maxTokens: input.maxTokens,
          dictionary: input.dictionary,
          logger: input.logger ?? logger,
          now,
        })
      } catch (error) {
        warnings.push(`命令描述翻译失败：${String(error?.message ?? error)}；保持英文`)
      }
      if (batch) {
        nextCache = batch.cache && typeof batch.cache === 'object' ? batch.cache : cache
        if (Array.isArray(batch.warnings)) warnings.push(...batch.warnings)
        for (const [itemName, result] of Object.entries(batch.results ?? {})) {
          const name = itemNames.get(itemName)
          if (!name) continue
          const item = captures.get(name)
          if (result?.engine === 'source') {
            nextTranslations.set(name, {
              zh: item.en,
              engine: 'source',
              fingerprint: item.fingerprint,
              translatedAt: nowIso(now),
              skip: true,
            })
            continue
          }
          const zh = typeof result?.zh === 'string' ? result.zh.trim() : ''
          if (result?.engine !== 'none' && zh.length > 0) {
            nextTranslations.set(name, {
              zh,
              engine: result.engine,
              ...(result.model ? { model: result.model } : {}),
              fingerprint: item.fingerprint,
              translatedAt: nowIso(now),
            })
          } else if (result?.error) {
            warnings.push(`/${name}: ${result.error}`)
          }
        }
      }
    }

    translations = nextTranslations
    // 重新准备成功即视为“已重新启用”，清掉上一次 restore 留下的时间戳。
    restoredAt = undefined
    preparedAt = nowIso(now)
    const registration = registerAgents([...knownAgents])
    return {
      ok: captured.ok,
      captures: captured.captures,
      translations: Object.fromEntries([...translations].map(([name, value]) => [name, { ...value }])),
      cache: nextCache,
      warnings: [...warnings],
      missing: [...missing],
      skipped: [...skipped],
      counts: {
        zh: [...translations.values()].filter((item) => !item.skip).length,
        total: translations.size,
      },
      engine: batch?.engine ?? (translations.size > 0 ? 'template' : 'none'),
      globalSignature,
      registration,
      preparedAt,
    }
  }

  function getAgentCommands(agent) {
    try {
      const service = agent?.ctx?.get?.('commands')
      return service && typeof service.register === 'function' ? service : undefined
    } catch (error) {
      logger.debug?.(`读取 agent commands 服务失败：${String(error?.message ?? error)}`)
      return undefined
    }
  }

  function signatureFor(active) {
    const parts = [hostVersion, targets.join(',')]
    for (const [name, translation] of active) {
      parts.push(`${name}\0${captures.get(name)?.fingerprint ?? ''}\0${translation.zh}`)
    }
    return sha256(parts.join('\0'))
  }

  function disposeRecord(record) {
    let disposed = 0
    for (const entry of record?.entries ?? []) {
      try {
        entry.dispose?.()
        disposed += 1
      } catch (error) {
        logger.debug?.(`注销命令影子 /${entry.name} 失败：${String(error?.message ?? error)}`)
      }
    }
    return disposed
  }

  /**
   * 为一个 agent 建立/刷新影子（同步；注册本身是同步 Map 操作）。
   * signature 相同直接返回，避免 commands/change 自触发导致重复注册。
   */
  function ensure(agent) {
    if (!agent) return { ok: false, reason: '缺少 agent', registered: 0 }
    knownAgents.add(agent)
    const agentCommands = getAgentCommands(agent)
    if (!agentCommands) {
      return { ok: false, reason: 'agent scope 没有 commands 服务', registered: 0 }
    }
    const active = [...translations].filter(([, value]) => value && !value.skip && typeof value.zh === 'string')
    const signature = signatureFor(active)
    const previous = records.get(agent)
    if (previous && previous.signature === signature) {
      return { ok: previous.failed === 0, registered: previous.entries.length, unchanged: true, failed: previous.failed }
    }
    if (previous) disposeRecord(previous)
    if (active.length === 0) {
      records.delete(agent)
      return { ok: true, registered: 0, skipped: true, reason: '还没有可用的中文译文' }
    }

    const entries = []
    let failed = 0
    for (const [name, translation] of active) {
      const item = captures.get(name)
      if (!item) continue
      try {
        const shadow = buildShadowDefinition({
          name,
          original: item.snapshot,
          description: translation.zh,
          commands,
        })
        const disposer = disposerOf(agentCommands.register(shadow))
        entries.push({ name, dispose: disposer })
      } catch (error) {
        failed += 1
        warnings.push(`/${name} 的影子注册失败：${String(error?.message ?? error)}`)
      }
    }
    const record = { signature, entries, failed, at: nowIso(now) }
    records.set(agent, record)
    lastRegisteredAt = record.at
    if (failed > 0) {
      logger.warn?.(`skill-desc-zh: ${failed} 条命令影子注册失败（agent=${agent?.id ?? agent?.session ?? '未知'}）`)
    }
    return { ok: failed === 0, registered: entries.length, failed }
  }

  function registerAgents(agents = []) {
    let registered = 0
    let failed = 0
    const results = []
    for (const agent of agents) {
      const result = ensure(agent)
      registered += result.registered ?? 0
      if (result.failed) failed += result.failed
      results.push(result)
    }
    return { ok: failed === 0, registered, failed, results }
  }

  function apply() {
    const result = registerAgents([...knownAgents])
    if (result.ok) restoredAt = undefined
    return result
  }

  function restore({ record = true } = {}) {
    let disposed = 0
    for (const agent of [...knownAgents]) {
      const record_ = records.get(agent)
      if (record_) disposed += disposeRecord(record_)
      records.delete(agent)
    }
    if (record) restoredAt = nowIso(now)
    return { ok: true, disposed, restoredAt }
  }

  /** restore + 清空译文/捕获；用于宿主版本变化与 retranslate。 */
  function clear() {
    const result = restore()
    translations = new Map()
    captures = new Map()
    warnings = []
    missing = []
    skipped = []
    globalSignature = ''
    preparedAt = undefined
    return result
  }

  function forgetAgent(agent) {
    const record = records.get(agent)
    if (record) disposeRecord(record)
    records.delete(agent)
    knownAgents.delete(agent)
  }

  function dispose() {
    const result = restore()
    knownAgents.clear()
    translations = new Map()
    captures = new Map()
    return result
  }

  async function globalChanged() {
    if (!commands || typeof commands.list !== 'function') return false
    try {
      const listed = await listGlobal()
      return computeGlobalSignature(listed) !== globalSignature
    } catch {
      return false
    }
  }

  async function check(agent) {
    const base = { registered: 0, sample: [] }
    if (!commands) {
      return { ...base, checked: { ok: false, reason: 'commands 服务不可用' } }
    }
    if (!agent) {
      return { ...base, checked: { ok: false, reason: '本次进程还没有 agent 注册命令影子' } }
    }
    const expected = [...translations].filter(([, value]) => value && !value.skip && typeof value.zh === 'string')
    if (expected.length === 0) {
      return { ...base, checked: { ok: false, reason: '还没有可用的命令中文译文' } }
    }
    let agentList
    let globalList
    try {
      agentList = await commands.list(agent)
      globalList = await commands.list(undefined)
    } catch (error) {
      return { ...base, checked: { ok: false, reason: `读取命令列表失败：${String(error?.message ?? error)}` } }
    }
    const agentEntries = Array.isArray(agentList) ? agentList : []
    const globalEntries = Array.isArray(globalList) ? globalList : []
    const results = []
    for (const [name, translation] of expected) {
      const item = captures.get(name)
      const agentEntry = agentEntries.find((entry) => entry?.name === name)
      const globalEntry = globalEntries.find((entry) => entry?.name === name)
      const definitionIdOk = (agentEntry?.definitionId ?? undefined) === (item?.definitionId ?? undefined)
      const globalEnglish = Boolean(globalEntry && globalEntry.description === item?.en)
      const notBuiltin = !isBuiltin(name, agentEntry?.definitionId)
      const ok = Boolean(agentEntry)
        && agentEntry.description === translation.zh
        && definitionIdOk
        && globalEnglish
        && notBuiltin
      results.push({
        name,
        ok,
        description: typeof agentEntry?.description === 'string' ? agentEntry.description.slice(0, 40) : undefined,
        definitionId: agentEntry?.definitionId,
        globalEnglish,
        notBuiltin,
      })
    }
    let registered = countRegistered()
    const failed = results.filter((item) => !item.ok)
    return {
      registered,
      sample: results.slice(0, 5),
      checked: {
        ok: results.length > 0 && failed.length === 0,
        ...(failed.length > 0 ? { reason: `未通过：${failed.map((item) => item.name).join(', ')}` } : {}),
        results,
      },
    }
  }

  function status() {
    const list = {}
    for (const [name, item] of captures) {
      const translation = translations.get(name)
      const stale = Boolean(translation && translation.fingerprint && translation.fingerprint !== item.fingerprint)
      list[name] = {
        en: item.en,
        zh: translation?.zh ?? null,
        engine: translation?.engine ?? 'none',
        ...(translation?.model ? { model: translation.model } : {}),
        stale,
        fingerprint: item.fingerprint,
      }
    }
    return {
      targets: [...targets],
      translations: list,
      agents: knownAgents.size,
      registered: countRegistered(),
      failedAgents: recomputeFailedAgents(),
      lastRegisteredAt,
      preparedAt,
      restoredAt,
      warnings: [...warnings],
      missing: [...missing],
      skipped: [...skipped],
      engine: [...translations.values()].some((item) => item.engine === 'llm')
        ? 'llm'
        : ([...translations.values()].length > 0 ? 'template-or-dictionary' : 'none'),
    }
  }

  return {
    capture,
    prepare,
    ensure,
    registerAgents,
    apply,
    restore,
    clear,
    forgetAgent,
    dispose,
    globalChanged,
    check,
    status,
    knownAgents: () => [...knownAgents],
    translations: () => new Map(translations),
    captures: () => new Map(captures),
    targetNames: () => [...targets],
    globalSignature: () => globalSignature,
  }
}
