import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { createSkillAdmin } from '../lib/skill-admin.js'
import { createSkillFiles } from '../lib/skill-files.js'
import { defaultState } from '../lib/state.js'
import { createMemfs, SKILL_MD } from './helpers/memfs.mjs'
import { HOME, PROJECT, createFakeTrash, makeFrontmatter, makePaths } from './helpers/fixtures.mjs'

const NOW = () => new Date('2026-01-02T03:04:05.000Z')
const USER_ROOT = path.join(HOME, '.dsh', 'skills')
const PROJECT_ROOT = path.join(PROJECT, '.dsh', 'skills')

function setup(options = {}) {
  const fs = options.fs ?? createMemfs({ cwd: PROJECT })
  if (!fs.existsSync(path.join(PROJECT, '.git'))) fs.seed({ [path.join(PROJECT, '.git')]: null })
  const trash = createFakeTrash(fs)
  const state = defaultState({ now: NOW })
  const paths = makePaths()
  const skillFiles = createSkillFiles({
    paths,
    frontmatter: makeFrontmatter(fs),
    trash,
    fs,
    now: NOW,
    allowlist: options.allowlist ?? [],
    getState: () => state,
  })
  const commits = []
  let invalidated = 0
  const readOnly = options.readOnlyRows ?? (() => [])
  const admin = createSkillAdmin({
    paths,
    config: { projectAllowlist: options.allowlist ?? [] },
    skillFiles,
    fs,
    now: NOW,
    getState: () => state,
    saveState: (current, meta) => {
      commits.push(meta?.reason)
      return { ok: true }
    },
    invalidate: () => {
      invalidated += 1
    },
    readOnlyRows: readOnly,
  })
  return { fs, trash, state, paths, skillFiles, admin, commits, get invalidated() { return invalidated } }
}

function w(fs, root, name, description = 'Demo.', body = '# Demo\n\n正文。\n') {
  fs.seed({ [path.join(root, name, 'SKILL.md')]: SKILL_MD(description, { name, body }) })
}

test('skill-admin：list 合并可写技能与只读来源，同名可写优先', () => {
  const { fs, admin } = setup({ readOnlyRows: () => [{ name: 'office', description: 'Office', source: 'bundled' }, { name: 'mine', description: '只读同名', source: 'custom' }] })
  w(fs, USER_ROOT, 'mine', '可写版本')
  const list = admin.list({}, { projectRoot: PROJECT })
  assert.equal(list.ok, true)
  assert.deepEqual(list.skills.map((row) => row.name), ['mine', 'office'])
  assert.equal(list.skills[0].description, '可写版本')
  assert.equal(list.skills[1].origin, 'bundled')
  assert.equal(list.skills[1].editable, false)
  assert.equal(list.skills[1].readOnlyReason, 'bundled')
})

test('skill-admin：list source 过滤、项目未授权时 project=null、缓存与 refresh', () => {
  const { fs, admin } = setup({ readOnlyRows: () => [{ name: 'office', description: 'Office', source: 'bundled' }] })
  w(fs, USER_ROOT, 'user-one')
  w(fs, PROJECT_ROOT, 'project-one')
  const all = admin.list({}, { projectRoot: PROJECT })
  assert.ok(all.skills.some((row) => row.name === 'project-one'))
  const onlyUser = admin.list({ source: 'user' }, { projectRoot: PROJECT })
  assert.ok(onlyUser.skills.some((row) => row.name === 'user-one'))
  assert.ok(!onlyUser.skills.some((row) => row.name === 'project-one'))
  assert.equal(onlyUser.skills.some((row) => row.editable !== true), false)
  assert.equal(onlyUser.skills.every((row) => row.scope === 'user'), true)
  const onlyProject = admin.list({ source: 'project' }, { projectRoot: PROJECT })
  assert.ok(onlyProject.skills.some((row) => row.name === 'project-one'))
  assert.ok(!onlyProject.skills.some((row) => row.name === 'office'))
  assert.equal(onlyProject.skills.some((row) => row.editable !== true), false)
  assert.equal(onlyProject.skills.every((row) => row.scope === 'project'), true)
  const cached = admin.list({}, { projectRoot: PROJECT })
  assert.equal(cached.cached, true)
  const refreshed = admin.list({ refresh: true }, { projectRoot: PROJECT })
  assert.equal(refreshed.cached, undefined)
  const blocked = admin.list({}, { projectRoot: '/opt/outside' })
  assert.equal(blocked.projectRoot, null)
  assert.equal(blocked.sources.project, null)
})

test('skill-admin：detail 返回正文/指纹/frontmatter，缺 description 只读', () => {
  const { fs, admin } = setup()
  w(fs, USER_ROOT, 'detail-me', 'Description.', 'line1\n\nline2\n')
  const detail = admin.detail({ scope: 'user', name: 'detail-me', projectRoot: PROJECT }, { projectRoot: PROJECT })
  assert.equal(detail.ok, true)
  assert.equal(detail.description, 'Description.')
  assert.match(detail.fingerprint, /^sha256:/u)
  assert.equal(detail.body, 'line1\n\nline2')
  assert.equal(detail.editable, true)
  fs.seed({ [path.join(USER_ROOT, 'no-desc', 'SKILL.md')]: '---\nname: no-desc\n---\n\n正文\n' })
  const readOnly = admin.detail({ scope: 'user', name: 'no-desc' }, { projectRoot: PROJECT })
  assert.equal(readOnly.ok, false)
  assert.equal(readOnly.code, 'broken-frontmatter')
})

test('skill-admin：create 成功提交并 invalidate，非法 description/重名被拒绝', () => {
  const env = setup()
  const { fs, admin, state, commits } = env
  const created = admin.action({ action: 'create', scope: 'user', name: 'created', description: '新技能。', body: '# 正文\n' }, { projectRoot: PROJECT })
  assert.equal(created.ok, true)
  assert.equal(fs.existsSync(path.join(USER_ROOT, 'created', 'SKILL.md')), true)
  assert.equal(commits.at(-1), 'skills.create')
  assert.ok(env.invalidated >= 1)
  assert.equal(state.skillAdmin.deletions.length, 0)
  assert.equal(admin.action({ action: 'create', scope: 'user', name: 'created', description: '重名' }, { projectRoot: PROJECT }).code, 'conflict')
  assert.equal(admin.action({ action: 'create', scope: 'user', name: 'bad', description: 'a\nb' }, { projectRoot: PROJECT }).code, 'invalid')
  assert.equal(admin.action({ action: 'create', scope: 'user', name: '../x', description: 'x' }, { projectRoot: PROJECT }).code, 'invalid')
})

test('skill-admin：save 乐观锁冲突、成功后正文保留；只读项目返回 unsupported-source', () => {
  const { fs, admin, commits } = setup()
  w(fs, USER_ROOT, 'saved', 'Old.', 'body\n')
  const detail = admin.detail({ scope: 'user', name: 'saved' }, { projectRoot: PROJECT })
  const stale = admin.action({ action: 'save', scope: 'user', name: 'saved', description: 'New.', expectedFingerprint: 'sha256:deadbeef' }, { projectRoot: PROJECT })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'conflict')
  const saved = admin.action({ action: 'save', scope: 'user', name: 'saved', description: 'New.', expectedFingerprint: detail.fingerprint }, { projectRoot: PROJECT })
  assert.equal(saved.ok, true)
  assert.equal(admin.detail({ scope: 'user', name: 'saved' }, { projectRoot: PROJECT }).body, 'body')
  assert.equal(commits.at(-1), 'skills.save')
  const denied = admin.action({ action: 'create', scope: 'project', name: 'outside', description: 'x', projectRoot: '/opt/outside' }, { projectRoot: '/opt/outside' })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'unsupported-source')
})

test('skill-admin：delete 真实移入废纸篓并记录，dryRun 不提交不移动', () => {
  const { fs, admin, state, commits } = setup()
  w(fs, USER_ROOT, 'gone', 'Gone.')
  const preview = admin.action({ action: 'delete', scope: 'user', name: 'gone', dryRun: true }, { projectRoot: PROJECT })
  assert.equal(preview.ok, true)
  assert.equal(preview.result.dryRun, true)
  assert.equal(commits.length, 0)
  assert.equal(fs.existsSync(path.join(USER_ROOT, 'gone')), true)
  const deleted = admin.action({ action: 'delete', scope: 'user', name: 'gone' }, { projectRoot: PROJECT })
  assert.equal(deleted.ok, true)
  assert.equal(fs.existsSync(path.join(USER_ROOT, 'gone')), false)
  assert.equal(state.skillAdmin.deletions.length, 1)
  assert.equal(commits.at(-1), 'skills.delete')
  assert.equal(admin.trashList().count, 1)
  assert.equal(admin.list({}, { projectRoot: PROJECT }).trash.count, 1)
})

test('skill-admin：restore 以 id 恢复，dryRun 不提交；目标已存在时 conflict', () => {
  const { fs, admin, state, commits } = setup()
  w(fs, USER_ROOT, 'back', 'Back.')
  const deleted = admin.action({ action: 'delete', scope: 'user', name: 'back' }, { projectRoot: PROJECT })
  const id = deleted.result.deletion.id
  const before = commits.length
  const preview = admin.action({ action: 'restore', id, dryRun: true }, { projectRoot: PROJECT })
  assert.equal(preview.ok, true)
  assert.equal(preview.result.dryRun, true)
  assert.equal(commits.length, before)
  assert.ok(state.skillAdmin.deletions[0].restoredAt == null)
  fs.seed({ [path.join(USER_ROOT, 'back', 'SKILL.md')]: SKILL_MD('占位', { name: 'back' }) })
  const conflict = admin.action({ action: 'restore', id }, { projectRoot: PROJECT })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'conflict')
  fs.renameSync(path.join(USER_ROOT, 'back'), path.join('/Trash', 'back-old'))
  const restored = admin.action({ action: 'restore', id }, { projectRoot: PROJECT })
  assert.equal(restored.ok, true)
  assert.equal(fs.existsSync(path.join(USER_ROOT, 'back', 'SKILL.md')), true)
  assert.ok(state.skillAdmin.deletions[0].restoredAt)
  assert.equal(commits.at(-1), 'skills.restore')
  assert.equal(admin.trashList().count, 0)
})

test('skill-admin：被篡改的删除记录拒绝恢复（不把任意路径搬进技能根）', () => {
  const { fs, admin, state } = setup()
  w(fs, USER_ROOT, 'tamper', 'Tamper.')
  admin.action({ action: 'delete', scope: 'user', name: 'tamper' }, { projectRoot: PROJECT })
  state.skillAdmin.deletions[0].from = '/etc/passwd'
  const result = admin.action({ action: 'restore', id: state.skillAdmin.deletions[0].id }, { projectRoot: PROJECT })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'invalid-target')
})

test('skill-admin：disable/enable 只写 state 并 invalidate，列表显示 disabled', () => {
  const { fs, admin, state, commits } = setup()
  w(fs, USER_ROOT, 'toggle', 'Toggle.')
  const disabled = admin.action({ action: 'disable', scope: 'user', name: 'toggle' }, { projectRoot: PROJECT })
  assert.equal(disabled.ok, true)
  assert.equal(state.skillAdmin.disabled.length, 1)
  assert.equal(admin.list({}, { projectRoot: PROJECT }).skills.find((row) => row.name === 'toggle').disabled, true)
  assert.equal(commits.at(-1), 'skills.disable')
  const enabled = admin.action({ action: 'enable', scope: 'user', name: 'toggle' }, { projectRoot: PROJECT })
  assert.equal(enabled.ok, true)
  assert.equal(state.skillAdmin.disabled.length, 0)
  assert.equal(commits.at(-1), 'skills.enable')
})

test('skill-admin：项目禁用只在对应 projectRoot 生效，未知动作/非法 scope 拒绝', () => {
  const { fs, admin, state } = setup()
  w(fs, PROJECT_ROOT, 'project-disable', 'Project.')
  const disabled = admin.action({ action: 'disable', scope: 'project', name: 'project-disable' }, { projectRoot: PROJECT })
  assert.equal(disabled.ok, true)
  assert.equal(state.skillAdmin.disabled[0].projectRoot, PROJECT)
  assert.equal(admin.list({}, { projectRoot: '/opt/outside' }).skills.some((row) => row.name === 'project-disable'), false)
  assert.equal(admin.action({ action: 'nope', scope: 'user', name: 'x' }, { projectRoot: PROJECT }).code, 'invalid')
  assert.equal(admin.action({ action: 'delete', scope: 'global', name: 'x' }, { projectRoot: PROJECT }).code, 'invalid')
})

test('skill-admin：statusSummary 统计来源、禁用与回收站数量', () => {
  const { fs, admin } = setup({ readOnlyRows: () => [{ name: 'office', description: 'Office', source: 'bundled' }] })
  w(fs, USER_ROOT, 'one')
  w(fs, PROJECT_ROOT, 'two')
  admin.action({ action: 'disable', scope: 'user', name: 'one' }, { projectRoot: PROJECT })
  const summary = admin.statusSummary(PROJECT)
  assert.equal(summary.userSkills >= 1, true)
  assert.equal(summary.projectSkills, 1)
  assert.equal(summary.disabledCount, 1)
  assert.equal(summary.readOnlySkills, 1)
  assert.equal(summary.trashCount, 0)
  assert.equal(summary.maxDeletions, 200)
})

test('skill-admin：list 的删除记录带 restorable，源目录不存在时 false', () => {
  const { fs, admin, state } = setup()
  w(fs, USER_ROOT, 'restorable', 'Restorable.')
  admin.action({ action: 'delete', scope: 'user', name: 'restorable' }, { projectRoot: PROJECT })
  assert.equal(admin.list({}, { projectRoot: PROJECT }).trash.items[0].restorable, true)
  state.skillAdmin.deletions[0].to = '/Trash/not-there'
  assert.equal(admin.list({ refresh: true }, { projectRoot: PROJECT }).trash.items[0].restorable, false)
})

test('skill-admin：只读技能不可 disable，detail 项目根未授权拒绝', () => {
  const { admin } = setup({ readOnlyRows: () => [{ name: 'office', description: 'Office', source: 'bundled' }] })
  assert.equal(admin.action({ action: 'disable', scope: 'user', name: 'office' }, { projectRoot: PROJECT }).code, 'not-found')
  const detail = admin.detail({ scope: 'project', name: 'x', projectRoot: '/opt/outside' }, { projectRoot: '/opt/outside' })
  assert.equal(detail.ok, false)
  assert.equal(detail.code, 'unsupported-source')
})

test('skill-admin：F2/F3 只读行 scope=origin、user/project 计数不含只读，已有译文显示中文', () => {
  const { fs, state, admin } = setup({
    readOnlyRows: () => [
      { name: 'office', description: 'Office English', source: 'bundled' },
      { name: 'pre', description: 'Preset English', source: 'custom' },
      { name: 'rt', description: 'Runtime English', source: 'runtime', isRuntime: true },
    ],
  })
  w(fs, USER_ROOT, 'mine', 'Mine.')
  w(fs, PROJECT_ROOT, 'proj-mine', 'Project mine.')
  state.skills.office = { en: 'Office English', zh: 'Office 中文', engine: 'llm', layer: 'global' }
  const list = admin.list({ refresh: true }, { projectRoot: PROJECT })
  const readOnly = list.skills.filter((row) => row.editable !== true)
  assert.deepEqual(readOnly.map((row) => [row.name, row.scope, row.origin]), [
    ['office', 'bundled', 'bundled'],
    ['pre', 'preset', 'preset'],
    ['rt', 'runtime', 'runtime'],
  ])
  const counts = {
    user: list.skills.filter((row) => row.scope === 'user').length,
    project: list.skills.filter((row) => row.scope === 'project').length,
  }
  assert.deepEqual(counts, { user: 1, project: 1 })
  const office = list.skills.find((row) => row.name === 'office')
  assert.equal(office.description, 'Office 中文')
  assert.deepEqual(office.translation, { engine: 'llm', zh: true })
  const pre = list.skills.find((row) => row.name === 'pre')
  assert.equal(pre.description, 'Preset English')
  assert.deepEqual(pre.translation, { engine: 'none', zh: false })
  // F2R：source=user/project 只返回对应可写行，只读来源不混入。
  const userOnly = admin.list({ source: 'user', refresh: true }, { projectRoot: PROJECT })
  assert.deepEqual(userOnly.skills.map((row) => [row.name, row.scope]), [['mine', 'user']])
  const projectOnly = admin.list({ source: 'project', refresh: true }, { projectRoot: PROJECT })
  assert.deepEqual(projectOnly.skills.map((row) => [row.name, row.scope]), [['proj-mine', 'project']])
  // F2b：statusSummary.readOnlySkills 由只读来源统计（去重可写同名）。
  assert.equal(admin.statusSummary(PROJECT).readOnlySkills, 3)
})

test('skill-admin：F5 按 id restore 重新校验 deletion.projectRoot 的 allowlist，不写盘', () => {
  const { fs, state, admin, commits } = setup({ allowlist: [] })
  const outsideRoot = '/opt/outside'
  state.skillAdmin.deletions.push({
    id: 'del-outside',
    scope: 'project',
    name: 'ghost',
    projectRoot: outsideRoot,
    from: path.join(outsideRoot, '.dsh', 'skills', 'ghost'),
    to: '/Trash/ghost',
    kind: 'dir',
    size: 1,
    fingerprint: null,
    deletedAt: NOW().toISOString(),
  })
  fs.seed({ ['/Trash/ghost/SKILL.md']: SKILL_MD('Ghost.', { name: 'ghost' }) })
  const result = admin.action({ action: 'restore', id: 'del-outside' }, { projectRoot: PROJECT })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'unsupported-source')
  assert.equal(fs.existsSync(path.join(outsideRoot, '.dsh', 'skills', 'ghost', 'SKILL.md')), false)
  assert.equal(state.skillAdmin.deletions[0].restoredAt, undefined)
  assert.equal(commits.length, 0)
})
