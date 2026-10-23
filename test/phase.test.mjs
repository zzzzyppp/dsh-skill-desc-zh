import test from 'node:test'
import assert from 'node:assert/strict'

import { computePhase } from '../lib/index.js'

function counts(overrides = {}) {
  return { llm: 0, dictionary: 0, source: 0, none: 0, ...overrides }
}

test('computePhase：全部走 LLM 且中文齐备 → active', () => {
  const result = computePhase({ zhCount: 12, total: 12, engineCounts: counts({ llm: 12 }) })
  assert.equal(result.phase, 'active')
  assert.equal(result.ready, true)
  assert.match(result.reason, /12 个技能/)
})

test('computePhase：dictionary 回退 → degraded（不冒充 active）', () => {
  const result = computePhase({ zhCount: 12, total: 12, engineCounts: counts({ llm: 11, dictionary: 1 }) })
  assert.equal(result.phase, 'degraded')
  assert.equal(result.ready, true)
  assert.match(result.reason, /dictionary 1/)
})

test('computePhase：office 只能文件回退捕获 → degraded（即使中文齐备）', () => {
  const result = computePhase({
    zhCount: 12,
    total: 12,
    engineCounts: counts({ llm: 12 }),
    degradedCapture: true,
  })
  assert.equal(result.phase, 'degraded')
  assert.match(result.reason, /文件回退捕获/)
})

test('computePhase：影子缺失导致 zhCount<total → degraded 且带出中文计数', () => {
  const result = computePhase({ zhCount: 8, total: 12, engineCounts: counts({ llm: 12 }) })
  assert.equal(result.phase, 'degraded')
  assert.match(result.reason, /中文 8\/12/)
})

test('computePhase：没有任何中文 → failed 且 ready=false', () => {
  const result = computePhase({ zhCount: 0, total: 12, engineCounts: counts({ none: 12 }) })
  assert.equal(result.phase, 'failed')
  assert.equal(result.ready, false)
})

test('computePhase：状态保存失败 → failed（优先于其它规则）', () => {
  const result = computePhase({
    savedOk: false,
    zhCount: 12,
    total: 12,
    engineCounts: counts({ llm: 12 }),
  })
  assert.equal(result.phase, 'failed')
  assert.equal(result.ready, false)
})

test('computePhase：source（原文已是中文）不计为回退', () => {
  const result = computePhase({ zhCount: 12, total: 12, engineCounts: counts({ source: 12 }) })
  assert.equal(result.phase, 'active')
  assert.equal(result.ready, true)
})
