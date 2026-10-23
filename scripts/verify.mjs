#!/usr/bin/env node
/**
 * 安装后自检（design §10 附加项 + A11）。
 *
 * 只做**文件级可复核**的检查：
 *  - 源码里不存在永久删除调用（rm/unlink/rmdir/truncate/find -delete/git clean…）；
 *  - 唯一删除通道 lib/trash.js 确实指向 safe-delete-trash/trash.mjs；
 *  - state.json 记录的每个影子目录：要么存在且带本插件标记，要么能在
 *    ~/.dsh/.trash-log.jsonl 找到对应“移入废纸篓”记录（不存在“凭空消失”）；
 *  - 可选断言：已安装（profile 依赖 + bundle 行）、已应用（12 条译文 + 4 个影子 + 宿主版本一致）、
 *    已还原（无译文、无影子、消失的影子均有废纸篓记录）。
 *
 * 工具是否可调用（skill_desc_zh / 中文目录）无法从 Node 侧证明，脚本会明确打印
 * “未验证”，需配合 cordis_inspect_query 或新会话目录人工确认。
 *
 * 用法：
 *   node scripts/verify.mjs [--expect-installed] [--expect-applied|--expect-restored]
 *                           [--profile desktop] [--json]
 * 退出码：0 通过；1 有失败项；2 仅警告。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = os.homedir()
const DSH_HOME = path.resolve(process.env.DSH_HOME || path.join(HOME, '.dsh'))
const args = process.argv.slice(2)
let profile = process.env.DSH_PROFILE || 'desktop'
let json = false
let expectInstalled = false
let expectApplied = false
let expectRestored = false

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--profile') profile = args[++i]
  else if (arg === '--json') json = true
  else if (arg === '--expect-installed') expectInstalled = true
  else if (arg === '--expect-applied') expectApplied = true
  else if (arg === '--expect-restored') expectRestored = true
  else if (arg === '--help' || arg === '-h') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
    process.exit(0)
  } else {
    console.error(`未知参数：${arg}`)
    process.exit(1)
  }
}

const rows = []
const pass = (title, detail) => rows.push({ level: 'pass', title, detail })
const warn = (title, detail) => rows.push({ level: 'warn', title, detail })
const fail = (title, detail) => rows.push({ level: 'fail', title, detail })
const note = (title, detail) => rows.push({ level: 'info', title, detail })

/* ------------------------------------------------------- A11 永久删除痕迹 */

const scanRoots = ['lib', 'scripts', 'test'].map((dir) => path.join(REPO_ROOT, dir)).filter((dir) => fs.existsSync(dir))
const scannable = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(m?js|cjs|json|md|yml|yaml)$/u.test(entry.name)) scannable.push(full)
  }
}
for (const root of scanRoots) walk(root)

const forbidden = [
  { name: 'rm -rf / rm -r', re: /\brm\s+-[a-zA-Z]*[rf]/u },
  { name: 'fs.rm / fs.rmSync', re: /\bfs\.rm(Sync)?\s*\(/u },
  { name: 'fs.unlink / unlinkSync', re: /\b(fs\.)?unlink(Sync)?\s*\(/u },
  { name: 'fs.rmdir / rmdirSync', re: /\b(fs\.)?rmdir(Sync)?\s*\(/u },
  { name: 'truncate', re: /\b(fs\.)?truncate(Sync)?\s*\(/u },
  { name: 'find -delete', re: /\bfind\b[^\n]*-delete\b/u },
  { name: 'git clean', re: /\bgit\s+clean\b/u },
  { name: 'pnpm clean', re: /\bpnpm\s+clean\b/u },
  { name: 'rimraf', re: /\brimraf\b/u },
]
let deletionHits = 0
for (const file of scannable) {
  const relative = path.relative(REPO_ROOT, file)
  /* 本脚本自身包含模式字符串，跳过以免自报 */
  if (relative === 'scripts/verify.mjs') continue
  const text = fs.readFileSync(file, 'utf8')
  for (const pattern of forbidden) {
    const match = pattern.re.exec(text)
    if (match) {
      deletionHits += 1
      fail('永久删除痕迹', `${relative} 命中 ${pattern.name}：${JSON.stringify(match[0])}`)
    }
  }
}
if (deletionHits === 0) pass('永久删除痕迹', `扫描 ${scannable.length} 个文件，未发现 rm/unlink/rmdir/truncate/find -delete/git clean/rimraf`)

const trashSource = path.join(REPO_ROOT, 'lib', 'trash.js')
if (fs.existsSync(trashSource) && /trash\.mjs/u.test(fs.readFileSync(trashSource, 'utf8'))) {
  pass('删除通道', 'lib/trash.js 调用 safe-delete-trash/trash.mjs（不可用时失败关闭，不降级永久删除）')
} else {
  fail('删除通道', 'lib/trash.js 未引用 trash.mjs，或文件缺失')
}

/* --------------------------------------------------------------- 状态与影子 */

const stateFile = path.join(DSH_HOME, '.skill-desc-zh', 'state.json')
const trashLog = path.join(DSH_HOME, '.trash-log.jsonl')
let state
if (fs.existsSync(stateFile)) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    note('state.json', `${stateFile}（hostVersion=${state.hostVersion}, skills=${Object.keys(state.skills || {}).length}, projects=${Object.keys(state.projects || {}).length}）`)
  } catch (error) {
    fail('state.json', `无法解析：${error.message}`)
  }
} else {
  note('state.json', `不存在（${stateFile}）——尚未 apply 或已被还原清理`)
}

const trashEntries = []
if (fs.existsSync(trashLog)) {
  for (const line of fs.readFileSync(trashLog, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      trashEntries.push(JSON.parse(trimmed))
    } catch {
      /* 忽略坏行 */
    }
  }
}
const trashedFrom = new Set(trashEntries.map((entry) => entry.from).filter(Boolean))

const shadowDirs = []
if (state?.projects && typeof state.projects === 'object') {
  for (const [projectRoot, project] of Object.entries(state.projects)) {
    for (const [name, record] of Object.entries(project?.skills || {})) {
      shadowDirs.push({ projectRoot, name, dir: record?.dir, marker: record })
    }
  }
}
let shadowProblems = 0
let shadowsExisting = 0
for (const shadow of shadowDirs) {
  if (!shadow.dir) {
    fail('影子记录', `${shadow.name} 在 state 中没有 dir 字段`)
    shadowProblems += 1
    continue
  }
  if (fs.existsSync(shadow.dir)) {
    shadowsExisting += 1
    const markerFile = path.join(shadow.dir, '.skill-desc-zh.json')
    let marker
    try {
      marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'))
    } catch {
      fail('影子标记', `${shadow.dir} 存在但没有可读的 .skill-desc-zh.json 标记`)
      shadowProblems += 1
      continue
    }
    if (marker.plugin === 'skill-desc-zh' && marker.name === shadow.name) {
      pass('影子标记', `${shadow.name} → ${shadow.dir}（schemaVersion=${marker.schemaVersion}）`)
    } else {
      fail('影子标记', `${shadow.dir} 标记 plugin/name 不匹配：${JSON.stringify({ plugin: marker.plugin, name: marker.name })}`)
      shadowProblems += 1
    }
  } else if (trashedFrom.has(shadow.dir)) {
    pass('影子已还原', `${shadow.name} 的旧影子在废纸篓记录中：${shadow.dir}`)
  } else {
    fail('影子丢失', `${shadow.name} 的 ${shadow.dir} 不存在，且 ~/.dsh/.trash-log.jsonl 无对应 from 记录（疑似永久删除）`)
    shadowProblems += 1
  }
}

/* ------------------------------------------------------------------ 安装 */

const profilePkgPath = path.join(DSH_HOME, 'profiles', profile, 'package.json')
let profilePkg
try {
  profilePkg = JSON.parse(fs.readFileSync(profilePkgPath, 'utf8'))
} catch {
  warn('profile', `无法读取 ${profilePkgPath}`)
}
const depSpec = profilePkg?.dependencies?.['dsh-skill-desc-zh']
const bundles = profilePkg?.dsh?.profile?.bundles || []
const installed = Boolean(depSpec) && bundles.includes('dsh-skill-desc-zh')
if (installed) pass('安装记录', `dsh-skill-desc-zh 在 profile dependencies（${depSpec}）与 dsh.profile.bundles 中`)
else note('安装记录', `dsh-skill-desc-zh 未出现在 profile 依赖/bundles（dep=${depSpec ?? '无'}）`)

/* ------------------------------------------------------------ 宿主版本 */

function detectHostVersion() {
  if (process.env.DSH_HOST_VERSION) return { version: process.env.DSH_HOST_VERSION, source: 'DSH_HOST_VERSION' }
  const resources = []
  if (process.env.DSH_RESOURCES_PATH) resources.push(process.env.DSH_RESOURCES_PATH)
  for (const base of ['/Applications', path.join(HOME, 'Applications')]) {
    try {
      for (const entry of fs.readdirSync(base)) {
        if (entry.endsWith('.app')) resources.push(path.join(base, entry, 'Contents', 'Resources'))
      }
    } catch {
      /* 跳过 */
    }
  }
  for (const res of resources) {
    try {
      const runtime = JSON.parse(fs.readFileSync(path.join(res, 'runtime', 'primary-runtime', 'runtime.json'), 'utf8'))
      if (runtime.desktopVersion) return { version: runtime.desktopVersion, source: 'Electron resources' }
    } catch {
      /* 继续 */
    }
  }
  return { version: 'unknown', source: '未找到 Electron 宿主 resources' }
}
const host = detectHostVersion()

/* ---------------------------------------------------------------- 断言 */

if (expectInstalled) {
  if (installed) pass('断言：已安装', `dependency=${depSpec}`)
  else fail('断言：已安装', 'profile 未记录 dsh-skill-desc-zh')
}

if (expectApplied) {
  const skillCount = Object.keys(state?.skills || {}).length
  if (skillCount === 12) pass('断言：已应用', `state.skills = 12 条译文`)
  else fail('断言：已应用', `state.skills = ${skillCount}，期望 12`)
  if (shadowDirs.length === 4 && shadowsExisting === 4 && shadowProblems === 0) {
    pass('断言：影子', '4 个 preset 影子全部存在且带标记')
  } else {
    fail('断言：影子', `state 记录 ${shadowDirs.length} 个影子、存在 ${shadowsExisting} 个、问题 ${shadowProblems} 个，期望 4/4/0`)
  }
  if (state?.hostVersion && host.version !== 'unknown' && state.hostVersion !== host.version) {
    fail('断言：宿主版本', `state.hostVersion=${state.hostVersion} 与宿主 ${host.version} 不一致（会触发自愈）`)
  } else {
    pass('断言：宿主版本', `state.hostVersion=${state?.hostVersion ?? 'n/a'} / 宿主 ${host.version}`)
  }
}

if (expectRestored) {
  const skillCount = Object.keys(state?.skills || {}).length
  const existingNow = shadowDirs.filter((shadow) => shadow.dir && fs.existsSync(shadow.dir)).length
  if (skillCount === 0 && existingNow === 0 && shadowProblems === 0) {
    pass('断言：已还原', 'state.skills 为空、无残留影子、旧影子均有废纸篓记录')
  } else {
    fail('断言：已还原', `state.skills=${skillCount}、仍存在影子=${existingNow}、影子问题=${shadowProblems}`)
  }
}

note('未验证：工具可用性', 'skill_desc_zh 是否已注册、技能目录是否显示中文，需 cordis_inspect_query(host Tool listTools) 或新会话目录确认，Node 侧无法证明')

/* ---------------------------------------------------------------- 输出 */

const failures = rows.filter((row) => row.level === 'fail').length
const warnings = rows.filter((row) => row.level === 'warn').length
const exitCode = failures > 0 ? 1 : warnings > 0 ? 2 : 0
if (json) {
  process.stdout.write(JSON.stringify({ exitCode, failures, warnings, host, installed, stateFile, rows }, null, 2) + '\n')
} else {
  console.log('=== 安装后自检 ===')
  const icon = { pass: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' }
  for (const row of rows) console.log(`${icon[row.level]} ${row.title}：${row.detail}`)
  console.log(failures > 0 ? `\n结论：❌ ${failures} 个失败项。` : warnings > 0 ? '\n结论：⚠️ 通过但有警告。' : '\n结论：✅ 文件级检查通过（工具可用性仍需宿主侧确认）。')
}
process.exit(exitCode)
