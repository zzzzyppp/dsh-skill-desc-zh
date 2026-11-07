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
  assert.deepEqual(env.calls.injected, ['settings.section', 'settings.section.icon'])
  assert.equal(env.calls.slots.length, 2)
  const iconEntry = env.calls.slots.find((entry) => entry.spec.name === 'settings.section.icon')
  const sectionEntry = env.calls.slots.find((entry) => entry.spec.name === 'settings.section')
  assert.ok(iconEntry && sectionEntry)
  const iconSpec = iconEntry.spec
  assert.equal(iconSpec.id, 'skill-desc-zh')
  assert.equal(iconEntry.Component.name, 'BetterSkillIconSlot')
  const { spec, Component } = sectionEntry
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

test('settings.section.icon：译图标跟随 active/size 与主题变量', () => {
  const passive = internals.BetterSkillIcon({ size: 20, active: false })
  assert.equal(passive.type, 'svg')
  assert.equal(passive.props.width, 25)
  assert.equal(passive.props.height, 25)
  assert.ok(String(passive.props.style.color).includes('--dsw-alias-label-primary'))
  const active = internals.BetterSkillIcon({ size: 99, active: true })
  assert.equal(active.props.width, 40)
  assert.equal(active.props.height, 40)
  assert.ok(String(active.props.style.color).includes('--dsw-alias-brand-primary'))
  assert.equal(collectText(active).trim(), '译')
})

test('locale 文件完整、zh/en key 一致、通过 DICT 校验', () => {
  const zh = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'en.json'), 'utf8'))
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(internals.DICT.zh).sort())
  assert.deepEqual(Object.keys(en).sort(), Object.keys(internals.DICT.en).sort())
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.equal(Object.keys(zh).length, 345)
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

test('BetterSkillPage：默认描述汉化、tablist 三 Tab 与 aria', () => {
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
  assert.equal(pkg.version, '0.7.0')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('client.js'))
  assert.ok(pkg.files.includes('locale'))
  assert.equal(pkg.scripts['check:client'], 'node scripts/check-client.mjs')
  assert.ok(fs.existsSync(path.join(root, 'icon.svg')))
  assert.ok(fs.statSync(path.join(root, 'icon.svg')).size < 256 * 1024)
})

/* ---------------------------------------------------------------------------
 * v0.7.0 插件索引：假 remote + 轻量 hooks 渲染器
 * ------------------------------------------------------------------------- */

function createHooksReact() {
  let slots = []
  let cursor = 0
  let pendingEffects = []
  let mounted = false
  let renderRoot = null
  let scheduled = false
  let disposed = false
  let tree = null

  function sameDeps(a, b) {
    if (!a || !b) return false
    return a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  }

  function schedule() {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (!disposed) render()
    })
  }

  function useState(initial) {
    const index = cursor++
    if (!slots[index]) {
      slots[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
    }
    const slot = slots[index]
    return [slot.value, (next) => {
      if (disposed) return
      const value = typeof next === 'function' ? next(slot.value) : next
      if (Object.is(value, slot.value)) return
      slot.value = value
      schedule()
    }]
  }

  function useRef(initial) {
    const index = cursor++
    if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initial } }
    return slots[index].value
  }

  function useMemo(fn, deps) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDeps(slot.deps, deps)) {
      slots[index] = { kind: 'memo', value: fn(), deps }
    }
    return slots[index].value
  }

  function useCallback(fn, deps) {
    const index = cursor++
    const slot = slots[index]
    if (!slot || !sameDeps(slot.deps, deps)) {
      slots[index] = { kind: 'callback', value: fn, deps }
    }
    return slots[index].value
  }

  function useEffect(fn, deps) {
    const index = cursor++
    pendingEffects.push({ index, fn, deps })
  }

  function runEffects() {
    const list = pendingEffects
    pendingEffects = []
    for (const effect of list) {
      const slot = slots[effect.index]
      if (slot && slot.deps && effect.deps && sameDeps(slot.deps, effect.deps)) continue
      if (slot && typeof slot.cleanup === 'function') slot.cleanup()
      const cleanup = effect.fn()
      slots[effect.index] = { kind: 'effect', deps: effect.deps, cleanup }
    }
  }

  function render() {
    if (!renderRoot) return
    cursor = 0
    pendingEffects = []
    tree = renderRoot()
    runEffects()
  }

  function mount(Component, props) {
    renderRoot = () => Component(props)
    mounted = true
    render()
    return tree
  }

  function unmount() {
    disposed = true
    for (const slot of slots) {
      if (slot && typeof slot.cleanup === 'function') slot.cleanup()
    }
    slots = []
    renderRoot = null
    mounted = false
  }

  async function flush(rounds = 8) {
    for (let i = 0; i < rounds; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  const react = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children } }
    },
    Component: ReactComponent,
    Fragment: 'Fragment',
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
  }

  return {
    react,
    mount,
    unmount,
    flush,
    getTree: () => tree,
    isMounted: () => mounted
  }
}

function collectAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    node.forEach((item) => collectAll(item, predicate, out))
    return out
  }
  if (predicate(node)) out.push(node)
  collectAll(node.props && node.props.children, predicate, out)
  return out
}

function findButton(node, label) {
  return collectAll(node, (item) => item.type === 'button' && collectText(item).includes(label))[0]
}

function findClickable(node, label) {
  return collectAll(node, (item) => item.props && typeof item.props.onClick === 'function' && collectText(item).includes(label))[0]
}

async function loadClientWith(reactImpl) {
  const registrations = []
  globalThis.window = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration)
      }
    }
  }
  const url = new URL(`../client.js?hooks=${Date.now()}-${Math.random()}`, import.meta.url)
  await import(url.href)
  assert.equal(registrations.length, 1)
  return registrations[0].factory((request) => {
    assert.equal(request, 'react')
    return reactImpl
  })
}

function makeIndexEnv(options = {}) {
  const calls = { indexes: 0, search: [] }
  const listeners = new Map()
  let failSources = Boolean(options.sourcesError)
  let failSearch = false
  const sources = options.sources || [
    { url: 'https://index.example/a', title: { zh: '源 A', en: 'Source A' } },
    { url: 'https://index.example/b', title: { zh: '源 B', en: 'Source B' } }
  ]
  const market = {
    async listIndexes() {
      calls.indexes += 1
      if (failSources) throw new Error('sources down')
      return sources
    },
    async search(url, query) {
      calls.search.push({ url, query })
      if (failSearch) throw new Error('search down')
      if (options.search) return options.search(url, query)
      return {
        url,
        title: 'Index',
        fetchedAt: 'f1',
        metadata: {
          categories: { tools: { title: { en: 'Tools', 'zh-CN': '工具' } } },
          labels: { demo: { title: { en: 'Demo', 'zh-CN': '演示' } } },
          sortKeys: {}
        },
        entries: [{
          name: 'alpha',
          title: { zh: '阿尔法', en: 'Alpha' },
          description: { zh: '一个示例插件。', en: 'An example plugin.' },
          author: 'Alice',
          homepage: 'https://example.com/alpha',
          repository: 'https://github.com/example/alpha',
          defaultVersion: '1.2.0',
          versions: [
            { version: '1.2.0', compatibility: { compatible: true }, install: { spec: 'alpha@1.2.0', registry: 'https://registry.example' } },
            { version: '2.0.0-beta.1', compatibility: { compatible: false, runtimeVersion: '0.2.1' } }
          ],
          installation: { status: 'update-available', installedVersion: '1.0.0' },
          metadata: { category: 'tools', labels: ['demo'] }
        }],
        total: 1,
        nextOffset: null
      }
    }
  }
  const remote = {
    pluginMarket: market,
    $on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(callback)
      return () => {
        const list = listeners.get(name) || []
        const index = list.indexOf(callback)
        if (index >= 0) list.splice(index, 1)
      }
    }
  }
  const ctx = {
    remote: options.noRemote ? undefined : remote,
    locale: {
      resolveText(value) {
        if (typeof value === 'string') return value
        if (value && typeof value === 'object') return value['zh-CN'] || value.zh || value.en || ''
        return ''
      }
    },
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(callback)
      return () => {
        const list = listeners.get(name) || []
        const index = list.indexOf(callback)
        if (index >= 0) list.splice(index, 1)
      }
    }
  }
  return {
    calls,
    ctx,
    market,
    emit(name) {
      (listeners.get(name) || []).slice().forEach((callback) => callback())
    },
    failSources(value) { failSources = value },
    failSearch(value) { failSearch = value }
  }
}

async function mountIndex(options = {}) {
  const env = makeIndexEnv(options)
  const hooks = createHooksReact()
  const plugin = await loadClientWith(hooks.react)
  const internals = plugin.__test__
  const t = (key, params) => internals.translate('zh', key, params)
  const bridge = internals.installPluginMarketBridge(env.ctx)
  hooks.mount(internals.PluginIndexView, { t, ctx: env.ctx })
  await hooks.flush()
  return { env, hooks, plugin, internals, t, bridge }
}

test('plugin index：初始加载、来源、状态与只读详情', async () => {
  const mounted = await mountIndex()
  const { env, hooks } = mounted
  try {
    assert.equal(env.calls.indexes, 1)
    assert.equal(env.calls.search.length, 1)
    assert.deepEqual(env.calls.search[0].query, { sort: { kind: 'index' }, offset: 0, limit: 50 })
    const internals = mounted.internals
    let rows = collectAll(hooks.getTree(), (node) => node.type === internals.PluginIndexRow)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].props.entry.name, 'alpha')
    assert.equal(rows[0].props.metadata.categories.tools.title['zh-CN'], '工具')
    assert.equal(rows[0].props.expanded, false)
    assert.match(collectText(hooks.getTree()), /共 1 个/u)

    rows[0].props.onToggle('alpha')
    await hooks.flush()
    rows = collectAll(hooks.getTree(), (node) => node.type === internals.PluginIndexRow)
    assert.equal(rows[0].props.expanded, true)
  } finally {
    hooks.unmount()
    mounted.bridge()
  }
})

test('plugin index：切换索引源与 250ms 搜索防抖', async () => {
  const mounted = await mountIndex({
    search: (url, query) => ({
      url,
      title: 'Index',
      fetchedAt: 'f1',
      entries: [{
        name: url.endsWith('/b') ? 'bravo' : 'alpha',
        title: url.endsWith('/b') ? '布拉沃' : '阿尔法',
        versions: [{ version: '1.0.0', compatibility: { compatible: true } }],
        defaultVersion: '1.0.0',
        installation: { status: 'installed' }
      }],
      total: 1,
      nextOffset: null
    })
  })
  const { env, hooks } = mounted
  try {
    const select = collectAll(hooks.getTree(), (node) => node.type === 'select')[0]
    assert.ok(select)
    assert.equal(env.calls.search[0].url, 'https://index.example/a')
    select.props.onChange({ target: { value: 'https://index.example/b' } })
    await hooks.flush()
    assert.equal(env.calls.search.at(-1).url, 'https://index.example/b')
    const bRows = collectAll(hooks.getTree(), (node) => node.type === mounted.internals.PluginIndexRow)
    assert.equal(bRows[0].props.entry.name, 'bravo')

    const input = collectAll(hooks.getTree(), (node) => node.type === 'input')[0]
    const before = env.calls.search.length
    input.props.onChange({ target: { value: 'bravo' } })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(env.calls.search.length, before, '250ms 内不应发起搜索')
    await new Promise((resolve) => setTimeout(resolve, 260))
    await hooks.flush()
    assert.equal(env.calls.search.length, before + 1)
    assert.equal(env.calls.search.at(-1).query.text, 'bravo')
  } finally {
    hooks.unmount()
    mounted.bridge()
  }
})

test('plugin index：加载更多使用同一 fetchedAt 并按 name 去重', async () => {
  const mounted = await mountIndex({
    search: (url, query) => ({
      url,
      title: 'Index',
      fetchedAt: 'session-1',
      entries: query.offset === 0
        ? [
            { name: 'alpha', title: '阿尔法', versions: [{ version: '1.0.0' }], defaultVersion: '1.0.0' },
            { name: 'beta', title: '贝塔', versions: [{ version: '1.0.0' }], defaultVersion: '1.0.0' }
          ]
        : [
            { name: 'beta', title: '贝塔', versions: [{ version: '1.0.0' }], defaultVersion: '1.0.0' },
            { name: 'gamma', title: '伽马', versions: [{ version: '2.0.0' }], defaultVersion: '2.0.0' }
          ],
      total: 3,
      nextOffset: query.offset === 0 ? 2 : null
    })
  })
  const { env, hooks } = mounted
  try {
    assert.equal(env.calls.search[0].query.offset, 0)
    const more = findClickable(hooks.getTree(), '加载更多')
    assert.ok(more, '加载更多按钮应存在')
    more.props.onClick()
    await hooks.flush()
    assert.equal(env.calls.search.length, 2)
    assert.equal(env.calls.search[1].query.offset, 2)
    assert.equal(env.calls.search[1].query.fetchedAt, 'session-1')
    const rows = collectAll(hooks.getTree(), (node) => node.type === mounted.internals.PluginIndexRow)
    assert.deepEqual(rows.map((node) => node.props.entry.name), ['alpha', 'beta', 'gamma'])
  } finally {
    hooks.unmount()
    mounted.bridge()
  }
})

test('plugin index：事件自动同步，卸载后不再响应', async () => {
  const mounted = await mountIndex()
  const { env, hooks } = mounted
  try {
    assert.equal(env.calls.indexes, 1)
    assert.equal(env.calls.search.length, 1)
    env.emit('plugin-market/changed')
    await hooks.flush()
    assert.equal(env.calls.indexes, 2)
    assert.equal(env.calls.search.length, 2)

    env.emit('plugin-manager/changed')
    await hooks.flush()
    assert.equal(env.calls.indexes, 2, '安装状态变化不应重读索引源')
    assert.equal(env.calls.search.length, 3)
    assert.equal(env.calls.search.at(-1).query.refresh, true)

    env.emit('connection/reset')
    await hooks.flush()
    assert.equal(env.calls.indexes, 3)

    hooks.unmount()
    mounted.bridge()
    const before = { indexes: env.calls.indexes, search: env.calls.search.length }
    env.emit('plugin-market/changed')
    await hooks.flush()
    assert.deepEqual({ indexes: env.calls.indexes, search: env.calls.search.length }, before)
  } finally {
    hooks.unmount()
    mounted.bridge()
  }
})

test('plugin index：缺少 remote 时降级，不阻塞插件页', async () => {
  const mounted = await mountIndex({ noRemote: true })
  try {
    assert.match(collectText(mounted.hooks.getTree()), /当前宿主未提供插件索引服务/u)
    assert.equal(mounted.env.calls.search.length, 0)
  } finally {
    mounted.hooks.unmount()
    mounted.bridge()
  }
})

test('plugin index：源错误可重试；搜索失败保留旧列表', async () => {
  const failing = await mountIndex({ sourcesError: true })
  try {
    assert.match(collectText(failing.hooks.getTree()), /索引源加载失败/u)
    failing.env.failSources(false)
    const retry = findClickable(failing.hooks.getTree(), '重试')
    assert.ok(retry)
    retry.props.onClick()
    await failing.hooks.flush()
    assert.equal(failing.env.calls.indexes, 2)
    assert.ok(collectAll(failing.hooks.getTree(), (node) => node.type === failing.internals.PluginIndexRow).length)
  } finally {
    failing.hooks.unmount()
    failing.bridge()
  }

  const normal = await mountIndex()
  try {
    normal.env.failSearch(true)
    normal.env.emit('plugin-manager/changed')
    await normal.hooks.flush()
    const text = collectText(normal.hooks.getTree())
    assert.match(text, /搜索失败/u)
    const rows = collectAll(normal.hooks.getTree(), (node) => node.type === normal.internals.PluginIndexRow)
    assert.equal(rows[0].props.entry.name, 'alpha', '失败时保留旧列表')
  } finally {
    normal.hooks.unmount()
    normal.bridge()
  }
})

test('plugin index metadata：Record 形状取 title，数组形状仅作 defensive 兼容', async () => {
  const hooks = createHooksReact()
  const plugin = await loadClientWith(hooks.react)
  const internals = plugin.__test__
  const ctx = { locale: { resolveText: (value) => (typeof value === 'string' ? value : value['zh-CN'] || value.zh || value.en || '') } }
  const record = internals.indexTextList(ctx, {
    tools: { title: { en: 'Tools', 'zh-CN': '工具' } },
    lint: { title: { en: 'Lint' } }
  })
  assert.deepEqual(record, [{ id: 'tools', title: '工具' }, { id: 'lint', title: 'Lint' }])
  const legacy = internals.indexTextList(ctx, ['工具', { title: { zh: '演示' } }])
  assert.deepEqual(legacy, [{ id: '工具', title: '工具' }, { id: '1', title: '演示' }])
})

test('plugin index metadata：缺失/非法 title 回退 id，不产生 [object Object]', async () => {
  const hooks = createHooksReact()
  const plugin = await loadClientWith(hooks.react)
  const internals = plugin.__test__
  const ctx = {
    locale: {
      resolveText: (value) => (typeof value === 'string' ? value : ((value && (value['zh-CN'] || value.zh || value.en)) || ''))
    }
  }
  const record = internals.indexTextList(ctx, {
    tools: { title: { en: 'Tools', 'zh-CN': '工具' } },
    empty: {}
  })
  assert.deepEqual(record, [{ id: 'tools', title: '工具' }, { id: 'empty', title: 'empty' }])

  const legacy = internals.indexTextList(ctx, ['x', {}, { title: 'T' }])
  assert.deepEqual(legacy, [{ id: 'x', title: 'x' }, { id: '2', title: 'T' }])

  const tags = internals.indexEntryTags(
    ctx,
    { metadata: { category: 'empty', labels: ['emptyLabel', 'known'] } },
    {
      categories: { tools: { title: { en: 'Tools', 'zh-CN': '工具' } }, empty: {} },
      labels: { emptyLabel: {}, known: { title: { en: 'Known' } } }
    }
  )
  assert.deepEqual(tags.categories, [{ id: 'empty', title: 'empty' }])
  assert.deepEqual(tags.labels, [{ id: 'emptyLabel', title: 'emptyLabel' }, { id: 'known', title: 'Known' }])

  const output = JSON.stringify([record, legacy, tags])
  assert.ok(!output.includes('[object Object]'), output)
  assert.deepEqual(internals.indexTextList(ctx, null), [])
  assert.deepEqual(internals.indexTextList(ctx, undefined), [])
  assert.deepEqual(internals.indexTextList(ctx, 'string'), [])
})

test('plugin index compat：exempted 优先于 incompatible', async () => {
  const hooks = createHooksReact()
  const plugin = await loadClientWith(hooks.react)
  const internals = plugin.__test__
  const t = (key, params) => internals.translate('zh', key, params)
  const ctx = { locale: { resolveText: (value) => (typeof value === 'string' ? value : value.zh || value.en || '') } }
  const makeEntry = (compatibility) => ({
    name: 'alpha',
    title: { zh: '阿尔法' },
    defaultVersion: '1.0.0',
    versions: [{ version: '1.0.0', compatibility }],
    metadata: { categories: { tools: { title: { zh: '工具' } } }, labels: {} }
  })

  const exempted = makeEntry({ compatible: false, runtimeVersion: '0.2.1', exempted: true })
  const info = internals.indexCompatInfo(exempted, t)
  assert.equal(info.label, '已豁免')
  assert.equal(info.tone, 'warning')
  assert.notEqual(info.label, '不兼容（宿主 0.2.1）')

  hooks.mount(internals.PluginIndexRow, { t, ctx, entry: exempted, expanded: true, onToggle: () => {} })
  await hooks.flush()
  const exemptedText = collectText(hooks.getTree())
  assert.match(exemptedText, /已豁免/u)
  assert.ok(!/不兼容/u.test(exemptedText), 'exempted 不应同时显示不兼容')
  hooks.unmount()

  const blocked = makeEntry({ compatible: false, runtimeVersion: '0.2.1', exempted: false })
  const blockedInfo = internals.indexCompatInfo(blocked, t)
  assert.equal(blockedInfo.label, '不兼容（宿主 0.2.1）')
  assert.equal(blockedInfo.tone, 'danger')
  hooks.mount(internals.PluginIndexRow, { t, ctx, entry: blocked, expanded: true, onToggle: () => {} })
  await hooks.flush()
  const blockedText = collectText(hooks.getTree())
  assert.match(blockedText, /不兼容（宿主 0\.2\.1）/u)
  assert.ok(!/已豁免/u.test(blockedText))
  hooks.unmount()
})

test('plugin index row：状态徽章、兼容性、版本与外链只读展示', async () => {
  const hooks = createHooksReact()
  const plugin = await loadClientWith(hooks.react)
  const internals = plugin.__test__
  const t = (key, params) => internals.translate('zh', key, params)
  const entry = {
    name: 'alpha',
    title: { zh: '阿尔法', en: 'Alpha' },
    description: { zh: '一个示例插件。', en: 'An example plugin.' },
    icon: 'https://example.com/icon.png',
    author: 'Alice',
    homepage: 'https://example.com/alpha',
    repository: 'https://github.com/example/alpha',
    defaultVersion: '2.0.0-beta.1',
    versions: [
      { version: '1.2.0', compatibility: { compatible: true }, install: { spec: 'alpha@1.2.0' } },
      { version: '2.0.0-beta.1', compatibility: { compatible: false, runtimeVersion: '0.2.1' }, install: { spec: 'alpha@2.0.0-beta.1', registry: 'https://registry.example' } }
    ],
    installation: { status: 'update-available', installedVersion: '1.0.0' },
    metadata: { category: 'tools', labels: ['demo'] }
  }
  const indexMetadata = {
    categories: { tools: { title: { en: 'Tools', 'zh-CN': '工具' } } },
    labels: { demo: { title: { en: 'Demo', 'zh-CN': '演示' } } },
    sortKeys: {}
  }
  const ctx = { locale: { resolveText: (value) => (typeof value === 'string' ? value : value['zh-CN'] || value.zh || value.en || '') } }
  hooks.mount(internals.PluginIndexRow, { t, ctx, entry, metadata: indexMetadata, expanded: true, onToggle: () => {} })
  await hooks.flush()
  const text = collectText(hooks.getTree())
  assert.match(text, /阿尔法/u)
  assert.match(text, /可更新/u)
  assert.match(text, /不兼容（宿主 0\.2\.1）/u)
  assert.match(text, /2\.0\.0-beta\.1/u)
  assert.match(text, /推荐/u)
  assert.match(text, /预发布/u)
  assert.match(text, /工具/u)
  assert.match(text, /演示/u)
  assert.match(text, /alpha@2\.0\.0-beta\.1/u)
  assert.match(text, /registry\.example/u)
  assert.match(text, /安装请在/u)
  assert.match(text, /收起/u)
  const icons = collectAll(hooks.getTree(), (node) => node.props && node.props.src === 'https://example.com/icon.png')
  assert.equal(icons.length, 1)
  const links = collectAll(hooks.getTree(), (node) => node.type === 'a')
  assert.ok(links.some((node) => node.props.href === 'https://example.com/alpha'))
  assert.ok(links.some((node) => node.props.href === 'https://github.com/example/alpha'))
  links.forEach((node) => {
    assert.equal(node.props.target, '_blank')
    assert.equal(node.props.rel, 'noreferrer')
  })
  const toggle = findButton(hooks.getTree(), '收起')
  assert.ok(toggle)
  assert.equal(toggle.props['aria-expanded'], 'true')
  hooks.unmount()
})

test('plugin index：插件管理 Tab 顶部二级切换默认「已安装」且不嵌套 tablist', async () => {
  const hooks = createHooksReact()
  const plugin = await loadClientWith(hooks.react)
  const internals = plugin.__test__
  const t = (key, params) => internals.translate('zh', key, params)
  const tree = internals.PluginAdminPage({ t })
  const group = collectAll(tree, (node) => node.props && node.props.role === 'group')[0]
  assert.ok(group, '应有二级切换 group')
  assert.equal(group.props['aria-label'], t('plugins.index.switch.label'))
  assert.equal(group.props.role === 'group', true)
  const buttons = collectAll(group, (node) => node.type === 'button')
  assert.equal(buttons.length, 2)
  assert.equal(buttons[0].props['aria-pressed'], 'true')
  assert.equal(buttons[1].props['aria-pressed'], 'false')
  assert.match(collectText(buttons[0]), /已安装/u)
  assert.match(collectText(buttons[1]), /插件索引/u)
  assert.equal(collectAll(tree, (node) => node.props && node.props.role === 'tablist').length, 0)
  hooks.unmount()
})

test('plugin index：版本排序按 SemVer（预发布数字段）降序', async () => {
  const hooks = createHooksReact()
  const plugin = await loadClientWith(hooks.react)
  const internals = plugin.__test__
  const sorted = internals.sortIndexVersions([
    { version: '2.0.0-beta.2' },
    { version: '2.0.0-beta.10' },
    { version: '2.0.0' },
    { version: '1.9.9' }
  ]).map((item) => item.version)
  assert.deepEqual(sorted, ['2.0.0', '2.0.0-beta.10', '2.0.0-beta.2', '1.9.9'])
  hooks.unmount()
})

test('plugin index row：第三方伪协议/非 http 图标不进入 DOM', async () => {
  const hooks = createHooksReact()
  const plugin = await loadClientWith(hooks.react)
  const internals = plugin.__test__
  const t = (key, params) => internals.translate('zh', key, params)
  const ctx = { locale: { resolveText: (value) => (typeof value === 'string' ? value : value.zh) } }
  hooks.mount(internals.PluginIndexRow, {
    t,
    ctx,
    entry: {
      name: 'evil',
      title: 'Evil',
      icon: 'javascript:alert(1)',
      homepage: 'javascript:alert(1)',
      repository: 'data:text/html,<script>alert(1)</script>',
      versions: [{ version: '1.0.0', compatibility: { compatible: true } }],
      installation: { status: 'not-installed' }
    },
    expanded: true,
    onToggle: () => {}
  })
  await hooks.flush()
  const links = collectAll(hooks.getTree(), (node) => node.type === 'a')
  assert.equal(links.length, 0)
  assert.equal(collectAll(hooks.getTree(), (node) => node.type === 'img').length, 0)
  const icons = collectAll(hooks.getTree(), (node) => node.type === internals.IndexIcon)
  assert.equal(icons.length, 1)
  const iconHooks = createHooksReact()
  const iconPlugin = await loadClientWith(iconHooks.react)
  iconHooks.mount(iconPlugin.__test__.IndexIcon, { src: 'javascript:alert(1)', name: 'Evil' })
  await iconHooks.flush()
  const fallback = collectAll(iconHooks.getTree(), (node) => node.props && node.props.className === 'sdzh-index-icon sdzh-index-icon-fallback')
  assert.equal(fallback.length, 1)
  assert.equal(collectAll(iconHooks.getTree(), (node) => node.type === 'img').length, 0)
  iconHooks.unmount()
  hooks.unmount()
})
