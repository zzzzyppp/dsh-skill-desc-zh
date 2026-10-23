#!/usr/bin/env node
/**
 * AGENTS.md 插件预检包装（design §10 A1）。
 *
 * 职责：
 *  1. 原样运行官方审计 `~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs
 *     <target> --profile <profile>`，继承其输出并采用其退出码（0 干净 / 2 警告 / 1 阻塞）。
 *  2. 额外做本地目录包专项检查：engines.dsh、dsh.bundle.patch、profile 冲突、
 *     是否引入依赖、是否带安装脚本。
 *  3. 本地目录**没有 npm 仓库元数据**，因此“供应链来源/发布者/发布时间”一律
 *     标注为 **未验证**，绝不谎报干净；退出码最低为 2（需人工确认）。
 *  4. 任一阻塞项 → 退出码 1；警告 → 2；全部通过且无“未验证”项 → 0。
 *
 * 用法：
 *   node scripts/preflight.mjs [target] [--profile desktop] [--no-audit]
 *                              [--host-version X.Y.Z] [--json]
 *   node scripts/preflight.mjs --verify dsh-skill-desc-zh   # 安装后复核（转 audit --verify）
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = os.homedir()
const DSH_HOME = path.resolve(process.env.DSH_HOME || path.join(HOME, '.dsh'))

const args = process.argv.slice(2)
const positional = []
let profile = process.env.DSH_PROFILE || 'desktop'
let runAudit = true
let json = false
let verifyName
let hostVersionOverride

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--profile') profile = args[++i]
  else if (arg === '--no-audit') runAudit = false
  else if (arg === '--json') json = true
  else if (arg === '--verify') verifyName = args[++i]
  else if (arg === '--host-version') hostVersionOverride = args[++i]
  else if (arg === '--help' || arg === '-h') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
    process.exit(0)
  } else if (arg.startsWith('-')) {
    console.error(`未知选项：${arg}`)
    process.exit(1)
  } else positional.push(arg)
}

const target = path.resolve(positional[0] || REPO_ROOT)
const profileDir = path.join(DSH_HOME, 'profiles', profile)
const profilePkgPath = path.join(profileDir, 'package.json')

const findings = []
const blocker = (title, detail) => findings.push({ level: 'blocker', title, detail })
const warn = (title, detail) => findings.push({ level: 'warn', title, detail })
const info = (title, detail) => findings.push({ level: 'info', title, detail })
const pass = (title, detail) => findings.push({ level: 'pass', title, detail })

function safeJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function requireFromProfile(name) {
  try {
    const req = createRequire(profilePkgPath)
    return req(name)
  } catch {
    return undefined
  }
}

/* ---------------------------------------------------------------- 宿主版本 */

function detectHostVersion() {
  if (hostVersionOverride) return { version: hostVersionOverride, source: '--host-version' }
  if (process.env.DSH_HOST_VERSION) {
    return { version: process.env.DSH_HOST_VERSION, source: 'DSH_HOST_VERSION' }
  }
  const resources = []
  if (process.env.DSH_RESOURCES_PATH) resources.push(process.env.DSH_RESOURCES_PATH)
  if (process.env.DSH_APP_PATH) resources.push(path.join(process.env.DSH_APP_PATH, 'Contents', 'Resources'))
  const match = /^(.*?\.app)\/Contents\/MacOS\//.exec(process.execPath)
  if (match) resources.push(path.join(match[1], 'Contents', 'Resources'))
  for (const base of ['/Applications', path.join(HOME, 'Applications')]) {
    try {
      for (const entry of fs.readdirSync(base)) {
        if (entry.endsWith('.app')) resources.push(path.join(base, entry, 'Contents', 'Resources'))
      }
    } catch {
      /* 目录不存在时跳过 */
    }
  }
  for (const res of resources) {
    const runtime = safeJson(path.join(res, 'runtime', 'primary-runtime', 'runtime.json'))
    if (runtime?.desktopVersion) {
      return { version: runtime.desktopVersion, source: path.join(res, 'runtime/primary-runtime/runtime.json') }
    }
  }
  return { version: 'unknown', source: '未找到 Electron 宿主 resources/runtime/primary-runtime/runtime.json' }
}

/* ------------------------------------------------------------ 本地包专项 */

function checkLocalPackage() {
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
  } catch (error) {
    blocker('package.json', `无法读取 ${path.join(target, 'package.json')}：${error.message}`)
    return undefined
  }
  info('目标', `${pkg.name || '(无 name)'}@${pkg.version || '(无 version)'}（${target}）`)

  /* engines.dsh */
  const wanted = pkg.engines?.dsh
  const host = detectHostVersion()
  info('宿主版本', `${host.version} ← ${host.source}`)
  if (!wanted) {
    warn('engines.dsh', '包未声明 engines.dsh，无法确认宿主兼容性（未验证）')
  } else if (host.version === 'unknown') {
    warn('engines.dsh', `声明 "${wanted}"，但无法确定宿主版本（未验证，未判定）`)
  } else {
    const semver = requireFromProfile('semver')
    if (!semver) {
      warn('engines.dsh', `声明 "${wanted}"，但无法从 profile 解析 semver，未判定`)
    } else if (semver.satisfies(host.version, wanted, { includePrerelease: true })) {
      pass('engines.dsh', `"${wanted}" 满足宿主 ${host.version}`)
    } else {
      blocker('engines.dsh', `"${wanted}" 不满足宿主 ${host.version}——宿主会阻止安装/激活`)
    }
  }

  /* dsh.bundle.patch */
  const patchField = pkg.dsh?.bundle?.patch
  if (!patchField) {
    warn('dsh.bundle.patch', '未声明 dsh.bundle.patch：作为插件安装时不会向 profile 组合注入任何行（若只想被显式挂载可忽略）')
  } else {
    const patchPath = path.resolve(target, patchField)
    if (!fs.existsSync(patchPath)) {
      blocker('dsh.bundle.patch', `声明了 ${patchField}，但文件不存在：${patchPath}`)
    } else {
      pass('dsh.bundle.patch', patchPath)
      const yaml = requireFromProfile('yaml')
      if (!yaml) {
        warn('dsh.bundle.patch 解析', '无法从 profile 解析 yaml，未验证 patch 内容')
      } else {
        try {
          const doc = yaml.parse(fs.readFileSync(patchPath, 'utf8'))
          if (!Array.isArray(doc)) {
            blocker('dsh.bundle.patch 结构', `顶层必须是数组，实际是 ${Array.isArray(doc) ? 'array' : typeof doc}`)
          } else {
            const ids = []
            let bad = 0
            for (const [index, row] of doc.entries()) {
              const insert = row?.insert
              if (!Array.isArray(insert) || insert.length === 0) {
                blocker('dsh.bundle.patch 结构', `第 ${index + 1} 行缺少 insert 数组`)
                bad += 1
                continue
              }
              for (const item of insert) {
                if (!item?.id || !item?.name) {
                  blocker('dsh.bundle.patch 结构', `第 ${index + 1} 行 insert 项缺少 id/name：${JSON.stringify(item)}`)
                  bad += 1
                } else {
                  ids.push(`${item.id}=${item.name}`)
                  if (item.name !== pkg.name) {
                    warn('dsh.bundle.patch 名称', `insert 项 name=${item.name} 与包名 ${pkg.name} 不一致`)
                  }
                }
              }
            }
            if (bad === 0) pass('dsh.bundle.patch 结构', `顶层数组，${doc.length} 行，insert: ${ids.join(', ')}`)
          }
        } catch (error) {
          blocker('dsh.bundle.patch 解析', `YAML 解析失败：${error.message}`)
        }
      }
    }
  }

  /* profile 冲突 */
  const profilePkg = safeJson(profilePkgPath)
  if (!profilePkg) {
    warn('profile', `无法读取 ${profilePkgPath}，跳过我装冲突检查（未验证）`)
  } else {
    const deps = profilePkg.dependencies || {}
    if (deps[pkg.name]) {
      warn('profile 已有同名依赖', `${pkg.name} 已在 ${profile} profile 中（${deps[pkg.name]}）；安装会改写该行，请确认这是你期望的升级/替换`)
    } else {
      pass('profile 冲突', `profile 中无同名依赖 ${pkg.name}`)
    }
    const bundles = profilePkg.dsh?.profile?.bundles || []
    if (bundles.includes(pkg.name)) info('profile bundle', `${pkg.name} 已在 dsh.profile.bundles 中`)
  }

  /* 依赖 */
  const runtimeDeps = Object.keys(pkg.dependencies || {})
  if (runtimeDeps.length === 0) {
    pass('依赖', '运行时零依赖')
  } else {
    warn('依赖', `会引入 ${runtimeDeps.length} 个运行时依赖：${runtimeDeps.join(', ')}（依赖收敛/隔离期需自行确认）`)
  }
  if (Object.keys(pkg.devDependencies || {}).length > 0) {
    info('devDependencies', `${Object.keys(pkg.devDependencies).length} 个（安装时不进入 profile）`)
  }

  /* 安装脚本 */
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'].filter((key) => pkg.scripts?.[key])
  if (lifecycle.length > 0) {
    warn('安装脚本', `包含 ${lifecycle.join(', ')}；安装会执行包内脚本，需显式批准`)
  } else {
    pass('安装脚本', '无 install/postinstall/preinstall/prepare 生命周期脚本')
  }

  /* 私有包 */
  if (pkg.private === true) {
    info('private', '包声明 private:true；本地路径安装可用，但不会被 npm 发布')
  }

  /* 本地目录的供应链来源无法验证 */
  warn(
    '供应链来源',
    '未验证：目标不是 npm 仓库包，没有 registry 元数据/发布者签名/发布时间/隔离期信息；来源可信度只能由你确认绝对路径内容',
  )
  warn(
    'audit 对本地包的判定',
    'audit.mjs 对本地目录的“仓库来源/发布者/隔离期”类检查无法判定，输出中的相关 ℹ️/⚠️ 原文需如实转述',
  )

  return pkg
}

/* ------------------------------------------------------------------ audit */

function resolveAuditScript() {
  const candidates = [
    process.env.DSH_PREINSTALL_AUDIT,
    path.join(DSH_HOME, 'skills', 'dsh-plugin-preinstall-audit', 'audit.mjs'),
    path.join(HOME, '.dsh', 'skills', 'dsh-plugin-preinstall-audit', 'audit.mjs'),
  ].filter(Boolean)
  return candidates.find((file) => fs.existsSync(file))
}

function runOfficialAudit() {
  const audit = resolveAuditScript()
  if (!audit) {
    blocker('官方预检', `找不到 audit.mjs（候选：${path.join(DSH_HOME, 'skills', 'dsh-plugin-preinstall-audit', 'audit.mjs')}）；AGENTS.md 要求安装前必须预检，未预检不得安装`)
    return 1
  }
  console.log(`\n=== audit.mjs ${verifyName ? '--verify ' + verifyName : target} --profile ${profile} ===`)
  const child = spawnSync(process.execPath, [audit, ...(verifyName ? ['--verify', verifyName] : [target]), '--profile', profile], {
    stdio: 'inherit',
  })
  if (child.error) {
    blocker('官方预检', `audit.mjs 启动失败：${child.error.message}`)
    return 1
  }
  const code = child.status ?? 1
  if (code === 0) pass('官方预检', 'audit.mjs 退出码 0（干净）')
  else if (code === 2) warn('官方预检', 'audit.mjs 退出码 2（仅警告，须人工确认）')
  else if (code === 1) blocker('官方预检', 'audit.mjs 退出码 1（存在阻塞项，禁止安装）')
  else warn('官方预检', `audit.mjs 退出码 ${code}（异常，按未通过处理）`)
  return code
}

/* ------------------------------------------------------------------ 汇总 */

const pkg = checkLocalPackage()
let auditCode = 0
if (runAudit) {
  auditCode = runOfficialAudit()
} else {
  info('官方预检', '已用 --no-audit 跳过 audit.mjs（本次结论不含官方审计，视为未验证）')
}

const hasBlocker = findings.some((row) => row.level === 'blocker') || auditCode === 1
const hasWarn = findings.some((row) => row.level === 'warn') || auditCode === 2
const exitCode = hasBlocker ? 1 : hasWarn ? 2 : 0

if (json) {
  process.stdout.write(JSON.stringify({ target, profile, host: detectHostVersion(), auditCode, exitCode, findings }, null, 2) + '\n')
} else {
  const icon = { blocker: '❌', warn: '⚠️', info: 'ℹ️', pass: '✅' }
  console.log('\n=== preflight 汇总 ===')
  console.log(`目标：${pkg ? `${pkg.name}@${pkg.version}` : target}`)
  console.log(`profile：${profile}   宿主：${detectHostVersion().version}`)
  for (const row of findings) console.log(`${icon[row.level]} ${row.title}：${row.detail}`)
  console.log(
    exitCode === 1
      ? '\n结论：❌ 存在阻塞项 —— 禁止安装。'
      : exitCode === 2
        ? '\n结论：⚠️ 有警告/未验证项 —— 必须逐条展示给用户并取得明确同意后才能安装；不得表述为“没问题”。'
        : '\n结论：✅ 本地检查与官方审计均无阻塞、无警告。',
  )
  console.log('提醒：安装后必须复核 `node scripts/preflight.mjs --verify <包名>` 并确认 fiberPhase=active。')
}

process.exit(exitCode)
