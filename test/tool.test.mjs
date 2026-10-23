import test from 'node:test'
import assert from 'node:assert/strict'

import { TOOL_ACTIONS, TOOL_NAME, createTool } from '../lib/tool.js'

function harness(overrides = {}) {
  const calls = []
  const controller = {
    async status(args, exec) { calls.push({ action: 'status', args, exec }); return { ok: true, action: 'status', summary: '状态正常', details: ['office 中文'] } },
    async apply(args) { calls.push({ action: 'apply', args }); return { ok: true, action: 'apply', summary: '已应用', counts: { zh: 2 } } },
    async restore(args) { calls.push({ action: 'restore', args }); return { ok: true, action: 'restore', summary: '已还原', warnings: ['无'] } },
    async retranslate(args) { calls.push({ action: 'retranslate', args }); return { ok: true, action: 'retranslate', summary: '已重译' } },
    async refresh(args) { calls.push({ action: 'refresh', args }); return { ok: true, action: 'refresh', summary: '已检查指纹' } },
    async doctor(args) { calls.push({ action: 'doctor', args }); return { ok: true, action: 'doctor', summary: '自检通过' } },
    ...overrides,
  }
  return { controller, calls, tool: createTool({ controller, logger: { warn() {} } }) }
}

test('工具元数据符合宿主 dsh-tools 契约', () => {
  const { tool } = harness()
  assert.equal(tool.name, TOOL_NAME)
  assert.equal(tool.name, 'skill_desc_zh')
  assert.deepEqual(tool.parameters.required, ['action'])
  assert.deepEqual(tool.parameters.properties.action.enum, TOOL_ACTIONS)
  assert.equal(tool.parameters.additionalProperties, false)
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(tool.timeoutMs, 180_000)
  assert.equal(tool.isConcurrencySafe({ action: 'status' }), true)
  assert.equal(tool.isConcurrencySafe({ action: 'doctor' }), true)
  assert.equal(tool.isConcurrencySafe({ action: 'restore' }), false)
  const present = tool.presentCall({ action: 'apply' })
  assert.deepEqual(present, {
    card: 'generic',
    title: '技能描述中文化',
    kind: 'skill-desc-zh',
    rawInput: { action: 'apply' },
  })
})

test('execute：action 透传 controller，refresh 走独立检查语义', async () => {
  const { tool, calls } = harness()
  const exec = { agent: { session: 's1' } }
  const status = await tool.execute({ action: 'status' }, exec)
  assert.equal(status.ok, true)
  assert.equal(status.action, 'status')
  assert.equal(calls[0].exec, exec)

  const refresh = await tool.execute({ action: 'refresh', force: true }, exec)
  assert.equal(refresh.ok, true)
  assert.equal(refresh.action, 'refresh')
  assert.equal(calls.at(-1).action, 'refresh')
  assert.deepEqual(calls.at(-1).args, { action: 'refresh', force: true })

  const restore = await tool.execute({ action: 'restore', dryRun: true }, exec)
  assert.equal(restore.ok, true)
  assert.equal(calls.at(-1).action, 'restore')
})

test('execute：未知 action 直接失败且不调用 controller', async () => {
  const { tool, calls } = harness()
  const result = await tool.execute({ action: 'explode' })
  assert.equal(result.ok, false)
  assert.match(result.summary, /未知 action/)
  assert.equal(calls.length, 0)
})

test('execute：异常归一为 ok:false，取消标记 aborted', async () => {
  const { tool } = harness({
    async apply() { throw new Error('磁盘只读') },
  })
  const failed = await tool.execute({ action: 'apply' })
  assert.equal(failed.ok, false)
  assert.equal(failed.action, 'apply')
  assert.match(failed.summary, /磁盘只读/)

  const controller = new AbortController()
  controller.abort()
  const { tool: cancelled } = harness({
    async doctor() { throw new Error('interrupted') },
  })
  const result = await cancelled.execute({ action: 'doctor' }, { signal: controller.signal })
  assert.deepEqual(result, { ok: false, action: 'doctor', summary: 'doctor 已取消', aborted: true })
})

test('execute：非对象返回与缺少 controller 方法都被兜底', async () => {
  const { tool } = harness({
    async status() { return 'not-an-object' },
  })
  const malformed = await tool.execute({ action: 'status' })
  assert.equal(malformed.ok, false)
  assert.match(malformed.summary, /非对象结果/)

  const noop = createTool({ controller: {}, logger: {} })
  const missing = await noop.execute({ action: 'apply' })
  assert.equal(missing.ok, false)
  assert.match(missing.summary, /controller\.apply 不可用/)
})

test('render：summary + details + warnings，缺失字段安全', () => {
  const { tool } = harness()
  const text = tool.output.render({}, {
    ok: true,
    action: 'status',
    summary: '状态正常',
    details: ['office：中文'],
    warnings: ['browser-skill 不可覆盖'],
  })[0].text
  assert.match(text, /^状态正常\n\noffice：中文\n\n警告：\n- browser-skill 不可覆盖$/)

  const plain = tool.output.render({}, { ok: false, action: 'apply', summary: '失败了' })[0].text
  assert.equal(plain, '失败了')
  const noSummary = tool.output.render({}, { ok: true, counts: { zh: 2 } })[0].text
  assert.match(noSummary, /"counts": \{/)
})


test('execute：plugins 动作透传 controller，且并发安全', async () => {
  const seen = []
  const { tool } = harness({
    async plugins(args) {
      seen.push(args)
      return { ok: true, action: 'plugins', summary: '已检查 4 个插件，1 个可更新', plugins: [{ name: 'dshmarket' }] }
    },
  })
  assert.equal(tool.parameters.properties.action.enum.includes('plugins'), true)
  assert.equal(tool.isConcurrencySafe({ action: 'plugins' }), true)
  const result = await tool.execute({ action: 'plugins' }, { agent: { session: 's1' } })
  assert.equal(result.ok, true)
  assert.equal(result.action, 'plugins')
  assert.equal(result.summary, '已检查 4 个插件，1 个可更新')
  assert.deepEqual(seen, [{ action: 'plugins' }])
})

test('execute：plugins 透传 controller 且并发安全', async () => {
  const { tool, calls } = harness({
    async plugins(args) {
      calls.push({ action: 'plugins', args })
      return { ok: true, action: 'plugins', summary: '已检查 3 个插件', plugins: [], warnings: [] }
    },
  })
  const result = await tool.execute({ action: 'plugins' })
  assert.equal(result.ok, true)
  assert.equal(result.action, 'plugins')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'plugins')
  assert.equal(tool.isConcurrencySafe({ action: 'plugins' }), true)
})

test('execute：skills 动作透传并补列表摘要', async () => {
  const { tool, calls } = harness({
    async skills(args) {
      calls.push({ action: 'skills', args })
      return {
        ok: true,
        projectRoot: '/work/proj',
        skills: [{ name: 'a', editable: true }, { name: 'b', editable: false }],
        sources: { user: ['/home/u/.dsh/skills'], project: '/work/proj/.dsh/skills' },
        trash: { count: 2 },
        warnings: [],
      }
    },
  })
  const result = await tool.execute({ action: 'skills', refresh: true, source: 'all' }, { agent: { session: 's1' } })
  assert.equal(result.ok, true)
  assert.deepEqual(calls.at(-1).args, { action: 'skills', refresh: true, source: 'all' })
  assert.match(result.summary, /技能 2/u)
  assert.match(result.summary, /可写 1/u)
  assert.match(result.summary, /回收站 2/u)
})
