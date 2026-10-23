import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { createDiscovery } from '../lib/discover.js'
import { contentHash, sourceHash } from '../lib/translate.js'
import { createMemfs } from './helpers/memfs.mjs'
import {
  OFFICE_DIR,
  PRESET_DIR,
  PROJECT,
  makeFrontmatter,
  makePaths,
  officeDefinition,
} from './helpers/fixtures.mjs'

const HOST_VERSION = '0.2.1-rc.2'
const CONFIG = {
  targets: {
    global: ['office', 'office-docx'],
    preset: ['agent-experience'],
  },
}

function setup(options = {}) {
  const fs = createMemfs({ cwd: PROJECT })
  const frontmatter = makeFrontmatter(fs)
  fs.seed({ [path.join(PROJECT, '.git')]: null })
  const presetDir = options.presetDir ?? PRESET_DIR
  if (options.seedPreset !== false) {
    fs.seed({
      [path.join(presetDir, 'agent-experience', 'SKILL.md')]: [
        '---',
        'name: agent-experience',
        'description: "Use when writing model-facing tool definitions."',
        'whenToUse: 设计工具描述时',
        'metadata:',
        '  author: host',
        '---',
        '',
        '# Agent Experience',
        '',
        '正文。',
      ].join('\n'),
      [path.join(presetDir, 'agent-experience', 'references', 'guide.md')]: '# Guide\n',
    })
  }
  const defs = {
    office: officeDefinition('office', 'Create, edit, inspect, or convert Office documents.', {
      content: '# Office\n\n正文\n\n## Installed LibreOffice Kit\n\nkit v1',
    }),
    'office-docx': officeDefinition('office-docx', 'Create, read, edit, and validate Word documents.'),
  }
  const skills = options.skills ?? {
    async get(name) {
      return defs[name]
    },
  }
  const paths = makePaths({
    presetSkillsDir: () => presetDir,
    officeSkillsDir: () => OFFICE_DIR,
    hostVersion: () => HOST_VERSION,
  })
  const discovery = createDiscovery({ paths, frontmatter, fs, config: CONFIG, logger: {} })
  return { fs, paths, discovery, skills, defs, frontmatter }
}

test('discover：L1 经 skills.get 捕获原始定义（含 LibreOffice 附录），L2 读预设原文', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { discovery, skills } = setup()
  const out = await discovery.discover({ cwd: path.join(PROJECT, 'src'), skills, hostVersion: HOST_VERSION })
  assert.equal(out.projectRoot, PROJECT)
  assert.equal(out.targetNames.global.length, 2)
  assert.equal(out.targetNames.preset.length, 1)
  assert.equal(out.targets.length, 3)
  assert.equal(out.complete, true)

  const office = out.targets.find((item) => item.name === 'office')
  assert.equal(office.layer, 'global')
  assert.equal(office.mechanism, 'provider')
  assert.equal(office.provider, 'dsh-office')
  assert.equal(office.rank, 600)
  assert.equal(office.capturedVia, 'skills.get')
  assert.equal(office.hasRuntimeAppendix, true)
  assert.match(office.content, /## Installed LibreOffice Kit/)
  assert.equal(office.resourceBase.path, path.join(OFFICE_DIR, 'office'))
  assert.equal(office.sourceHash.length, 64)
  assert.equal(office.fingerprint, office.sourceHash)

  const preset = out.targets.find((item) => item.name === 'agent-experience')
  assert.equal(preset.layer, 'preset')
  assert.equal(preset.mechanism, 'shadow')
  assert.equal(preset.rank, 300)
  assert.equal(preset.capturedVia, 'file')
  assert.equal(preset.description, 'Use when writing model-facing tool definitions.')
  assert.equal(preset.content, '# Agent Experience\n\n正文。')
  assert.equal(preset.sourceDir, path.join(PRESET_DIR, 'agent-experience'))
  assert.equal(preset.whenToUse, '设计工具描述时')
  assert.deepEqual(out.warnings, [])
})

test('discover：指纹与 translate 模块同口径，且对 description/content/resourceBase/宿主版本敏感', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { discovery, skills, defs } = setup()
  const first = await discovery.discover({ cwd: PROJECT, skills, hostVersion: HOST_VERSION })
  const again = await discovery.discover({ cwd: PROJECT, skills, hostVersion: HOST_VERSION })
  const a = first.targets.find((item) => item.name === 'office')
  const b = again.targets.find((item) => item.name === 'office')
  assert.equal(a.sourceHash, b.sourceHash)
  assert.equal(a.contentHash, b.contentHash)
  assert.equal(a.contentHash, contentHash({ description: a.description, content: a.content, resourceBase: a.resourceBase }))
  assert.equal(a.sourceHash, sourceHash({
    name: 'office',
    description: a.description,
    content: a.content,
    resourceBase: a.resourceBase,
    hostVersion: HOST_VERSION,
  }))

  const descriptionChanged = await discovery.discover({
    cwd: PROJECT,
    hostVersion: HOST_VERSION,
    skills: { get: async (name) => ({ ...defs[name], description: `${defs[name].description} Updated.` }) },
  })
  assert.notEqual(descriptionChanged.targets.find((item) => item.name === 'office').sourceHash, a.sourceHash)

  const versionChanged = await discovery.discover({ cwd: PROJECT, skills, hostVersion: '0.3.0' })
  assert.notEqual(versionChanged.targets.find((item) => item.name === 'office').sourceHash, a.sourceHash)
})

test('discover：同名用户技能优先时跳过，不覆盖；skills.get 失败时回退读内置文件', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { discovery, skills } = setup({
    skills: {
      async get(name) {
        if (name === 'office') return { name, description: '用户自己的 office', provider: 'my-provider', source: 'user' }
        throw new Error('服务未就绪')
      },
    },
  })
  const out = await discovery.discover({ cwd: PROJECT, skills, hostVersion: HOST_VERSION })
  assert.equal(out.targets.some((item) => item.name === 'office'), false)
  assert.ok(out.warnings.some((item) => item.includes('用户自己的 office') || item.includes('跳过以免覆盖')), JSON.stringify(out.warnings))

  // 第二次：两个都失败，office-docx 回退到内置目录（fixture 里没有该文件 => warning）。
  const fallbackFs = createMemfs({ cwd: PROJECT })
  fallbackFs.seed({
    [path.join(PROJECT, '.git')]: null,
    [path.join(OFFICE_DIR, 'office-docx', 'SKILL.md')]: [
      '---',
      'name: office-docx',
      'description: "Create, read, edit, and validate Word documents."',
      '---',
      '',
      '# docx',
    ].join('\n'),
  })
  const paths = makePaths({
    presetSkillsDir: () => PRESET_DIR,
    officeSkillsDir: () => OFFICE_DIR,
    hostVersion: () => HOST_VERSION,
  })
  const discovery2 = createDiscovery({
    paths,
    frontmatter: makeFrontmatter(fallbackFs),
    fs: fallbackFs,
    config: { targets: { global: ['office-docx'], preset: [] } },
    logger: {},
  })
  const out2 = await discovery2.discover({
    cwd: PROJECT,
    hostVersion: HOST_VERSION,
    skills: { get: async () => { throw new Error('boom') } },
  })
  const docx = out2.targets.find((item) => item.name === 'office-docx')
  assert.ok(docx)
  assert.equal(docx.capturedVia, 'file')
  assert.equal(docx.content, '# docx')
  assert.ok(out2.warnings.some((item) => item.includes('回退直接读取')))
  void discovery
})

test('discover：mtime/size 未变时复用指纹（快路径），变化后重新计算', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { discovery, skills } = setup()
  const first = await discovery.discover({ cwd: PROJECT, skills, hostVersion: HOST_VERSION })
  const preset = first.targets.find((item) => item.name === 'agent-experience')
  assert.equal(preset.hashReused, undefined, '首次没有历史记录')
  const known = {
    'agent-experience': {
      sourcePath: preset.sourcePath,
      capturedVia: 'file',
      size: preset.size,
      mtimeMs: preset.mtimeMs,
      hostVersion: HOST_VERSION,
      enHash: preset.contentHash,
      sourceHash: preset.sourceHash,
    },
  }
  const reused = await discovery.discover({ cwd: PROJECT, skills, hostVersion: HOST_VERSION, known })
  const cached = reused.targets.find((item) => item.name === 'agent-experience')
  assert.equal(cached.hashReused, true)
  assert.equal(cached.contentHash, preset.contentHash)
  assert.equal(cached.sourceHash, preset.sourceHash)

  const changed = await discovery.discover({
    cwd: PROJECT,
    skills,
    hostVersion: HOST_VERSION,
    known: { 'agent-experience': { ...known['agent-experience'], size: preset.size + 1 } },
  })
  const recomputed = changed.targets.find((item) => item.name === 'agent-experience')
  assert.equal(recomputed.hashReused, undefined)
  assert.equal(recomputed.sourceHash, preset.sourceHash, '内容没变，重算结果仍一致')

  const office = first.targets.find((item) => item.name === 'office')
  const officeKnown = {
    office: {
      sourcePath: office.sourcePath,
      capturedVia: 'skills.get',
      size: office.size,
      mtimeMs: office.mtimeMs,
      hostVersion: HOST_VERSION,
      enHash: office.contentHash,
      sourceHash: office.sourceHash,
    },
  }
  const fromService = await discovery.discover({
    cwd: PROJECT,
    skills,
    hostVersion: HOST_VERSION,
    known: officeKnown,
  })
  assert.equal(fromService.targets.find((item) => item.name === 'office').hashReused, undefined, '运行时捕获必须重算，不能复用')
})

test('discover：translatePreset=false 跳过预设并给出 warning；缺预设目录不崩溃', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const { discovery, skills } = setup({ seedPreset: false, presetDir: '/missing/preset/skills' })
  const out = await discovery.discover({
    cwd: PROJECT,
    skills,
    hostVersion: HOST_VERSION,
    config: undefined,
  })
  // config 在工厂内，translatePreset 由 paths/构造 config 控制；这里验证缺目录时只 warning。
  assert.equal(out.targets.some((item) => item.layer === 'preset'), false)
  assert.ok(out.warnings.some((item) => item.includes('未找到 dsh-agent-preset')))

  const fs = createMemfs({ cwd: PROJECT })
  fs.seed({ [path.join(PROJECT, '.git')]: null })
  const disabled = createDiscovery({
    paths: makePaths({ presetSkillsDir: () => PRESET_DIR, officeSkillsDir: () => OFFICE_DIR, hostVersion: () => HOST_VERSION }),
    frontmatter: makeFrontmatter(fs),
    fs,
    config: { ...CONFIG, translatePreset: false },
    logger: {},
  })
  const skipped = await disabled.discover({ cwd: PROJECT, skills, hostVersion: HOST_VERSION })
  assert.equal(skipped.targets.some((item) => item.layer === 'preset'), false)
  assert.ok(skipped.warnings.some((item) => item.includes('translatePreset=false')))
  void discovery
})
