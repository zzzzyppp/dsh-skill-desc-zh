#!/usr/bin/env node
/**
 * 命令描述中文化的端到端验证（不启动 DSH、不改磁盘、不联网）。
 *
 * 为什么必须是 Electron-as-node：脚本直接 import 宿主 app.asar 内的
 * `@deepseek-ai/cordis`、`@deepseek-ai/dsh-scope`、`@deepseek-ai/dsh-commands`
 * 真实模块，普通 node 读不了 asar。运行方式：
 *
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
 *     scripts/commands-e2e.mjs
 *
 * 覆盖（对应 docs/command-desc-design.md §8）：
 *  1. 全局注册三条命令，global 视角为英文原文；
 *  2. 用 lib/command-layer.js 为 agent A 注册影子；
 *  3. agent A 中文、global 与 agent B 英文、definitionId/input.hint 原样、descriptor 不含 handler；
 *  4. execute /acp 透传原 handler 且只执行一次；
 *  5. execute /agent-teams --profile dev go 原 handler 收到 rawInput；
 *  6. restore 回英文、apply 回中文；
 *  7. dispose 回英文，且 commands/change 有事件；
 *  8. 内置命令（definitionId 命中 GUI 本地化集合）不被覆盖。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const appAsarDsh = process.env.DSH_ASAR_DSH
  ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
const depsBase = path.join(appAsarDsh, 'node_modules', '@deepseek-ai')

const checks = []
function check(name, fn) {
  const result = fn()
  if (result && typeof result.then === 'function') {
    throw new Error(`check "${name}" 必须是同步断言（异步断言请在外层 await 后再调用 check）`)
  }
  checks.push(name)
  console.log(`✔ ${name}`)
}

const cordis = await import(path.join(depsBase, 'cordis', 'lib', 'index.js'))
const scopeMod = await import(path.join(depsBase, 'dsh-scope', 'lib', 'index.js'))
const commandsMod = await import(path.join(depsBase, 'dsh-commands', 'lib', 'index.js'))
const layerMod = await import(path.join(repoRoot, 'lib', 'command-layer.js'))
const { createCommandLayer, BUILTIN_COMMAND_IDS } = layerMod

const EN = {
  acp: 'Show bili context-compression status',
  'acp-cache': 'Prompt-cache reconciliation (same report as the acp_cache tool)',
  'agent-teams': 'run a goal with a multi-agent team (you become the captain)',
}
const ZH = {
  acp: '显示 bili 上下文压缩状态',
  'acp-cache': '提示词缓存对账（与 acp_cache 工具同源同报）',
  'agent-teams': '以多智能体团队运行目标（你将成为队长）',
}

// 真实宿主装配：Context + commands 服务 + 三个 agent scope。
const ctx = new cordis.Context()
ctx.plugin(commandsMod.CommandRuntime)
await new Promise((resolve) => setTimeout(resolve, 30))
const commands = ctx.get('commands')
assert.ok(commands && typeof commands.register === 'function', 'commands 服务应可用')

let changeEvents = 0
ctx.on('commands/change', () => {
  changeEvents += 1
})

const lifecycle = []
const makeAgent = (id) => {
  const agent = {
    id,
    session: {
      async append(type, data) {
        lifecycle.push({ agent: id, type, data })
      },
    },
  }
  agent.scope = scopeMod.createScope(ctx, agent)
  agent.ctx = agent.scope.ctx
  return agent
}
const agentA = makeAgent('agent-A')
const agentB = makeAgent('agent-B')
assert.ok(agentA.scope.ctx.get('commands'), 'agent scope 应能取到 commands 服务')

const calls = { acp: 0, 'acp-cache': 0, 'agent-teams': 0 }
const rawInputs = []
// 三个全局命令；acp 带合成 definitionId 与 hint，用于验证七字段保留。
const disposers = [
  commands.register({
    definitionId: '@deepseek-ai/dsh-command-acp',
    name: 'acp',
    description: EN.acp,
    input: { hint: '输入 /acp 查看压缩状态', attachments: true },
    handler: (invocation) => {
      calls.acp += 1
      return { kind: 'success', text: `acp-ok:${invocation.rawInput}` }
    },
  }),
  commands.register({
    name: 'acp-cache',
    description: EN['acp-cache'],
    handler: () => {
      calls['acp-cache'] += 1
      return { kind: 'success', text: 'cache-ok' }
    },
  }),
  commands.register({
    name: 'agent-teams',
    description: EN['agent-teams'],
    input: { hint: '输入团队目标' },
    handler: (invocation) => {
      calls['agent-teams'] += 1
      rawInputs.push(invocation.rawInput)
      return { kind: 'success', text: 'teams-ok' }
    },
  }),
  // GUI 已本地化的内置命令：按 definitionId 排除，必须保持英文。
  commands.register({
    definitionId: BUILTIN_COMMAND_IDS[0],
    name: 'goal',
    description: 'Run a long-running goal',
    handler: () => ({ kind: 'success' }),
  }),
]

const descriptions = (agent) => Object.fromEntries(commands.list(agent).map((item) => [item.name, item.description]))

check('全局注册后 global 视角为英文原文', () => {
  const map = descriptions(undefined)
  for (const [name, en] of Object.entries(EN)) assert.equal(map[name], en)
  assert.equal(map.goal, 'Run a long-running goal')
  assert.equal(commands.list(undefined).length, 4)
})

// 用真实层实现注册影子；翻译用确定性 stub，避免联网。
const translate = async (input) => {
  const results = {}
  for (const item of input.items ?? []) {
    const name = item.name.replace(/^command:/u, '')
    results[item.name] = {
      name: item.name,
      en: item.description,
      zh: ZH[name],
      text: ZH[name],
      engine: 'llm',
      fingerprint: item.fingerprint,
      cached: false,
    }
  }
  return {
    results,
    translations: {},
    cache: {},
    warnings: [],
    counts: { llm: (input.items ?? []).length, dictionary: 0, source: 0, none: 0 },
    engine: 'llm',
  }
}

const layer = createCommandLayer({ now: () => new Date('2026-02-03T04:05:06.000Z') })
const prepared = await layer.prepare({
  commands,
  targets: ['acp', 'acp-cache', 'agent-teams', 'goal'],
  hostVersion: '0.2.1-rc.2',
  translate,
})
check('prepare 捕获三条命令、排除内置 goal、模板外无告警', () => {
  assert.deepEqual(prepared.captures.map((item) => item.name).sort(), ['acp', 'acp-cache', 'agent-teams'])
  assert.deepEqual(prepared.skipped.map((item) => item.name), ['goal'])
  assert.equal(prepared.translations.acp.zh, ZH.acp)
})

const firstEnsure = layer.ensure(agentA)
check('agent A 注册三条影子，agent B 与 global 不受影响', () => {
  assert.equal(firstEnsure.ok, true)
  assert.equal(firstEnsure.registered, 3)
  const a = descriptions(agentA)
  assert.equal(a.acp, ZH.acp)
  assert.equal(a['acp-cache'], ZH['acp-cache'])
  assert.equal(a['agent-teams'], ZH['agent-teams'])
  assert.equal(a.goal, 'Run a long-running goal')
  const b = descriptions(agentB)
  for (const [name, en] of Object.entries(EN)) assert.equal(b[name], en)
  const globalMap = descriptions(undefined)
  for (const [name, en] of Object.entries(EN)) assert.equal(globalMap[name], en)
})

check('影子保留 definitionId/input.hint，descriptor 不含 handler', () => {
  const acp = commands.list(agentA).find((item) => item.name === 'acp')
  assert.equal(acp.definitionId, '@deepseek-ai/dsh-command-acp')
  assert.equal(acp.input.hint, '输入 /acp 查看压缩状态')
  assert.equal(acp.input.attachments, true)
  assert.equal('handler' in acp, false)
  const teams = commands.list(agentA).find((item) => item.name === 'agent-teams')
  assert.equal(teams.input.hint, '输入团队目标')
  assert.equal('definitionId' in teams, false)
})

const acpResult = await commands.execute(agentA, '/acp', [], new AbortController().signal)
check('execute /acp 透传原 handler，且只执行一次', () => {
  assert.equal(calls.acp, 1)
  assert.equal(acpResult.result.kind, 'success')
  assert.equal(acpResult.result.text, 'acp-ok:')
  const lifecycleTypes = lifecycle.filter((item) => item.agent === 'agent-A').map((item) => item.type)
  assert.deepEqual(lifecycleTypes.slice(-2), ['command/run', 'command/done'])
})

const teamsResult = await commands.execute(agentA, '/agent-teams --profile dev go', [], new AbortController().signal)
check('execute /agent-teams 原 handler 收到 rawInput', () => {
  assert.equal(calls['agent-teams'], 1)
  // 宿主解析器保留命令名后的前导空格；关键是参数原文完整透传。
  assert.deepEqual(rawInputs.map((text) => text.trim()), ['--profile dev go'])
  assert.equal(teamsResult.result.kind, 'success')
})

check('restore 后 agent 视角回英文，global 仍英文', () => {
  layer.restore()
  const a = descriptions(agentA)
  for (const [name, en] of Object.entries(EN)) assert.equal(a[name], en)
  const globalMap = descriptions(undefined)
  for (const [name, en] of Object.entries(EN)) assert.equal(globalMap[name], en)
})

check('apply 后重新变中文，无需重新翻译', () => {
  const applied = layer.apply()
  assert.equal(applied.registered, 3)
  const a = descriptions(agentA)
  for (const [name, zh] of Object.entries(ZH)) assert.equal(a[name], zh)
})

check('dispose 后回英文，commands/change 有事件', () => {
  layer.dispose()
  const a = descriptions(agentA)
  for (const [name, en] of Object.entries(EN)) assert.equal(a[name], en)
  assert.ok(changeEvents > 0, `commands/change 事件数 ${changeEvents}`)
})

check('agent 视角与 global 视角并存，互不污染', () => {
  assert.equal(commands.list(undefined).length, 4)
  assert.equal(commands.list(agentA).length, 4)
  assert.equal(commands.list(agentB).length, 4)
})

for (const dispose of disposers) dispose()

console.log(`\n命令描述中文化端到端：${checks.length}/${checks.length} 项通过`)
process.exit(0)
