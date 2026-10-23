/**
 * SKILL.md frontmatter 解析与“只替换 description”的定点重写。
 *
 * 解析固定使用宿主自带的 `yaml`（与 dsh-skill-filesystem / dsh-skill-office 同一个库），
 * 避免另造一套 YAML 方言。重写不是重新序列化整个 frontmatter：利用 yaml 的
 * node.range 只替换 description 标量的字节区间，其余字段、注释和正文逐字保留。
 * 任何无法安全重写的情况都失败关闭（由调用方保留英文），绝不输出半成品 SKILL.md。
 */

import fsDefault from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

function safeExists(fs, file) {
  try {
    return fs.existsSync(file)
  } catch {
    return false
  }
}

function safeReadJson(fs, file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 找到宿主的 yaml 模块（CJS）。候选顺序：显式覆盖 → app.asar 内宿主依赖
 * → 当前 profile 的 node_modules → 任意 profile → 本插件自身依赖。
 * @returns {{ yaml?: object, path?: string, error?: string }}
 */
export function loadHostYaml(options = {}) {
  const env = options.env ?? process.env
  const fs = options.fs ?? fsDefault
  const home = options.home ?? os.homedir()
  const dshHome = options.dshHome ?? (env.DSH_HOME || path.join(home, '.dsh'))
  const resourcesPath = options.resourcesPath
    ?? (typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined)
  const require = createRequire(import.meta.url)

  const candidates = []
  if (typeof env.DSH_SKILL_DESC_ZH_YAML === 'string' && env.DSH_SKILL_DESC_ZH_YAML.length > 0) {
    candidates.push(env.DSH_SKILL_DESC_ZH_YAML)
  }
  if (resourcesPath) {
    candidates.push(
      path.join(resourcesPath, 'app.asar', 'dsh', 'node_modules', 'yaml'),
      path.join(resourcesPath, 'app.asar', 'node_modules', 'yaml'),
      path.join(resourcesPath, 'app', 'node_modules', 'yaml'),
    )
  }
  try {
    candidates.push(require.resolve('yaml'))
  } catch {
    /* 插件自身没有依赖 yaml，正常 */
  }
  const profilesDir = path.join(dshHome, 'profiles')
  try {
    for (const entry of fs.readdirSync(profilesDir)) {
      candidates.push(path.join(profilesDir, entry, 'node_modules', 'yaml'))
    }
  } catch {
    /* 没有 profiles 目录 */
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    let resolved = candidate
    try {
      if (safeExists(fs, path.join(candidate, 'package.json'))) {
        const pkg = safeReadJson(fs, path.join(candidate, 'package.json'))
        const main = typeof pkg?.main === 'string' ? pkg.main : 'dist/index.js'
        resolved = path.join(candidate, main)
      }
    } catch {
      /* 继续用原路径 require */
    }
    try {
      const mod = require(resolved)
      const yaml = mod?.default && typeof mod.default.parseDocument === 'function' ? mod.default : mod
      if (yaml && typeof yaml.parseDocument === 'function' && typeof yaml.parse === 'function') {
        return { yaml, path: resolved }
      }
    } catch {
      /* 该候选不可用，继续 */
    }
  }
  return {
    error: '无法加载宿主的 yaml 模块（尝试过 app.asar、profile node_modules 与本插件依赖）',
  }
}

function describeYamlError(error) {
  if (!error) return 'unknown yaml error'
  if (Array.isArray(error)) return error.map((item) => item?.message ?? String(item)).join('; ')
  return error.message ?? String(error)
}

/**
 * @param {{ yaml?: object, loadYaml?: () => {yaml?: object, path?: string, error?: string}, fs?: typeof fsDefault }} [options]
 */
export function createFrontmatter(options = {}) {
  const fs = options.fs ?? fsDefault
  let loaded = options.yaml ? { yaml: options.yaml, path: '<injected>' } : undefined
  let loadError
  const ensure = () => {
    if (loaded) return loaded
    try {
      loaded = options.loadYaml ? options.loadYaml() : loadHostYaml({ fs })
    } catch (error) {
      loaded = { error: error instanceof Error ? error.message : String(error) }
    }
    if (!loaded.yaml) loadError = loaded.error ?? 'yaml unavailable'
    return loaded
  }

  const available = () => Boolean(ensure().yaml)
  const yamlPath = () => ensure().path

  /**
   * 解析 SKILL.md 文本。
   * @returns {{ok: true, name: string, description: string, whenToUse?: string,
   *   invocation?: object, metadata?: object, frontmatter: object, frontmatterRaw: string,
   *   body: string, bodyRaw: string, raw: string} | {ok: false, reason: string}}
   */
  function parse(raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return { ok: false, reason: 'SKILL.md 为空或不是文本' }
    }
    const loaded = ensure()
    if (!loaded.yaml) {
      return { ok: false, reason: loadError ?? 'yaml 模块不可用' }
    }
    const match = FRONTMATTER.exec(raw)
    if (!match) return { ok: false, reason: '缺少合法的 YAML frontmatter（首行必须是 ---）' }
    const frontmatterRaw = match[1]
    let doc
    try {
      doc = loaded.yaml.parseDocument(frontmatterRaw)
    } catch (error) {
      return { ok: false, reason: `frontmatter YAML 解析失败：${describeYamlError(error)}` }
    }
    if (doc.errors && doc.errors.length > 0) {
      return { ok: false, reason: `frontmatter YAML 解析失败：${describeYamlError(doc.errors)}` }
    }
    let data
    try {
      data = doc.toJS()
    } catch (error) {
      return { ok: false, reason: `frontmatter 转换失败：${describeYamlError(error)}` }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'frontmatter 必须是 YAML 映射' }
    }
    const name = data.name
    const description = data.description
    if (typeof name !== 'string' || name.length === 0) {
      return { ok: false, reason: 'frontmatter 缺少非空 name' }
    }
    if (typeof description !== 'string' || description.length === 0) {
      return { ok: false, reason: 'frontmatter 缺少非空 description' }
    }
    const bodyRaw = raw.slice(match[0].length)
    const result = {
      ok: true,
      name,
      description,
      invocation: data.invocation,
      metadata: data.metadata,
      frontmatter: data,
      frontmatterRaw,
      body: bodyRaw.trim(),
      bodyRaw,
      raw,
    }
    if (typeof data.whenToUse === 'string') result.whenToUse = data.whenToUse
    return result
  }

  function readSkillFile(file) {
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (error) {
      return { ok: false, reason: `无法读取 ${file}：${error instanceof Error ? error.message : String(error)}` }
    }
    const parsed = parse(raw)
    if (!parsed.ok) return { ...parsed, file }
    return { ...parsed, file }
  }

  /**
   * 仅替换 frontmatter 的 description 标量，正文与其它字段逐字保留。
   * @returns {{ok: true, markdown: string, changed: boolean} | {ok: false, reason: string}}
   */
  function renderDescription(raw, description) {
    if (typeof description !== 'string' || description.length === 0) {
      return { ok: false, reason: '译文为空，拒绝写入影子文件' }
    }
    const parsed = parse(raw)
    if (!parsed.ok) return parsed
    const loaded = ensure()
    if (!loaded.yaml) return { ok: false, reason: loadError ?? 'yaml 模块不可用' }
    const match = FRONTMATTER.exec(raw)
    const frontmatterRaw = match[1]
    const prefix = raw.slice(0, match[0].indexOf(frontmatterRaw))
    const closing = raw.slice(prefix.length + frontmatterRaw.length, match[0].length)
    const bodyRaw = raw.slice(match[0].length)

    let doc
    try {
      doc = loaded.yaml.parseDocument(frontmatterRaw)
    } catch (error) {
      return { ok: false, reason: `frontmatter YAML 解析失败：${describeYamlError(error)}` }
    }
    if (doc.errors && doc.errors.length > 0) {
      return { ok: false, reason: `frontmatter YAML 解析失败：${describeYamlError(doc.errors)}` }
    }
    const node = doc.get('description', true)
    let nextFrontmatter
    if (node && Array.isArray(node.range) && typeof node.range[0] === 'number') {
      const [start, end] = node.range
      const original = frontmatterRaw.slice(start, end)
      // block scalar 的 range 会吞掉值末尾的换行；补回去，避免与下一行粘连。
      const newline = original.endsWith('\r\n') ? '\r\n' : original.endsWith('\n') ? '\n' : ''
      nextFrontmatter = `${frontmatterRaw.slice(0, start)}${JSON.stringify(description)}${newline}${frontmatterRaw.slice(end)}`
    } else {
      // 没有 description 节点时才退回整段序列化；目标技能都走不到这里。
      try {
        doc.set('description', description)
        nextFrontmatter = String(doc.toString({ lineWidth: 0 }))
      } catch (error) {
        return { ok: false, reason: `无法写入 description：${describeYamlError(error)}` }
      }
      if (nextFrontmatter.endsWith('\n')) nextFrontmatter = nextFrontmatter.slice(0, -1)
    }

    const markdown = `${prefix}${nextFrontmatter}${closing}${bodyRaw}`
    const verify = parse(markdown)
    if (!verify.ok) {
      return { ok: false, reason: `重写后的 SKILL.md 校验失败：${verify.reason}` }
    }
    if (verify.name !== parsed.name) {
      return { ok: false, reason: '重写 name 后发生变化，拒绝写入' }
    }
    if (verify.description !== description) {
      return { ok: false, reason: '重写后的 description 与译文不一致，拒绝写入' }
    }
    if (verify.bodyRaw !== parsed.bodyRaw) {
      return { ok: false, reason: '重写改动到了正文，拒绝写入' }
    }
    return { ok: true, markdown, changed: markdown !== raw }
  }

  return {
    available,
    yamlPath,
    /** 原始 yaml 模块（供 skill-files 做锚点/别名检测；不可用时为 undefined）。 */
    get yaml() {
      return ensure().yaml
    },
    parse,
    readSkillFile,
    renderDescription,
    /** 兼容别名：调用方可读成 replaceDescription。 */
    replaceDescription: renderDescription,
  }
}
