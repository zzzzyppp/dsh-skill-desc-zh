/**
 * 可写技能文件层（v0.5 技能管理）。
 *
 * 安全边界：
 * - 只认两个根：`$HOME/.dsh/skills`（user）与 `<project>/.dsh/skills`（project）。
 *   项目根必须通过 isProjectAllowed（项目在 $HOME 下，或命中 projectAllowlist）。
 * - 目标名 kebab-case；目标真实路径必须落在根内，symlink 一律拒绝。
 * - 删除只走注入的 trash（lib/trash.js → trash.mjs）；覆盖前先 `trash.snapshot`。
 * - 删除/恢复记录只来自本插件 state，不扫描 ~/.Trash（TCC 下 readdir 会 EPERM）。
 */

import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import { isProjectAllowed } from './paths.js'
import {
  findDeletion,
  isDisabled,
  listDeletions,
  markRestored,
  recordDeletion,
} from './state.js'

export const KEBAB_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u
/** 每一段路径都不能是 `.`/`..`/隐藏目录。 */
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
])
const MAX_MARKDOWN_BYTES = 1024 * 1024
const MAX_ENTRIES = 2000
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024
const MAX_DEPTH = 8
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function isInside(child, parent) {
  if (typeof child !== 'string' || typeof parent !== 'string') return false
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function tryStat(fs, file) {
  try {
    return fs.statSync(file)
  } catch {
    return undefined
  }
}

function tryLstat(fs, file) {
  try {
    return fs.lstatSync(file)
  } catch {
    return undefined
  }
}

function tryRealpath(fs, file) {
  try {
    if (typeof fs.realpathSync === 'function') return fs.realpathSync(file)
  } catch {
    /* 不存在或平台不支持 */
  }
  return undefined
}

function validSegment(segment) {
  return SEGMENT_RE.test(segment) && segment !== '.' && segment !== '..'
}

/** 正文切片：优先空行/句子边界，均衡代码围栏；保留原文顺序，不丢内容。 */
export function chunkBody(body, maxChars = 12000) {
  const max = Number.isFinite(maxChars) && maxChars >= 64 ? Math.trunc(maxChars) : 12000
  if (typeof body !== 'string' || body.length <= max) return [body]
  const chunks = []
  let rest = body
  let fence = null
  while (rest.length > max) {
    let take = -1
    // 只在不处于围栏内时寻找边界，避免把代码块切断。
    const window = rest.slice(0, max)
    const lines = window.split('\n')
    let scanFence = fence
    let boundaryLine = -1
    let sentenceBoundary = -1
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const trimmed = line.trimStart()
      const marker = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : null
      if (scanFence) {
        if (marker === scanFence) scanFence = null
        continue
      }
      if (marker) {
        scanFence = marker
        continue
      }
      if (line.trim() === '' && index > 0) boundaryLine = index
      const match = /[。！？.!?](?=\s|$)/u.exec(line)
      if (match) sentenceBoundary = index
    }
    if (boundaryLine > 0) take = lines.slice(0, boundaryLine).join('\n').length + 1
    else if (sentenceBoundary >= 0) take = lines.slice(0, sentenceBoundary + 1).join('\n').length + 1
    else if (lines.length > 1) take = lines.slice(0, -1).join('\n').length + 1
    else take = max
    if (take <= 0) take = max
    let chunk = rest.slice(0, take)
    // 记录 chunk 结束时是否仍在围栏中；若是，补齐闭合并在下一段重开。
    const fenceState = fenceAfter(chunk, fence)
    if (fenceState) {
      chunk = `${chunk.replace(/\s*$/u, '')}\n${fenceState}\n`
      rest = `${fenceState}text\n${rest.slice(take)}`
      fence = null
    } else {
      rest = rest.slice(take)
      fence = null
    }
    chunks.push(chunk)
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}

function fenceAfter(text, initial = null) {
  let open = initial
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart()
    const marker = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : null
    if (!marker) continue
    if (!open) open = marker
    else if (open === marker) open = null
  }
  return open
}

/**
 * 单行 description：先尝试 YAML block scalar（literal），保持可读；失败退回 JSON 引号。
 * 锚点/别名/自定义 tag 一律失败关闭（D1）。
 */
export function renderEdit(frontmatter, raw, description, body) {
  if (typeof description !== 'string' || description.trim().length === 0) {
    return { ok: false, code: 'invalid-arguments', reason: 'description 不能为空' }
  }
  if (description.length > 4096) {
    return { ok: false, code: 'invalid-arguments', reason: 'description 过长' }
  }
  if (body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 200 * 1024)) {
    return { ok: false, code: 'too-large', reason: '正文超过 200KiB' }
  }
  const parsed = frontmatter.parse(raw)
  if (!parsed.ok) return { ok: false, code: 'unsupported-frontmatter', reason: parsed.reason }
  const yaml = frontmatter.yaml
  if (!yaml || typeof yaml.parseDocument !== 'function') {
    return { ok: false, code: 'internal', reason: '宿主 yaml 模块不可用' }
  }
  const match = FRONTMATTER.exec(raw)
  if (!match) return { ok: false, code: 'unsupported-frontmatter', reason: '缺少合法 frontmatter' }
  const frontmatterRaw = match[1]
  let doc
  try {
    doc = yaml.parseDocument(frontmatterRaw)
  } catch (error) {
    return { ok: false, code: 'unsupported-frontmatter', reason: `YAML 解析失败：${error?.message ?? error}` }
  }
  if (doc.errors && doc.errors.length > 0) {
    return { ok: false, code: 'unsupported-frontmatter', reason: 'frontmatter 含 YAML 错误' }
  }
  // description 使用锚点/别名、或被 alias 引用：拒绝编辑（只读）。
  const anchored = doc.anchors && typeof doc.anchors.has === 'function' && doc.anchors.has('description')
  const node = doc.get('description', true)
  const isAlias = Boolean(node && (node.type === 'ALIAS' || typeof node.anchor === 'string' && node.anchor.length > 0))
  if (anchored || isAlias) {
    return { ok: false, code: 'unsupported-frontmatter', reason: 'description 使用 YAML 锚点/别名，无法安全改写' }
  }
  const rendered = frontmatter.renderDescription(raw, description)
  if (!rendered.ok) {
    return { ok: false, code: 'unsupported-frontmatter', reason: rendered.reason }
  }
  let markdown = rendered.markdown
  if (body !== undefined) {
    // 只替换 frontmatter 之后的正文；分隔空行保持模板一致。
    const prefix = markdown.slice(0, markdown.length - parsed.bodyRaw.length)
    markdown = `${prefix}${body.startsWith('\n') ? '' : '\n'}${body}`
    const verify = frontmatter.parse(markdown)
    if (!verify.ok || verify.name !== parsed.name || verify.description !== description || verify.body !== body.trim()) {
      return { ok: false, code: 'unsupported-frontmatter', reason: '重写正文后校验失败' }
    }
  }
  return { ok: true, markdown, changed: markdown !== raw }
}

function renderNew(description) {
  const safe = JSON.stringify(description)
  return `---\nname: __NAME__\ndescription: ${safe}\n---\n\n`
}

/**
 * @param {{
 *   paths: object,
 *   frontmatter: object,
 *   trash: object,
 *   fs?: object,
 *   logger?: {debug?: Function, warn?: Function},
 *   now?: () => Date,
 *   state?: object,
 *   getState?: () => object,
 *   allowlist?: string[],
 * }} options
 */
export function createSkillFiles(options = {}) {
  const {
    paths,
    frontmatter,
    trash,
    fs,
    logger = {},
    now = () => new Date(),
    allowlist = [],
  } = options
  if (!paths) throw new TypeError('createSkillFiles: 缺少 paths')
  if (!frontmatter) throw new TypeError('createSkillFiles: 缺少 frontmatter')
  const fileSystem = fs ?? undefined
  const getState = typeof options.getState === 'function'
    ? options.getState
    : typeof options.state === 'object'
      ? () => options.state
      : () => undefined
  const home = paths.home
  const stateDir = paths.stateDir
  const trashDir = path.join(home, '.Trash')
  const userSkillsRoot = path.join(home, '.dsh', 'skills')
  const nowIso = () => now().toISOString()

  function projectAllowed(projectRoot) {
    if (!projectRoot) return { allowed: false, reason: '当前会话没有项目根' }
    if (isProjectAllowed(projectRoot, { home, allowlist, env: process.env })) {
      return { allowed: true, reason: null }
    }
    return {
      allowed: false,
      reason: '项目根不在 $HOME 下且未命中 projectAllowlist；为防越权只读展示',
    }
  }

  function roots(projectRoot) {
    const list = [
      {
        kind: 'user',
        root: userSkillsRoot,
        projectRoot: null,
        writable: true,
        reason: null,
      },
    ]
    if (projectRoot) {
      const permission = projectAllowed(projectRoot)
      list.push({
        kind: 'project',
        root: path.join(projectRoot, '.dsh', 'skills'),
        projectRoot,
        writable: permission.allowed,
        reason: permission.reason,
      })
    } else {
      list.push({
        kind: 'project',
        root: null,
        projectRoot: null,
        writable: false,
        reason: '当前会话没有项目根',
      })
    }
    return list
  }

  function writableRoot(scope, projectRoot) {
    if (scope === 'user') return roots(null)[0]
    if (!projectRoot) return { writable: false, reason: '当前会话没有项目根' }
    return roots(projectRoot).find((root) => root.kind === 'project')
  }

  function targetPath(scope, name, projectRoot) {
    const root = scope === 'project' ? writableRoot('project', projectRoot) : writableRoot('user', projectRoot)
    if (!root || !root.root) return null
    return { root, file: path.join(root.root, name, 'SKILL.md'), dir: path.join(root.root, name), flat: path.join(root.root, `${name}.md`) }
  }

  function assertSafePath(candidate, root, { allowSymlink = false } = {}) {
    if (!candidate || !root) return { ok: false, code: 'invalid-arguments', reason: '目标路径不合法' }
    const stat = tryLstat(fileSystem, candidate)
    if (!stat) return { ok: true }
    if (!allowSymlink && stat.isSymbolicLink?.()) {
      return { ok: false, code: 'invalid-target', reason: '目标为符号链接，拒绝操作' }
    }
    if (!isInside(candidate, root)) {
      return { ok: false, code: 'invalid-target', reason: '目标越过技能根目录' }
    }
    const real = tryRealpath(fileSystem, candidate)
    const realRoot = tryRealpath(fileSystem, root)
    if (real && realRoot && !isInside(real, realRoot)) {
      return { ok: false, code: 'invalid-target', reason: '目标真实路径越过技能根目录' }
    }
    if (isInside(candidate, stateDir) || isInside(candidate, trashDir)) {
      return { ok: false, code: 'invalid-target', reason: '目标位于受保护目录' }
    }
    return { ok: true }
  }

  /**
   * 只收集根层技能文档（F1）：
   * - `<root>/<name>/SKILL.md`
   * - `<root>/<name>.md`
   *
   * `references/`、`assets/` 等子目录里的 `.md` 是技能资源，不是技能行；
   * 这里不递归，保留条目预算与符号链接防护（只接受真实普通文件）。
   */
  function walkMarkdown(root) {
    const files = []
    let entries = 0
    // 根层扫描的深度固定为 0/1，仍受既有 MAX_DEPTH 预算约束。
    if (MAX_DEPTH < 1) return files
    let children
    try {
      children = fileSystem.readdirSync(root, { withFileTypes: true })
    } catch {
      return files
    }
    children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      entries += 1
      if (entries > MAX_ENTRIES) break
      if (child.name.startsWith('.')) continue
      if (child.isDirectory()) {
        if (EXCLUDED_DIRS.has(child.name)) continue
        // 只认一级技能目录下的 SKILL.md；不进入 references/assets。
        const skillFile = path.join(root, child.name, 'SKILL.md')
        let stat
        try {
          stat = fileSystem.lstatSync(skillFile)
        } catch {
          continue
        }
        if (stat.isFile() && !stat.isSymbolicLink?.()) files.push(skillFile)
      } else if (child.isFile() && child.name.endsWith('.md')) {
        files.push(path.join(root, child.name))
      }
    }
    return files
  }

  function nameFor(root, file) {
    const relative = path.relative(root, file).split(path.sep)
    if (relative.length === 0) return null
    const base = relative[relative.length - 1]
    if (base === 'SKILL.md') return relative.length === 2 ? relative[0] : relative[relative.length - 2]
    return base.slice(0, -3)
  }

  function readRaw(file) {
    let stat
    try {
      stat = fileSystem.statSync(file)
    } catch {
      return { ok: false, code: 'not-found', reason: `文件不存在：${file}` }
    }
    if (!stat.isFile()) return { ok: false, code: 'invalid-target', reason: '目标不是普通文件' }
    if (stat.size > MAX_MARKDOWN_BYTES) return { ok: false, code: 'too-large', reason: 'SKILL.md 超过 1MB，拒绝读取' }
    try {
      return { ok: true, raw: fileSystem.readFileSync(file, 'utf8'), size: stat.size, mtimeMs: stat.mtimeMs }
    } catch (error) {
      return { ok: false, code: 'internal', reason: `读取失败：${error?.message ?? error}` }
    }
  }

  function fromPath(file, scope, projectRoot, root) {
    const raw = readRaw(file)
    if (!raw.ok) return raw
    const parsed = frontmatter.parse(raw.raw)
    const dir = path.basename(file) === 'SKILL.md' ? path.dirname(file) : null
    const rootPath = typeof root === 'string' ? root : root?.root
    const rootWritable = typeof root === 'object' && root ? root.writable : undefined
    const relativePath = path.relative(rootPath, file).split(path.sep).join('/')
    if (!parsed.ok) {
      return {
        ok: false,
        code: 'broken-frontmatter',
        reason: parsed.reason,
        path: file,
        scope,
        projectRoot: scope === 'project' ? projectRoot : null,
        relativePath,
        raw: raw.raw,
        size: raw.size,
        mtimeMs: raw.mtimeMs,
      }
    }
    return {
      ok: true,
      scope,
      name: parsed.name,
      description: parsed.description,
      whenToUse: parsed.whenToUse,
      invocation: parsed.invocation,
      path: file,
      dir,
      relativePath,
      raw: raw.raw,
      body: parsed.body,
      bodyRaw: parsed.bodyRaw,
      frontmatter: parsed.frontmatter,
      size: raw.size,
      mtimeMs: raw.mtimeMs,
      writable: scope === 'user' ? true : Boolean(rootWritable),
      root: rootPath ?? null,
    }
  }

  function scan({ projectRoot } = {}) {
    const warnings = []
    const listed = []
    const byKey = new Map()
    for (const root of roots(projectRoot)) {
      if (!root.root) continue
      if (!tryStat(fileSystem, root.root)) continue
      let files = []
      try {
        files = walkMarkdown(root.root)
      } catch (error) {
        warnings.push(`扫描 ${root.root} 失败：${error?.message ?? error}`)
      }
      for (const file of files) {
        const name = nameFor(root.root, file)
        if (!name || !KEBAB_SKILL_NAME.test(name)) continue
        const key = `${root.kind}\u0000${root.projectRoot ?? ''}\u0000${name}`
        // 同一技能优先目录形式 SKILL.md（相对路径为 name/SKILL.md）。
        const relativePath = path.relative(root.root, file).split(path.sep).join('/')
        // F1：技能只能是根层 `<name>/SKILL.md` 或根层 `<name>.md`。
        if (relativePath !== `${name}/SKILL.md` && relativePath !== `${name}.md`) continue
        const previous = byKey.get(key)
        const prefer = relativePath === `${name}/SKILL.md`
        if (previous && !(prefer && previous.relativePath !== `${name}/SKILL.md`)) continue
        if (previous) listed.splice(listed.indexOf(previous), 1)
        const entry = { name, scope: root.kind, projectRoot: root.projectRoot, path: file, relativePath, writable: root.kind === 'user' ? true : root.writable }
        let parsed
        try {
          const raw = readRaw(file)
          if (!raw.ok) {
            entry.description = null
            entry.error = raw.reason
          } else {
            parsed = frontmatter.parse(raw.raw)
            if (!parsed.ok) {
              entry.description = null
              entry.error = parsed.reason
            } else {
              entry.description = parsed.description
              entry.whenToUse = parsed.whenToUse
              entry.path = file
              entry.parsedName = parsed.name
              if (parsed.name !== name) entry.error = `frontmatter name（${parsed.name}）与文件名不一致`
            }
          }
        } catch (error) {
          entry.description = null
          entry.error = error?.message ?? String(error)
        }
        entry.disabled = Boolean(getState() && isDisabled(getState(), { scope: root.kind, name, projectRoot: root.projectRoot }))
        byKey.set(key, entry)
        listed.push(entry)
      }
    }
    listed.sort((a, b) => `${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`))
    return { ok: true, skills: listed, roots: roots(projectRoot), warnings }
  }

  function readTarget({ scope, name, projectRoot } = {}) {
    if (scope !== 'user' && scope !== 'project') return { ok: false, code: 'invalid-arguments', reason: 'scope 不合法' }
    if (!KEBAB_SKILL_NAME.test(String(name ?? ''))) return { ok: false, code: 'invalid-arguments', reason: '技能名不合规' }
    const target = targetPath(scope, name, projectRoot)
    if (!target) return { ok: false, code: 'invalid-arguments', reason: '缺少项目根' }
    const { root } = target
    const candidates = [target.file, target.flat]
    for (const file of candidates) {
      if (!tryStat(fileSystem, file)) continue
      const safety = assertSafePath(file, root.root)
      if (!safety.ok) return safety
      return fromPath(file, scope, scope === 'project' ? projectRoot : null, root)
    }
    return { ok: false, code: 'not-found', reason: `技能 ${name} 不存在` }
  }

  function scanResources(rootDir) {
    const resources = []
    let total = 0
    let entries = 0
    const visit = (dir, depth, prefix) => {
      if (!dir || depth > MAX_DEPTH) return
      let children
      try {
        children = fileSystem.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      children.sort((a, b) => a.name.localeCompare(b.name))
      for (const child of children) {
        if (child.name.startsWith('.')) continue
        entries += 1
        if (entries > MAX_ENTRIES || total >= MAX_RESOURCE_BYTES) return
        const full = path.join(dir, child.name)
        const rel = prefix ? `${prefix}/${child.name}` : child.name
        if (rel === 'SKILL.md') continue
        if (child.isDirectory()) {
          resources.push({ path: rel, type: 'dir', bytes: 0 })
          visit(full, depth + 1, rel)
        } else if (child.isFile()) {
          const stat = tryStat(fileSystem, full)
          const bytes = stat && Number.isFinite(stat.size) ? stat.size : 0
          total += bytes
          resources.push({ path: rel, type: 'file', bytes })
        }
      }
    }
    visit(rootDir, 0, '')
    return { resources, totalBytes: total }
  }

  function detail({ scope, name, projectRoot } = {}) {
    const target = readTarget({ scope, name, projectRoot })
    if (!target.ok) return target
    const { resources, totalBytes } = target.dir ? scanResources(target.dir) : { resources: [], totalBytes: 0 }
    return {
      ok: true,
      skill: {
        name: target.name,
        description: target.description,
        whenToUse: target.whenToUse ?? null,
        scope: target.scope,
        projectRoot: target.projectRoot,
        path: target.path,
        relativePath: target.relativePath,
        body: target.body,
        size: target.size,
        mtimeMs: target.mtimeMs,
        writable: target.writable,
        disabled: Boolean(getState() && isDisabled(getState(), { scope: target.scope, name: target.name, projectRoot: target.projectRoot })),
      },
      resources,
      totalBytes,
    }
  }

  function fingerprint(target) {
    const body = typeof target?.body === 'string' ? target.body : ''
    return sha256(`${target?.description ?? ''}\u0000${body}\u0000${target?.relativePath ?? ''}`)
  }

  function fileFingerprint(file, relativePath = path.basename(file)) {
    const raw = readRaw(file)
    if (!raw.ok) return null
    const parsed = frontmatter.parse(raw.raw)
    if (!parsed.ok) return null
    return sha256(`${parsed.description}\u0000${parsed.body}\u0000${relativePath}`)
  }

  function writeAtomic(dir, file, content) {
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}.tmp`)
    try {
      fileSystem.writeFileSync(tmp, content, { mode: 0o600 })
      fileSystem.renameSync(tmp, file)
      return { ok: true }
    } catch (error) {
      try {
        if (tryStat(fileSystem, tmp)) trash?.trash?.([tmp])
      } catch {
        /* 清理失败不覆盖原始错误 */
      }
      return { ok: false, code: 'internal', reason: `写入失败：${error?.message ?? error}` }
    }
  }

  function create({ scope, name, description, body: bodyInput, projectRoot, args = {} } = {}) {
    if (scope !== 'user' && scope !== 'project') return { ok: false, code: 'invalid-arguments', reason: 'scope 不合法' }
    if (!KEBAB_SKILL_NAME.test(String(name ?? ''))) return { ok: false, code: 'invalid-arguments', reason: '技能名必须是 kebab-case' }
    if (typeof description !== 'string' || description.trim().length === 0) {
      return { ok: false, code: 'invalid-arguments', reason: 'description 不能为空' }
    }
    const target = targetPath(scope, name, projectRoot)
    if (!target) return { ok: false, code: 'invalid-arguments', reason: '缺少项目根' }
    const root = target.root
    if (!root?.writable) return { ok: false, code: 'not-writable', reason: root?.reason ?? '目标只读' }
    if (tryStat(fileSystem, target.dir) || tryStat(fileSystem, target.flat)) {
      return { ok: false, code: 'conflict', reason: `技能 ${name} 已存在` }
    }
    try {
      fileSystem.mkdirSync(target.dir, { recursive: true })
    } catch (error) {
      return { ok: false, code: 'internal', reason: `创建目录失败：${error?.message ?? error}` }
    }
    const body = typeof bodyInput === 'string' ? bodyInput : typeof args.body === 'string' ? args.body : ''
    const markdown = renderNew(description).replace('__NAME__', name) + body
    const written = writeAtomic(target.dir, target.file, markdown)
    if (!written.ok) {
      try {
        if (tryStat(fileSystem, target.dir)) trash?.trash?.([target.dir])
      } catch {
        /* ignore */
      }
      return written
    }
    const reread = readTarget({ scope, name, projectRoot })
    return {
      ok: true,
      created: true,
      skill: reread.ok ? { name: reread.name, description: reread.description, scope, projectRoot: scope === 'project' ? projectRoot : null, path: reread.path, relativePath: reread.relativePath } : null,
    }
  }

  function save({ scope, name, description, projectRoot, args = {} } = {}) {
    const target = readTarget({ scope, name, projectRoot })
    if (!target.ok) return target
    if (!target.writable) return { ok: false, code: 'not-writable', reason: '目标只读' }
    if (target.name !== name) {
      return { ok: false, code: 'invalid-target', reason: 'frontmatter name 与目录/文件名不一致，拒绝改写' }
    }
    const safety = assertSafePath(target.path, target.root)
    if (!safety.ok) return safety
    const currentFingerprint = fingerprint(target)
    const expectedRaw = typeof args.fingerprint === 'string' ? args.fingerprint : typeof args.expectedFingerprint === 'string' ? args.expectedFingerprint : null
    const expected = typeof expectedRaw === 'string' ? expectedRaw.replace(/^sha256:/u, '') : null
    if (expected && expected !== currentFingerprint) {
      return { ok: false, code: 'conflict', reason: '文件已被其他窗口修改，请刷新后重试', fingerprint: currentFingerprint }
    }
    const rendered = renderEdit(frontmatter, target.raw, description, typeof args.body === 'string' ? args.body : undefined)
    if (!rendered.ok) return rendered
    if (!rendered.changed) {
      return { ok: true, changed: false, fingerprint: currentFingerprint, skill: { name: target.name, description } }
    }
    if (!trash || typeof trash.snapshot !== 'function') {
      return { ok: false, code: 'trash-unavailable', reason: '废纸篓不可用，拒绝覆盖文件' }
    }
    try {
      const snapshot = trash.snapshot(target.path)
      if (snapshot && snapshot.ok === false) {
        return { ok: false, code: 'trash-unavailable', reason: `覆盖前留档失败：${snapshot.reason ?? '未知原因'}` }
      }
    } catch (error) {
      if (error?.code === 'ENOENT' && !tryStat(fileSystem, target.path)) return { ok: false, code: 'not-found' }
      return { ok: false, code: 'trash-unavailable', reason: `覆盖前留档失败：${error?.message ?? error}` }
    }
    const written = writeAtomic(path.dirname(target.path), target.path, rendered.markdown)
    if (!written.ok) return written
    const reread = readTarget({ scope, name, projectRoot })
    if (!reread.ok) return reread
    if (reread.description !== description) {
      return { ok: false, code: 'internal', reason: '写入后 description 校验失败' }
    }
    return { ok: true, changed: true, fingerprint: fingerprint(reread), skill: { name: reread.name, description: reread.description, scope, projectRoot: scope === 'project' ? projectRoot : null, path: reread.path } }
  }

  function deletionId() {
    return randomUUID()
  }

  function deleteSkill({ scope, name, projectRoot, dryRun = false } = {}) {
    const target = readTarget({ scope, name, projectRoot })
    if (!target.ok) return target
    if (!target.writable) return { ok: false, code: 'not-writable', reason: '目标只读' }
    const root = target.root
    const safety = assertSafePath(target.path, root)
    if (!safety.ok) return safety
    if (isInside(target.path, root) === false) return { ok: false, code: 'invalid-target', reason: '目标越过技能根目录' }
    const state = getState()
    if (!state) return { ok: false, code: 'internal', reason: '状态未加载' }
    if (!trash || typeof trash.trash !== 'function') {
      return { ok: false, code: 'trash-unavailable', reason: '废纸篓不可用，拒绝删除' }
    }
    const from = path.basename(target.path) === 'SKILL.md' ? target.dir : target.path
    const before = fingerprint(target)
    const walk = scanResources(target.dir)
    const size = (target.size ?? 0) + walk.totalBytes
    if (dryRun === true) {
      return {
        ok: true,
        dryRun: true,
        deletion: {
          id: 'dry-run',
          scope,
          name: target.name,
          projectRoot: scope === 'project' ? projectRoot : null,
          from,
          to: null,
          kind: path.basename(target.path) === 'SKILL.md' ? 'dir' : 'file',
          size,
          fingerprint: before,
          deletedAt: nowIso(),
        },
      }
    }
    let results
    try {
      results = trash.trash([from])
    } catch (error) {
      return { ok: false, code: 'trash-unavailable', reason: `移入废纸篓失败：${error?.message ?? error}` }
    }
    const rows = Array.isArray(results) ? results : results?.results ?? []
    const result = Array.isArray(rows) ? rows[0] : rows
    if (!result || (result.status !== 'trashed' && result.status !== 'dry-run' && result.status !== 'moved')) {
      return { ok: false, code: 'trash-unavailable', reason: `废纸篓拒绝删除：${result?.reason ?? '未知原因'}` }
    }
    const record = recordDeletion(state, {
      id: deletionId(),
      scope,
      name: target.name,
      projectRoot: scope === 'project' ? projectRoot : null,
      from,
      to: result.to ?? null,
      kind: path.basename(target.path) === 'SKILL.md' ? 'dir' : 'file',
      size,
      fingerprint: before,
      deletedAt: nowIso(),
    })
    return { ok: true, deleted: true, deletion: record, via: result.status }
  }

  function copyDirectory(source, destination) {
    const stat = tryStat(fileSystem, source)
    if (!stat) throw new Error(`源不存在：${source}`)
    if (stat.isDirectory()) {
      fileSystem.mkdirSync(destination, { recursive: true })
      for (const child of fileSystem.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, child.name)
        const to = path.join(destination, child.name)
        if (child.isDirectory()) copyDirectory(from, to)
        else if (child.isFile()) fileSystem.copyFileSync(from, to)
      }
    } else if (stat.isFile()) {
      fileSystem.copyFileSync(source, destination)
    } else {
      throw new Error('不支持的恢复目标类型')
    }
  }

  function restore({ id, scope, name, projectRoot, intent = 'move', dryRun = false } = {}) {
    const state = getState()
    if (!state) return { ok: false, code: 'internal', reason: '状态未加载' }
    const deletion = findDeletion(state, { id, scope, name, projectRoot })
    if (!deletion) return { ok: false, code: 'not-found', reason: '没有找到可恢复的删除记录' }
    if (deletion.restoredAt) return { ok: false, code: 'conflict', reason: '该条目已经恢复过' }
    if (!deletion.to) {
      return { ok: false, code: 'trash-unavailable', reason: '删除时未记录废纸篓路径，无法精确恢复' }
    }
    // 记录可能被篡改：from 必须落在登记的 user/project 技能根内，to 的 basename
    // 必须是该技能（废纸篓重名会加 “ 2” 后缀），避免把任意路径搬进技能根。
    const userRoot = path.join(paths.home, '.dsh', 'skills')
    const projectSkillsRoot = deletion.scope === 'project' && deletion.projectRoot
      ? path.join(deletion.projectRoot, '.dsh', 'skills')
      : null
    const fromRoot = deletion.scope === 'user' ? userRoot : projectSkillsRoot
    if (!fromRoot || !isInside(deletion.from, fromRoot) || isInside(deletion.from, stateDir) || isInside(deletion.from, trashDir)) {
      return { ok: false, code: 'invalid-target', reason: '删除记录的源路径不在允许的技能根内' }
    }
    const base = path.basename(deletion.from)
    const expectedBase = deletion.name
    const expectedFile = `${deletion.name}.md`
    if (!(base === expectedBase || base === expectedFile || base.startsWith(`${expectedBase} `) || base.startsWith(`${expectedFile} `))) {
      return { ok: false, code: 'invalid-target', reason: '删除记录与技能名不匹配' }
    }
    const existsFrom = tryStat(fileSystem, deletion.from)
    const existsTo = tryStat(fileSystem, deletion.to)
    // 关键安全点：先检查目标已存在（rename/copy 到已存在会覆盖）。
    if (existsFrom) return { ok: false, code: 'conflict', reason: '原位置已有同名文件/目录，拒绝覆盖' }
    if (!existsTo) return { ok: false, code: 'not-found', reason: '废纸篓中的条目已不存在' }
    if (dryRun) {
      return { ok: true, dryRun: true, id: deletion.id, from: deletion.to, to: deletion.from, via: 'move' }
    }
    try {
      if (intent !== 'copy') {
        fileSystem.mkdirSync(path.dirname(deletion.from), { recursive: true })
        try {
          fileSystem.renameSync(deletion.to, deletion.from)
        } catch (error) {
          if (error?.code === 'EXDEV') {
            return { ok: false, code: 'trash-unavailable', reason: '跨卷无法 rename，请用 Finder 手工恢复' }
          }
          throw error
        }
      } else {
        fileSystem.mkdirSync(path.dirname(deletion.from), { recursive: true })
        copyDirectory(deletion.to, deletion.from)
      }
      const verified = tryStat(fileSystem, deletion.from)
      if (!verified) throw new Error('恢复后目标不存在')
      markRestored(state, deletion.id, { now })
      return { ok: true, restored: true, id: deletion.id, from: deletion.to, to: deletion.from, via: intent === 'copy' ? 'copy' : 'move' }
    } catch (error) {
      return { ok: false, code: 'internal', reason: `恢复失败：${error?.message ?? error}` }
    }
  }

  return {
    roots,
    scan,
    readTarget,
    detail,
    renderEdit: (raw, description, body) => renderEdit(frontmatter, raw, description, body),
    create,
    save,
    delete: deleteSkill,
    restore,
    fingerprint,
    fileFingerprint,
    listDeletions: () => listDeletions(getState()),
    chunkBody,
    scanResources,
    isInside,
    targetPath,
    _internal: { nameFor, walkMarkdown, fromPath, renderNew },
  }
}
