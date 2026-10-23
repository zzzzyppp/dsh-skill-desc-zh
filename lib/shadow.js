/**
 * L2 影子文件管理：把 agent-preset 技能整目录复制到项目级
 * <project>/.dsh/skills/<name>/，只替换 SKILL.md frontmatter 的 description。
 *
 * 设计约束（design §4.2 / §7）：
 *  - 目录内容原样复制（references/templates 等资源不丢）；
 *  - 写入前先放 `.skill-desc-zh.json` 标记；目标目录已存在但没有标记时绝不覆盖；
 *  - 替换 / 还原一律走 trash（废纸篓），没有永久删除；
 *  - 临时目录放在 `.dsh/` 下而不是 `.dsh/skills/` 下，避免被宿主扫描成技能。
 */

import { createHash } from 'node:crypto'
import fsDefault from 'node:fs'
import path from 'node:path'

export const MARKER_FILE = '.skill-desc-zh.json'
export const MARKER_PLUGIN = 'skill-desc-zh'
export const MARKER_SCHEMA = 1

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeReadJson(fs, file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function isDirectory(fs, dir) {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function copyTree(fs, source, destination, options = {}) {
  const skip = new Set(options.skip ?? [])
  const resources = []
  const copy = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true })
    let entries
    try {
      entries = fs.readdirSync(src)
    } catch (error) {
      throw new Error(`读取影子源目录失败 ${src}：${error instanceof Error ? error.message : String(error)}`)
    }
    for (const entry of entries) {
      if (skip.has(entry)) continue
      const from = path.join(src, entry)
      const to = path.join(dest, entry)
      let stat
      try {
        stat = fs.lstatSync ? fs.lstatSync(from) : fs.statSync(from)
      } catch {
        continue
      }
      if (typeof stat.isSymbolicLink === 'function' && stat.isSymbolicLink()) {
        // 资源里若有符号链接，复制链接本身而不是目标（避免把外部文件带进项目）。
        try {
          fs.symlinkSync(fs.readlinkSync(from), to)
          resources.push(path.relative(source, from))
        } catch {
          /* 平台不支持符号链接时跳过，不阻断主流程 */
        }
        continue
      }
      if (stat.isDirectory()) {
        copy(from, to)
      } else if (stat.isFile()) {
        fs.copyFileSync(from, to)
        resources.push(path.relative(source, from).split(path.sep).join('/'))
      }
    }
  }
  copy(source, destination)
  return resources.sort()
}

/**
 * @param {{
 *   paths: ReturnType<import('./paths.js').createPaths>,
 *   frontmatter: ReturnType<import('./host-yaml.js').createFrontmatter>,
 *   trash: ReturnType<import('./trash.js').createTrash>,
 *   fs?: typeof fsDefault,
 *   logger?: {warn?: Function, info?: Function},
 *   now?: () => Date,
 * }} options
 */
export function createShadows(options) {
  const paths = options.paths
  const frontmatter = options.frontmatter
  const trash = options.trash
  const fs = options.fs ?? fsDefault
  const logger = options.logger ?? {}
  const now = options.now ?? (() => new Date())

  function root(projectRoot) {
    return paths.projectDshDir(projectRoot)
  }

  function dirFor(projectRoot, name) {
    const skillsRoot = root(projectRoot)
    if (!skillsRoot) return undefined
    return path.join(skillsRoot, name)
  }

  /** 读取单个影子目录的标记与现状。 */
  function inspect(projectRoot, name) {
    const dir = dirFor(projectRoot, name)
    if (!dir) return { exists: false, marked: false, dir: undefined }
    if (!fs.existsSync(dir)) return { exists: false, marked: false, dir }
    if (!isDirectory(fs, dir)) {
      return { exists: true, marked: false, dir, conflict: '同名路径不是目录' }
    }
    const markerFile = path.join(dir, MARKER_FILE)
    const marker = safeReadJson(fs, markerFile)
    const marked = marker?.plugin === MARKER_PLUGIN && marker?.name === name && marker?.schemaVersion === MARKER_SCHEMA
    const skillMd = path.join(dir, 'SKILL.md')
    let shadowHash
    try {
      if (fs.existsSync(skillMd)) shadowHash = sha256(fs.readFileSync(skillMd, 'utf8'))
    } catch {
      shadowHash = undefined
    }
    return {
      exists: true,
      marked,
      dir,
      marker,
      markerFile,
      skillMd,
      shadowHash,
      sourceHash: marker?.sourceHash,
      stale: marked && Boolean(marker?.shadowHash) && Boolean(shadowHash) && marker.shadowHash !== shadowHash,
    }
  }

  function writeShadowFile(dir, markdown, marker) {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), markdown)
    fs.writeFileSync(path.join(dir, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`)
  }

  /**
   * 创建或更新一个影子目录（幂等）。
   * @param {{
   *   projectRoot: string,
   *   name: string,
   *   sourceDir: string,
   *   sourcePath?: string,
   *   description: string,
   *   sourceHash: string,
   *   enHash?: string,
   *   hostVersion?: string,
   *   force?: boolean,
   * }} input
   * @returns {{status: string, dir?: string, marker?: object, resources?: string[], reason?: string}}
   */
  function ensure(input) {
    const {
      projectRoot, name, sourceDir, sourcePath, description, sourceHash, enHash,
      hostVersion, force = false,
    } = input
    const skillsRoot = root(projectRoot)
    if (!skillsRoot) return { status: 'skipped', reason: '没有项目根，跳过项目级影子' }
    if (!sourceDir || !isDirectory(fs, sourceDir)) {
      return { status: 'error', reason: `源技能目录不存在：${sourceDir ?? '(undefined)'}` }
    }
    const skillFile = sourcePath ?? path.join(sourceDir, 'SKILL.md')
    let sourceRaw
    try {
      sourceRaw = fs.readFileSync(skillFile, 'utf8')
    } catch (error) {
      return { status: 'error', reason: `读取源 SKILL.md 失败：${error instanceof Error ? error.message : String(error)}` }
    }
    const rendered = frontmatter.renderDescription(sourceRaw, description)
    if (!rendered.ok) return { status: 'error', reason: rendered.reason }
    const shadowHash = sha256(rendered.markdown)
    const target = dirFor(projectRoot, name)
    const current = inspect(projectRoot, name)

    if (current.exists && !current.marked) {
      return {
        status: 'conflict',
        dir: target,
        reason: `目标 ${target} 已存在且没有 ${MARKER_FILE} 标记，拒绝覆盖用户技能`,
      }
    }
    if (
      current.exists && current.marked && !force
      && current.marker?.sourceHash === sourceHash
      && current.shadowHash === shadowHash
      && (!hostVersion || current.marker?.hostVersion === hostVersion)
    ) {
      return {
        status: 'unchanged',
        dir: target,
        marker: current.marker,
        resources: current.marker?.resources ?? [],
        shadowHash,
      }
    }

    let resources
    const tempRoot = path.join(projectRoot, '.dsh', `.skill-desc-zh-tmp`)
    const tempDir = path.join(tempRoot, `${name}.${process.pid}.${Date.now().toString(36)}`)
    try {
      fs.mkdirSync(tempDir, { recursive: true })
      resources = copyTree(fs, sourceDir, tempDir, { skip: ['SKILL.md', MARKER_FILE] })
      const createdAt = current.marker?.createdAt ?? now().toISOString()
      const marker = {
        schemaVersion: MARKER_SCHEMA,
        plugin: MARKER_PLUGIN,
        name,
        sourceDir,
        sourcePath: skillFile,
        sourceHash,
        ...(typeof enHash === 'string' ? { enHash } : {}),
        shadowHash,
        resources,
        hostVersion: hostVersion ?? paths.hostVersion(),
        createdAt,
        updatedAt: now().toISOString(),
      }
      writeShadowFile(tempDir, rendered.markdown, marker)

      fs.mkdirSync(skillsRoot, { recursive: true })
      if (current.exists) {
        const result = trash.trash([target])
        if (!result.ok) {
          trash.trash([tempDir])
          return {
            status: 'error',
            dir: target,
            reason: `旧影子目录移入废纸篓失败：${trashReason(result)}`,
          }
        }
      }
      try {
        fs.renameSync(tempDir, target)
      } catch (error) {
        // 目标可能被并发创建；不覆盖非标记目录。
        const after = inspect(projectRoot, name)
        trash.trash([tempDir])
        if (after.exists && !after.marked) {
          return { status: 'conflict', dir: target, reason: `目标 ${target} 已存在且没有标记，拒绝覆盖` }
        }
        return { status: 'error', dir: target, reason: `影子目录落位失败：${error instanceof Error ? error.message : String(error)}` }
      }
      return {
        status: current.exists ? 'replaced' : 'created',
        dir: target,
        marker,
        resources,
        shadowHash,
      }
    } catch (error) {
      try {
        if (fs.existsSync(tempDir)) trash.trash([tempDir])
      } catch {
        /* 清理失败不掩盖原始错误 */
      }
      return { status: 'error', dir: target, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  function trashReason(result) {
    const failed = result?.results?.find?.((item) => item.status === 'failed' || item.status === 'refused')
    return failed?.reason ?? result?.error ?? `退出码 ${result?.code ?? '未知'}`
  }

  /**
   * 还原一个项目里所有带本插件标记的影子目录；没有标记的目录绝不触碰。
   * @param {string} projectRoot
   * @param {{dryRun?: boolean, names?: string[]}} [opts]
   */
  function restoreProject(projectRoot, opts = {}) {
    const skillsRoot = root(projectRoot)
    const results = []
    if (!skillsRoot || !isDirectory(fs, skillsRoot)) {
      return { ok: true, results, note: '项目下没有 .dsh/skills，无需还原' }
    }
    let entries
    try {
      entries = fs.readdirSync(skillsRoot)
    } catch (error) {
      return { ok: false, results, error: `读取 ${skillsRoot} 失败：${error instanceof Error ? error.message : String(error)}` }
    }
    const only = Array.isArray(opts.names) && opts.names.length > 0 ? new Set(opts.names) : undefined
    const targets = []
    for (const name of entries) {
      if (only && !only.has(name)) continue
      const info = inspect(projectRoot, name)
      if (!info.exists || !info.marked) continue
      targets.push(info)
    }
    if (opts.dryRun) {
      return {
        ok: true,
        dryRun: true,
        results: targets.map((info) => ({ name: path.basename(info.dir), dir: info.dir, status: 'would-trash' })),
      }
    }
    if (targets.length === 0) return { ok: true, results, note: '没有本插件创建的影子目录' }
    const trashed = trash.trash(targets.map((info) => info.dir))
    const byDir = new Map((trashed.results ?? []).map((item) => [item.abs ?? item.target, item]))
    let ok = trashed.ok
    for (const info of targets) {
      const item = byDir.get(info.dir)
      if (item && item.status === 'trashed') {
        results.push({ name: path.basename(info.dir), dir: info.dir, status: 'trashed', to: item.to })
      } else if (item && item.status === 'skipped') {
        results.push({ name: path.basename(info.dir), dir: info.dir, status: 'skipped' })
      } else {
        ok = false
        results.push({
          name: path.basename(info.dir),
          dir: info.dir,
          status: 'failed',
          reason: item?.reason ?? trashReason(trashed),
        })
      }
    }
    return { ok, results, via: trashed.via }
  }

  /** 列出项目内所有影子（含未标记目录），用于 status/doctor。 */
  function list(projectRoot, names) {
    const skillsRoot = root(projectRoot)
    if (!skillsRoot || !isDirectory(fs, skillsRoot)) return []
    let entries
    try {
      entries = fs.readdirSync(skillsRoot)
    } catch {
      return []
    }
    const filter = Array.isArray(names) && names.length > 0 ? new Set(names) : undefined
    return entries
      .filter((name) => !filter || filter.has(name))
      .map((name) => ({ name, ...inspect(projectRoot, name) }))
      .filter((item) => item.exists)
  }

  /** 源技能目录里会被复制到影子的资源清单（只读）。 */
  function sourceResources(sourceDir) {
    if (!sourceDir || !isDirectory(fs, sourceDir)) return []
    const resources = []
    const walk = (dir) => {
      let entries
      try {
        entries = fs.readdirSync(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry === 'SKILL.md' || entry === MARKER_FILE) continue
        const file = path.join(dir, entry)
        let stat
        try {
          stat = fs.statSync(file)
        } catch {
          continue
        }
        if (stat.isDirectory()) walk(file)
        else resources.push(path.relative(sourceDir, file).split(path.sep).join('/'))
      }
    }
    walk(sourceDir)
    return resources.sort()
  }

  return {
    root,
    dirFor,
    inspect,
    ensure,
    restoreProject,
    list,
    sourceResources,
    MARKER_FILE,
    MARKER_PLUGIN,
  }
}
