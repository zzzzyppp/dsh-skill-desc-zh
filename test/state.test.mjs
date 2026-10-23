import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import {
  createStateStore,
  defaultState,
  normalizeState,
  pruneCache,
  addDisabled,
  findDeletion,
  isDisabled,
  listDeletions,
  markRestored,
  normalizeSkillAdmin,
  recordCommand,
  recordDeletion,
  recordProjectSkill,
  removeDisabled,
  recordSkill,
  removeCommand,
  removeProjectSkill,
  resetCommands,
} from '../lib/state.js'
import { createMemfs } from './helpers/memfs.mjs'
import { HOME, createFakeTrash, makePaths } from './helpers/fixtures.mjs'

const now = () => new Date('2026-01-02T03:04:05.000Z')
const STATE_FILE = path.join(HOME, '.dsh', '.skill-desc-zh', 'state.json')

function makeStore(options = {}) {
  const fs = createMemfs()
  const trash = createFakeTrash(fs)
  const paths = makePaths({ stateFile: STATE_FILE, stateDir: path.dirname(STATE_FILE) })
  const store = createStateStore({ paths, fs, trash, now, ...options })
  return { fs, trash, paths, store }
}

test('state：首次加载返回默认状态，apply 后原子写入且权限 600', () => {
  const { fs, store } = makeStore()
  const first = store.load()
  assert.equal(first.exists, false)
  assert.deepEqual(first.warnings, [])
  assert.equal(first.state.enabled, true)
  assert.equal(first.state.hostVersion, 'unknown')

  recordSkill(first.state, 'office', {
    layer: 'global',
    mechanism: 'provider',
    sourcePath: '/Applications/DSH/runtime/office-skills/office/SKILL.md',
    sourceHash: 'a'.repeat(64),
    fingerprint: 'b'.repeat(64),
    en: 'Create, edit, inspect, or convert Office documents.',
    zh: '创建、编辑、检查或转换 Office 文档。',
    engine: 'llm',
  }, { now })

  const saved = store.save(first.state, { reason: 'test' })
  assert.equal(saved.ok, true)
  assert.equal(fs.existsSync(STATE_FILE), true)
  assert.equal(fs.statSync(STATE_FILE).mode & 0o777, 0o600)

  const parsed = JSON.parse(fs.readText(STATE_FILE))
  assert.equal(parsed.version, 3)
  assert.deepEqual(parsed.commands.byName, {})
  assert.equal(parsed.enabled, true)
  assert.equal(parsed.skills.office.zh, '创建、编辑、检查或转换 Office 文档。')
  assert.equal(parsed.skills.office.sourcePath, '/Applications/DSH/runtime/office-skills/office/SKILL.md')
  assert.deepEqual(fs.list(path.dirname(STATE_FILE)), ['state.json'], '不留下临时文件')
})

test('state：二次保存前先留档（trash.snapshot），并写入 history', () => {
  const { fs, trash, store } = makeStore()
  const { state } = store.load()
  assert.equal(store.save(state).ok, true)
  recordSkill(state, 'office', { en: 'en', zh: '中文', fingerprint: 'c'.repeat(64) }, { now })
  state.history.push({ at: 'x', action: 'apply', actor: 'plugin' })
  const saved = store.save(state, { reason: 'apply' })
  assert.equal(saved.ok, true)
  assert.ok(trash.calls.some((call) => call.snapshot === STATE_FILE), '覆盖前调用 snapshot')
  const parsed = JSON.parse(fs.readText(STATE_FILE))
  assert.equal(parsed.skills.office.zh, '中文')
})

test('state：损坏文件不崩溃、不删除原文件，使用空状态并给 warning', () => {
  const { fs, store } = makeStore()
  fs.seed({ [STATE_FILE]: '{ this is not json' })
  const loaded = store.load()
  assert.equal(loaded.corrupt, true)
  assert.equal(loaded.state.enabled, true)
  assert.ok(loaded.warnings.some((item) => item.includes('损坏')))
  assert.equal(fs.readText(STATE_FILE), '{ this is not json', '原文件保持不动')

  const saved = store.save(loaded.state, { reason: 'repair' })
  assert.equal(saved.ok, true)
  assert.ok(JSON.parse(fs.readText(STATE_FILE)).skills)
})

test('state：归一化未知版本与项目条目，pruneCache 只保留在用指纹', () => {
  const normalized = normalizeState({
    version: 9,
    enabled: false,
    skills: { a: { fingerprint: 'keep-a', zh: '甲' } },
    projects: { '/p': { skills: { b: { sourceHash: 'keep-b' } } } },
    commands: { byName: { acp: { fingerprint: 'keep-cmd', zh: '显示状态' } }, updatedAt: 'x' },
    cache: { 'keep-a': { zh: '甲' }, 'keep-b': { zh: '乙' }, 'keep-cmd': { zh: '丙' }, stale: { zh: '丁' } },
    history: [{ action: 'x' }, 'invalid'],
  }, { now })
  assert.equal(normalized.version, 3)
  assert.equal(normalized.enabled, false)
  assert.deepEqual(normalized.history, [{ action: 'x' }])
  assert.equal(normalized.commands.byName.acp.zh, '显示状态')
  pruneCache(normalized)
  assert.deepEqual(Object.keys(normalized.cache).sort(), ['keep-a', 'keep-b', 'keep-cmd'])

  recordProjectSkill(normalized, '/p', 'b', { sourceHash: 'keep-b', dir: '/p/.dsh/skills/b' }, { now })
  assert.equal(removeProjectSkill(normalized, '/p', 'b'), true)
  assert.equal(removeProjectSkill(normalized, '/p', 'missing'), false)
  assert.equal(defaultState({ now }).version, 3)
  assert.ok(defaultState({ now }).commands.byName)
  assert.deepEqual(defaultState({ now }).skillAdmin.disabled, [])
  assert.deepEqual(defaultState({ now }).skillAdmin.deletions, [])
})

test('state：命令记录可增删、resetCommands 清空但保留还原时间', () => {
  const state = defaultState({ now })
  recordCommand(state, 'acp', {
    en: 'Show bili context-compression status',
    zh: '显示 bili 上下文压缩状态',
    engine: 'llm',
    fingerprint: 'f'.repeat(64),
    hint: '',
  }, { now })
  assert.equal(state.commands.byName.acp.zh, '显示 bili 上下文压缩状态')
  assert.equal(removeCommand(state, 'acp'), true)
  assert.equal(removeCommand(state, 'acp'), false)

  recordCommand(state, 'agent-teams', { zh: '以多智能体团队运行目标', engine: 'template' }, { now })
  resetCommands(state, { now, restoredAt: '2026-01-02T03:04:05.000Z' })
  assert.deepEqual(state.commands.byName, {})
  assert.equal(state.commands.restoredAt, '2026-01-02T03:04:05.000Z')
})

test('state v3：v2 状态迁移补 skillAdmin，保留 commands/cache', () => {
  const state = normalizeState({
    version: 2,
    enabled: true,
    hostVersion: '0.4.0',
    commands: { byName: { acp: { zh: '显示' } }, restoredAt: null },
    cache: { fp: { zh: '缓存', enHash: 'x' } },
    skills: {},
  }, { now })
  assert.equal(state.version, 3)
  assert.deepEqual(state.skillAdmin, { disabled: [], deletions: [], updatedAt: '2026-01-02T03:04:05.000Z' })
  assert.equal(state.commands.byName.acp.zh, '显示')
  assert.equal(state.cache.fp.zh, '缓存')
})

test('state v3：禁用记录去重/移除，项目记录保留 projectRoot', () => {
  const state = defaultState({ now })
  addDisabled(state, { scope: 'user', name: 'demo' }, { now })
  addDisabled(state, { scope: 'user', name: 'demo' }, { now })
  assert.equal(state.skillAdmin.disabled.length, 1)
  addDisabled(state, { scope: 'project', name: 'demo', projectRoot: '/work/proj' }, { now })
  assert.equal(state.skillAdmin.disabled.length, 2)
  assert.equal(isDisabled(state, { scope: 'user', name: 'demo' }), true)
  assert.equal(isDisabled(state, { scope: 'user', name: 'other' }), false)
  assert.equal(removeDisabled(state, { scope: 'user', name: 'demo' }), true)
  assert.equal(state.skillAdmin.disabled.length, 1)
  assert.equal(state.skillAdmin.disabled[0].projectRoot, '/work/proj')
})

test('state v3：normalizeSkillAdmin 丢弃非法条目并截断删除记录', () => {
  const deletions = Array.from({ length: 205 }, (_, i) => ({
    id: `d${i}`,
    scope: 'user',
    name: `n${i}`,
    from: `/home/u/.dsh/skills/n${i}`,
    to: `/Trash/n${i}`,
    deletedAt: '2026-01-01T00:00:00.000Z',
  }))
  const normalized = normalizeSkillAdmin({
    disabled: [
      { scope: 'user', name: 'ok' },
      { scope: 'bad', name: 'no' },
      { scope: 'project', name: 'no-root' },
      { scope: 'user', name: '../escape' },
    ],
    deletions,
  }, { now })
  assert.equal(normalized.disabled.length, 1)
  assert.equal(normalized.disabled[0].name, 'ok')
  assert.equal(normalized.deletions.length, 200)
})

test('state v3：删除记录可查、restorable 标记与 pruneDeletions', () => {
  const state = defaultState({ now })
  recordDeletion(state, { id: 'd1', scope: 'user', name: 'gone', from: '/home/u/.dsh/skills/gone', to: '/Trash/gone', deletedAt: '2026-01-01T00:00:00.000Z' }, { now })
  assert.equal(findDeletion(state, { id: 'd1' }).name, 'gone')
  assert.equal(markRestored(state, 'd1', { now }), true)
  assert.equal(listDeletions(state).length, 0)
  assert.equal(findDeletion(state, { id: 'missing' }), undefined)
})
