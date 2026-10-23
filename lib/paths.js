/**
 * 宿主路径探测：不假设固定的安装位置，全部候选按“存在优先”挑选。
 *
 * 只在 Electron 宿主里运行；单测通过注入 fs / env / resourcesPath 使用内存文件系统。
 * 本模块不写任何文件。
 */

import fsDefault from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * design §4.7 的默认目标；cordis.patch.yml 里的 config 会覆盖它们。
 *
 * global 里的 `browser-skill` 是 runtime 技能（rank 250，按 agent scope 注册），
 * 无法靠 global provider 压过；发现阶段在这里捕获它的英文原文，再在 agent 层
 * 用同名 provider（rank 50，见 agent-layer.js）覆盖。
 */
export const DEFAULT_TARGETS = {
  global: [
    'office',
    'office-docx',
    'office-export-pdf',
    'office-pptx',
    'office-recalculate',
    'office-render',
    'office-xlsx',
    'browser-skill',
  ],
  preset: [
    'agent-experience',
    'cordis-composition-reference',
    'cordis-plugin-development',
    'editing-cordis-compositions',
  ],
  // v0.2：斜杠命令描述（agent scope 命令影子，不注册全局命令）。
  commands: ['acp', 'acp-cache', 'agent-teams'],
}

/** runtime 技能（browser-skill）的 rank，仅用于状态说明。 */
export const RUNTIME_RANK = 250
export const PROVIDER_RANK = 50
export const PROJECT_RANK = 100

function safeReadJson(fs, file) {
  try {
    if (!fs.existsSync(file)) return undefined
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function deriveResourcesPath(execPath) {
  if (typeof execPath !== 'string' || execPath.length === 0) return undefined
  // macOS: <App>.app/Contents/MacOS/<exe> → <App>.app/Contents/Resources
  // Windows/Linux: <install>/<exe> → <install>/resources（存在才采用）
  const dir = path.dirname(execPath)
  const mac = path.join(dir, '..', 'Resources')
  return path.resolve(mac)
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   fs?: typeof fsDefault,
 *   execPath?: string,
 *   resourcesPath?: string,
 *   home?: string,
 *   isElectron?: boolean,
 *   profile?: string,
 * }} [options]
 */
export function createPaths(options = {}) {
  const env = options.env ?? process.env
  const fs = options.fs ?? fsDefault
  const home = options.home ?? os.homedir()
  const isElectron = options.isElectron ?? process.versions.electron !== undefined
  const execPath = options.execPath ?? process.execPath
  const resourcesPath = options.resourcesPath
    ?? env.DSH_RESOURCES_PATH
    ?? (typeof process.resourcesPath === 'string' ? process.resourcesPath : undefined)
    ?? deriveResourcesPath(execPath)
  const dshHome = path.resolve(env.DSH_HOME && env.DSH_HOME.length > 0
    ? env.DSH_HOME
    : path.join(home, '.dsh'))
  const profile = env.DSH_PROFILE && env.DSH_PROFILE.length > 0 ? env.DSH_PROFILE : 'desktop'

  const presetCandidates = [
    env.DSH_AGENT_PRESET_SKILLS_DIR,
    resourcesPath && path.join(resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills'),
    resourcesPath && path.join(resourcesPath, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills'),
    resourcesPath && path.join(resourcesPath, 'app', 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills'),
    path.join(dshHome, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills'),
    path.join(dshHome, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills'),
  ].filter(Boolean)

  const officeCandidates = [
    env.DSH_OFFICE_SKILLS_DIR,
    resourcesPath && path.join(resourcesPath, 'runtime', 'office-skills'),
    resourcesPath && path.join(resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-skill-office', 'assets'),
    path.join(dshHome, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh-skill-office', 'assets'),
  ].filter(Boolean)

  const nodeCandidates = [
    env.DSH_NODE_BIN,
    path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    resourcesPath && path.join(resourcesPath, 'runtime', 'bin', process.platform === 'win32' ? 'node.cmd' : 'node'),
  ].filter(Boolean)

  const trashCandidates = [
    env.DSH_TRASH_SCRIPT,
    path.join(dshHome, 'skills', 'safe-delete-trash', 'trash.mjs'),
    path.join(home, '.dsh', 'skills', 'safe-delete-trash', 'trash.mjs'),
  ].filter(Boolean)

  const firstExistingDir = (candidates) => {
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
      } catch {
        /* 候选不可读时继续 */
      }
    }
    return undefined
  }

  const firstExistingFile = (candidates) => {
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
      } catch {
        /* 候选不可读时继续 */
      }
    }
    return undefined
  }

  let cachedHostVersion
  const hostVersion = () => {
    if (cachedHostVersion !== undefined) return cachedHostVersion
    if (typeof env.DSH_HOST_VERSION === 'string' && env.DSH_HOST_VERSION.length > 0) {
      cachedHostVersion = env.DSH_HOST_VERSION
      return cachedHostVersion
    }
    const candidates = [
      resourcesPath && path.join(resourcesPath, 'runtime', 'primary-runtime', 'runtime.json'),
      path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'runtime.json'),
      resourcesPath && path.join(resourcesPath, 'app.asar', 'package.json'),
      path.join(dshHome, 'profiles', profile, 'package.json'),
    ].filter(Boolean)
    for (const file of candidates) {
      const json = safeReadJson(fs, file)
      if (!json || typeof json !== 'object') continue
      if (typeof json.desktopVersion === 'string' && json.desktopVersion.length > 0) {
        cachedHostVersion = json.desktopVersion
        return cachedHostVersion
      }
      if (typeof json.version === 'string' && json.version.length > 0) {
        cachedHostVersion = json.version
        return cachedHostVersion
      }
      const dep = json.dependencies?.['@deepseek-ai/dsh']
      if (typeof dep === 'string' && dep.length > 0) {
        cachedHostVersion = dep
        return cachedHostVersion
      }
    }
    cachedHostVersion = 'unknown'
    return cachedHostVersion
  }

  /** 项目的 `.dsh/skills` 根；没有项目根时返回 undefined。 */
  const projectDshDir = (projectRoot) => (projectRoot
    ? path.join(projectRoot, '.dsh', 'skills')
    : undefined)

  return {
    home,
    dshHome,
    profile,
    resourcesPath,
    isElectron,
    execPath,
    stateDir: path.join(dshHome, '.skill-desc-zh'),
    stateFile: path.join(dshHome, '.skill-desc-zh', 'state.json'),
    projectDshDir,
    hostVersion,
    presetSkillsDir: () => firstExistingDir(presetCandidates),
    officeSkillsDir: () => firstExistingDir(officeCandidates),
    trashScript: () => firstExistingFile(trashCandidates),
    nodeBin: () => firstExistingFile(nodeCandidates) ?? execPath,
    candidates: {
      preset: presetCandidates,
      office: officeCandidates,
      node: nodeCandidates,
      trash: trashCandidates,
    },
  }
}

/** 与宿主 dsh-skill-filesystem 一致的 findProjectRoot：向上找第一个含 .git 的目录。 */
export function findProjectRootFS(cwd, fs = fsDefault) {
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  let dir
  try {
    dir = path.resolve(cwd)
  } catch {
    return undefined
  }
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) return dir
    } catch {
      /* 目录不可读时继续向上 */
    }
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** 与宿主 workingDirectory 的 findProjectRoot 语义一致。 */
export async function findProjectRoot(cwd, fs = fsDefault) {
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  let dir = path.resolve(cwd)
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) return dir
    } catch {
      /* ignore */
    }
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * L2 写入白名单：项目根位于 $HOME 之下，或显式列在 projectAllowlist。
 * $HOME 本身不算项目（避免污染用户级 ~/.dsh/skills）。
 */
export function isProjectAllowed(projectRoot, options = {}) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return false
  const home = options.home ?? os.homedir()
  const allowlist = Array.isArray(options.allowlist) ? options.allowlist : []
  const env = options.env ?? process.env
  const extra = typeof env.DSH_SKILL_DESC_ZH_ALLOW === 'string'
    ? env.DSH_SKILL_DESC_ZH_ALLOW.split(path.delimiter).filter(Boolean)
    : []
  let root
  try {
    root = path.resolve(projectRoot)
  } catch {
    return false
  }
  const homeResolved = path.resolve(home)
  if (root !== homeResolved && root.startsWith(homeResolved + path.sep)) return true
  for (const entry of [...allowlist, ...extra]) {
    if (typeof entry !== 'string' || entry.length === 0) continue
    let allowed
    try {
      allowed = path.resolve(entry.replace(/^~(?=$|[/\\])/, homeResolved))
    } catch {
      continue
    }
    if (root === allowed || root.startsWith(allowed + path.sep)) return true
  }
  return false
}
