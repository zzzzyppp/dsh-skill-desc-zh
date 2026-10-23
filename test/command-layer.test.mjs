import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AGENT_TEAMS_PROFILE_PATTERN,
  BUILTIN_COMMAND_IDS,
  buildShadowDefinition,
  commandFingerprint,
  createCommandLayer,
  makeDelegate,
  templateTranslation,
} from '../lib/command-layer.js'
import { defaultState, pruneCache, recordCommand } from '../lib/state.js'
import { DICTIONARY, validateTranslation } from '../lib/translate.js'

const NOW = () => new Date('2026-02-03T04:05:06.000Z')

function makeCommand(name, description, { definitionId, hint, handler, input, recordInput } = {}) {
  const command = {
    name,
    description,
    handler: handler ?? (() => ({ kind: 'text', text: `${name}-ok` })),
  }
  if (definitionId !== undefined) command.definitionId = definitionId
  if (input !== undefined) command.input = input
  else if (hint !== undefined) command.input = { hint }
  if (recordInput !== undefined) command.recordInput = recordInput
  return command
}

/** 最小化的真实 commands 语义：全局层 + 每个 agent 一层，近层覆盖；全局 register 必抛。 */
function createHost(entries = []) {
  const global = new Map(entries.map((item) => [item.name, item]))
  const layers = new Map()
  const actions = []
  const merge = (agent) => new Map([...global, ...(layers.get(agent) ?? new Map())])
  const descriptor = (definition) => {
    const { handler, ...rest } = definition
    return { ...rest }
  }
  const service = {
    list(agent) {
      return [...merge(agent).values()].map(descriptor)
    },
    find(agent, name) {
      return merge(agent).get(name)
    },
    register() {
      throw new Error(
        'command "acp" is already registered (for a per-agent variant, mount a command-injected plugin under that agent\'s agent.ctx)',
      )
    },
  }
  function scope(agent) {
    return {
      list: () => service.list(agent),
      find: (_agent, name) => service.find(agent, name),
      register(definition) {
        let layer = layers.get(agent)
        if (!layer) {
          layer = new Map()
          layers.set(agent, layer)
        }
        if (layer.has(definition.name)) throw new Error(`command "${definition.name}" is already registered`)
        layer.set(definition.name, definition)
        actions.push({ type: 'register', name: definition.name, description: definition.description })
        return () => {
          if (layer.delete(definition.name)) actions.push({ type: 'dispose', name: definition.name })
        }
      },
    }
  }
  function addAgent(id = 'agent-1') {
    const agent = {
      id,
      ctx: {
        get(name) {
          return name === 'commands' ? scope(agent) : undefined
        },
      },
    }
    layers.set(agent, new Map())
    return agent
  }
  return {
    service,
    addAgent,
    actions,
    global,
    layer: (agent) => layers.get(agent) ?? new Map(),
    setGlobal(definition) {
      global.set(definition.name, definition)
    },
    deleteGlobal(name) {
      global.delete(name)
    },
  }
}

function makeLayer(host, extra = {}) {
  return createCommandLayer({
    now: NOW,
    translate: translateTo((item) => `【中文】${item.description}`),
    ...extra,
  })
}

function translateTo(zh, hook) {
  return async (input) => {
    hook?.(input)
    const results = {}
    for (const item of input.items ?? []) {
      const text = typeof zh === 'function' ? zh(item) : zh
      results[item.name] = {
        name: item.name,
        en: item.description,
        zh: text,
        text,
        engine: 'llm',
        fingerprint: item.fingerprint,
        cached: false,
      }
    }
    return {
      results,
      translations: {},
      cache: { ...(input.cache ?? {}) },
      warnings: [],
      counts: { llm: (input.items ?? []).length, dictionary: 0, source: 0, none: 0 },
      engine: 'llm',
    }
  }
}

test('U1 影子只透传宿主的 definitionId/name/description/input/recordInput/handler', () => {
  const handler = () => ({ kind: 'text', text: 'ok' })
  const original = makeCommand('acp', 'Show bili context-compression status', {
    definitionId: '@scope/acp',
    input: { hint: '输入 /acp 查看' },
    recordInput: true,
    handler,
  })
  const host = createHost([original])
  const shadow = buildShadowDefinition({
    name: 'acp',
    original,
    description: '显示 bili 上下文压缩状态',
    commands: host.service,
  })
  assert.equal(shadow.name, 'acp')
  assert.equal(shadow.description, '显示 bili 上下文压缩状态')
  assert.equal(shadow.definitionId, '@scope/acp')
  assert.equal(shadow.input, original.input, 'input 原引用透传（hint/attachments 影响执行）')
  assert.equal(shadow.recordInput, true)
  assert.equal(typeof shadow.handler, 'function')
  assert.deepEqual(shadow.handler(), { kind: 'text', text: 'ok' })
  assert.deepEqual(Object.keys(shadow).sort(), ['definitionId', 'description', 'handler', 'input', 'name', 'recordInput'])
})

test('U2 内置命令按 name 或 definitionId 排除，并给出 warning', async () => {
  const host = createHost([
    makeCommand('goal', 'Run a long-running goal'),
    makeCommand('acp', 'Show bili context-compression status'),
    makeCommand('daily', 'A custom command', { definitionId: BUILTIN_COMMAND_IDS[0] }),
  ])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  const result = await layer.prepare({
    commands: host.service,
    targets: ['goal', 'acp', 'daily'],
    hostVersion: '0.2.1-rc.2',
  })
  assert.deepEqual(result.skipped.map((item) => item.name).sort(), ['daily', 'goal'])
  assert.ok(result.warnings.some((item) => item.includes('跳过内置命令')))
  layer.ensure(agent)
  assert.equal(host.layer(agent).has('goal'), false)
  assert.equal(host.layer(agent).has('daily'), false)
  assert.equal(host.layer(agent).get('acp').description, '【中文】Show bili context-compression status')
})

test('U3 目标缺失只记 missing，不注册也不抛错', async () => {
  const host = createHost([makeCommand('acp', 'Show bili context-compression status')])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  const result = await layer.prepare({
    commands: host.service,
    targets: ['acp', 'not-yet-registered'],
    hostVersion: '0.2.1-rc.2',
  })
  assert.deepEqual(result.missing, ['not-yet-registered'])
  assert.ok(result.warnings.some((item) => item.includes('命令尚未注册')))
  layer.ensure(agent)
  assert.equal(host.layer(agent).has('not-yet-registered'), false)
  assert.equal(host.layer(agent).has('acp'), true)

  const empty = makeLayer(host)
  const failed = await empty.prepare({
    commands: { list: async () => [], find: async () => undefined },
    targets: ['acp'],
    hostVersion: '0.2.1-rc.2',
  })
  assert.equal(failed.ok, true)
  assert.deepEqual(failed.missing, ['acp'])
})

test('U4 委托实时优先：全局 handler 被替换后影子立即调用新实现', async () => {
  let oldCalls = 0
  let newCalls = 0
  const host = createHost([
    makeCommand('acp', 'Show bili context-compression status', {
      handler: () => {
        oldCalls += 1
        return { kind: 'text', text: 'old' }
      },
    }),
  ])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  await layer.prepare({ commands: host.service, targets: ['acp'], hostVersion: '0.2.1-rc.2' })
  layer.ensure(agent)
  host.setGlobal(makeCommand('acp', 'Show bili context-compression status', {
    handler: () => {
      newCalls += 1
      return { kind: 'text', text: 'new' }
    },
  }))
  const shadow = host.layer(agent).get('acp')
  assert.deepEqual(shadow.handler(), { kind: 'text', text: 'new' })
  assert.equal(oldCalls, 0)
  assert.equal(newCalls, 1)
})

test('U5 全局定义消失时用注册前快照兜底', async () => {
  let calls = 0
  const host = createHost([
    makeCommand('acp', 'Show bili context-compression status', {
      handler: () => {
        calls += 1
        return { kind: 'text', text: 'snapshot' }
      },
    }),
  ])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  await layer.prepare({ commands: host.service, targets: ['acp'], hostVersion: '0.2.1-rc.2' })
  layer.ensure(agent)
  host.deleteGlobal('acp')
  assert.deepEqual(host.layer(agent).get('acp').handler(), { kind: 'text', text: 'snapshot' })
  assert.equal(calls, 1)
})

test('U6 原 handler 抛错原样抛出，不被影子吞掉或改写', async () => {
  const host = createHost([
    makeCommand('acp', 'Show bili context-compression status', {
      handler: () => {
        throw new Error('原命令失败')
      },
    }),
  ])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  await layer.prepare({ commands: host.service, targets: ['acp'], hostVersion: '0.2.1-rc.2' })
  layer.ensure(agent)
  assert.throws(() => host.layer(agent).get('acp').handler({}), /原命令失败/)
})

test('U7 原始实现与快照都不可用时返回明确 error，不抛错', async () => {
  const original = makeCommand('acp', 'Show bili context-compression status')
  const host = createHost([original])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  await layer.prepare({ commands: host.service, targets: ['acp'], hostVersion: '0.2.1-rc.2' })
  layer.ensure(agent)
  host.deleteGlobal('acp')
  original.handler = undefined
  const result = host.layer(agent).get('acp').handler({})
  assert.equal(result.kind, 'error')
  assert.match(result.text, /\/acp 的原始实现已不可用（skill-desc-zh 命令影子）/)
})

test('U8 commandFingerprint 对 name/en/hint/hostVersion 稳定且可区分', () => {
  const a = commandFingerprint('acp', 'Show status', 'hint', '0.2.1-rc.2')
  const b = commandFingerprint('acp', 'Show status', 'hint', '0.2.1-rc.2')
  assert.equal(a, b)
  assert.equal(a.length, 64)
  assert.notEqual(a, commandFingerprint('acp', 'Show status!', 'hint', '0.2.1-rc.2'))
  assert.notEqual(a, commandFingerprint('acp', 'Show status', 'other', '0.2.1-rc.2'))
  assert.notEqual(a, commandFingerprint('acp-cache', 'Show status', 'hint', '0.2.1-rc.2'))
  assert.notEqual(a, commandFingerprint('acp', 'Show status', 'hint', '0.3.0'))
})

test('U9 漂移时先 dispose 旧影子，再翻译，再重注册', async () => {
  const host = createHost([makeCommand('acp', 'Show bili context-compression status')])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  await layer.prepare({
    commands: host.service,
    targets: ['acp'],
    hostVersion: '0.2.1-rc.2',
    translate: translateTo('显示 bili 上下文压缩状态（旧）'),
  })
  layer.ensure(agent)
  assert.equal(host.layer(agent).size, 1)

  host.setGlobal(makeCommand('acp', 'Show bili context-compression status v2'))
  let layerSizeDuringTranslate = -1
  const result = await layer.prepare({
    commands: host.service,
    targets: ['acp'],
    hostVersion: '0.2.1-rc.2',
    translate: translateTo('显示 bili 上下文压缩状态（新）', () => {
      layerSizeDuringTranslate = host.layer(agent).size
    }),
  })
  assert.equal(layerSizeDuringTranslate, 0, '翻译期间旧影子已下架（显示英文）')
  assert.ok(host.actions.some((item) => item.type === 'dispose' && item.name === 'acp'))
  layer.ensure(agent)
  assert.equal(host.layer(agent).get('acp').description, '显示 bili 上下文压缩状态（新）')
  assert.equal(result.translations.acp.zh, '显示 bili 上下文压缩状态（新）')
})

test('U10 连续 ensure 幂等，且 check 报告 agent 中文 / global 英文', async () => {
  const host = createHost([makeCommand('acp', 'Show bili context-compression status', { definitionId: '@scope/acp' })])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  await layer.prepare({ commands: host.service, targets: ['acp'], hostVersion: '0.2.1-rc.2' })
  const first = layer.ensure(agent)
  const second = layer.ensure(agent)
  assert.equal(first.registered, 1)
  assert.equal(second.unchanged, true)
  assert.equal(host.actions.filter((item) => item.type === 'register').length, 1)
  const check = await layer.check(agent)
  assert.equal(check.checked.ok, true)
  assert.equal(check.checked.results[0].globalEnglish, true)
  assert.equal(check.checked.results[0].definitionId, '@scope/acp')
})

test('U11 restore 全部回英文，apply 重注册且不重新翻译', async () => {
  const host = createHost([makeCommand('acp', 'Show bili context-compression status')])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  await layer.prepare({ commands: host.service, targets: ['acp'], hostVersion: '0.2.1-rc.2' })
  layer.ensure(agent)
  const restored = layer.restore()
  assert.equal(restored.disposed, 1)
  assert.equal(host.layer(agent).size, 0)
  assert.ok(restored.restoredAt)
  const applied = layer.apply()
  assert.equal(applied.registered, 1)
  assert.equal(host.layer(agent).get('acp').description, '【中文】Show bili context-compression status')
})

test('U12 AgentTeams profile 模板离线翻译，不走 LLM，动态命令一并覆盖', async () => {
  const host = createHost([
    makeCommand('agent-teams', 'run a goal with a multi-agent team (you become the captain)'),
    makeCommand('agent-teams-dev', 'run a goal with the AgentTeams dev profile'),
  ])
  const layer = makeLayer(host)
  const agent = host.addAgent()
  const seen = []
  const translate = async (input) => {
    for (const item of input.items ?? []) seen.push(item.name)
    return {
      results: {
        'command:agent-teams': {
          name: 'command:agent-teams',
          en: 'run a goal with a multi-agent team (you become the captain)',
          zh: '以多智能体团队运行目标（你将成为队长）',
          text: '以多智能体团队运行目标（你将成为队长）',
          engine: 'llm',
          fingerprint: input.items?.[0]?.fingerprint,
          cached: false,
        },
      },
      cache: {},
      warnings: [],
      counts: { llm: 1, dictionary: 0, source: 0, none: 0 },
      engine: 'llm',
    }
  }
  const result = await layer.prepare({
    commands: host.service,
    targets: ['agent-teams'],
    hostVersion: '0.2.1-rc.2',
    translate,
  })
  assert.deepEqual(seen, ['command:agent-teams'], '模板命中的动态命令不进入 LLM 批次')
  assert.equal(result.translations['agent-teams-dev'].engine, 'template')
  assert.equal(result.translations['agent-teams-dev'].zh, '以 AgentTeams「dev」配置运行一个团队目标')
  assert.equal(templateTranslation('run a goal with the AgentTeams dev profile').zh, '以 AgentTeams「dev」配置运行一个团队目标')
  assert.equal(AGENT_TEAMS_PROFILE_PATTERN.test('run a goal with the AgentTeams staging profile'), true)
  layer.ensure(agent)
  assert.equal(host.layer(agent).get('agent-teams-dev').description, '以 AgentTeams「dev」配置运行一个团队目标')
})

test('U13 三条命令的内置译文逐字正确且通过 validateTranslation', () => {
  const expected = {
    'Show bili context-compression status': '显示 bili 上下文压缩状态',
    'Prompt-cache reconciliation (same report as the acp_cache tool)': '提示词缓存对账（与 acp_cache 工具同源同报）',
    'run a goal with a multi-agent team (you become the captain)': '以多智能体团队运行目标（你将成为队长）',
  }
  for (const [en, zh] of Object.entries(expected)) {
    assert.equal(DICTIONARY[en], zh)
    const checked = validateTranslation({ name: 'command:test', en, zh })
    assert.equal(checked.ok, true, checked.reason)
  }
})

test('U14 pruneCache 保留命令指纹，restore 状态可持久化', () => {
  const state = defaultState({ now: NOW })
  recordCommand(state, 'acp', {
    en: 'Show status',
    zh: '显示状态',
    engine: 'llm',
    fingerprint: 'k'.repeat(64),
  }, { now: NOW })
  state.cache['k'.repeat(64)] = { zh: '显示状态', engine: 'llm' }
  state.cache.stale = { zh: '旧' }
  pruneCache(state)
  assert.deepEqual(Object.keys(state.cache), ['k'.repeat(64)])
  assert.equal(state.commands.byName.acp.zh, '显示状态')
})
