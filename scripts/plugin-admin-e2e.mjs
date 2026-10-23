#!/usr/bin/env node
/**
 * 插件管理后台的端到端冒烟测试（不需要浏览器，不写 profile）。
 *
 * 覆盖：
 *  A1 真实 profile 解析 + 真实 pluginManager 契约（用真实 profile 目录与 bundle 形状模拟宿主）
 *  A2 真实 npm registry 的 latest 查询（网络不可用时记为 SKIP，不误报失败）
 *  A3 更新流水线：inspect → installBundle → restart-required 映射（安装器为内存假实现）
 *  A4 失败分类：供应链隔离期 / 构建脚本 / 兼容性闸门
 *  A5 describe() 元数据与缓存失效
 *
 * 安全边界：全程只读真实 profile；installBundle / inspect 均为假实现，绝不真的安装。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'

import {
  DEFAULT_REGISTRY,
  classifySource,
  createPluginAdmin,
  isNewerVersion,
  resolveProfileTarget,
} from '../lib/plugin-admin.js'

const results = []
function record(name, status, detail) {
  results.push({ name, status, detail })
  const icon = status === 'PASS' ? '✓' : status === 'SKIP' ? '↷' : '✗'
  console.log(`${icon} ${name}${detail ? `: ${detail}` : ''}`)
}
function pass(name, detail) { record(name, 'PASS', detail) }
function fail(name, detail) { record(name, 'FAIL', detail) }
function skip(name, detail) { record(name, 'SKIP', detail) }
function assert(name, condition, detail) {
  if (condition) pass(name, detail)
  else fail(name, detail ?? 'assertion failed')
  return Boolean(condition)
}

function profileDirFromHome() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'profiles', 'desktop')
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function realBundles(profileDir) {
  const profile = readJson(path.join(profileDir, 'package.json'))
  const deps = profile.dependencies ?? {}
  return Object.entries(deps)
    .map(([name, spec]) => {
      const pkgFile = path.join(profileDir, 'node_modules', name, 'package.json')
      let version
      try {
        version = readJson(pkgFile).version
      } catch {
        version = undefined
      }
      return {
        name,
        official: name.startsWith('@deepseek-ai/'),
        availability: 'profile',
        installed: true,
        enabled: true,
        version,
        meta: {},
        spec,
      }
    })
    .filter((bundle) => bundle.official || classifySource(bundle.spec) !== 'unknown')
}

function makeAdmin(profileDir, options = {}) {
  const bundles = options.bundles ?? realBundles(profileDir)
  const manager = {
    installs: [],
    inspects: [],
    async listBundles() { return bundles },
    async registries() { return { registry: DEFAULT_REGISTRY, resolved: DEFAULT_REGISTRY } },
    async inspect(spec) {
      this.inspects.push(spec)
      return options.inspect ? options.inspect(spec) : { status: 'accepted' }
    },
    async installBundle(spec, installOptions) {
      this.installs.push({ spec, installOptions })
      return options.install ? options.install(spec, installOptions) : { changed: true, application: 'applied', version: '0.0.0-e2e' }
    },
  }
  const admin = createPluginAdmin({
    ctx: { get: (name) => (name === 'desktopProfiles' ? { current: { name: 'desktop', dir: profileDir } } : undefined) },
    logger: { debug() {}, warn() {} },
    fetchImpl: options.fetchImpl,
    pluginManager: manager,
    env: process.env,
    argv: ['node', 'plugin-admin-e2e'],
    home: process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
  })
  return { admin, manager }
}

async function main() {
  const profileDir = profileDirFromHome()
  if (!fs.existsSync(path.join(profileDir, 'package.json'))) {
    console.error(`找不到 profile：${profileDir}`)
    process.exit(1)
  }

  // ---- A1 真实 profile + bundle 契约 ----
  const target = resolveProfileTarget(
    { get: (name) => (name === 'desktopProfiles' ? { current: { name: 'desktop', dir: profileDir } } : undefined) },
    {
      fs,
      env: {},
      home: process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'),
      argv: ['node', 'plugin-admin-e2e'],
    },
  )
  assert('A1.1 profile 解析', target.ok && target.profileName === 'desktop', `${target.profileName} · ${target.source}`)

  const real = makeAdmin(profileDir)
  const listed = await real.admin.list()
  assert('A1.2 列表成功', listed.ok === true && listed.pluginManager === true, `profile=${listed.profile?.name}`)
  const plugins = listed.plugins ?? []
  assert('A1.3 插件数量', plugins.length >= 10, `${plugins.length} 个第三方插件`)
  assert('A1.4 官方 bundle 过滤', listed.officialCount >= 1, `${listed.officialCount} 个官方 bundle`)
  const self = plugins.find((plugin) => plugin.name === 'dsh-skill-desc-zh')
  assert('A1.5 自身 link 不可更新', Boolean(self) && self.updateable === false && self.kind === 'local', self ? `${self.version} · ${self.kind}` : '缺失')
  assert('A1.6 npm 插件可检查更新', plugins.some((plugin) => plugin.updateable), `${plugins.filter((p) => p.updateable).length} 个可检查`)
  assert('A1.7 list 返回值可无损 JSON 往返', JSON.stringify(JSON.parse(JSON.stringify(listed))) === JSON.stringify(listed), 'round-trip')

  // ---- A2 真实 registry ----
  const checked = plugins.filter((plugin) => plugin.updateable && typeof plugin.latestVersion === 'string')
  const failures = plugins.filter((plugin) => plugin.updateable && plugin.latestError)
  if (checked.length > 0) {
    pass('A2.1 registry 查询', `${checked.length}/${plugins.filter((p) => p.updateable).length} 个查到 latest`)
    const consistent = checked.every((plugin) => plugin.updateAvailable === isNewerVersion(plugin.latestVersion, plugin.version))
    assert('A2.2 updateAvailable 与 semver 一致', consistent)
  } else if (failures.length > 0) {
    skip('A2.1 registry 查询', `网络不可用（${failures.length} 个失败），跳过在线版本检查`)
  } else {
    fail('A2.1 registry 查询', '既没有成功也没有失败结果')
  }

  // ---- A3/A4/A5 更新流水线（假安装器，选一个真实存在的 npm 插件名） ----
  const targetName = plugins.find((plugin) => plugin.updateable)?.name
  if (!targetName) {
    fail('A3 更新流水线', 'profile 中没有可更新的 npm 插件')
  } else {
    const fetchImpl = async (url) => ({ ok: true, status: 200, async json() { return { version: '99.0.0-e2e' } } })
    const fake = makeAdmin(profileDir, {
      fetchImpl,
      install: async (spec) => ({ changed: true, application: 'restart-required', restartReason: 'host-module', version: '99.0.0-e2e' }),
    })
    const result = await fake.admin.update({ name: targetName })
    assert('A3.1 更新成功', result.ok === true, `${result.from} → ${result.to}`)
    assert('A3.2 restartRequired 映射', result.restartRequired === true && result.application === 'restart-required', String(result.restartReason))
    assert('A3.6 更新结果可无损 JSON 往返', JSON.stringify(JSON.parse(JSON.stringify(result))) === JSON.stringify(result), 'round-trip')
    assert('A3.3 inspect 先行', fake.manager.inspects[0] === `${targetName}@99.0.0-e2e`, fake.manager.inspects[0])
    assert('A3.4 installBundle 规格', fake.manager.installs[0]?.spec === `${targetName}@99.0.0-e2e`, fake.manager.installs[0]?.spec)
    assert('A3.5 无真实安装（只有假实现）', fake.manager.installs.length === 1)

    const quarantined = makeAdmin(profileDir, {
      fetchImpl,
      install: async () => ({
        changed: false,
        application: 'failed',
        error: { code: 'operation-error', diagnostic: 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION' },
      }),
    })
    const quarantineResult = await quarantined.admin.update({ name: targetName })
    assert('A4.1 隔离期分类', quarantineResult.ok === false && quarantineResult.code === 'quarantine', quarantineResult.code)

    const pending = makeAdmin(profileDir, { fetchImpl, install: async () => ({ changed: false, application: 'failed', pendingBuilds: ['cpu-features'] }) })
    const pendingResult = await pending.admin.update({ name: targetName })
    assert('A4.2 构建脚本分类', pendingResult.code === 'pending-builds', pendingResult.code)

    const refused = makeAdmin(profileDir, {
      fetchImpl,
      inspect: async () => ({ status: 'refused', problem: 'incompatible-version', reason: 'host 0.2.1-rc.2 不兼容' }),
    })
    const refusedResult = await refused.admin.update({ name: targetName })
    assert('A4.3 预检拒绝', refusedResult.ok === false && refusedResult.code === 'incompatible-version', refusedResult.code)
    assert('A4.4 预检拒绝不安装', refused.manager.installs.length === 0)

    const described = fake.admin.describe()
    assert('A5.1 describe 元数据', described.ok === true && described.version === 1 && described.pluginManager === true)
    assert('A5.2 更新后缓存失效触发重查', described.cached === undefined, 'cache cleared after update')
  }

  const failedCount = results.filter((item) => item.status === 'FAIL').length
  const skipCount = results.filter((item) => item.status === 'SKIP').length
  console.log(`\n插件管理后台端到端：${results.length - failedCount - skipCount}/${results.length - skipCount} 项通过${skipCount ? `，${skipCount} 项跳过` : ''}`)
  if (failedCount > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
