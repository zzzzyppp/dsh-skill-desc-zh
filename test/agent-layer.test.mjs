import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AGENT_DISABLED_PROVIDER_NAME,
  AGENT_DISABLED_RANK,
  AGENT_PROVIDER_NAME,
  AGENT_PROVIDER_RANK,
  RUNTIME_SKILL_RANK,
  DISABLED_PREFIX,
  createAgentProvider,
  createDisabledProvider,
  hasDisabledEntries,
  isRuntimeRecord,
  registerAgentLayerProvider,
  registerDisabledProvider,
} from '../lib/agent-layer.js'

const EN = "Automate the user's logged-in Chromium through this plugin's injected bsk_* tools. Use to read pages, fill forms, operate tabs, inspect page activity, debug a website, or test a UI."
const ZH = '通过本插件注入的 bsk_* 工具操作用户已登录的 Chromium：读取页面、填写表单、操作标签页、检查页面活动、调试网站或测试 UI。'

function runtimeRecord(overrides = {}) {
  return {
    name: 'browser-skill',
    isRuntime: true,
    definition: {
      name: 'browser-skill',
      description: EN,
      content: '# browser-skill\n\n正文',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
    },
    ...overrides,
  }
}

function officeRecord() {
  return {
    name: 'office',
    isRuntime: false,
    definition: {
      name: 'office',
      description: 'Create, edit, inspect, or convert Office documents.',
      content: '正文',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
    },
  }
}

function readyProvider(captured, translations = new Map()) {
  return createAgentProvider({
    captured,
    isEnabled: () => true,
    isReady: () => true,
    isCapturing: () => false,
    translationFor: (record) => translations.get(record?.name),
  })
}

function mockAgent(skills) {
  return { ctx: { get: (name) => (name === 'skills' ? skills : undefined) } }
}

test('agent-layer：rank 常量满足“同层更小 rank 压过 runtime 250”', () => {
  assert.equal(AGENT_PROVIDER_NAME, 'skill-desc-zh-agent')
  assert.equal(AGENT_PROVIDER_RANK, 50)
  assert.equal(RUNTIME_SKILL_RANK, 250)
  assert.ok(AGENT_PROVIDER_RANK < RUNTIME_SKILL_RANK)
})

test('agent-layer：isRuntimeRecord 只认 isRuntime === true', () => {
  assert.equal(isRuntimeRecord(runtimeRecord()), true)
  assert.equal(isRuntimeRecord(officeRecord()), false)
  assert.equal(isRuntimeRecord(undefined), false)
  assert.equal(isRuntimeRecord({ isRuntime: 'yes' }), false)
})

test('agent-layer：provider 只列 runtime 记录，中文描述 + content 原样透传', async () => {
  const captured = new Map()
  captured.set('browser-skill', runtimeRecord())
  captured.set('office', officeRecord())
  const translations = new Map([['browser-skill', { zh: ZH, engine: 'dictionary' }]])
  const provider = readyProvider(captured, translations)

  assert.equal(provider.name, AGENT_PROVIDER_NAME)
  const listed = provider.list()
  assert.equal(listed.complete, true)
  assert.deepEqual(listed.candidates.map((item) => item.name), ['browser-skill'])
  const candidate = listed.candidates[0]
  assert.equal(candidate.provider, AGENT_PROVIDER_NAME)
  assert.equal(candidate.rank, AGENT_PROVIDER_RANK)
  assert.equal(candidate.source, 'bundled')
  assert.equal(candidate.description, ZH)

  const definition = await provider.get({ name: 'browser-skill' })
  assert.equal(definition.description, ZH)
  assert.equal(definition.content, '# browser-skill\n\n正文')
  assert.equal(definition.provider, AGENT_PROVIDER_NAME)
  assert.equal(await provider.get({ name: 'office' }), undefined)
})

test('agent-layer：未启用 / 未就绪 / 捕获中时不暴露候选（防自噬）', () => {
  const captured = new Map([['browser-skill', runtimeRecord()]])
  const variants = [
    { isEnabled: () => false, isReady: () => true, isCapturing: () => false },
    { isEnabled: () => true, isReady: () => false, isCapturing: () => false },
    { isEnabled: () => true, isReady: () => true, isCapturing: () => true },
  ]
  for (const overrides of variants) {
    const provider = createAgentProvider({ captured, translationFor: () => ({ zh: ZH }), ...overrides })
    assert.deepEqual(provider.list(), { candidates: [], complete: false })
  }
})

test('agent-layer：registerAgentLayerProvider 经 agent.ctx 注册并回传 control/dispose', () => {
  const controls = []
  const disposed = []
  const mockSkills = {
    registerProvider(create) {
      const control = { signal: { aborted: false }, invalidate: () => {} }
      const provider = create(control)
      assert.equal(provider.name, AGENT_PROVIDER_NAME)
      controls.push(control)
      return () => disposed.push(true)
    },
  }
  const agent = mockAgent(mockSkills)
  const provider = readyProvider(new Map([['browser-skill', runtimeRecord()]]))
  const seen = []
  const result = registerAgentLayerProvider({ agent, provider, onControl: (control) => seen.push(control) })

  assert.equal(result.ok, true)
  assert.equal(result.providerName, AGENT_PROVIDER_NAME)
  assert.equal(seen.length, 1)
  assert.equal(controls.length, 1)
  result.dispose()
  assert.equal(disposed.length, 1)
  assert.doesNotThrow(() => result.dispose())
})

test('agent-layer：没有 scoped agent / skills 服务时安全跳过', () => {
  const provider = readyProvider(new Map())
  const cases = [
    undefined,
    {},
    { ctx: {} },
    { ctx: { get: () => undefined } },
    { ctx: { get: () => ({}) } },
  ]
  for (const agent of cases) {
    const result = registerAgentLayerProvider({ agent, provider })
    assert.equal(result.ok, false)
    assert.equal(result.skipped, true)
  }
})

test('agent-layer：读取 agent.ctx 抛错时返回 skipped 与原因', () => {
  const provider = readyProvider(new Map())
  const result = registerAgentLayerProvider({
    agent: {
      ctx: {
        get: () => {
          throw new Error('boom')
        },
      },
    },
    provider,
  })
  assert.equal(result.ok, false)
  assert.equal(result.skipped, true)
  assert.match(result.reason, /boom/u)
})

test('agent-layer：registerProvider 抛错时返回失败原因，不向上抛', () => {
  const mockSkills = {
    registerProvider() {
      throw new Error('cannot create effect on inactive context')
    },
  }
  const provider = readyProvider(new Map())
  const result = registerAgentLayerProvider({ agent: mockAgent(mockSkills), provider })
  assert.equal(result.ok, false)
  assert.match(result.reason, /inactive context/u)
})

test('agent-layer：provider 缺少 list/get 时不注册', () => {
  const mockSkills = {
    registerProvider() {
      throw new Error('不应被调用')
    },
  }
  const result = registerAgentLayerProvider({ agent: mockAgent(mockSkills), provider: { name: 'x' } })
  assert.equal(result.ok, false)
  assert.equal(result.skipped, true)
})

function disabledState(entries) {
  return { skillAdmin: { disabled: entries } }
}

function disabledTargets(map) {
  return (entry) => map[`${entry.scope}:${entry.name}`]
}

test('禁用影子：user 条目生成禁用候选，description 加前缀且不可调用', () => {
  const state = disabledState([{ scope: 'user', name: 'demo', disabledAt: '2026-01-02T03:04:05.000Z' }])
  const provider = createDisabledProvider({
    state,
    readTarget: disabledTargets({
      'user:demo': {
        description: 'Demo skill.',
        content: '# Demo\n\n正文',
        dir: '/home/u/.dsh/skills/demo',
        whenToUse: '当需要演示时。',
        invocation: { modelInvocable: true, userInvocable: true },
      },
    }),
  })
  assert.equal(provider.name, AGENT_DISABLED_PROVIDER_NAME)
  const list = provider.list({ cwd: '/work/proj' })
  assert.equal(list.candidates.length, 1)
  assert.equal(list.candidates[0].description, `${DISABLED_PREFIX}Demo skill.`)
  assert.deepEqual(list.candidates[0].invocation, { modelInvocable: false, userInvocable: false })
  assert.equal(list.candidates[0].rank, AGENT_DISABLED_RANK)
  assert.equal(list.candidates[0].source, 'user-dsh')
  const definition = provider.get(list.candidates[0])
  assert.equal(definition.content, '# Demo\n\n正文')
  // F4：definition 必须与 candidate 一致，不能泄漏原始 description/invocation。
  assert.equal(definition.description, list.candidates[0].description)
  assert.deepEqual(definition.invocation, list.candidates[0].invocation)
  assert.equal(definition.whenToUse, '当需要演示时。')
  assert.deepEqual(definition.resourceBase, { kind: 'directory', path: '/home/u/.dsh/skills/demo' })
})

test('禁用影子：项目条目只在 cwd 位于该项目内时出现', () => {
  const state = disabledState([{ scope: 'project', name: 'proj-skill', projectRoot: '/work/proj' }])
  const provider = createDisabledProvider({
    state,
    readTarget: disabledTargets({ 'project:proj-skill': { description: 'Project.', content: '正文' } }),
  })
  assert.equal(provider.list({ cwd: '/work/proj/sub' }).candidates.length, 1)
  assert.equal(provider.list({ cwd: '/work/other' }).candidates.length, 0)
  assert.equal(provider.list({ cwd: '/work/proj2' }).candidates.length, 0)
})

test('禁用影子：空列表/禁用开关/读取失败都不产生候选', () => {
  assert.deepEqual(createDisabledProvider({ state: disabledState([]), readTarget: () => ({}) }).list({ cwd: '/w' }).candidates, [])
  const state = disabledState([{ scope: 'user', name: 'missing' }])
  assert.equal(createDisabledProvider({ state, readTarget: () => undefined }).list({ cwd: '/w' }).candidates.length, 0)
  assert.equal(createDisabledProvider({ state, isEnabled: () => false, readTarget: () => ({ content: 'x' }) }).list({ cwd: '/w' }).candidates.length, 0)
  assert.equal(hasDisabledEntries(state), true)
  assert.equal(hasDisabledEntries({}), false)
})

test('禁用影子：同名 user/project 条目分别按 cwd 列出，get 按 metadata 读对应定义', () => {
  const state = disabledState([
    { scope: 'user', name: 'same', description: 'U' },
    { scope: 'project', name: 'same', projectRoot: '/work/proj' },
  ])
  const provider = createDisabledProvider({
    state,
    readTarget: (entry) => (entry.scope === 'user' ? { description: '用户版', content: 'user' } : { description: '项目版', content: 'project' }),
  })
  const projectList = provider.list({ cwd: '/work/proj' })
  assert.equal(projectList.candidates.length, 2)
  const projectCandidate = projectList.candidates.find((item) => item.source === 'project-dsh')
  assert.equal(provider.get(projectCandidate).content, 'project')
  const userCandidate = projectList.candidates.find((item) => item.source === 'user-dsh')
  assert.equal(provider.get(userCandidate).content, 'user')
  // F6：projectRoot 必须参与匹配；错误的 projectRoot 不得 fallback 到用户条目。
  assert.equal(provider.get({ name: 'same', metadata: { projectRoot: '/work/other' } }), undefined)
  assert.equal(provider.get({ name: 'same', metadata: { projectRoot: '/work/other', scope: 'project' } }), undefined)
  assert.equal(provider.get({ name: 'same', metadata: { projectRoot: '/work/proj', scope: 'project' } }).content, 'project')
  assert.equal(provider.get({ name: 'same', metadata: { scope: 'user' } }).content, 'user')
})

test('禁用影子：registerDisabledProvider 通过 agent.ctx 注册并可 dispose', () => {
  const registered = []
  let disposed = 0
  const agent = { ctx: { get: (name) => (name === 'skills' ? { registerProvider: (create) => { registered.push(create({ invalidate() {} })); return () => { disposed += 1 } } } : undefined) } }
  const provider = createDisabledProvider({ state: disabledState([]), readTarget: () => ({}) })
  const result = registerDisabledProvider({ agent, provider })
  assert.equal(result.ok, true)
  assert.equal(result.providerName, AGENT_DISABLED_PROVIDER_NAME)
  assert.equal(registered[0].name, AGENT_DISABLED_PROVIDER_NAME)
  result.dispose()
  assert.equal(disposed, 1)
  assert.equal(registerDisabledProvider({ agent: {}, provider }).ok, false)
})
