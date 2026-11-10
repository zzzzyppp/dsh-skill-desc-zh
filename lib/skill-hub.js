/**
 * 技能索引：从 SkillHub 公共目录读取技能条目，并把选中的技能下载到
 * `$DSH_HOME/skills/<slug>/`。
 *
 * 约束：
 * - 只写用户级技能目录，不碰项目技能、插件包或 app.asar；
 * - 目录名必须是 kebab-case，文件路径必须落在目标目录内；
 * - 下载逐个校验 sha256 与大小，SKILL.md 必须能解析且 name 与目录一致；
 * - 覆盖已有同名技能前先走 trash.mjs 留档，绝不永久删除。
 */
import path from 'node:path'
import { createHash } from 'node:crypto'
import { toLosslessJson } from './plugin-admin.js'
import { KEBAB_SKILL_NAME } from './skill-files.js'

export const SKILL_HUB_BASE = 'https://api.skillhub.cn'
export const SKILL_HUB_SOURCE = {
  id: 'skillhub',
  name: 'SkillHub',
  homepage: 'https://skillhub.cn',
}

const MAX_FILES = 64
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

function failure(code, message, extra = {}) {
  return toLosslessJson({ ok: false, code, message, ...extra })
}

function safeRelativePath(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  if (raw.includes('\0')) return undefined
  const normalized = raw.replace(/\\/gu, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/u.test(normalized)) return undefined
  const parts = normalized.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return undefined
  return parts.join('/')
}

function text(value) {
  return typeof value === 'string' ? value : undefined
}

function pickTitle(item) {
  return text(item?.name) ?? text(item?.title) ?? text(item?.slug) ?? ''
}

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl]
 * @param {object} options.fs
 * @param {object} options.paths
 * @param {object} options.frontmatter
 * @param {object} options.trash
 * @param {object} [options.logger]
 */
export function createSkillHub({
  fetchImpl = globalThis.fetch,
  fs,
  paths,
  frontmatter,
  trash,
  logger = {},
  baseUrl = SKILL_HUB_BASE,
} = {}) {
  function rootDir() {
    return path.join(paths.dshHome, 'skills')
  }

  function endpoint(pathname, params = {}) {
    const url = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  async function fetchJson(pathname, params) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch 不可用')
    const response = await fetchImpl(endpoint(pathname, params), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async function fetchBytes(url) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch 不可用')
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: '*/*' },
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer
  }

  function available() {
    return typeof fetchImpl === 'function'
  }

  async function search({ text: keyword, page, pageSize } = {}) {
    if (!available()) return failure('fetch-unavailable', '当前宿主没有可用的 fetch')
    const pageNumber = Math.max(1, Math.trunc(Number(page) || 1))
    const size = Math.min(50, Math.max(1, Math.trunc(Number(pageSize) || 20)))
    try {
      const payload = await fetchJson('/api/skills', {
        page: pageNumber,
        pageSize: size,
        keyword: typeof keyword === 'string' ? keyword.trim().slice(0, 80) : '',
      })
      const data = payload?.data ?? payload
      const skills = Array.isArray(data?.skills) ? data.skills : []
      return toLosslessJson({
        ok: true,
        action: 'search',
        source: SKILL_HUB_SOURCE,
        page: pageNumber,
        pageSize: size,
        total: Number.isFinite(data?.total) ? data.total : undefined,
        entries: skills.slice(0, size).map((item) => ({
          slug: text(item?.slug),
          name: pickTitle(item),
          description: text(item?.description_zh) ?? text(item?.description),
          category: text(item?.category),
          downloads: Number.isFinite(item?.downloads) ? item.downloads : undefined,
          installs: Number.isFinite(item?.installs) ? item.installs : undefined,
          owner: text(item?.ownerName) ?? text(item?.publisher?.name),
        })),
      })
    } catch (error) {
      logger.warn?.(`skill-desc-zh: 技能索引搜索失败：${String(error?.message ?? error)}`)
      return failure('skillhub-failed', String(error?.message ?? error))
    }
  }

  async function detail(slug) {
    if (!KEBAB_SKILL_NAME.test(String(slug ?? ''))) {
      return failure('invalid-skill', '非法的技能标识')
    }
    try {
      const payload = await fetchJson(`/api/v1/skills/${encodeURIComponent(slug)}`)
      const data = payload?.data ?? payload
      return toLosslessJson({
        ok: true,
        action: 'detail',
        slug,
        name: text(data?.name) ?? slug,
        description: text(data?.description_zh) ?? text(data?.description),
        version: text(data?.latestVersion?.version),
        owner: text(data?.owner?.displayName) ?? text(data?.owner?.handle),
      })
    } catch (error) {
      return failure('skillhub-failed', String(error?.message ?? error), { slug })
    }
  }

  async function install({ slug, force = false } = {}) {
    const name = String(slug ?? '')
    if (!KEBAB_SKILL_NAME.test(name)) {
      return failure('invalid-skill', '技能标识必须是 kebab-case（a-z0-9-）')
    }
    const dir = path.join(rootDir(), name)
    if (!dir.startsWith(rootDir() + path.sep)) {
      return failure('invalid-target', '目标目录越界')
    }
    const existed = fs.existsSync(dir)
    if (existed && force !== true) {
      return failure('already-installed', `技能 ${name} 已存在；如需覆盖请勾选强制安装`, { slug: name })
    }
    let listing
    try {
      listing = await fetchJson(`/api/v1/skills/${encodeURIComponent(name)}/files`)
    } catch (error) {
      return failure('skillhub-failed', String(error?.message ?? error), { slug: name })
    }
    const files = Array.isArray(listing?.files) ? listing.files : []
    if (files.length === 0) return failure('empty-skill', '技能没有可下载的文件', { slug: name })
    if (files.length > MAX_FILES) return failure('too-large', '技能文件数量超过限制', { slug: name })
    const planned = []
    let total = 0
    for (const item of files) {
      const relative = safeRelativePath(item?.path)
      if (!relative) return failure('unsafe-path', '技能文件路径不安全', { slug: name, path: item?.path })
      const size = Number(item?.size)
      if (Number.isFinite(size) && size > MAX_FILE_BYTES) {
        return failure('too-large', '单个文件超过大小限制', { slug: name, path: relative })
      }
      total += Number.isFinite(size) ? size : 0
      planned.push({ path: relative, sha256: text(item?.sha256), size: Number.isFinite(size) ? size : undefined })
    }
    if (total > MAX_TOTAL_BYTES) {
      return failure('too-large', '技能总大小超过限制', { slug: name, bytes: total })
    }

    if (existed) {
      const moved = trash?.trash?.([dir])
      if (!moved || moved.ok !== true) {
        return failure('replace-failed', '已有同名技能无法移入废纸篓，已中止安装', {
          slug: name,
          reason: moved?.reason ?? moved?.error,
        })
      }
    }

    const tmp = path.join(rootDir(), `.sdzh-install-${name}-${Date.now().toString(36)}`)
    const created = []
    try {
      fs.mkdirSync(tmp, { recursive: true })
      let bytes = 0
      for (const item of planned) {
        const target = path.join(tmp, item.path)
        if (!target.startsWith(tmp + path.sep)) {
          throw Object.assign(new Error('文件路径越界'), { code: 'unsafe-path' })
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        const buffer = await fetchBytes(endpoint(`/api/v1/skills/${encodeURIComponent(name)}/file`, { path: item.path }))
        if (item.size !== undefined && buffer.length !== item.size) {
          throw Object.assign(new Error(`文件大小不符：${item.path}`), { code: 'size-mismatch' })
        }
        if (typeof item.sha256 === 'string' && item.sha256.length > 0) {
          const digest = createHash('sha256').update(buffer).digest('hex')
          if (digest !== item.sha256.toLowerCase()) {
            throw Object.assign(new Error(`校验和不符：${item.path}`), { code: 'checksum-mismatch' })
          }
        }
        fs.writeFileSync(target, buffer)
        created.push(target)
        bytes += buffer.length
      }
      const skillFile = path.join(tmp, 'SKILL.md')
      if (!fs.existsSync(skillFile)) {
        throw Object.assign(new Error('缺少 SKILL.md'), { code: 'missing-skill-file' })
      }
      const parsed = frontmatter?.parse?.(fs.readFileSync(skillFile, 'utf8'))
      if (!parsed || parsed.ok !== true) {
        throw Object.assign(new Error(`SKILL.md 无法解析：${parsed?.reason ?? '未知原因'}`), { code: 'invalid-skill-file' })
      }
      if (parsed.name !== name) {
        throw Object.assign(new Error(`SKILL.md 的 name（${parsed.name}）与目录（${name}）不一致`), { code: 'name-mismatch' })
      }
      fs.renameSync(tmp, dir)
      return toLosslessJson({
        ok: true,
        action: 'install',
        slug: name,
        name: parsed.name,
        description: parsed.description,
        dir,
        files: created.length,
        bytes,
        replaced: existed,
        source: SKILL_HUB_SOURCE,
      })
    } catch (error) {
      if (fs.existsSync(tmp)) trash?.trash?.([tmp])
      return failure(error?.code ?? 'install-failed', String(error?.message ?? error), { slug: name })
    }
  }

  return {
    available,
    rootDir,
    search,
    detail,
    install,
    source: SKILL_HUB_SOURCE,
  }
}
