/** 单测共享夹具：宿主 yaml、memfs 路径对象、假 trash/translate/服务。 */

import path from 'node:path'

import { createFrontmatter, loadHostYaml } from '../../lib/host-yaml.js'
import { createMemfs } from './memfs.mjs'

export const HOME = '/Users/tester'
export const PROJECT = '/Users/tester/work/proj'
export const OFFICE_DIR = '/Applications/DSH/runtime/office-skills'
export const PRESET_DIR = '/Applications/DSH/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills'

const loaded = loadHostYaml()
export const YAML = loaded.yaml
export const YAML_PATH = loaded.path

export function makeFrontmatter(fs) {
  return YAML ? createFrontmatter({ yaml: YAML, ...(fs ? { fs } : {}) }) : undefined
}

export function makePaths(overrides = {}) {
  const hostVersion = overrides.hostVersion ?? (() => '0.2.1-rc.2')
  return {
    home: HOME,
    dshHome: path.join(HOME, '.dsh'),
    profile: 'desktop',
    resourcesPath: '/Applications/DSH/Resources',
    isElectron: false,
    execPath: '/usr/local/bin/node',
    stateDir: path.join(HOME, '.dsh', '.skill-desc-zh'),
    stateFile: path.join(HOME, '.dsh', '.skill-desc-zh', 'state.json'),
    projectDshDir: (root) => (root ? path.join(root, '.dsh', 'skills') : undefined),
    hostVersion,
    presetSkillsDir: () => PRESET_DIR,
    officeSkillsDir: () => OFFICE_DIR,
    trashScript: () => undefined,
    nodeBin: () => '/usr/local/bin/node',
    candidates: { preset: [PRESET_DIR], office: [OFFICE_DIR], node: [], trash: [] },
    ...overrides,
  }
}

/** 一个把目标 rename 到 /Trash 的假废纸篓，行为与真实 trash.mjs 的“移走”一致。 */
export function createFakeTrash(fs, { root = '/Trash', fail = false } = {}) {
  const calls = []
  let seq = 0
  return {
    calls,
    available: () => true,
    trash(targets, opts = {}) {
      const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean)
      calls.push({ targets: list, dryRun: Boolean(opts.dryRun) })
      const results = []
      for (const target of list) {
        if (!fs.existsSync(target)) {
          results.push({ target, abs: target, status: 'skipped' })
          continue
        }
        if (fail) {
          results.push({ target, abs: target, status: 'failed', reason: '测试注入失败' })
          continue
        }
        if (opts.dryRun) {
          results.push({ target, abs: target, status: 'would-trash' })
          continue
        }
        fs.mkdirSync(root, { recursive: true })
        const destination = path.join(root, `${path.basename(target)}-${seq++}`)
        fs.renameSync(target, destination)
        results.push({ target, abs: target, status: 'trashed', to: destination })
      }
      return { ok: !results.some((item) => item.status === 'failed'), code: 0, results, via: 'fake' }
    },
    snapshot(file) {
      calls.push({ snapshot: file })
      return { ok: true, via: 'fake' }
    },
  }
}

/** 确定性翻译：英文 → “【中文】原文”，支持引擎/失败注入。 */
export function createFakeTranslate(options = {}) {
  const calls = []
  let failures = options.failures ?? 0
  const fn = async (input) => {
    calls.push(input)
    if (failures > 0) {
      failures -= 1
      throw new Error('注入的翻译失败')
    }
    const results = {}
    const cache = { ...(input.cache ?? {}) }
    const counts = { llm: 0, dictionary: 0, source: 0, none: 0 }
    for (const item of input.items ?? []) {
      const engine = options.engine ?? 'llm'
      const zh = engine === 'none' ? null : `【中文】${item.description}`
      results[item.name] = {
        name: item.name,
        en: item.description,
        zh,
        text: zh ?? item.description,
        engine,
        fingerprint: item.fingerprint,
        cached: false,
      }
      if (zh) {
        counts[engine] += 1
        if (engine === 'llm' && options.cache !== false) {
          cache[item.fingerprint] = {
            zh,
            engine: 'llm',
            model: 'test/model',
            translatedAt: new Date().toISOString(),
            enHash: item.fingerprint,
          }
        }
      } else counts.none += 1
    }
    return { results, translations: {}, cache, warnings: [], counts, engine: options.engine ?? 'llm' }
  }
  fn.calls = calls
  return fn
}

/** 构造 office 技能定义（skills.get 返回值）。 */
export function officeDefinition(name, description, { content, resourceBase } = {}) {
  return {
    name,
    description,
    content: content ?? `# ${name}\n\n正文 ${name}`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: 'dsh-office',
    resourceBase: resourceBase ?? { kind: 'directory', path: path.join(OFFICE_DIR, name) },
    path: path.join(OFFICE_DIR, name, 'SKILL.md'),
  }
}

/** 构造一个最小工作目录的 memfs。 */
export function makeProjectFs({ cwd = PROJECT } = {}) {
  const fs = createMemfs({ cwd })
  fs.seed({ [path.join(cwd, '.git')]: null })
  return fs
}

export { path }
