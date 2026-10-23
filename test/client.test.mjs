import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

class ReactComponent {
  constructor(props) {
    this.props = props
  }
}

const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children } }
  },
  Component: ReactComponent,
  Fragment: 'Fragment',
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}]
}

function collectText(node) {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join(' ')
  if (node.props) return collectText(node.props.children)
  return ''
}

function loadClient() {
  const registrations = []
  globalThis.window = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration)
      }
    }
  }
  const url = new URL(`../client.js?test=${Date.now()}-${Math.random()}`, import.meta.url)
  return import(url.href).then(() => {
    assert.equal(registrations.length, 1, 'client.js must call ModuleLoader.load exactly once')
    return registrations[0]
  })
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

function makeCtx(activeLocale = 'zh') {
  const calls = { effects: [], injected: [], slots: [], locales: [] }
  let active = activeLocale
  const ctx = {
    effect(fn, label) {
      calls.effects.push(label)
      return fn()
    },
    locale: {
      register(ns, dict) {
        calls.locales.push({ ns, dict })
        return () => {}
      },
      bind(ns) {
        return (key, params) => {
          const template = dictFor(active)[key] ?? key
          if (!params) return template
          return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
        }
      }
    },
    slots: {
      inject(name, fn) {
        calls.injected.push(name)
        fn()
      },
      register(spec, Component) {
        calls.slots.push({ spec, Component })
        return () => {}
      }
    }
  }
  return {
    ctx,
    calls,
    setLocale(locale) {
      active = locale
    }
  }
}

let dictFor = (locale) => JSON.parse(fs.readFileSync(path.join(root, 'locale', `${locale}.json`), 'utf8'))

const registration = await loadClient()
const plugin = registration.factory((request) => {
  assert.equal(request, 'react')
  return ReactStub
})
const internals = plugin.__test__

test('client 注册：id、factory、注入与设置页 slot', () => {
  assert.equal(registration.id, 'dsh-skill-desc-zh')
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(internals.PAGE_ORDER, 16)
  const env = makeCtx('zh')
  plugin.apply(env.ctx)
  assert.equal(env.calls.injected.length, 1)
  assert.equal(env.calls.injected[0], 'settings.section')
  assert.equal(env.calls.slots.length, 1)
  const { spec, Component } = env.calls.slots[0]
  assert.equal(spec.name, 'settings.section')
  assert.equal(spec.id, 'skill-desc-zh')
  assert.equal(spec.order, 16)
  assert.equal(spec.order, internals.PAGE_ORDER)
  assert.equal(spec.locale, 'skill-desc-zh')
  assert.equal(spec.label(), 'Better Skill')
  assert.equal(typeof Component, 'function')
  env.setLocale('en')
  assert.equal(spec.label(), 'Better Skill')
  assert.equal(env.calls.locales[0].ns, 'skill-desc-zh')
  assert.equal(env.calls.effects[0], 'skill-desc-zh: locale')
})

test('locale 文件完整、zh/en key 一致、通过 DICT 校验', () => {
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'en.json'), 'utf8'))
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(internals.DICT.zh).sort())
  assert.deepEqual(Object.keys(en).sort(), Object.keys(internals.DICT.en).sort())
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.equal(Object.keys(zh).length, 298)
  assert.ok(Object.keys(zh).filter((key) => key.startsWith('skills.')).length >= 80)
  assert.equal(zh.nav, 'Better Skill')
  assert.equal(en.nav, 'Better Skill')
  assert.equal(zh['tabs.label'], '功能区')
  assert.equal(en['tabs.label'], 'Sections')
  assert.deepEqual(internals.TAB_IDS, ['translate', 'plugins', 'skills'])
  assert.deepEqual(internals.TAB_LABELS, { translate: 'title', plugins: 'plugins.nav', skills: 'skills.nav' })
  assert.equal(internals.translate('zh', 'action.done', { action: '应用' }), '应用完成')
  assert.equal(internals.translate('en', 'action.done', { action: 'Apply' }), 'Apply finished')
})

test('fetch 封装：GET state/doctor、POST action 的 URL 与载荷', async () => {
  const calls = []
  const api = internals.createApi(async (url, init) => {
    calls.push({ url, init })
    return response({ ok: true, state: { phase: 'active' } })
  })
  const state = await api.getState({ projectRoot: '/tmp/a b' })
  assert.equal(state.state.phase, 'active')
  assert.equal(calls[0].url, '/plugins/skill-desc-zh/state?projectRoot=%2Ftmp%2Fa%20b')
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.equal(calls[0].init.cache, 'no-store')

  await api.getDoctor({ projectRoot: '/p' })
  assert.equal(calls[1].url, '/plugins/skill-desc-zh/doctor?projectRoot=%2Fp')

  await api.postAction('retranslate', { names: ['office', 'agent-experience'], projectRoot: '/p', force: true })
  assert.equal(calls[2].url, '/plugins/skill-desc-zh/action')
  assert.equal(calls[2].init.method, 'POST')
  assert.equal(calls[2].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    action: 'retranslate',
    names: ['office', 'agent-experience'],
    projectRoot: '/p',
    force: true
  })
})

test('fetch 封装：技能列表/详情/动作的 URL 与载荷', async () => {
  const calls = []
  const api = internals.createApi(async (url, init) => {
    calls.push({ url, init })
    return response({ ok: true, skills: [], trash: { count: 0, items: [] } })
  })
  await api.listSkills({ projectRoot: '/tmp/a b', source: 'user', refresh: true })
  assert.equal(calls[0].url, '/plugins/skill-desc-zh/skills?projectRoot=%2Ftmp%2Fa%20b&source=user&refresh=1')
  assert.equal(calls[0].init.credentials, 'same-origin')

  await api.getSkillDetail({ scope: 'project', name: 'demo skill', projectRoot: '/p' })
  assert.equal(calls[1].url, '/plugins/skill-desc-zh/skills/detail?scope=project&name=demo%20skill&projectRoot=%2Fp')

  await api.skillAction('save', {
    scope: 'user',
    name: 'demo',
    description: 'desc',
    body: '# body',
    expectedFingerprint: 'sha256:abc'
  })
  assert.equal(calls[2].url, '/plugins/skill-desc-zh/skills/action')
  assert.equal(calls[2].init.method, 'POST')
  assert.equal(calls[2].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    action: 'save',
    scope: 'user',
    name: 'demo',
    description: 'desc',
    body: '# body',
    expectedFingerprint: 'sha256:abc'
  })
})

test('tab 纯函数：读写、非法值、storage 抛错、nextTabId 环绕与 Home/End', () => {
  const memory = {
    value: null,
    getItem(key) { assert.equal(key, internals.TAB_STORAGE_KEY); return this.value },
    setItem(key, value) { assert.equal(key, internals.TAB_STORAGE_KEY); this.value = value }
  }
  assert.equal(internals.TAB_STORAGE_KEY, 'dsh-skill-desc-zh.activeTab')
  assert.equal(internals.readStoredTab(memory), 'translate')
  assert.equal(internals.writeStoredTab('plugins', memory), true)
  assert.equal(memory.value, 'plugins')
  assert.equal(internals.selectInitialTab(memory), 'plugins')
  assert.equal(internals.writeStoredTab(memory, 'skills'), true)
  assert.equal(memory.value, 'skills')
  assert.equal(internals.writeStoredTab('nope', memory), false)
  assert.equal(internals.readStoredTab(memory), 'skills')

  const throwing = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') }
  }
  assert.equal(internals.readStoredTab(throwing), 'translate')
  assert.equal(internals.writeStoredTab('plugins', throwing), false)
  assert.equal(internals.selectInitialTab(null), 'translate')

  assert.equal(internals.nextTabId('translate', 'ArrowLeft'), 'skills')
  assert.equal(internals.nextTabId('skills', 'ArrowRight'), 'translate')
  assert.equal(internals.nextTabId('plugins', 'Home'), 'translate')
  assert.equal(internals.nextTabId('plugins', 'End'), 'skills')
  assert.equal(internals.nextTabId('plugins', 'Escape'), 'plugins')
  assert.equal(internals.nextTabId('nope', 'ArrowRight'), 'plugins')
})

test('BetterSkillPage：默认描述中文化、tablist 三 Tab 与 aria', () => {
  const tree = internals.BetterSkillPage({ t: (key) => key })
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'sdzh-page sdzh-page-tabs')
  const tabbar = tree.props.children.find((child) => child.props && child.props.role === 'tablist')
  assert.ok(tabbar)
  assert.equal(tabbar.props['aria-label'], 'tabs.label')
  const tabs = Array.isArray(tabbar.props.children[0]) ? tabbar.props.children[0] : tabbar.props.children
  assert.equal(tabs.length, 3)
  assert.deepEqual(tabs.map((tab) => tab.props.id), ['sdzh-tab-translate', 'sdzh-tab-plugins', 'sdzh-tab-skills'])
  assert.equal(tabs[0].props['aria-controls'], 'sdzh-panel-translate')
  assert.equal(tabs[1].props['aria-controls'], undefined)
  assert.equal(tabs[2].props['aria-controls'], undefined)
  assert.equal(tabs[0].props['aria-selected'], 'true')
  assert.equal(tabs[0].props.tabIndex, 0)
  assert.equal(tabs[1].props['aria-selected'], 'false')
  assert.equal(tabs[1].props.tabIndex, -1)
  const panel = tree.props.children.find((child) => child.props && child.props.role === 'tabpanel')
  assert.ok(panel)
  assert.equal(panel.props.id, 'sdzh-panel-translate')
  assert.equal(panel.props['aria-labelledby'], 'sdzh-tab-translate')
  const boundary = panel.props.children[0]
  assert.equal(boundary.type, internals.Boundary)
  assert.equal(boundary.props.key, 'translate')
  assert.equal(boundary.props.children[0].type, internals.SettingsPage)
})

test('BetterSkillPage：Boundary key 随 active 变化，切 Tab 重建失败边界', () => {
  globalThis.localStorage = {
    value: 'translate',
    getItem() { return this.value },
    setItem(key, value) { this.value = value }
  }
  try {
    function keyFor(tab) {
      globalThis.localStorage.value = tab
      const tree = internals.BetterSkillPage({ t: (key) => key })
      const panel = tree.props.children.find((child) => child.props && child.props.role === 'tabpanel')
      return panel.props.children[0].props.key
    }
    const keys = [keyFor('translate'), keyFor('plugins'), keyFor('skills')]
    assert.deepEqual(keys, ['translate', 'plugins', 'skills'])
    assert.notEqual(keys[0], keys[1])
    assert.notEqual(keys[1], keys[2])
  } finally {
    delete globalThis.localStorage
  }
})

test('BetterSkillPage：localStorage 选择初始 Tab，只挂载当前页', () => {
  globalThis.localStorage = {
    value: 'plugins',
    getItem() { return this.value },
    setItem(key, value) { this.value = value }
  }
  try {
    const tree = internals.BetterSkillPage({ t: (key) => key })
    const panel = tree.props.children.find((child) => child.props && child.props.role === 'tabpanel')
    assert.equal(panel.props.id, 'sdzh-panel-plugins')
    assert.equal(panel.props.children[0].props.children[0].type, internals.PluginAdminPage)
    const tabbar = tree.props.children.find((child) => child.props && child.props.role === 'tablist')
    const tabs = Array.isArray(tabbar.props.children[0]) ? tabbar.props.children[0] : tabbar.props.children
    assert.equal(tabs[0].props['aria-controls'], undefined)
    assert.equal(tabs[1].props['aria-controls'], 'sdzh-panel-plugins')
    assert.equal(tabs[2].props['aria-controls'], undefined)
    assert.equal(tabs[1].props['aria-selected'], 'true')
    assert.equal(tabs[1].props.tabIndex, 0)
    assert.equal(panel.props.children[0].props.key, 'plugins')
  } finally {
    delete globalThis.localStorage
  }
})

test('SkillAdminPage：静态渲染标题与加载文案', () => {
  const tree = internals.SkillAdminPage({ t: (key) => key })
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'sdx-page')
  const card = tree.props.children.find((child) => child.props && child.props.title === 'skills.title')
  assert.ok(card, 'loading card title must be skills.title')
  const spinner = card.props.children.find((child) => child.props && child.props.label)
  assert.equal(spinner.props.label, 'skills.refresh')
})

test('fetch 封装：401/503/网络错误保留 status/code 且可映射', async () => {
  const unauthorized = internals.createApi(async () => response({ error: 'unauthorized', message: 'bad token' }, 401))
  await assert.rejects(unauthorized.getState(), (error) => {
    assert.equal(error.status, 401)
    assert.equal(error.code, 'unauthorized')
    assert.equal(internals.errorInfo((key) => key, error).title, 'error.unauthorized')
    assert.equal(internals.errorInfo((key) => key, error).retry, false)
    return true
  })
  const unavailable = internals.createApi(async () => response({ error: 'unavailable', message: 'restart' }, 503))
  await assert.rejects(unavailable.getState(), (error) => {
    assert.equal(internals.errorInfo((key) => key, error).title, 'error.unavailable')
    assert.equal(internals.errorInfo((key) => key, error).retry, true)
    return true
  })
  const busy = internals.createApi(async () => response({ ok: false, error: { code: 'busy', message: 'another action is running' } }, 409))
  await assert.rejects(busy.postAction('apply'), (error) => {
    assert.equal(error.status, 409)
    assert.equal(error.code, 'busy')
    assert.equal(error.message, 'another action is running')
    assert.equal(internals.errorInfo((key) => key, error).title, 'error.busy')
    return true
  })
  const network = internals.createApi(async () => {
    throw new TypeError('connection refused')
  })
  await assert.rejects(network.getState(), (error) => {
    assert.equal(error.code, 'network')
    assert.equal(internals.errorInfo((key) => key, error).title, 'error.network')
    return true
  })
})

test('targets 归一化：优先 targets，回退 details 解析出 15 行', () => {
  const details = [
    ...[
      'office', 'office-docx', 'office-export-pdf', 'office-pptx',
      'office-recalculate', 'office-render', 'office-xlsx', 'office'
    ].map((name, index) => `${name}${index === 0 ? '' : '-' + index} [global/dsh-office] 中文 · engine=llm`),
    ...[
      'agent-experience', 'cordis-composition-reference', 'cordis-plugin-development', 'editing-cordis-compositions'
    ].map((name) => `${name} [preset/dsh-skill-filesystem] 中文 · engine=llm`),
    ...['acp', 'acp-cache', 'agent-teams'].map((name) => `/${name} [command/agent] 中文 · engine=dictionary`)
  ]
  const targets = internals.normalizeTargets({ details })
  assert.equal(targets.length, 15)
  assert.equal(targets.filter((target) => target.kind === 'command').length, 3)
  assert.equal(targets[0].kind, 'skill')
  assert.equal(targets[0].current, 'zh')
  assert.equal(targets[0].engine, 'llm')

  const explicit = internals.normalizeTargets({
    targets: [{ id: 'skill:x', kind: 'skill', layer: 'global', name: 'x', current: 'en' }]
  })
  assert.equal(explicit.length, 1)
  assert.equal(explicit[0].current, 'en')
})

test('counts/engines 派生与 phase token', () => {
  const targets = [
    { kind: 'skill', current: 'zh', engine: 'llm' },
    { kind: 'skill', current: 'en', engine: 'dictionary' },
    { kind: 'command', current: 'zh', engine: 'dictionary' }
  ]
  const counts = internals.deriveCounts(targets, {
    counts: { zh: 1, total: 12 },
    commands: { zh: 1, total: 3 }
  })
  assert.deepEqual(counts, { skills: { zh: 1, total: 12 }, commands: { zh: 1, total: 3 } })
  assert.deepEqual(internals.deriveEngines(targets, null), { llm: 1, dictionary: 2, source: 0, none: 0 })
  assert.equal(internals.phaseToken('active'), '--dsw-alias-state-success-primary')
  assert.equal(internals.phaseToken('failed'), '--dsw-alias-state-danger-primary')
  assert.equal(internals.phaseToken('restored'), '--dsw-alias-brand-primary')
  assert.equal(internals.phaseToken('nope'), '--dsw-alias-label-secondary')
})

test('manifest：version/exports/dsh.client/files/check 脚本', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.version, '0.6.0')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('client.js'))
  assert.ok(pkg.files.includes('locale'))
  assert.equal(pkg.scripts['check:client'], 'node scripts/check-client.mjs')
  assert.ok(fs.existsSync(path.join(root, 'icon.svg')))
  assert.ok(fs.statSync(path.join(root, 'icon.svg')).size < 256 * 1024)
})
