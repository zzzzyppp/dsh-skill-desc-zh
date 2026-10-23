import test from 'node:test'
import assert from 'node:assert/strict'

import { PROVIDER_NAME, PROVIDER_RANK, createProvider } from '../lib/provider.js'

function makeProvider(overrides = {}) {
  const captured = new Map()
  const state = {
    captured,
    enabled: true,
    ready: true,
    capturing: false,
    translations: new Map(),
  }
  captured.set('office', {
    name: 'office',
    definition: {
      name: 'office',
      description: 'Create, edit, inspect, or convert Office documents.',
      content: '正文\n\n## Installed LibreOffice Kit\n\nkit',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      whenToUse: 'Office 任务',
      resourceBase: { kind: 'directory', path: '/runtime/office-skills/office' },
      path: '/runtime/office-skills/office/SKILL.md',
    },
  })
  const provider = createProvider({
    captured,
    name: PROVIDER_NAME,
    isEnabled: () => state.enabled,
    isReady: () => state.ready,
    isCapturing: () => state.capturing,
    translationFor: (record) => state.translations.get(record?.name),
    ...overrides,
  })
  return { provider, state }
}

test('provider：未就绪/捕获中/禁用时不暴露候选（防自噬）', async () => {
  const { provider, state } = makeProvider()
  assert.equal((await provider.list({})).candidates.length, 1)
  state.ready = false
  assert.deepEqual(await provider.list({}), { candidates: [], complete: false })
  state.ready = true
  state.capturing = true
  assert.equal((await provider.list({})).candidates.length, 0)
  state.capturing = false
  state.enabled = false
  assert.equal((await provider.list({})).candidates.length, 0)
})

test('provider：候选只换 description，rank=50，get 透传正文与资源', async () => {
  const { provider, state } = makeProvider()
  state.translations.set('office', { zh: '创建、编辑、检查或转换 Office 文档。', engine: 'llm' })

  const { candidates, complete } = await provider.list({ cwd: '/p' })
  assert.equal(complete, true)
  assert.equal(candidates.length, 1)
  const candidate = candidates[0]
  assert.equal(candidate.name, 'office')
  assert.equal(candidate.description, '创建、编辑、检查或转换 Office 文档。')
  assert.equal(candidate.provider, PROVIDER_NAME)
  assert.equal(candidate.rank, PROVIDER_RANK)
  assert.equal(candidate.source, 'bundled')
  assert.equal(candidate.path, '/runtime/office-skills/office/SKILL.md')
  assert.equal(candidate.resourceBase.path, '/runtime/office-skills/office')

  const definition = await provider.get(candidate, { cwd: '/p' })
  assert.equal(definition.description, '创建、编辑、检查或转换 Office 文档。')
  assert.equal(definition.content, '正文\n\n## Installed LibreOffice Kit\n\nkit')
  assert.equal(definition.resourceBase.path, '/runtime/office-skills/office')
  assert.equal(definition.whenToUse, 'Office 任务')
})

test('provider：无译文时退回英文；未知名字 get 返回 undefined', async () => {
  const { provider, state } = makeProvider()
  const { candidates } = await provider.list({})
  assert.equal(candidates[0].description, 'Create, edit, inspect, or convert Office documents.')
  state.translations.set('office', { zh: '' })
  const fallback = await provider.list({})
  assert.equal(fallback.candidates[0].description, 'Create, edit, inspect, or convert Office documents.')
  assert.equal(await provider.get({ name: 'unknown' }), undefined)
  state.ready = false
  assert.equal(await provider.get({ name: 'office' }), undefined)
})

test('provider：中文为空/非字符串时绝不写空描述', async () => {
  const { provider, state } = makeProvider()
  state.translations.set('office', { zh: '   ' })
  const { candidates } = await provider.list({})
  assert.equal(candidates[0].description.length > 0, true)
  assert.match(candidates[0].description, /Office documents/)
})
