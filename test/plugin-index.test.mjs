import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginIndex } from '../lib/plugin-index.js'

function createServices(overrides = {}) {
  const calls = { listIndexes: 0, search: [], entry: [], installs: [] }
  const market = {
    async listIndexes() {
      calls.listIndexes += 1
      return [{ url: 'https://index.example/a.json', title: 'A', description: 'alpha', error: 'stale' }]
    },
    async search(url, query) {
      calls.search.push({ url, query })
      return {
        url,
        title: 'A',
        description: 'alpha',
        metadata: { categories: ['tools'], labels: [], sortKeys: ['index'] },
        fetchedAt: '2026-11-10T00:00:00.000Z',
        total: 2,
        nextOffset: 20,
        entries: [
          {
            name: 'demo-plugin',
            title: 'Demo Plugin',
            defaultVersion: '1.2.0',
            versions: [
              { version: '1.2.0', install: { spec: 'demo-plugin@1.2.0', registry: 'https://registry.npmjs.org' } },
              { version: '1.1.0', install: { spec: 'demo-plugin@1.1.0' } }
            ],
            installation: { status: 'not-installed' },
            junk: 'dropped'
          }
        ]
      }
    },
    async entry(url, name) {
      calls.entry.push({ url, name })
      if (name !== 'demo-plugin') return undefined
      return {
        name,
        defaultVersion: '1.2.0',
        versions: [
          { version: '1.2.0', install: { spec: 'demo-plugin@1.2.0', registry: 'https://registry.npmjs.org' } }
        ]
      }
    }
  }
  const manager = {
    async installBundle(spec, options) {
      calls.installs.push({ spec, options })
      return {
        changed: true,
        application: 'restart-required',
        restartReason: 'host-module',
        stage: 'install',
        enabled: true,
        warnings: ['w'],
        pendingBuilds: ['native'],
        error: undefined,
        debug: 'dropped'
      }
    }
  }
  const services = { pluginMarket: market, pluginManager: manager, ...overrides }
  return { calls, services }
}

test('plugin-index：describe 反映服务可用性', () => {
  const { services } = createServices()
  const index = createPluginIndex({ getService: (name) => services[name] })
  assert.deepEqual(index.describe(), { version: 1, market: true, manager: true })
  const empty = createPluginIndex({ getService: () => undefined })
  assert.deepEqual(empty.describe(), { version: 1, market: false, manager: false })
})

test('plugin-index：sources 映射字段，服务缺失时返回 market-unavailable', async () => {
  const { services } = createServices()
  const index = createPluginIndex({ getService: (name) => services[name] })
  const result = await index.sources()
  assert.equal(result.ok, true)
  assert.deepEqual(result.sources, [{ url: 'https://index.example/a.json', title: 'A', description: 'alpha', error: 'stale' }])

  const missing = await createPluginIndex({ getService: () => undefined }).sources()
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'market-unavailable')
})

test('plugin-index：search 归一化查询与条目，丢弃未知字段', async () => {
  const { calls, services } = createServices()
  const index = createPluginIndex({ getService: (name) => services[name] })
  const result = await index.search({ url: 'https://index.example/a.json', text: '  demo  ', offset: 0, limit: 99 })
  assert.equal(result.ok, true)
  assert.equal(calls.search[0].query.limit, 50)
  assert.equal(calls.search[0].query.sort.kind, 'relevance')
  assert.equal(calls.search[0].query.text, 'demo')
  assert.equal(result.entries[0].name, 'demo-plugin')
  assert.equal('junk' in result.entries[0], false)
  assert.equal(result.total, 2)
  assert.equal(result.nextOffset, 20)

  const invalid = await index.search({ url: '', text: 'x' })
  assert.equal(invalid.code, 'invalid-query')
})

test('plugin-index：search 捕获服务异常', async () => {
  const index = createPluginIndex({
    getService: () => ({
      async listIndexes() { return [] },
      async search() { throw new Error('boom') }
    })
  })
  const result = await index.search({ url: 'https://x/a.json' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'market-failed')
})

test('plugin-index：install 选择默认版本、传递 registry 并归一化结果', async () => {
  const { calls, services } = createServices()
  const index = createPluginIndex({ getService: (name) => services[name] })
  const result = await index.install({ url: 'https://index.example/a.json', name: 'demo-plugin' })
  assert.equal(result.ok, true)
  assert.equal(result.name, 'demo-plugin')
  assert.equal(result.version, 'demo-plugin@1.2.0')
  assert.equal(result.application, 'restart-required')
  assert.equal(result.restartRequired, true)
  assert.equal(result.restartReason, 'host-module')
  assert.deepEqual(result.pendingBuilds, ['native'])
  assert.deepEqual(calls.installs[0], {
    spec: 'demo-plugin@1.2.0',
    options: { registry: 'https://registry.npmjs.org' }
  })
  assert.equal('debug' in result, false)
})

test('plugin-index：install 处理未找到、无安装目标与非法参数', async () => {
  const { services } = createServices()
  const index = createPluginIndex({ getService: (name) => services[name] })
  const notFound = await index.install({ url: 'https://index.example/a.json', name: 'missing' })
  assert.equal(notFound.code, 'not-found')
  const noName = await index.install({ url: 'https://index.example/a.json' })
  assert.equal(noName.code, 'invalid-query')

  const thin = createPluginIndex({
    getService: () => ({
      async entry() { return { name: 'x', versions: [{ version: '1.0.0' }] } },
      async installBundle() { return { changed: true, application: 'applied' } }
    })
  })
  const noTarget = await thin.install({ url: 'https://x/a.json', name: 'x' })
  assert.equal(noTarget.code, 'no-install-target')
})

test('plugin-index：install 安装失败结果与异常都被归一化', async () => {
  const failing = createPluginIndex({
    getService: () => ({
      async entry() { return { name: 'x', versions: [{ version: '1.0.0', install: { spec: 'x@1.0.0' } }] } },
      async installBundle() {
        return {
          changed: false,
          application: 'failed',
          error: { code: 'incompatible-version', diagnostic: { message: 'bad host' }, incompatible: [{ name: 'x' }] }
        }
      }
    })
  })
  const failed = await failing.install({ url: 'https://x/a.json', name: 'x' })
  assert.equal(failed.ok, false)
  assert.equal(failed.application, 'failed')
  assert.equal(failed.error.code, 'incompatible-version')
  assert.equal(failed.error.message, 'bad host')

  const throwing = createPluginIndex({
    getService: () => ({
      async entry() { return { name: 'x', versions: [{ version: '1.0.0', install: { spec: 'x@1.0.0' } }] } },
      async installBundle() { throw new Error('locked') }
    })
  })
  const thrown = await throwing.install({ url: 'https://x/a.json', name: 'x' })
  assert.equal(thrown.code, 'install-failed')
  assert.match(thrown.message, /locked/u)
})

test('plugin-index：install 单飞，进行中再次调用返回 busy', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const index = createPluginIndex({
    getService: () => ({
      async entry() { return { name: 'x', versions: [{ version: '1.0.0', install: { spec: 'x@1.0.0' } }] } },
      async installBundle() {
        await gate
        return { changed: true, application: 'applied' }
      }
    })
  })
  const first = index.install({ url: 'https://x/a.json', name: 'x' })
  const second = await index.install({ url: 'https://x/a.json', name: 'x' })
  assert.equal(second.code, 'busy')
  assert.equal(index.busy, true)
  release()
  const done = await first
  assert.equal(done.ok, true)
  assert.equal(index.busy, false)
})

test('plugin-index：服务 getter 抛错时按不可用处理', async () => {
  const index = createPluginIndex({
    getService() { throw new Error('no ctx') }
  })
  const sources = await index.sources()
  assert.equal(sources.code, 'market-unavailable')
  const install = await index.install({ url: 'https://x/a.json', name: 'x' })
  assert.equal(install.code, 'plugin-manager-unavailable')
})
