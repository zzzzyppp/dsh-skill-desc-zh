#!/usr/bin/env node
/**
 * v0.5.0 s1 spike A：禁用影子语义验证（真实宿主模块，不启动 DSH、不写磁盘、不联网）。
 *
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
 *     scripts/spike-disable-shadow.mjs
 *
 * 复刻的宿主装配：
 *  - global 层：Context + SkillRegistry；
 *  - agent scope 层：模拟 preset 自带的 `skill-filesystem` provider（provider 名
 *    "filesystem"，候选 rank 400 = USER_DSH_RANK，source "user-dsh"），与真实宿主
 *    一样注册在 agent scope 里（preset 的 skill-filesystem 是 preset-scoped）；
 *  - 本插件的禁用影子：同层注册 provider "skill-desc-zh-agent"，候选 rank 40，
 *    invocation {modelInvocable:false,userInvocable:false}。
 *
 * 断言目标是宿主语义（不是我们的实现）：
 *  1. 同层 rank 小者胜 → agent 视角读到 rank 40 的候选；
 *  2. 复刻 dsh-tool-skill 的 `snapshot().skills.filter(isModelInvocable)` → 被排除；
 *  3. skills.get 返回我们的定义（content 透传）；
 *  4. 模型/用户两条调用校验都按 invocation 拒绝；
 *  5. dispose / list 空 + invalidate 后回落文件定义；
 *  6. 反证：global 层即使 rank 1 也压不过 agent 层的文件 provider（近层整体获胜）。
 */

import assert from 'node:assert/strict'
import path from 'node:path'

const ASAR_DSH = process.env.DSH_ASAR_DSH
  ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
const DEPS = path.join(ASAR_DSH, 'node_modules', '@deepseek-ai')

const checks = []
async function check(name, fn) {
  await fn()
  checks.push(name)
  console.log(`✔ ${name}`)
}
function info(message) {
  console.log(`· ${message}`)
}

const cordis = await import(path.join(DEPS, 'cordis', 'lib', 'index.js'))
const scopeMod = await import(path.join(DEPS, 'dsh-scope', 'lib', 'index.js'))
const skillMod = await import(path.join(DEPS, 'dsh-skill', 'lib', 'index.js'))

const EN = 'Generate release notes from the git log and changelog rules.'
const DISABLED_PREFIX = '（已禁用）'
const BODY = '# demo-skill\n\n## 步骤\n\n1. 读取 git log\n2. 汇总\n'
const BODY_KEEP = '# keep-skill\n\n不应受影响。\n'

const ctx = new cordis.Context()
ctx.plugin(skillMod.SkillRegistry)
await new Promise((resolve) => setTimeout(resolve, 30))
const skills = ctx.get('skills')
assert.ok(skills && typeof skills.snapshot === 'function', 'skills 服务应可用')

const agentKey = { id: 'agent-spike-a' }
const agentScope = scopeMod.createScope(ctx, agentKey)
const agentSkills = agentScope.ctx.get('skills')
assert.ok(agentSkills && typeof agentSkills.registerProvider === 'function', 'agent scope 上应有 skills 服务')

// ── 模拟 preset 的 skill-filesystem（agent scope，rank 400）────────────────
const fileCandidate = (name) => ({
  name,
  description: name === 'demo-skill' ? EN : 'Keep this skill visible.',
  source: 'user-dsh',
  provider: 'filesystem',
  rank: 400,
  invocation: { modelInvocable: true, userInvocable: true },
  resourceBase: { kind: 'directory', path: `/tmp/spike-skills/${name}` },
  locator: { kind: 'file', path: `/tmp/spike-skills/${name}/SKILL.md`, directory: `/tmp/spike-skills/${name}` },
})
const fileListCalls = { count: 0 }
const filesystemProvider = {
  name: 'filesystem',
  list() {
    fileListCalls.count += 1
    return { candidates: [fileCandidate('demo-skill'), fileCandidate('keep-skill')], complete: true }
  },
  async get(candidate) {
    return {
      name: candidate.name,
      description: candidate.description,
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'user-dsh',
      provider: 'filesystem',
      content: candidate.name === 'demo-skill' ? BODY : BODY_KEEP,
      resourceBase: { kind: 'directory', path: `/tmp/spike-skills/${candidate.name}` },
      path: `/tmp/spike-skills/${candidate.name}/SKILL.md`,
    }
  },
}
let fileControl
const disposeFilesystem = agentSkills.registerProvider((control) => {
  fileControl = control
  return filesystemProvider
})
assert.ok(fileControl && typeof fileControl.invalidate === 'function', 'provider control 应可用')

async function view(scope) {
  const snapshot = await skills.snapshot(scope === undefined ? {} : { scope })
  const byName = new Map(snapshot.skills.map((item) => [item.name, item]))
  return { snapshot, byName }
}
const modelVisible = (snapshot) => snapshot.skills.filter(skillMod.isModelInvocable)

const baseline = await view(agentKey)
await check('A1 基线：agent 视角看到 filesystem 的 demo-skill（rank 400，可调用）', () => {
  const hit = baseline.byName.get('demo-skill')
  assert.ok(hit, '应能看到 demo-skill')
  assert.equal(hit.provider, 'filesystem')
  assert.equal(hit.description, EN)
  assert.equal(hit.invocation.modelInvocable, true)
  assert.equal(modelVisible(baseline.snapshot).length, 2)
})

// ── 禁用影子：同层 rank 40，invocation 全 false ─────────────────────────────
const disabledCandidate = (name) => {
  const original = fileCandidate(name)
  return {
    name,
    description: `${DISABLED_PREFIX}${original.description}`,
    source: original.source,
    provider: 'skill-desc-zh-agent',
    rank: 40,
    invocation: { modelInvocable: false, userInvocable: false },
    resourceBase: original.resourceBase,
  }
}
let disabledControl
let disabledEnabled = true
const disabledProvider = {
  name: 'skill-desc-zh-agent',
  list() {
    if (!disabledEnabled) return { candidates: [], complete: true }
    return { candidates: [disabledCandidate('demo-skill')], complete: true }
  },
  async get(candidate) {
    if (!disabledEnabled || candidate?.name !== 'demo-skill') return undefined
    const original = fileCandidate(candidate.name)
    return {
      name: candidate.name,
      description: `${DISABLED_PREFIX}${original.description}`,
      invocation: { modelInvocable: false, userInvocable: false },
      source: original.source,
      provider: 'skill-desc-zh-agent',
      content: BODY,
      resourceBase: original.resourceBase,
      path: original.locator.path,
    }
  },
}
const disposeDisabled = agentSkills.registerProvider((control) => {
  disabledControl = control
  return disabledProvider
})

const shadowed = await view(agentKey)
await check('A2 同层 rank 40 获胜：agent 视角 description 变「（已禁用）」前缀', () => {
  const hit = shadowed.byName.get('demo-skill')
  assert.equal(hit.provider, 'skill-desc-zh-agent')
  assert.equal(hit.description, `${DISABLED_PREFIX}${EN}`)
  assert.deepEqual(hit.invocation, { modelInvocable: false, userInvocable: false })
})
await check('A3 复刻 tool-skill：filter(isModelInvocable) 后只剩 keep-skill', () => {
  assert.deepEqual(modelVisible(shadowed.snapshot).map((item) => item.name), ['keep-skill'])
  assert.equal(shadowed.snapshot.skills.length, 2)
})
await check('A4 skills.get 返回禁用影子定义，content 原样透传', async () => {
  const loaded = await skills.get('demo-skill', { scope: agentKey })
  assert.equal(loaded.provider, 'skill-desc-zh-agent')
  assert.equal(loaded.invocation.modelInvocable, false)
  assert.equal(loaded.content, BODY)
  assert.equal(loaded.description, `${DISABLED_PREFIX}${EN}`)
})
await check('A5 模型调用校验：skill 工具那行 isModelInvocable 会拒绝', () => {
  const summary = shadowed.byName.get('demo-skill')
  assert.equal(skillMod.isModelInvocable(summary), false)
  assert.throws(() => {
    if (!skillMod.isModelInvocable(summary)) {
      throw new Error('skill "demo-skill" is not available for model invocation')
    }
  }, /is not available for model invocation/u)
})
await check('A6 用户显式调用校验：isUserInvocable=false 时 injection 被跳过', async () => {
  const loaded = await skills.get('demo-skill', { scope: agentKey })
  assert.equal(skillMod.isUserInvocable(loaded), false)
})
await check('A7 global 视角不受影响（禁用影子只在 agent 层）', async () => {
  const global = await skills.snapshot({})
  assert.equal(global.skills.length, 0)
  assert.equal(global.complete, true)
})

// ── invalidate / 释放 ──────────────────────────────────────────────────────
disabledEnabled = false
disabledControl.invalidate()
const restored = await view(agentKey)
await check('A8 禁用影子 list() 空 + invalidate 后回落 filesystem（英文、可调用）', () => {
  const hit = restored.byName.get('demo-skill')
  assert.equal(hit.provider, 'filesystem')
  assert.equal(hit.description, EN)
  assert.equal(modelVisible(restored.snapshot).length, 2)
})

disabledEnabled = true
disabledControl.invalidate()
await view(agentKey)
disposeDisabled()
const afterDispose = await view(agentKey)
await check('A9 dispose provider 后同样回落 filesystem', () => {
  const hit = afterDispose.byName.get('demo-skill')
  assert.equal(hit.provider, 'filesystem')
  assert.equal(hit.description, EN)
})

// ── 反证：近层整体获胜（global 层 rank 1 也压不过 agent 层 rank 400）────────
let globalControl
const globalProvider = {
  name: 'skill-desc-zh-global-probe',
  list() {
    return {
      candidates: [{
        name: 'demo-skill',
        description: 'GLOBAL-LAYER-PROBE',
        source: 'user-dsh',
        provider: 'skill-desc-zh-global-probe',
        rank: 1,
        invocation: { modelInvocable: true, userInvocable: true },
      }],
      complete: true,
    }
  },
  async get() {
    return undefined
  },
}
const disposeGlobal = skills.registerProvider((control) => {
  globalControl = control
  return globalProvider
})
const afterGlobal = await view(agentKey)
await check('A10 反证：global 层 rank 1 的候选在 agent 视角不出现（近层整体获胜）', () => {
  const hit = afterGlobal.byName.get('demo-skill')
  assert.equal(hit.provider, 'filesystem')
  assert.ok(globalControl)
})
const globalOnly = await skills.snapshot({})
await check('A11 global 视角能看到 global 层探针（证明它确实注册成功）', () => {
  const hit = globalOnly.skills.find((item) => item.name === 'demo-skill')
  assert.equal(hit.provider, 'skill-desc-zh-global-probe')
})
disposeGlobal()

fileControl.invalidate()
info(`filesystem provider.list 调用次数：${fileListCalls.count}（缓存按 revision 生效）`)
console.log(`\nspike A（禁用影子）：${checks.length}/${checks.length} 项通过`)
process.exit(0)
