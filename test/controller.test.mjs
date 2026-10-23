import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { createController } from '../lib/index.js'
import { createShadows } from '../lib/shadow.js'
import { createStateStore } from '../lib/state.js'
import { createTrash } from '../lib/trash.js'
import { sourceHash } from '../lib/translate.js'
import { createMemfs } from './helpers/memfs.mjs'
import {
  HOME,
  OFFICE_DIR,
  PRESET_DIR,
  PROJECT,
  createFakeTranslate,
  createFakeTrash,
  makeFrontmatter,
  makePaths,
} from './helpers/fixtures.mjs'

const now = () => new Date('2026-01-02T03:04:05.000Z')
const OFFICE_CONTENT = '# Office\n\n正文\n\n## Installed LibreOffice Kit\n\nkit v1'
const PRESET_CONTENT = '# Agent Experience\n\n正文。'

function presetSource() {
  return {
    'SKILL.md': [
      '---',
      'name: agent-experience',
      'description: "Use when writing model-facing tool definitions."',
      'metadata:',
      '  author: host',
      '---',
      '',
      PRESET_CONTENT,
      '',
    ].join('\n'),
    'references/guide.md': '# Guide\n',
  }
}

function setup(options = {}) {
  const fs = createMemfs({ cwd: PROJECT })
  fs.seed({ [path.join(PROJECT, '.git')]: null })
  const sourceDir = path.join(PRESET_DIR, 'agent-experience')
  for (const [relative, content] of Object.entries(presetSource())) {
    fs.seed({ [path.join(sourceDir, relative)]: content })
  }

  const frontmatter = makeFrontmatter(fs)
  let hostVersion = options.hostVersion ?? '0.2.1-rc.2'
  const paths = makePaths({
    stateFile: path.join(HOME, '.dsh', '.skill-desc-zh', 'state.json'),
    stateDir: path.join(HOME, '.dsh', '.skill-desc-zh'),
    trashScript: () => undefined,
    hostVersion: () => hostVersion,
  })
  const trash = options.trash ?? createFakeTrash(fs)
  const stateStore = createStateStore({ paths, fs, trash, now })
  const shadows = createShadows({ paths, frontmatter, trash, fs, now })
  const translate = options.translate ?? createFakeTranslate(options.engine ? { engine: options.engine } : {})
  const discovery = {
    async discover({ hostVersion: version }) {
      const office = {
        name: 'office',
        layer: 'global',
        mechanism: 'provider',
        description: 'Create, edit, inspect, or convert Office documents.',
        en: 'Create, edit, inspect, or convert Office documents.',
        content: OFFICE_CONTENT,
        resourceBase: { kind: 'directory', path: path.join(OFFICE_DIR, 'office') },
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled',
        provider: 'dsh-office',
        rank: 600,
        sourcePath: path.join(OFFICE_DIR, 'office', 'SKILL.md'),
        sourceDir: path.join(OFFICE_DIR, 'office'),
        hostVersion: version,
        contentHash: sourceHash({
          name: 'office',
          description: 'Create, edit, inspect, or convert Office documents.',
          content: OFFICE_CONTENT,
          resourceBase: { kind: 'directory', path: path.join(OFFICE_DIR, 'office') },
          hostVersion: version,
        }),
        capturedVia: 'skills.get',
      }
      office.sourceHash = office.contentHash
      office.fingerprint = office.sourceHash
      const preset = {
        name: 'agent-experience',
        layer: 'preset',
        mechanism: 'shadow',
        description: 'Use when writing model-facing tool definitions.',
        en: 'Use when writing model-facing tool definitions.',
        content: PRESET_CONTENT,
        resourceBase: { kind: 'directory', path: sourceDir },
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled',
        provider: 'dsh-skill-filesystem',
        rank: 300,
        sourcePath: path.join(sourceDir, 'SKILL.md'),
        sourceDir,
        hostVersion: version,
        contentHash: sourceHash({
          name: 'agent-experience',
          description: 'Use when writing model-facing tool definitions.',
          content: PRESET_CONTENT,
          resourceBase: { kind: 'directory', path: sourceDir },
          hostVersion: version,
        }),
        capturedVia: 'file',
      }
      preset.sourceHash = preset.contentHash
      preset.fingerprint = preset.sourceHash
      return {
        targets: options.targets ?? [office, preset],
        warnings: [],
        projectRoot: PROJECT,
        hostVersion: version,
        complete: true,
      }
    },
  }
  const services = {
    skills: { async get() { return undefined } },
    llm: { name: 'fake-llm' },
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
    workingDirectory: { get: () => PROJECT },
    ...(options.services ?? {}),
  }
  const controller = createController({
    paths,
    config: {
      enabled: true,
      engine: options.engine ?? 'auto',
      translatePreset: true,
      projectAllowlist: [],
      targets: { global: ['office'], preset: ['agent-experience'] },
      llm: { provider: null, model: null, timeoutMs: 5000 },
      ...(options.config ?? {}),
    },
    logger: options.logger ?? {},
    deps: { fs, frontmatter, trash, stateStore, shadows, discovery, translateBatch: translate, now, services },
  })
  let invalidations = 0
  controller.attach({ invalidate: () => { invalidations += 1 } })
  const exec = { agent: { session: 'session-1' } }
  return {
    fs, paths, trash, stateStore, shadows, translate, discovery, controller, services, exec,
    getHostVersion: () => hostVersion,
    setHostVersion: (value) => { hostVersion = value },
    invalidations: () => invalidations,
    shadowDir: path.join(PROJECT, '.dsh', 'skills', 'agent-experience'),
    stateFile: paths.stateFile,
    eventsFile: path.join(HOME, '.dsh', '.skill-desc-zh', 'events.ndjson'),
    readEvents: () => fs.readText(path.join(HOME, '.dsh', '.skill-desc-zh', 'events.ndjson'))
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  }
}

/** 最小 commands 宿主：全局一条 /acp，agent scope 可注册同名影子。 */
function createFakeCommands() {
  const global = new Map([
    ['acp', {
      name: 'acp',
      definitionId: '@scope/acp',
      description: 'Show bili context-compression status',
      input: { hint: '输入 /acp 查看压缩状态' },
      handler: () => ({ kind: 'success', text: 'acp-ok' }),
    }],
  ])
  const layers = new Map()
  const merge = (agent) => new Map([...global, ...(layers.get(agent) ?? new Map())])
  const service = {
    list(agent) {
      return [...merge(agent).values()].map(({ handler, ...descriptor }) => descriptor)
    },
    find(agent, name) {
      return merge(agent).get(name)
    },
  }
  function makeAgent(id = 'agent-commands') {
    const agent = {
      id,
      ctx: {
        get(name) {
          if (name !== 'commands') return undefined
          return {
            register(definition) {
              let layer = layers.get(agent)
              if (!layer) {
                layer = new Map()
                layers.set(agent, layer)
              }
              if (layer.has(definition.name)) throw new Error(`duplicate ${definition.name}`)
              layer.set(definition.name, definition)
              return () => layer.delete(definition.name)
            },
          }
        },
      },
    }
    return agent
  }
  return { service, layers, makeAgent }
}

test('controller.apply：L1 中文候选 + L2 影子 + 状态落盘 + invalidate', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup()
  const { controller, translate } = env
  assert.deepEqual(controller.provider.list(), { candidates: [], complete: false }, 'apply 前不暴露候选')

  const result = await controller.apply({}, env.exec)
  assert.equal(result.ok, true, JSON.stringify(result.warnings))
  assert.match(result.summary, /apply 完成：中文 2\/2/)
  assert.equal(translate.calls.length, 1)
  assert.equal(translate.calls[0].items.length, 2)
  assert.equal(translate.calls[0].llm, env.services.llm)
  assert.equal(translate.calls[0].agentDefaultModel, env.services.agentDefaultModel)

  const candidates = controller.provider.list()
  assert.equal(candidates.complete, true)
  assert.equal(candidates.candidates.length, 1)
  assert.equal(candidates.candidates[0].description, '【中文】Create, edit, inspect, or convert Office documents.')
  const definition = await controller.provider.get({ name: 'office' })
  assert.equal(definition.content, OFFICE_CONTENT, '正文与 LibreOffice 附录原样透传')

  const state = JSON.parse(env.fs.readText(env.stateFile))
  assert.equal(state.hostVersion, '0.2.1-rc.2')
  assert.equal(state.skills.office.engine, 'llm')
  assert.equal(state.skills.office.fingerprint, state.skills.office.sourceHash)
  assert.equal(state.projects[PROJECT].skills['agent-experience'].dir, env.shadowDir)
  assert.equal(state.skills['agent-experience'].shadow.projectRoot, PROJECT)
  assert.ok(env.invalidations() >= 1)

  const shadowSkill = env.fs.readText(path.join(env.shadowDir, 'SKILL.md'))
  const parsed = makeFrontmatter(env.fs).parse(shadowSkill)
  assert.equal(parsed.description, '【中文】Use when writing model-facing tool definitions.')
  assert.equal(parsed.body, PRESET_CONTENT)
  assert.equal(env.fs.readText(path.join(env.shadowDir, 'references', 'guide.md')), '# Guide\n')
  const marker = JSON.parse(env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json')))
  assert.equal(marker.hostVersion, '0.2.1-rc.2')
  assert.equal(marker.sourceHash, state.skills['agent-experience'].sourceHash)

  const status = await controller.status({}, env.exec)
  assert.equal(status.ok, true)
  assert.match(status.summary, /中文 2\/2/)
  assert.ok(status.details.some((line) => line.startsWith('office') && line.includes('中文')))
  assert.ok(status.details.some((line) => line.startsWith('agent-experience') && line.includes('影子')))
})

test('controller.apply 幂等：重复执行不重写影子，仍刷新状态', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup()
  await env.controller.apply({}, env.exec)
  const before = env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json'))
  const trashedBefore = env.trash.calls.filter((call) => call.targets).length

  const second = await env.controller.apply({}, env.exec)
  assert.equal(second.ok, true)
  assert.equal(env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json')), before)
  assert.equal(env.trash.calls.filter((call) => call.targets).length, trashedBefore, '幂等 apply 不搬旧影子')
  assert.equal(second.warnings.filter((item) => item.includes('影子未建立')).length, 0)
})

test('controller.restore：dryRun 不改状态；真实还原后候选为空、影子进废纸篓、apply 可回中文', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup()
  await env.controller.apply({}, env.exec)

  const dry = await env.controller.restore({ dryRun: true }, env.exec)
  assert.equal(dry.ok, true)
  assert.match(dry.summary, /预演/)
  assert.equal(env.fs.existsSync(env.shadowDir), true, 'dryRun 不动影子')
  assert.equal(JSON.parse(env.fs.readText(env.stateFile)).enabled, true, 'dryRun 不改 enabled')
  assert.equal(env.controller.provider.list().candidates.length, 1, 'dryRun 不下架 provider')

  const restored = await env.controller.restore({}, env.exec)
  assert.equal(restored.ok, true, JSON.stringify(restored.warnings))
  assert.match(restored.summary, /已恢复英文原文/)
  assert.equal(env.fs.existsSync(env.shadowDir), false)
  assert.equal(env.controller.provider.list().candidates.length, 0)
  const state = JSON.parse(env.fs.readText(env.stateFile))
  assert.equal(state.enabled, false)
  assert.deepEqual(state.projects, {})
  assert.equal(state.skills.office.shadow, undefined)
  assert.ok(env.trash.calls.some((call) => call.targets?.includes(env.shadowDir)))

  const retranslate = await env.controller.retranslate({}, env.exec)
  assert.equal(retranslate.ok, false)
  assert.match(retranslate.summary, /先执行 skill_desc_zh\(action="apply"\)/)

  const reapplied = await env.controller.apply({}, env.exec)
  assert.equal(reapplied.ok, true)
  assert.equal(env.controller.provider.list().candidates.length, 1)
  assert.equal(JSON.parse(env.fs.readText(env.stateFile)).enabled, true)
  assert.equal(env.fs.existsSync(env.shadowDir), true)
})

test('controller.apply：宿主版本变化先还原旧影子再重建', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup()
  await env.controller.apply({}, env.exec)
  const oldMarker = JSON.parse(env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json')))
  assert.equal(oldMarker.hostVersion, '0.2.1-rc.2')

  env.setHostVersion('0.3.0')
  const result = await env.controller.apply({}, env.exec)
  assert.equal(result.ok, true)
  assert.ok(result.warnings.some((item) => item.includes('宿主版本变化')))
  const marker = JSON.parse(env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json')))
  assert.equal(marker.hostVersion, '0.3.0')
  const state = JSON.parse(env.fs.readText(env.stateFile))
  assert.equal(state.hostVersion, '0.3.0')
  assert.equal(state.skills.office.zh.length > 0, true)
  assert.ok(env.trash.calls.filter((call) => call.targets).length >= 1, '旧影子被移入废纸篓')
})

test('controller：宿主升级先清影子与旧缓存，再重译并记事件', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const seen = []
  const base = createFakeTranslate()
  let env
  const translate = async (input) => {
    seen.push({ shadowExists: env.fs.existsSync(env.shadowDir), cache: { ...input.cache } })
    return base(input)
  }
  env = setup({ translate })
  await env.controller.apply({}, env.exec)
  const oldFingerprint = JSON.parse(env.fs.readText(env.stateFile)).skills.office.fingerprint

  env.setHostVersion('0.3.0')
  const result = await env.controller.apply({}, env.exec)
  assert.equal(result.ok, true, JSON.stringify(result.warnings))
  assert.equal(seen.length, 2, '升级后必须重新翻译一次')
  assert.equal(seen[1].shadowExists, false, '重译前旧影子已移入废纸篓')
  assert.deepEqual(seen[1].cache, {}, '旧译文缓存先清空，避免用旧指纹命中')
  assert.ok(result.warnings.some((item) => item.includes('宿主版本变化')))
  assert.notEqual(
    JSON.parse(env.fs.readText(env.stateFile)).skills.office.fingerprint,
    oldFingerprint,
  )
  const marker = JSON.parse(env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json')))
  assert.equal(marker.hostVersion, '0.3.0')
  assert.ok(env.readEvents().some((event) => event.action === 'host-version-heal'))
  assert.equal(env.controller.phase().phase, 'active')
})

test('controller：半状态自愈——state 记着影子但磁盘已丢失 / 影子被改坏', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup()
  await env.controller.apply({}, env.exec)

  // 状态还在，影子目录被外部清掉：下一次 apply 应补建，而不是留下悬空记录。
  env.trash.trash([env.shadowDir])
  assert.equal(env.fs.existsSync(env.shadowDir), false)
  assert.ok(JSON.parse(env.fs.readText(env.stateFile)).projects[PROJECT])
  const rebuilt = await env.controller.apply({}, env.exec)
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.warnings))
  assert.equal(env.fs.existsSync(path.join(env.shadowDir, 'SKILL.md')), true)
  assert.equal(env.fs.existsSync(path.join(env.shadowDir, '.skill-desc-zh.json')), true)

  // 影子内容被改坏（shadowHash 不符）：应整目录换新，不能把用户的改动当译文。
  const skillFile = path.join(env.shadowDir, 'SKILL.md')
  env.fs.writeFileSync(skillFile, `${env.fs.readText(skillFile)}\n被改坏的一行\n`)
  const repaired = await env.controller.apply({}, env.exec)
  assert.equal(repaired.ok, true, JSON.stringify(repaired.warnings))
  assert.doesNotMatch(env.fs.readText(skillFile), /被改坏的一行/u)
  assert.ok(env.trash.calls.some((call) => call.targets?.includes(env.shadowDir)))
})

test('controller：agent/created 为新会话项目建影子；restoreOnQuit 退出还原', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const project2 = path.join(HOME, 'work', 'proj2')
  const env = setup({
    services: {
      workingDirectory: {
        get: (session) => (session === 'session-2' ? project2 : PROJECT),
      },
    },
  })
  await env.controller.apply({}, env.exec)
  env.fs.seed({ [path.join(project2, '.git')]: null })

  const created = await env.controller.ensureShadowsForAgent({ agent: { session: 'session-2' } })
  assert.equal(created.ok, true, JSON.stringify(created.warnings))
  const shadow2 = path.join(project2, '.dsh', 'skills', 'agent-experience')
  assert.equal(env.fs.existsSync(path.join(shadow2, 'SKILL.md')), true)
  assert.equal(JSON.parse(env.fs.readText(env.stateFile)).projects[project2].skills['agent-experience'].dir, shadow2)
  assert.ok(env.readEvents().some((event) => event.action === 'agent-created'))

  const quitting = setup({ config: { restoreOnQuit: true } })
  await quitting.controller.apply({}, quitting.exec)
  quitting.controller.dispose()
  assert.equal(quitting.fs.existsSync(quitting.shadowDir), false)
  assert.equal(JSON.parse(quitting.fs.readText(quitting.stateFile)).projects[PROJECT], undefined)
  assert.ok(quitting.readEvents().some((event) => event.action === 'restore-on-quit'))
})

test('controller.refresh：指纹未变时不重建影子，也不改 enabled', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup()
  await env.controller.apply({}, env.exec)
  const before = env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json'))
  const trashed = env.trash.calls.filter((call) => call.targets).length

  const result = await env.controller.refresh({}, env.exec)
  assert.equal(result.ok, true, JSON.stringify(result.warnings))
  assert.match(result.summary, /refresh 完成/)
  assert.equal(env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json')), before)
  assert.equal(env.trash.calls.filter((call) => call.targets).length, trashed)
  assert.equal(JSON.parse(env.fs.readText(env.stateFile)).enabled, true)
  assert.ok(env.readEvents().some((event) => event.action === 'refresh'))
})

test('controller：同名未标记目录冲突时不覆盖、不记影子，但 L1 仍生效', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup()
  env.fs.seed({
    [path.join(env.shadowDir, 'SKILL.md')]: '---\nname: agent-experience\ndescription: 用户自己的技能\n---\n',
  })
  const result = await env.controller.apply({}, env.exec)
  assert.equal(result.ok, true)
  assert.equal(result.phase, 'degraded', 'preset 影子未建立时不能声称全部中文生效')
  assert.match(result.summary, /中文 1\/2/)
  assert.ok(result.warnings.some((item) => item.includes('影子未建立')))
  assert.equal(env.controller.provider.list().candidates.length, 1)
  const state = JSON.parse(env.fs.readText(env.stateFile))
  assert.equal(state.projects[PROJECT]?.skills?.['agent-experience'], undefined)
  assert.equal(
    env.fs.readText(path.join(env.shadowDir, 'SKILL.md')),
    '---\nname: agent-experience\ndescription: 用户自己的技能\n---\n',
    '用户技能一字不动',
  )
})

test('controller：dictionary 引擎与 translate 全失败时绝不写空中文', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const dictionary = setup({ engine: 'dictionary' })
  const applied = await dictionary.controller.apply({}, dictionary.exec)
  assert.equal(applied.ok, true)
  assert.equal(applied.phase, 'degraded')
  const state = JSON.parse(dictionary.fs.readText(dictionary.stateFile))
  assert.equal(state.skills.office.engine, 'dictionary')

  const failing = setup({ translate: createFakeTranslate({ engine: 'none' }) })
  const fallback = await failing.controller.apply({}, failing.exec)
  assert.equal(fallback.ok, true)
  assert.equal(fallback.phase, 'failed')
  assert.match(fallback.summary, /中文 0\/2/)
  const fallbackState = JSON.parse(failing.fs.readText(failing.stateFile))
  assert.equal(fallbackState.skills.office.zh, null, '失败时 zh 留空，绝不写半成品')
  assert.equal(fallbackState.skills.office.engine, 'none')
  assert.equal(fallbackState.skills.office.shadow, undefined)
  assert.deepEqual(
    failing.controller.provider.list(),
    { candidates: [], complete: false },
    '翻译失败时 fail-closed，让底层 provider 提供英文原文',
  )
  assert.equal(failing.fs.existsSync(failing.shadowDir), false, 'preset 无中文时不建影子')
})

test('controller：translate 抛错时 phase=failed 且 fail-closed', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup({
    translate: async () => {
      throw new Error('boom')
    },
  })
  const result = await env.controller.apply({}, env.exec)
  assert.equal(result.ok, false)
  assert.equal(result.phase, 'failed')
  assert.match(result.warnings.join('\n'), /翻译失败：boom/u)
  assert.equal(env.controller.isReady(), false)
  assert.deepEqual(env.controller.provider.list(), { candidates: [], complete: false })
  assert.ok(env.readEvents().some((event) => event.action === 'apply' && event.ok === false))
})

test('controller：config.enabled=false 时完全停用；未知 names 给 warning', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup()
  const disabled = createController({
    paths: env.paths,
    config: { enabled: false },
    logger: {},
    deps: {
      fs: env.fs,
      frontmatter: makeFrontmatter(env.fs),
      trash: env.trash,
      stateStore: env.stateStore,
      shadows: env.shadows,
      discovery: env.discovery,
      translateBatch: env.translate,
      now,
      services: env.services,
    },
  })
  disabled.attach({ invalidate: () => {} })
  const result = await disabled.apply({}, env.exec)
  assert.equal(result.ok, false)
  assert.match(result.summary, /禁用/)
  assert.deepEqual(disabled.provider.list(), { candidates: [], complete: false })

  const applied = await env.controller.apply({}, env.exec)
  assert.equal(applied.ok, true)
  const candidatesBeforeUnknown = env.controller.provider.list().candidates.length
  const beforeUnknown = env.fs.readText(env.stateFile)
  const unknown = await env.controller.apply({ names: ['not-a-skill'] }, env.exec)
  assert.equal(unknown.ok, true)
  assert.ok(unknown.warnings.some((item) => item.includes('未知技能名')))
  assert.equal(env.fs.readText(env.stateFile), beforeUnknown, '未知 names 不应改写已生效的状态')
  assert.equal(env.controller.phase().phase, 'active', '未知 names 不应改变运行状态')
  assert.equal(env.controller.provider.list().candidates.length, candidatesBeforeUnknown, '未知 names 不应下架已生效的中文')
  const state = JSON.parse(env.fs.readText(env.stateFile))
  assert.ok(state.skills.office, '未选中的目标保持原有译文')
})

test('controller.restore：废纸篓失败时保留 state/project 与影子，phase=failed', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const fs = createMemfs({ cwd: PROJECT })
  const failedTrash = createFakeTrash(fs, { fail: true })
  const env = setup({ trash: failedTrash })
  const applied = await env.controller.apply({}, env.exec)
  assert.equal(applied.ok, true)

  const result = await env.controller.restore({}, env.exec)
  assert.equal(result.ok, false)
  assert.equal(env.controller.phase().phase, 'failed')
  const state = env.stateStore.load().state
  assert.equal(state.enabled, false)
  assert.ok(state.projects[PROJECT], '失败时不能丢掉项目登记，否则无法重试还原')
  assert.ok(env.fs.existsSync(env.shadowDir), '影子仍在，不能假装已还原')
  const events = env.readEvents()
  assert.equal(events.at(-1).action, 'restore')
  assert.equal(events.at(-1).ok, false)
})

test('controller：命令描述在 agent 层中文化，restore/apply 全程可逆', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const commands = createFakeCommands()
  const env = setup({
    services: { commands: commands.service },
    config: {
      targets: { global: ['office'], preset: ['agent-experience'], commands: ['acp'] },
    },
  })

  const applied = await env.controller.apply({}, env.exec)
  assert.equal(applied.ok, true, JSON.stringify(applied.warnings))
  assert.match(applied.summary, /命令 1\/1/)
  assert.equal(JSON.parse(env.fs.readText(env.stateFile)).commands.byName.acp.engine, 'llm')

  const agent = commands.makeAgent()
  const ensured = env.controller.ensureCommandShadows({ agent })
  assert.equal(ensured.ok, true)
  assert.equal(ensured.registered, 1)
  const shadow = commands.layers.get(agent).get('acp')
  assert.equal(shadow.description, '【中文】Show bili context-compression status')
  assert.equal(shadow.definitionId, '@scope/acp')
  assert.equal(shadow.input.hint, '输入 /acp 查看压缩状态')

  const status = await env.controller.status({}, env.exec)
  assert.equal(status.commands.active, true)
  assert.equal(status.commands.translations.acp.zh, '【中文】Show bili context-compression status')
  assert.equal(status.commands.persisted.acp.engine, 'llm')
  assert.ok(status.details.some((line) => line.includes('/acp [command/agent] 中文')))

  const restored = await env.controller.restore({}, env.exec)
  assert.equal(restored.ok, true)
  assert.match(restored.summary, /命令描述已恢复英文/)
  assert.equal(commands.layers.get(agent).size, 0, 'restore 立即回英文')
  const restoredState = JSON.parse(env.fs.readText(env.stateFile))
  assert.ok(restoredState.commands.restoredAt)

  const reapplied = await env.controller.apply({}, env.exec)
  assert.equal(reapplied.ok, true)
  assert.equal(
    commands.layers.get(agent).get('acp').description,
    '【中文】Show bili context-compression status',
    'apply 直接重注册已知 agent',
  )
})

test('controller：hostVersion=unknown 时不误判升级、不删除影子', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup({ hostVersion: 'unknown' })
  await env.controller.apply({}, env.exec)
  assert.equal(env.fs.existsSync(path.join(env.shadowDir, '.skill-desc-zh.json')), true)
  const before = env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json'))
  const result = await env.controller.apply({}, env.exec)
  assert.equal(result.ok, true)
  assert.equal(env.fs.readText(path.join(env.shadowDir, '.skill-desc-zh.json')), before)
  assert.equal(env.readEvents().some((event) => event.action === 'host-version-heal'), false)
})

test('controller.status：启动期 degraded 相位在实时数据全部生效后自动纠偏为 active', async (t) => {
  if (!makeFrontmatter()) return t.skip('宿主 yaml 不可用')
  const env = setup({ engine: 'dictionary' })
  const applied = await env.controller.apply({}, env.exec)
  assert.equal(applied.ok, true, JSON.stringify(applied.warnings))
  assert.equal(applied.phase, 'degraded', 'dictionary 回退时应如实 degraded')

  // 模拟“后续一次成功的 LLM 翻译”：把 state 里两条技能的 engine 改成 llm。
  const state = JSON.parse(env.fs.readText(env.stateFile))
  for (const name of Object.keys(state.skills)) state.skills[name].engine = 'llm'
  env.fs.writeFileSync(env.stateFile, JSON.stringify(state))

  const status = await env.controller.status({}, env.exec)
  assert.equal(status.ok, true)
  assert.equal(status.phase, 'active', JSON.stringify(status.phaseReason))
  assert.match(status.summary, /phase=active/)
  const reconciled = env.readEvents().find((event) => event.action === 'phase-reconciled')
  assert.ok(reconciled, '应记录 phase-reconciled 事件')
  assert.equal(reconciled.to, 'active')
})

test('controller.status/doctor：暴露技能管理摘要与非强制技能管理检查', async () => {
  const { controller, exec } = setup()
  await controller.startup()
  const status = await controller.status({}, exec)
  assert.equal(status.ok, true)
  assert.ok(status.skillAdmin, 'status 应包含 skillAdmin 摘要')
  assert.ok(status.skillAdmin.sources?.user, '应报告用户技能根')
  assert.equal(typeof status.skillAdmin.counts?.total, 'number')
  assert.equal(typeof status.skillAdmin.disabledCount, 'number')
  assert.equal(typeof status.skillAdmin.trashCount, 'number')

  const doctor = await controller.doctor({}, exec)
  const byKey = new Map(doctor.checks.map((check) => [check.key, check]))
  for (const key of ['skill-admin', 'skill-roots', 'trash-restore']) {
    assert.ok(byKey.has(key), `doctor 应包含 ${key} 检查`)
    assert.equal(byKey.get(key).mandatory, false, `${key} 应为非强制检查`)
  }
  assert.equal(byKey.get('skill-admin').ok, true)
  assert.equal(byKey.get('skill-roots').ok, true)
})
