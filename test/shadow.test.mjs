import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { MARKER_FILE, MARKER_PLUGIN, createShadows } from '../lib/shadow.js'
import { createMemfs } from './helpers/memfs.mjs'
import { PROJECT, createFakeTrash, makeFrontmatter, makePaths } from './helpers/fixtures.mjs'

const now = () => new Date('2026-01-02T03:04:05.000Z')
const SOURCE = '/Applications/DSH/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/demo'

function setup() {
  const frontmatter = makeFrontmatter()
  const fs = createMemfs({ cwd: PROJECT })
  fs.seed({
    [path.join(PROJECT, '.git')]: null,
    [path.join(SOURCE, 'references', 'guide.md')]: '# Guide\n\n参考内容\n',
    [path.join(SOURCE, 'templates', 'report.md')]: '# Template\n',
    [path.join(SOURCE, 'SKILL.md')]: [
      '---',
      'name: demo',
      'description: "Use when demonstrating things."',
      'metadata:',
      '  author: host',
      '---',
      '',
      '# Demo',
      '',
      '正文第一行。',
      '正文第二行。',
      '',
    ].join('\n'),
  })
  const trash = createFakeTrash(fs)
  const shadows = createShadows({ paths: makePaths(), frontmatter, trash, fs, now })
  return { fs, trash, shadows, frontmatter }
}

test('shadow：整目录复制，只把 description 换成中文，正文与资源逐字保留', (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { fs, shadows } = setup()
  const result = shadows.ensure({
    projectRoot: PROJECT,
    name: 'demo',
    sourceDir: SOURCE,
    sourcePath: path.join(SOURCE, 'SKILL.md'),
    description: '演示某件事时使用。',
    sourceHash: 'a'.repeat(64),
    enHash: 'b'.repeat(64),
    hostVersion: '0.2.1-rc.2',
  })
  assert.equal(result.status, 'created')
  assert.equal(result.dir, path.join(PROJECT, '.dsh', 'skills', 'demo'))

  const skill = fs.readText(path.join(result.dir, 'SKILL.md'))
  const parsed = makeFrontmatter().parse(skill)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.name, 'demo')
  assert.equal(parsed.description, '演示某件事时使用。')
  assert.equal(parsed.metadata.author, 'host')
  assert.equal(parsed.body, '# Demo\n\n正文第一行。\n正文第二行。')
  assert.equal(fs.readText(path.join(result.dir, 'references', 'guide.md')), '# Guide\n\n参考内容\n')
  assert.equal(fs.readText(path.join(result.dir, 'templates', 'report.md')), '# Template\n')
  assert.deepEqual(result.resources, ['references/guide.md', 'templates/report.md'])

  const marker = JSON.parse(fs.readText(path.join(result.dir, MARKER_FILE)))
  assert.equal(marker.plugin, MARKER_PLUGIN)
  assert.equal(marker.name, 'demo')
  assert.equal(marker.sourceHash, 'a'.repeat(64))
  assert.equal(marker.enHash, 'b'.repeat(64))
  assert.equal(marker.shadowHash, result.shadowHash)
  assert.equal(marker.hostVersion, '0.2.1-rc.2')
})

test('shadow：重复 apply 幂等，force 才重建；源变化后替换', (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { fs, shadows, trash } = setup()
  const base = {
    projectRoot: PROJECT,
    name: 'demo',
    sourceDir: SOURCE,
    sourcePath: path.join(SOURCE, 'SKILL.md'),
    description: '演示某件事时使用。',
    sourceHash: 'a'.repeat(64),
    enHash: 'b'.repeat(64),
    hostVersion: '0.2.1-rc.2',
  }
  const first = shadows.ensure(base)
  const markerBefore = fs.readText(path.join(first.dir, MARKER_FILE))
  const skillBefore = fs.readText(path.join(first.dir, 'SKILL.md'))
  const callsBefore = trash.calls.length

  const again = shadows.ensure(base)
  assert.equal(again.status, 'unchanged')
  assert.equal(fs.readText(path.join(first.dir, MARKER_FILE)), markerBefore)
  assert.equal(fs.readText(path.join(first.dir, 'SKILL.md')), skillBefore)
  assert.equal(trash.calls.length, callsBefore, '未触发任何废纸篓操作')

  const forced = shadows.ensure({ ...base, force: true })
  assert.equal(forced.status, 'replaced')
  assert.ok(trash.calls.length > callsBefore, '旧影子先移入废纸篓')

  const changed = shadows.ensure({
    ...base,
    sourceHash: 'c'.repeat(64),
    description: '新的中文描述。',
  })
  assert.equal(changed.status, 'replaced')
  assert.equal(makeFrontmatter().parse(fs.readText(path.join(changed.dir, 'SKILL.md'))).description, '新的中文描述。')
})

test('shadow：同名未标记目录绝不覆盖；restore 只搬走带标记的目录', (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { fs, shadows } = setup()
  const userDir = path.join(PROJECT, '.dsh', 'skills', 'demo')
  fs.seed({ [path.join(userDir, 'SKILL.md')]: '---\nname: demo\ndescription: 用户自己的技能\n---\n' })

  const conflict = shadows.ensure({
    projectRoot: PROJECT,
    name: 'demo',
    sourceDir: SOURCE,
    sourcePath: path.join(SOURCE, 'SKILL.md'),
    description: '演示某件事时使用。',
    sourceHash: 'a'.repeat(64),
  })
  assert.equal(conflict.status, 'conflict')
  assert.match(conflict.reason, /拒绝覆盖/)
  assert.equal(fs.readText(path.join(userDir, 'SKILL.md')), '---\nname: demo\ndescription: 用户自己的技能\n---\n')

  const otherDir = path.join(PROJECT, '.dsh', 'skills', 'other')
  fs.seed({ [path.join(otherDir, 'SKILL.md')]: '---\nname: other\ndescription: 别人的技能\n---\n' })
  const restored = shadows.restoreProject(PROJECT)
  assert.equal(restored.ok, true)
  assert.equal(fs.existsSync(userDir), true, '未标记目录不删')
  assert.equal(fs.existsSync(otherDir), true)
  assert.ok(restored.results.some((item) => item.status === 'skipped') || restored.results.length === 0)
})

test('shadow：restore 真正移走带标记影子；dryRun 只报告', (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { fs, shadows, trash } = setup()
  const result = shadows.ensure({
    projectRoot: PROJECT,
    name: 'demo',
    sourceDir: SOURCE,
    sourcePath: path.join(SOURCE, 'SKILL.md'),
    description: '演示某件事时使用。',
    sourceHash: 'a'.repeat(64),
  })
  assert.equal(result.status, 'created')

  const dry = shadows.restoreProject(PROJECT, { dryRun: true })
  assert.equal(dry.dryRun, true)
  assert.equal(fs.existsSync(result.dir), true, 'dryRun 不搬')
  assert.ok(dry.results.some((item) => item.status === 'would-trash'))

  const restored = shadows.restoreProject(PROJECT)
  assert.equal(restored.ok, true)
  assert.equal(fs.existsSync(result.dir), false)
  assert.equal(restored.results[0].status, 'trashed')
  assert.ok(trash.calls.some((call) => call.targets.includes(result.dir)))
})
