#!/usr/bin/env node
/**
 * agent 层覆盖机制的端到端验证（不启动 DSH、不改磁盘、不联网）。
 *
 * 为什么必须是 Electron-as-node：本脚本直接 import 宿主 app.asar 内的
 * `@deepseek-ai/cordis`、`@deepseek-ai/dsh-scope`、`@deepseek-ai/dsh-skill`
 * 三个真实模块，普通 node 读不了 asar。运行方式：
 *
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
 *     scripts/agent-layer-e2e.mjs
 *
 * 验证内容：
 *  1. browser-skill 在 global 层 + agent scope 各注册一次 runtime 技能后，
 *     agent 视角基线显示英文（最近层 runtime 250 获胜）；
 *  2. 本插件的 agent 层 provider（rank 50）注册后，同一视角变成中文，
 *     provider 显示为 skill-desc-zh-agent，content 原样透传；
 *  3. global 视角不受影响；
 *  4. control.invalidate() 后立即读到新译文；
 *  5. dispose 后回落到英文。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EN = "Automate the user's logged-in Chromium through this plugin's injected bsk_* tools. Use to read pages, fill forms, operate tabs, inspect page activity, debug a website, or test a UI."
const ZH = '通过本插件注入的 bsk_* 工具操作用户已登录的 Chromium：读取页面、填写表单、操作标签页、检查页面活动、调试网站或测试 UI。'
const BODY = '# browser-skill\n\n原始正文 content v1'
const DEFINITION = {
  name: 'browser-skill',
  description: EN,
  content: BODY,
  source: 'bundled',
  resourceBase: { kind: 'directory', path: '/tmp/bsk/skill' },
}

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const appAsarDsh = process.env.DSH_ASAR_DSH
  ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
const depsBase = path.join(appAsarDsh, 'node_modules', '@deepseek-ai')

const checks = []
function check(name, fn) {
  fn()
  checks.push(name)
  console.log(`✔ ${name}`)
}

const cordis = await import(path.join(depsBase, 'cordis', 'lib', 'index.js'))
const scopeMod = await import(path.join(depsBase, 'dsh-scope', 'lib', 'index.js'))
const skillMod = await import(path.join(depsBase, 'dsh-skill', 'lib', 'index.js'))
const plugin = await import(path.join(repoRoot, 'lib', 'agent-layer.js'))

// 真实宿主装配：Context + skills 服务 + 一个 agent 的 scoped ctx。
const ctx = new cordis.Context()
ctx.plugin(skillMod.SkillRegistry)
await new Promise((resolve) => setTimeout(resolve, 30))
const skills = ctx.get('skills')
assert.ok(skills && typeof skills.list === 'function', 'skills 服务应可用')

// browser-skill 的两处 runtime 注册（global 插件 ctx + agent/created 的 agent.ctx）。
skills.register(DEFINITION)
const agentKey = { id: 'agent-e2e' }
const agentScope = scopeMod.createScope(ctx, agentKey)
agentScope.ctx.get('skills').register(DEFINITION)

const findBrowserSkill = async (scope, label) => {
  const list = await skills.list(scope === undefined ? {} : { scope })
  const hit = list.find((item) => item.name === 'browser-skill')
  assert.ok(hit, `${label} 应能看到 browser-skill`)
  return hit
}

const captured = new Map([
  ['browser-skill', { name: 'browser-skill', isRuntime: true, sourceHash: 'sha-e2e', definition: DEFINITION }],
])
const translations = new Map([['browser-skill', { zh: ZH, engine: 'dictionary' }]])
const provider = plugin.createAgentProvider({
  captured,
  isEnabled: () => true,
  isReady: () => true,
  isCapturing: () => false,
  translationFor: (record) => translations.get(record?.name),
})

await (async () => {
  const baseline = await findBrowserSkill(agentKey, '基线 agent 视角')
  check('基线：agent 视角显示英文（最近层 runtime 250 获胜）', () => {
    assert.equal(baseline.provider, 'runtime')
    assert.equal(baseline.description, EN)
  })
})()

const controls = []
const registration = plugin.registerAgentLayerProvider({
  agent: { ctx: agentScope.ctx },
  provider,
  onControl: (control) => controls.push(control),
})
await (async () => {
  check('agent 层 provider 注册成功', () => {
    assert.equal(registration.ok, true)
    assert.equal(registration.providerName, plugin.AGENT_PROVIDER_NAME)
    assert.equal(controls.length, 1)
  })

  const hit = await findBrowserSkill(agentKey, '注册后 agent 视角')
  check('注册后 agent 视角显示中文，provider 为 skill-desc-zh-agent', () => {
    assert.equal(hit.provider, plugin.AGENT_PROVIDER_NAME)
    assert.equal(hit.description, ZH)
  })

  const loaded = await skills.get('browser-skill', { scope: agentKey })
  check('skills.get(agent scope)：中文描述 + content 原样透传', () => {
    assert.equal(loaded?.description, ZH)
    assert.equal(loaded?.content, BODY)
    assert.equal(loaded?.name, 'browser-skill')
  })

  const globalHit = await findBrowserSkill(undefined, 'global 视角')
  check('global 视角不受 agent 层注册影响（仍英文）', () => {
    assert.equal(globalHit.provider, 'runtime')
    assert.equal(globalHit.description, EN)
  })

  translations.set('browser-skill', { zh: '中文译文 v2', engine: 'llm' })
  controls[0].invalidate()
  const afterInvalidate = await findBrowserSkill(agentKey, 'invalidate 后')
  check('control.invalidate() 后立即读到新译文', () => {
    assert.equal(afterInvalidate.provider, plugin.AGENT_PROVIDER_NAME)
    assert.equal(afterInvalidate.description, '中文译文 v2')
  })

  registration.dispose()
  const afterDispose = await findBrowserSkill(agentKey, 'dispose 后')
  check('dispose 后回落英文', () => {
    assert.equal(afterDispose.provider, 'runtime')
    assert.equal(afterDispose.description, EN)
  })
})()

console.log(`\nagent 层覆盖端到端：${checks.length}/${checks.length} 项通过`)
process.exit(0)
