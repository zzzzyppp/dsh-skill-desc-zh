/**
 * 单测用的内存文件系统（同步 API 子集）。
 *
 * 只实现插件实际用到的 node:fs 方法，行为足够贴近真实文件系统：
 * 目录/文件、递归 mkdir、目录 rename、copyFile、symlink、append、mode。
 * 不实现删除（插件本身也不允许删除，删除必须走废纸篓）。
 */

import path from 'node:path'

function normalize(target) {
  if (typeof target !== 'string' || target.length === 0) {
    throw new TypeError(`memfs: 非法路径 ${String(target)}`)
  }
  return path.normalize(path.resolve(target))
}

function makeStat(node) {
  return {
    size: node.type === 'file' ? Buffer.byteLength(String(node.content)) : 0,
    mtimeMs: node.mtimeMs,
    mode: node.mode ?? (node.type === 'dir' ? 0o755 : 0o644),
    isFile: () => node.type === 'file',
    isDirectory: () => node.type === 'dir',
    isSymbolicLink: () => node.type === 'symlink',
  }
}

export function createMemfs({ cwd = process.cwd(), now = () => 1_700_000_000_000 } = {}) {
  const base = normalize(cwd)
  const nodes = new Map()
  nodes.set('/', { type: 'dir', mtimeMs: now() })
  nodes.set(base, { type: 'dir', mtimeMs: now() })

  const exists = (target) => nodes.has(normalize(target))

  function get(target) {
    return nodes.get(normalize(target))
  }

  function requireNode(target) {
    const key = normalize(target)
    const node = nodes.get(key)
    if (!node) {
      const error = new Error(`ENOENT: no such file or directory, '${key}'`)
      error.code = 'ENOENT'
      throw error
    }
    return { key, node }
  }

  function ensureParent(target) {
    const key = normalize(target)
    const parent = path.dirname(key)
    if (!nodes.has(parent)) {
      mkdirSync(parent, { recursive: true })
    }
    if (nodes.get(parent)?.type !== 'dir') {
      const error = new Error(`ENOTDIR: not a directory, '${parent}'`)
      error.code = 'ENOTDIR'
      throw error
    }
  }

  function mkdirSync(target, options = {}) {
    const key = normalize(target)
    if (nodes.has(key)) {
      if (options.recursive && nodes.get(key).type === 'dir') return undefined
      const error = new Error(`EEXIST: file already exists, '${key}'`)
      error.code = 'EEXIST'
      throw error
    }
    if (options.recursive) {
      const parts = []
      let cursor = key
      while (!nodes.has(cursor)) {
        parts.unshift(cursor)
        const parent = path.dirname(cursor)
        if (parent === cursor) break
        cursor = parent
      }
      for (const dir of parts) {
        if (!nodes.has(dir)) nodes.set(dir, { type: 'dir', mtimeMs: now() })
      }
      return undefined
    }
    ensureParent(key)
    nodes.set(key, { type: 'dir', mtimeMs: now() })
    return undefined
  }

  function readdirSync(target, options = {}) {
    const { key } = requireNode(target)
    const prefix = key === '/' ? '/' : `${key}/`
    const names = new Set()
    for (const entry of nodes.keys()) {
      if (!entry.startsWith(prefix) || entry === key) continue
      const rest = entry.slice(prefix.length)
      const first = rest.split('/')[0]
      if (first) names.add(first)
    }
    const list = [...names].sort()
    if (options?.withFileTypes !== true) return list
    return list.map((name) => {
      const node = nodes.get(path.join(key, name))
      const type = node?.type ?? 'file'
      return {
        name,
        isFile: () => type === 'file',
        isDirectory: () => type === 'dir',
        isSymbolicLink: () => type === 'symlink',
      }
    })
  }

  function readFileSync(target, encoding) {
    const { node } = requireNode(target)
    if (node.type === 'dir') {
      const error = new Error(`EISDIR: illegal operation on a directory, read '${target}'`)
      error.code = 'EISDIR'
      throw error
    }
    if (node.type === 'symlink') {
      return readFileSync(node.link, encoding)
    }
    return encoding ? String(node.content) : Buffer.from(String(node.content))
  }

  function writeFileSync(target, data, options = {}) {
    const key = normalize(target)
    if (nodes.get(key)?.type === 'dir') {
      const error = new Error(`EISDIR: illegal operation on a directory, '${key}'`)
      error.code = 'EISDIR'
      throw error
    }
    const parent = path.dirname(key)
    if (!nodes.has(parent)) {
      if (options.recursive) mkdirSync(parent, { recursive: true })
      else {
        const error = new Error(`ENOENT: no such file or directory, open '${key}'`)
        error.code = 'ENOENT'
        throw error
      }
    }
    nodes.set(key, {
      type: 'file',
      content: String(data),
      mtimeMs: now(),
      mode: options.mode ?? nodes.get(key)?.mode ?? 0o644,
    })
  }

  function appendFileSync(target, data) {
    const key = normalize(target)
    const current = nodes.get(key)
    writeFileSync(key, current ? `${current.content}${String(data)}` : String(data))
  }

  function statSync(target) {
    const { node } = requireNode(target)
    if (node.type === 'symlink') {
      const { node: linked } = requireNode(node.link)
      return makeStat(linked)
    }
    return makeStat(node)
  }

  function lstatSync(target) {
    const { node } = requireNode(target)
    return makeStat(node)
  }

  function copyFileSync(from, to) {
    const { node } = requireNode(from)
    if (node.type !== 'file') throw new Error(`EINVAL: copyFile source is not a file '${from}'`)
    writeFileSync(to, node.content)
  }

  function renameSync(from, to) {
    const source = normalize(from)
    const destination = normalize(to)
    const { node } = requireNode(source)
    if (nodes.has(destination)) {
      const existing = nodes.get(destination)
      // 模拟 POSIX rename：文件可原子覆盖文件；目录目标一律失败。
      if (existing.type === 'file' && node.type === 'file') {
        nodes.delete(destination)
      } else {
        const error = new Error(`EEXIST: rename target exists, '${destination}'`)
        error.code = 'EEXIST'
        throw error
      }
    }
    ensureParent(destination)
    const moves = [[source, destination]]
    if (node.type === 'dir') {
      const prefix = `${source}/`
      for (const key of [...nodes.keys()]) {
        if (key.startsWith(prefix)) moves.push([key, `${destination}${key.slice(source.length)}`])
      }
    }
    for (const [oldKey, newKey] of moves) {
      const value = nodes.get(oldKey)
      nodes.delete(oldKey)
      nodes.set(newKey, value)
    }
    node.mtimeMs = now()
  }

  function symlinkSync(linkTarget, linkPath) {
    const key = normalize(linkPath)
    ensureParent(key)
    const resolved = path.isAbsolute(linkTarget)
      ? normalize(linkTarget)
      : normalize(path.join(path.dirname(key), linkTarget))
    nodes.set(key, { type: 'symlink', link: resolved, mtimeMs: now() })
  }

  function readlinkSync(target) {
    const { node } = requireNode(target)
    if (node.type !== 'symlink') throw new Error(`EINVAL: not a symbolic link '${target}'`)
    return node.link
  }

  function chmodSync(target, mode) {
    const { node } = requireNode(target)
    node.mode = mode
  }

  return {
    base,
    nodes,
    existsSync: exists,
    statSync,
    lstatSync,
    readdirSync,
    readFileSync,
    writeFileSync,
    appendFileSync,
    mkdirSync,
    copyFileSync,
    renameSync,
    symlinkSync,
    readlinkSync,
    chmodSync,
    /** 测试辅助：直接写入多级目录/文件。 */
    seed(entries) {
      for (const [target, content] of Object.entries(entries)) {
        if (content === null) mkdirSync(target, { recursive: true })
        else {
          mkdirSync(path.dirname(normalize(target)), { recursive: true })
          writeFileSync(target, content)
        }
      }
      return this
    },
    readText(target) {
      return readFileSync(target, 'utf8')
    },
    list(target) {
      return readdirSync(target)
    },
    dump() {
      return [...nodes.keys()].sort().map((key) => `${key}${nodes.get(key).type === 'dir' ? '/' : ''}`)
    },
  }
}

export const SKILL_MD = (description, { name = 'demo-skill', body = '# Demo\n\n正文内容。\n', extra = '' } = {}) => [
  '---',
  `name: ${name}`,
  extra,
  `description: ${JSON.stringify(description)}`,
  'metadata:',
  '  author: test',
  '---',
  '',
  body,
].filter((line) => line !== '').join('\n')
