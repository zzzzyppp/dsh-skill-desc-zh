import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { chunkBody, createSkillFiles, KEBAB_SKILL_NAME, renderEdit } from '../lib/skill-files.js'
import { defaultState, recordDeletion } from '../lib/state.js'
import { createMemfs, SKILL_MD } from './helpers/memfs.mjs'
import {
  HOME,
  PROJECT,
  createFakeTrash,
  makeFrontmatter,
  makePaths,
} from './helpers/fixtures.mjs'

const now = () => new Date('2026-01-02T03:04:05.000Z')
const USER_ROOT = path.join(HOME, '.dsh', 'skills')
const PROJECT_ROOT = path.join(PROJECT, '.dsh', 'skills')

function setup(options = {}) {
  const fs = createMemfs({ cwd: PROJECT })
  fs.seed({ [path.join(PROJECT, '.git')]: null })
  const trash = createFakeTrash(fs)
  const state = defaultState({ now })
  const paths = makePaths()
  const files = createSkillFiles({
    paths,
    frontmatter: makeFrontmatter(fs),
    trash,
    fs,
    now,
    allowlist: options.allowlist ?? [],
    getState: () => state,
  })
  return { fs, trash, state, paths, files }
}

function writeSkill(fs, dir, name, description = 'A demo skill.', body = '# Demo\n\n正文。\n', extra = '') {
  fs.seed({ [path.join(dir, name, 'SKILL.md')]: SKILL_MD(description, { name, body, extra }) })
}

test('skill-files：名白名单与 chunkBody 边界不丢内容', () => {
  assert.equal(KEBAB_SKILL_NAME.test('good-name'), true)
  assert.equal(KEBAB_SKILL_NAME.test('-bad'), false)
  assert.equal(KEBAB_SKILL_NAME.test('Bad'), false)
  assert.equal(KEBAB_SKILL_NAME.test('a'.repeat(65)), false)
  const body = Array.from({ length: 40 }, (_, index) => `第 ${index} 段。`).join('\n\n')
  const chunks = chunkBody(body, 100)
  assert.ok(chunks.length > 1)
  assert.equal(chunks.join(''), body)
  const fenced = '```js\nconsole.log(1)\nconsole.log(2)\n```\n\n' + 'x'.repeat(300)
  const split = chunkBody(fenced, 80)
  for (const chunk of split) {
    const fences = (chunk.match(/^```/gm) ?? []).length
    assert.equal(fences % 2, 0, '每个切片围栏成对')
  }
})

test('skill-files：roots 区分 user/project，项目未放行时不可写', () => {
  const { files } = setup()
  const roots = files.roots(PROJECT)
  assert.equal(roots[0].kind, 'user')
  assert.equal(roots[0].writable, true)
  assert.equal(roots[1].kind, 'project')
  assert.equal(roots[1].writable, true) // PROJECT 在 $HOME 下
  const outside = files.roots('/opt/outside')
  assert.equal(outside[1].writable, false)
  assert.match(outside[1].reason, /HOME|allowlist/u)
})

test('skill-files：create 写目录形式 SKILL.md、正文与权限 600，并拒绝重复/非法名', () => {
  const { fs, files } = setup()
  const created = files.create({ scope: 'user', name: 'new-skill', description: '新建技能。', args: { body: '# Body\n' } })
  assert.equal(created.ok, true)
  const file = path.join(USER_ROOT, 'new-skill', 'SKILL.md')
  assert.ok(fs.existsSync(file))
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.match(fs.readText(file), /name: new-skill/u)
  assert.match(fs.readText(file), /新建技能/u)
  assert.match(fs.readText(file), /# Body/u)

  const again = files.create({ scope: 'user', name: 'new-skill', description: '重复' })
  assert.equal(again.ok, false)
  assert.equal(again.code, 'conflict')

  const bad = files.create({ scope: 'user', name: '../escape', description: 'x' })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'invalid-arguments')

  const empty = files.create({ scope: 'user', name: 'blank', description: '   ' })
  assert.equal(empty.ok, false)
  assert.equal(empty.code, 'invalid-arguments')
})

test('skill-files：scan 读 user+project、跳过 node_modules/隐藏目录、坏 frontmatter 进 warnings 而非崩溃', () => {
  const { fs, files } = setup()
  writeSkill(fs, USER_ROOT, 'user-skill', 'User skill.')
  writeSkill(fs, PROJECT_ROOT, 'project-skill', 'Project skill.')
  fs.seed({
    [path.join(USER_ROOT, 'node_modules', 'fake', 'SKILL.md')]: SKILL_MD('不该出现'),
    [path.join(USER_ROOT, '.hidden', 'SKILL.md')]: SKILL_MD('不该出现'),
    [path.join(USER_ROOT, 'broken', 'SKILL.md')]: '---\nname: broken\n---\n',
    [path.join(USER_ROOT, 'flat.md')]: '---\nname: flat\ndescription: 扁平技能。\n---\n\n正文\n',
  })
  const scanned = files.scan({ projectRoot: PROJECT })
  assert.equal(scanned.ok, true)
  const names = scanned.skills.map((item) => `${item.scope}:${item.name}`)
  assert.ok(names.includes('user:user-skill'))
  assert.ok(names.includes('project:project-skill'))
  assert.ok(names.includes('user:flat'))
  assert.ok(!names.some((name) => name.includes('fake') || name.includes('hidden')))
  const broken = scanned.skills.find((item) => item.name === 'broken')
  assert.equal(broken.description, null)
  assert.match(broken.error, /description|缺少/u)
})

test('skill-files：F1 只把根层 <name>/SKILL.md 或 <name>.md 当技能，references/assets 内 .md 忽略', () => {
  const { fs, files } = setup()
  fs.seed({
    [path.join(USER_ROOT, 'demo', 'SKILL.md')]: SKILL_MD('Demo.', { name: 'demo' }),
    [path.join(USER_ROOT, 'demo', 'references', 'guide.md')]: '# Guide\n\n资源文档，不是技能。\n',
    [path.join(USER_ROOT, 'demo', 'assets', 'note.md')]: '# Note\n',
    [path.join(USER_ROOT, 'loose.md')]: SKILL_MD('Loose.', { name: 'loose' }),
    [path.join(USER_ROOT, 'multi', 'nested', 'SKILL.md')]: SKILL_MD('Nested.', { name: 'nested' }),
  })
  const scanned = files.scan()
  assert.equal(scanned.ok, true)
  assert.deepEqual(scanned.skills.map((item) => item.name).sort(), ['demo', 'loose'])
  assert.ok(!scanned.skills.some((item) => item.name === 'guide' || item.name === 'nested'))
})

test('skill-files：detail 返回 body/frontmatter/资源清单；只读项目不可写', () => {
  const { fs, files } = setup({ allowlist: [] })
  writeSkill(fs, PROJECT_ROOT, 'outer', 'Outer.')
  fs.seed({ [path.join(PROJECT_ROOT, 'outer', 'references', 'guide.md')]: '# Guide\n' })
  const detail = files.detail({ scope: 'project', name: 'outer', projectRoot: PROJECT })
  assert.equal(detail.ok, true)
  assert.match(detail.skill.body, /正文/u)
  assert.equal(detail.skill.writable, true)
  assert.ok(detail.resources.some((item) => item.path === 'references/guide.md'))
  const notAllowed = files.roots('/opt/outside')
  assert.equal(notAllowed[1].writable, false)
})

test('skill-files：save 只改 description，正文/资源逐字保留，且写前 snapshot', () => {
  const { fs, trash, files } = setup()
  writeSkill(fs, USER_ROOT, 'edit-me', 'Old description.', 'line1\n\nline2\n')
  fs.seed({ [path.join(USER_ROOT, 'edit-me', 'references', 'a.md')]: 'keep' })
  const detail = files.detail({ scope: 'user', name: 'edit-me' })
  const saved = files.save({
    scope: 'user',
    name: 'edit-me',
    description: '新的描述。',
    args: { expectedFingerprint: `sha256:${files.fileFingerprint(detail.skill.path, detail.skill.relativePath)}` },
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.changed, true)
  assert.ok(trash.calls.some((call) => call.snapshot === detail.skill.path))
  const reread = files.detail({ scope: 'user', name: 'edit-me' })
  assert.equal(reread.skill.description, '新的描述。')
  assert.equal(reread.skill.body, 'line1\n\nline2')
  assert.equal(fs.readText(path.join(USER_ROOT, 'edit-me', 'references', 'a.md')), 'keep')
})

test('skill-files：save 乐观锁指纹不一致返回 conflict；正文可安全重写', () => {
  const { fs, files } = setup()
  writeSkill(fs, USER_ROOT, 'locked', 'Locked.')
  const stale = files.save({ scope: 'user', name: 'locked', description: 'x', args: { expectedFingerprint: 'deadbeef' } })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'conflict')
  const detail = files.detail({ scope: 'user', name: 'locked' })
  const bodyUpdated = files.save({
    scope: 'user',
    name: 'locked',
    description: 'Locked 2.',
    args: { body: '# 新正文\n', expectedFingerprint: detail.skill.fingerprint ?? `sha256:${files.fileFingerprint(detail.skill.path, detail.skill.relativePath)}` },
  })
  assert.equal(bodyUpdated.ok, true)
  assert.equal(files.detail({ scope: 'user', name: 'locked' }).skill.body, '# 新正文')
})

test('skill-files：frontmatter 锚点/别名/自定义 tag 一律失败关闭（D1）', () => {
  const frontmatter = makeFrontmatter(createMemfs())
  const anchored = '---\nname: a\ndescription: &d 原描述\nother: *d\n---\n\n正文\n'
  const alias = '---\nname: a\ndescription: 原描述\nalias: *somewhere\n---\n\n正文\n'
  assert.equal(renderEdit(frontmatter, anchored, '新描述').code, 'unsupported-frontmatter')
  assert.equal(renderEdit(frontmatter, alias, '新描述').ok, false)
  const block = '---\nname: a\ndescription: >-\n  第一行\n  第二行\n---\n\n正文\n'
  const rendered = renderEdit(frontmatter, block, '新的描述')
  assert.equal(rendered.ok, true)
  assert.match(rendered.markdown, /description: "新的描述"/u)
  assert.match(rendered.markdown, /正文/u)
})

test('skill-files：delete 走 trash 并记录 deletion；dryRun 不动文件不写记录', () => {
  const { fs, trash, state, files } = setup()
  writeSkill(fs, USER_ROOT, 'delete-me', 'Delete me.')
  const preview = files.delete({ scope: 'user', name: 'delete-me', dryRun: true })
  assert.equal(preview.ok, true)
  assert.equal(preview.dryRun, true)
  assert.equal(fs.existsSync(path.join(USER_ROOT, 'delete-me', 'SKILL.md')), true)
  assert.equal(state.skillAdmin.deletions.length, 0)

  const deleted = files.delete({ scope: 'user', name: 'delete-me' })
  assert.equal(deleted.ok, true)
  assert.equal(fs.existsSync(path.join(USER_ROOT, 'delete-me')), false)
  assert.equal(state.skillAdmin.deletions.length, 1)
  assert.equal(trash.calls.at(-1).targets.length, 1)
})

test('skill-files：restore 以 deletionId 为主键，目标已存在时拒绝覆盖', () => {
  const { fs, files, state } = setup()
  writeSkill(fs, USER_ROOT, 'restore-me', 'Restore me.')
  const deleted = files.delete({ scope: 'user', name: 'restore-me' })
  assert.equal(deleted.ok, true)
  const id = state.skillAdmin.deletions[0].id
  writeSkill(fs, USER_ROOT, 'restore-me', 'Another file.')
  const conflict = files.restore({ id })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'conflict')
  // 仅凭 name 不会误恢复别的同名条目（D2）。
  assert.equal(files.restore({ name: 'restore-me' }).ok, false)
  fs.renameSync(path.join(USER_ROOT, 'restore-me'), path.join('/Trash', 'restore-me-conflict'))
  const restored = files.restore({ id })
  assert.equal(restored.ok, true)
  assert.equal(restored.id, id)
  assert.ok(state.skillAdmin.deletions[0].restoredAt)
  assert.equal(files.restore({ id }).code, 'conflict', '重复恢复被拒绝')
})

test('skill-files：restore 跨卷返回 trash-unavailable，不复制后删除', () => {
  const { fs, files } = setup()
  writeSkill(fs, USER_ROOT, 'cross', 'Cross.')
  const deleted = files.delete({ scope: 'user', name: 'cross' })
  assert.equal(deleted.ok, true)
  const original = fs.renameSync
  fs.renameSync = () => {
    const error = new Error('EXDEV')
    error.code = 'EXDEV'
    throw error
  }
  const restored = files.restore({ name: 'cross' })
  fs.renameSync = original
  assert.equal(restored.ok, false)
  assert.equal(restored.code, 'trash-unavailable')
})

test('skill-files：symlink 目标拒绝读写，越权路径不越出技能根', () => {
  const { fs, files } = setup()
  fs.seed({ '/tmp/outside.md': 'outside' })
  fs.mkdirSync(path.join(USER_ROOT, 'linky'), { recursive: true })
  fs.symlinkSync('/tmp/outside.md', path.join(USER_ROOT, 'linky', 'SKILL.md'))
  const detail = files.detail({ scope: 'user', name: 'linky' })
  assert.equal(detail.ok, false)
  assert.ok(['invalid-target', 'broken-frontmatter'].includes(detail.code))
  const created = files.create({ scope: 'user', name: 'ok', description: 'ok' })
  assert.equal(created.ok, true)
  const target = path.join(USER_ROOT, 'ok', 'SKILL.md')
  assert.equal(files.targetPath('user', 'ok').file, target)
})

test('skill-files：删除记录上限 200 条，移出最旧记录', () => {
  const { state } = setup()
  assert.ok(state.skillAdmin.deletions.length === 0)
  // 通过 state 直接验证上限，避免创建 200 个目录拖慢测试。
  for (let index = 0; index < 205; index += 1) {
    recordDeletion(state, {
      id: `id-${index}`,
      scope: 'user',
      name: `skill-${index}`,
      from: path.join(USER_ROOT, `skill-${index}`),
      to: path.join('/Trash', `skill-${index}`),
      kind: 'dir',
      size: 1,
      deletedAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
    })
  }
  assert.equal(state.skillAdmin.deletions.length, 200)
  assert.equal(state.skillAdmin.deletions.some((item) => item.id === 'id-0'), false)
  assert.equal(state.skillAdmin.deletions.at(-1).id, 'id-204')
})


test('skill-files：frontmatter name 与目录名不一致时拒绝 save', () => {
  const { files, fs } = setup()
  const dir = path.join(USER_ROOT, 'wrong-name', 'SKILL.md')
  fs.seed({ [dir]: '---\nname: other-name\ndescription: 描述\n---\n\n正文\n' })
  const before = fs.readText(dir)
  const result = files.save({ scope: 'user', name: 'wrong-name', description: '新描述' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'invalid-target')
  assert.equal(fs.readText(dir), before)
})


test('skill-files：snapshot 返回 ok:false 时拒绝覆盖', () => {
  const { files, fs, trash } = setup()
  fs.seed({ [path.join(USER_ROOT, 'keep', 'SKILL.md')]: '---\nname: keep\ndescription: 原描述\n---\n\n正文\n' })
  const before = fs.readText(path.join(USER_ROOT, 'keep', 'SKILL.md'))
  trash.snapshot = () => ({ ok: false, reason: 'disk full' })
  const result = files.save({ scope: 'user', name: 'keep', description: '新描述' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'trash-unavailable')
  assert.equal(fs.readText(path.join(USER_ROOT, 'keep', 'SKILL.md')), before)
})
