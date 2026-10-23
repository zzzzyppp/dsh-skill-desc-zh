/**
 * 插件状态：$DSH_HOME/.skill-desc-zh/state.json。
 *
 * - 原子写：同目录临时文件 + rename（避免半截 JSON）；
 * - 覆盖前用 trash.snapshot() 留档；
 * - 损坏的状态文件只告警并回退为空状态，不删除原文件；
 * - 所有记录都是可重建的缓存/元数据，源技能文件永不在此修改。
 */

import fsDefault from 'node:fs'
import path from 'node:path'

export const STATE_VERSION = 3
export const MAX_HISTORY = 50
export const MAX_DELETIONS = 200

const KEBAB = /^[a-z0-9][a-z0-9-]{0,63}$/u

function absolutePath(value) {
  return typeof value === 'string' && path.isAbsolute(value) ? path.resolve(value) : null
}

function isoOr(value, now) {
  if (typeof value !== 'string' || value.length === 0) return nowIso(now)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? nowIso(now) : date.toISOString()
}

export function defaultSkillAdmin({ now = () => new Date() } = {}) {
  return { disabled: [], deletions: [], updatedAt: nowIso(now) }
}

export function nowIso(now = () => new Date()) {
  const value = now()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function defaultState({ now = () => new Date() } = {}) {
  return {
    version: STATE_VERSION,
    enabled: true,
    hostVersion: 'unknown',
    updatedAt: nowIso(now),
    skills: {},
    projects: {},
    // v0.2：命令描述翻译记录；byName[name] = {en, zh, engine, fingerprint, hint, …}
    commands: {
      byName: {},
      updatedAt: nowIso(now),
      restoredAt: null,
    },
    // v0.5：技能管理的禁用记录 / 删除记录（只记录本插件动作，不扫描废纸篓）。
    skillAdmin: defaultSkillAdmin({ now }),
    cache: {},
    history: [],
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeDeletion(item, { now }) {
  if (!isPlainObject(item)) return null
  const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : null
  const scope = item.scope === 'project' ? 'project' : item.scope === 'user' ? 'user' : null
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const from = absolutePath(item.from)
  const to = item.to === null || item.to === undefined ? null : absolutePath(item.to)
  if (!id || !scope || !KEBAB.test(name) || !from) return null
  const projectRoot = scope === 'project' ? absolutePath(item.projectRoot) : null
  if (scope === 'project' && !projectRoot) return null
  const size = Number.isFinite(item.size) && item.size >= 0 ? Math.trunc(item.size) : 0
  return {
    id,
    scope,
    name,
    projectRoot,
    from,
    to,
    kind: item.kind === 'file' ? 'file' : item.kind === 'dir' ? 'dir' : null,
    size,
    deletedAt: isoOr(item.deletedAt, now),
    restoredAt: typeof item.restoredAt === 'string' ? isoOr(item.restoredAt, now) : null,
  }
}

/** 保留最近 MAX_DELETIONS 条：先丢最旧的已恢复记录，再丢最旧的未恢复记录。 */
export function pruneDeletions(items) {
  const list = (Array.isArray(items) ? items : []).filter(isPlainObject)
  if (list.length <= MAX_DELETIONS) return list
  const sorted = [...list].sort((a, b) => String(a.deletedAt).localeCompare(String(b.deletedAt)))
  const restored = sorted.filter((item) => typeof item.restoredAt === 'string')
  const pending = sorted.filter((item) => typeof item.restoredAt !== 'string')
  const removeCount = sorted.length - MAX_DELETIONS
  const dropRestored = restored.slice(0, Math.min(removeCount, restored.length))
  const dropped = new Set(dropRestored)
  const remainingNeed = removeCount - dropRestored.length
  const dropPending = pending.slice(0, Math.max(0, remainingNeed))
  for (const item of dropPending) dropped.add(item)
  return sorted.filter((item) => !dropped.has(item))
}

export function normalizeSkillAdmin(input, { now = () => new Date() } = {}) {
  const state = defaultSkillAdmin({ now })
  if (!isPlainObject(input)) return state
  const seen = new Set()
  for (const item of Array.isArray(input.disabled) ? input.disabled : []) {
    if (!isPlainObject(item)) continue
    const scope = item.scope === 'project' ? 'project' : item.scope === 'user' ? 'user' : null
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!scope || !KEBAB.test(name)) continue
    const projectRoot = scope === 'project' ? absolutePath(item.projectRoot) : null
    if (scope === 'project' && !projectRoot) continue
    const key = `${scope}\u0000${name}\u0000${projectRoot ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    state.disabled.push({
      scope,
      name,
      projectRoot,
      disabledAt: isoOr(item.disabledAt, now),
      reason: typeof item.reason === 'string' ? item.reason : 'user',
    })
  }
  const deletions = (Array.isArray(input.deletions) ? input.deletions : [])
    .filter(isPlainObject)
    .map((item) => normalizeDeletion(item, { now }))
    .filter(Boolean)
  state.deletions = pruneDeletions(deletions)
  state.updatedAt = isoOr(input.updatedAt, now)
  return state
}

/** 宽松归一化：旧版本 / 手工编辑缺字段时不崩。 */
export function normalizeState(input, { now = () => new Date() } = {}) {
  const state = defaultState({ now })
  if (!isPlainObject(input)) return state
  if (typeof input.enabled === 'boolean') state.enabled = input.enabled
  if (typeof input.hostVersion === 'string') state.hostVersion = input.hostVersion
  if (typeof input.updatedAt === 'string') state.updatedAt = input.updatedAt
  if (isPlainObject(input.skills)) state.skills = { ...input.skills }
  if (isPlainObject(input.projects)) {
    for (const [root, project] of Object.entries(input.projects)) {
      if (!isPlainObject(project)) continue
      state.projects[root] = {
        ...project,
        skills: isPlainObject(project.skills) ? { ...project.skills } : {},
      }
    }
  }
  if (isPlainObject(input.commands)) {
    const commands = input.commands
    state.commands = {
      byName: isPlainObject(commands.byName) ? { ...commands.byName } : {},
      updatedAt: typeof commands.updatedAt === 'string' ? commands.updatedAt : state.commands.updatedAt,
      restoredAt: typeof commands.restoredAt === 'string' ? commands.restoredAt : null,
    }
  }
  if (isPlainObject(input.cache)) state.cache = { ...input.cache }
  // v0.5（v2 → v3）：迁移/归一化技能管理记录；未知键在此被白名单丢弃。
  state.skillAdmin = normalizeSkillAdmin(input.skillAdmin, { now })
  if (Array.isArray(input.history)) state.history = input.history.filter(isPlainObject).slice(-MAX_HISTORY)
  state.version = STATE_VERSION
  return state
}

export function recordSkill(state, name, record, { now = () => new Date() } = {}) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('recordSkill: name 必须是非空字符串')
  state.skills[name] = { ...record, name, updatedAt: nowIso(now) }
  return state.skills[name]
}

export function removeSkills(state, names) {
  const removed = []
  for (const name of names ?? []) {
    if (Object.prototype.hasOwnProperty.call(state.skills, name)) {
      delete state.skills[name]
      removed.push(name)
    }
  }
  return removed
}

export function recordProjectSkill(state, projectRoot, name, shadow, { now = () => new Date() } = {}) {
  if (!isPlainObject(state.projects[projectRoot])) {
    state.projects[projectRoot] = { skills: {}, updatedAt: nowIso(now) }
  }
  const project = state.projects[projectRoot]
  if (!isPlainObject(project.skills)) project.skills = {}
  project.skills[name] = { ...shadow, name, updatedAt: nowIso(now) }
  project.updatedAt = nowIso(now)
  return project.skills[name]
}

export function removeProjectSkill(state, projectRoot, name) {
  const project = state.projects[projectRoot]
  if (!isPlainObject(project) || !isPlainObject(project.skills)) return false
  if (!Object.prototype.hasOwnProperty.call(project.skills, name)) return false
  delete project.skills[name]
  return true
}

export function dropProject(state, projectRoot) {
  if (Object.prototype.hasOwnProperty.call(state.projects, projectRoot)) {
    delete state.projects[projectRoot]
    return true
  }
  return false
}

export function recordCommand(state, name, record, { now = () => new Date() } = {}) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('recordCommand: name 必须是非空字符串')
  if (!isPlainObject(state.commands)) state.commands = { byName: {}, updatedAt: nowIso(now), restoredAt: null }
  if (!isPlainObject(state.commands.byName)) state.commands.byName = {}
  state.commands.byName[name] = { ...record, name, updatedAt: nowIso(now) }
  state.commands.updatedAt = nowIso(now)
  return state.commands.byName[name]
}

export function removeCommand(state, name) {
  if (!isPlainObject(state.commands?.byName)) return false
  if (!Object.prototype.hasOwnProperty.call(state.commands.byName, name)) return false
  delete state.commands.byName[name]
  return true
}

/** 清空命令译文记录（宿主升级 / retranslate），保留 restoredAt。 */
export function resetCommands(state, { now = () => new Date(), restoredAt } = {}) {
  if (!isPlainObject(state.commands)) state.commands = { byName: {}, updatedAt: nowIso(now), restoredAt: null }
  state.commands.byName = {}
  state.commands.updatedAt = nowIso(now)
  if (restoredAt !== undefined) state.commands.restoredAt = restoredAt
  return state.commands
}

function ensureSkillAdmin(state, now) {
  if (!isPlainObject(state.skillAdmin)) state.skillAdmin = defaultSkillAdmin({ now })
  if (!Array.isArray(state.skillAdmin.disabled)) state.skillAdmin.disabled = []
  if (!Array.isArray(state.skillAdmin.deletions)) state.skillAdmin.deletions = []
  return state.skillAdmin
}

function disabledKey(entry) {
  const scope = entry?.scope === 'project' ? 'project' : 'user'
  const root = scope === 'project' && typeof entry?.projectRoot === 'string' ? path.resolve(entry.projectRoot) : null
  return `${scope}\u0000${entry?.name ?? ''}\u0000${root ?? ''}`
}

export function isDisabled(state, entry) {
  const admin = state?.skillAdmin
  if (!isPlainObject(admin) || !Array.isArray(admin.disabled)) return false
  const key = disabledKey(entry)
  return admin.disabled.some((item) => disabledKey(item) === key)
}

/** 幂等：已存在同 (scope,name,projectRoot) 时只更新时间。返回是否新增。 */
export function addDisabled(state, entry, { now = () => new Date() } = {}) {
  const admin = ensureSkillAdmin(state, now)
  const scope = entry?.scope === 'project' ? 'project' : entry?.scope === 'user' ? 'user' : null
  const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
  if (!scope || !KEBAB.test(name)) throw new TypeError('addDisabled: scope/name 不合法')
  const projectRoot = scope === 'project' ? absolutePath(entry.projectRoot) : null
  if (scope === 'project' && !projectRoot) throw new TypeError('addDisabled: 项目条目缺少 projectRoot')
  const key = disabledKey({ scope, name, projectRoot })
  if (admin.disabled.some((item) => disabledKey(item) === key)) return false
  admin.disabled.push({
    scope,
    name,
    projectRoot,
    disabledAt: nowIso(now),
    reason: typeof entry.reason === 'string' ? entry.reason : 'user',
  })
  admin.updatedAt = nowIso(now)
  return true
}

export function removeDisabled(state, entry, { now = () => new Date() } = {}) {
  const admin = ensureSkillAdmin(state, now)
  const key = disabledKey(entry)
  const index = admin.disabled.findIndex((item) => disabledKey(item) === key)
  if (index < 0) return false
  admin.disabled.splice(index, 1)
  admin.updatedAt = nowIso(now)
  return true
}

export function recordDeletion(state, deletion, { now = () => new Date() } = {}) {
  const admin = ensureSkillAdmin(state, now)
  const normalized = normalizeDeletion({ ...deletion, deletedAt: deletion?.deletedAt ?? nowIso(now) }, { now })
  if (!normalized) throw new TypeError('recordDeletion: 删除记录不合法')
  admin.deletions = pruneDeletions([...admin.deletions, normalized])
  admin.updatedAt = nowIso(now)
  return normalized
}

/** id 优先；缺 id 时取 scope+name+projectRoot 组合最近一条未恢复记录。 */
export function findDeletion(state, { id, scope, name, projectRoot } = {}) {
  const admin = state?.skillAdmin
  if (!isPlainObject(admin) || !Array.isArray(admin.deletions)) return undefined
  if (typeof id === 'string' && id.length > 0) return admin.deletions.find((item) => item.id === id)
  if (typeof name !== 'string' || name.length === 0) return undefined
  const root = typeof projectRoot === 'string' ? path.resolve(projectRoot) : null
  return [...admin.deletions]
    .filter((item) => item.restoredAt == null && item.name === name)
    .filter((item) => (scope ? item.scope === scope : true))
    .filter((item) => (root && item.scope === 'project' ? item.projectRoot === root : true))
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))[0]
}

export function markRestored(state, id, { now = () => new Date() } = {}) {
  const admin = ensureSkillAdmin(state, now)
  const item = admin.deletions.find((entry) => entry.id === id)
  if (!item) return false
  item.restoredAt = nowIso(now)
  admin.updatedAt = nowIso(now)
  return true
}

/** 只返回仍在废纸篓、可恢复的记录，按 deletedAt 倒序。 */
export function listDeletions(state) {
  const admin = state?.skillAdmin
  if (!isPlainObject(admin) || !Array.isArray(admin.deletions)) return []
  return admin.deletions
    .filter((item) => item.restoredAt == null)
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
}

export function pushHistory(state, entry, { now = () => new Date(), max = MAX_HISTORY } = {}) {
  const item = {
    at: nowIso(now),
    action: typeof entry?.action === 'string' ? entry.action : 'unknown',
    actor: typeof entry?.actor === 'string' ? entry.actor : 'plugin',
    ...(Array.isArray(entry?.names) ? { names: entry.names.slice(0, 50) } : {}),
    ...(typeof entry?.note === 'string' ? { note: entry.note } : {}),
  }
  state.history.push(item)
  if (state.history.length > max) state.history = state.history.slice(-max)
  return item
}

/** 只保留当前目标仍在使用的缓存键，防止无限增长。 */
export function pruneCache(state) {
  const keep = new Set()
  for (const skill of Object.values(state.skills ?? {})) {
    if (typeof skill?.fingerprint === 'string') keep.add(skill.fingerprint)
    if (typeof skill?.sourceHash === 'string') keep.add(skill.sourceHash)
  }
  for (const project of Object.values(state.projects ?? {})) {
    for (const skill of Object.values(project?.skills ?? {})) {
      if (typeof skill?.sourceHash === 'string') keep.add(skill.sourceHash)
    }
  }
  for (const command of Object.values(state.commands?.byName ?? {})) {
    if (typeof command?.fingerprint === 'string') keep.add(command.fingerprint)
  }
  for (const key of Object.keys(state.cache ?? {})) {
    if (!keep.has(key)) delete state.cache[key]
  }
  return state.cache
}

/**
 * @param {{
 *   paths: ReturnType<import('./paths.js').createPaths>,
 *   fs?: typeof fsDefault,
 *   trash?: ReturnType<import('./trash.js').createTrash>,
 *   logger?: {warn?: Function, info?: Function},
 *   now?: () => Date,
 *   file?: string,
 * }} options
 */
export function createStateStore(options) {
  const paths = options.paths
  const fs = options.fs ?? fsDefault
  const trash = options.trash
  const logger = options.logger ?? {}
  const now = options.now ?? (() => new Date())
  const file = options.file ?? paths.stateFile
  const dir = path.dirname(file)

  function load() {
    const warnings = []
    if (!fs.existsSync(file)) {
      return { state: defaultState({ now }), warnings, exists: false }
    }
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (error) {
      warnings.push(`读取状态文件失败：${String(error?.message ?? error)}`)
      return { state: defaultState({ now }), warnings, exists: true, readable: false }
    }
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.version !== STATE_VERSION) {
        warnings.push(`状态文件版本 ${parsed?.version ?? '未知'}，已按 v${STATE_VERSION} 归一化`)
      }
      return { state: normalizeState(parsed, { now }), warnings, exists: true }
    } catch (error) {
      warnings.push(`状态文件损坏（${String(error?.message ?? error)}），本次使用空状态；原文件会先留档再覆盖`)
      return { state: defaultState({ now }), warnings, exists: true, corrupt: true }
    }
  }

  /**
   * @param {object} state
   * @param {{reason?: string, backup?: boolean}} [saveOptions]
   */
  function save(state, saveOptions = {}) {
    const warnings = []
    const next = normalizeState(state, { now })
    next.updatedAt = nowIso(now)
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (error) {
      return { ok: false, warnings: [`创建状态目录失败：${String(error?.message ?? error)}`] }
    }
    if (saveOptions.backup !== false && fs.existsSync(file) && trash?.snapshot) {
      const snapshot = trash.snapshot(file)
      if (!snapshot?.ok) warnings.push(`状态文件留档失败：${snapshot?.reason ?? '未知原因'}`)
    }
    const temp = path.join(dir, `.state.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`)
    try {
      fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
      if (typeof fs.chmodSync === 'function') {
        try {
          fs.chmodSync(temp, 0o600)
        } catch {
          /* 某些文件系统不支持 chmod */
        }
      }
      fs.renameSync(temp, file)
      return { ok: true, file, warnings, state: next }
    } catch (error) {
      // 临时文件也是“文件”，不用删除；留在目录里由用户/清理脚本处理。
      warnings.push(`写入状态文件失败：${String(error?.message ?? error)}`)
      return { ok: false, warnings, temp }
    }
  }

  return { file, dir, load, save }
}
