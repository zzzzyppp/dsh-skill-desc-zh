#!/usr/bin/env node
/**
 * Client 侧静态自检：在无浏览器环境里检查 manifest、ModuleLoader 约定、
 * locale 完整性和 require 白名单。它不能替代浏览器渲染验证。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const failures = []
const checks = []

function check(name, fn) {
  try {
    const detail = fn()
    checks.push({ name, ok: true, detail })
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
    failures.push(name)
  }
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
}

const pkg = readJson('package.json')
const client = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
const zh = readJson('locale/zh.json')
const en = readJson('locale/en.json')
const icon = fs.readFileSync(path.join(root, 'icon.svg'))

check('package name', () => {
  if (pkg.name !== 'dsh-skill-desc-zh') throw new Error(`unexpected name: ${pkg.name}`)
  return pkg.name
})

check('package version', () => {
  if (pkg.version !== '0.6.0') throw new Error(`expected 0.6.0, got ${pkg.version}`)
  return pkg.version
})

check('client export', () => {
  if (pkg.exports?.['./client'] !== './client.js') throw new Error('exports["./client"] must be ./client.js')
  return pkg.exports['./client']
})

check('locale export', () => {
  if (pkg.exports?.['./locale/*.json'] !== './locale/*.json') throw new Error('locale export missing')
  return pkg.exports['./locale/*.json']
})

check('client platform', () => {
  if (pkg.dsh?.client?.platform !== 'web') throw new Error('dsh.client.platform must be web')
  return 'web'
})

check('client entry id', () => {
  if (!client.includes("window.__ModuleLoader__.load({")) throw new Error('ModuleLoader.load call missing')
  if (!client.includes("id: 'dsh-skill-desc-zh'")) throw new Error('client module id must equal package name')
  return 'dsh-skill-desc-zh'
})

check('client factory', () => {
  if (!/factory\s*\(\s*require\s*\)/u.test(client)) throw new Error('factory(require) missing')
  if (!/module\.exports\s*=\s*\{/u.test(client)) throw new Error('module.exports missing')
  if (!/inject:\s*\[\s*'slots'\s*,\s*'locale'\s*\]/u.test(client)) throw new Error('inject must be slots+locale')
  return 'factory + exports + inject'
})

check('require allowlist', () => {
  const requests = [...client.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/gu)].map((match) => match[1])
  const unexpected = requests.filter((request) => request !== 'react')
  if (unexpected.length) throw new Error(`unexpected requires: ${unexpected.join(', ')}`)
  return requests.join(', ') || 'none'
})

check('single settings slot', () => {
  const injections = client.match(/ctx\.slots\.inject\('settings\.section'/gu) || []
  if (injections.length !== 1) throw new Error(`expected exactly one settings.section injection, got ${injections.length}`)
  if (!/order:\s*PAGE_ORDER/u.test(client) || !/PAGE_ORDER\s*=\s*16/u.test(client)) throw new Error('settings order must be PAGE_ORDER=16')
  if (!/label:\s*function\s*\(\s*\)\s*\{\s*return\s+t\('nav'\)/u.test(client)) throw new Error('locale-aware label thunk missing')
  if (!/locale:\s*NS/u.test(client)) throw new Error('slot locale missing')
  if (client.includes("id: 'plugin-admin'") || client.includes("id: 'skill-admin'")) throw new Error('extra admin slots must be removed')
  if (client.includes('ADMIN_ORDER') || client.includes('SKILL_ORDER')) throw new Error('ADMIN_ORDER/SKILL_ORDER must be removed')
  return 'settings.section order 16 (single)'
})

check('tabs', () => {
  if (!/TAB_STORAGE_KEY\s*=\s*'dsh-skill-desc-zh\.activeTab'/u.test(client)) throw new Error('tab storage key missing')
  if (!/id:\s*'translate'[\s\S]*?id:\s*'plugins'[\s\S]*?id:\s*'skills'/u.test(client)) throw new Error('TABS ids missing')
  if (!/labelKey:\s*'title'[\s\S]*?labelKey:\s*'plugins\.nav'[\s\S]*?labelKey:\s*'skills\.nav'/u.test(client)) throw new Error('TABS labelKey missing')
  if (!client.includes("role: 'tablist'") || !client.includes("role: 'tab'") || !client.includes("role: 'tabpanel'")) throw new Error('tab roles missing')
  if (!client.includes("'sdzh-tab-' + item.id") || !client.includes("'sdzh-panel-' + active")) throw new Error('tab/panel ids missing')
  if (!client.includes("if (selected) tabProps['aria-controls'] = 'sdzh-panel-' + active")) throw new Error('aria-controls must be active-only')
  if (!/h\(Boundary,\s*\{\s*key:\s*active/u.test(client)) throw new Error('Boundary key=active missing')
  if (!client.includes('BetterSkillPage')) throw new Error('BetterSkillPage missing')
  return 'one tablist + 3 tabs + tabpanel; active-only aria-controls; Boundary key=active'
})

check('skill admin api', () => {
  for (const api of ['listSkills', 'getSkillDetail', 'skillAction']) {
    if (!client.includes(api + ':')) throw new Error(`api method missing: ${api}`)
  }
  return 'listSkills + getSkillDetail + skillAction'
})

check('page version', () => {
  if (!/PAGE_VERSION\s*=\s*'0\.6\.0'/u.test(client)) throw new Error('PAGE_VERSION must be 0.6.0')
  return '0.6.0'
})

check('feature pages and APIs', () => {
  for (const page of ['SettingsPage', 'PluginAdminPage', 'SkillAdminPage', 'BetterSkillPage']) {
    if (!client.includes('function ' + page)) throw new Error(`page missing: ${page}`)
  }
  for (const api of ['listPlugins', 'checkPlugins', 'updatePlugin', 'listSkills', 'getSkillDetail', 'skillAction']) {
    if (!client.includes(api + ':')) throw new Error(`api method missing: ${api}`)
  }
  return '4 pages + 6 APIs'
})


check('locale registration', () => {
  if (!/ctx\.locale\.register\(NS,\s*DICT\)/u.test(client)) throw new Error('locale registration missing')
  if (!/ctx\.locale\.bind\(NS\)/u.test(client)) throw new Error('locale bind missing')
  return 'ctx.locale.register + bind'
})

check('locale key parity', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  const missingEn = zhKeys.filter((key) => !(key in en))
  const missingZh = enKeys.filter((key) => !(key in zh))
  if (missingEn.length || missingZh.length) throw new Error(`missing en=${missingEn.length} missing zh=${missingZh.length}`)
  const required = [
    'nav', 'title', 'subtitle', 'phase.active', 'phase.degraded', 'phase.failed', 'phase.restored',
    'summary.skills', 'summary.commands', 'summary.host', 'summary.project', 'summary.warnings',
    'toggle.label', 'toggle.hint', 'action.apply', 'action.restore', 'action.refresh',
    'action.retranslate', 'action.doctor', 'table.name', 'table.stale', 'table.shadow',
    'doctor.title', 'config.title', 'notices.title', 'error.unavailable', 'error.unauthorized',
    'tabs.label'
  ]
  required.push(
    'plugins.nav', 'plugins.title', 'plugins.check', 'plugins.update', 'plugins.updating',
    'plugins.stateAvailable', 'plugins.stateLatest', 'plugins.noticeSuccess', 'plugins.dialogTitle',
    'plugins.dialogBody', 'plugins.source.npm', 'plugins.colName', 'plugins.hostManager',
  )
  const inlineSkills = [...client.matchAll(/\['(skills\.[^']+)'/gu)].map((match) => match[1])
  if (inlineSkills.length < 80) throw new Error(`expected >=80 inline skill keys, got ${inlineSkills.length}`)
  const absentInline = inlineSkills.filter((key) => !(key in zh) || !(key in en))
  if (absentInline.length) throw new Error(`inline skill keys missing from locale: ${absentInline.slice(0, 8).join(', ')}`)
  const absent = required.filter((key) => !(key in zh))
  if (absent.length) throw new Error(`missing required keys: ${absent.join(', ')}`)
  const skillTotal = zhKeys.filter((key) => key.startsWith('skills.')).length
  if (skillTotal < 80) throw new Error(`expected >=80 skill locale keys, got ${skillTotal}`)
  if (zhKeys.length !== 298) throw new Error(`expected exactly 298 locale keys, got ${zhKeys.length}`)
  return `${zhKeys.length} keys (${inlineSkills.length} skill keys)`
})

check('icon', () => {
  if (!icon.includes('<svg')) throw new Error('icon.svg is not SVG')
  if (icon.length > 256 * 1024) throw new Error('icon.svg exceeds 256 KiB')
  return `${icon.length} bytes`
})

check('client syntax', () => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, 'client.js')], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || '').trim() || 'node --check failed')
  return 'node --check passed'
})

for (const item of checks) {
  console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? `: ${item.detail}` : ''}`)
}
if (failures.length) {
  console.error(`\ncheck:client failed: ${failures.length} check(s)`)
  process.exit(1)
}
console.log(`\ncheck:client passed: ${checks.length} checks`)
