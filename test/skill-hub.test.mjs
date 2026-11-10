import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createSkillHub, SKILL_HUB_SOURCE } from '../lib/skill-hub.js'
import { createMemfs } from './helpers/memfs.mjs'

const HOME = '/Users/tester'
const DSH_HOME = path.join(HOME, '.dsh')

function sha256(content) {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
    async arrayBuffer() { return Buffer.from('', 'utf8').buffer }
  }
}

function bytesResponse(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return {} },
    async arrayBuffer() { return Buffer.from(text, 'utf8') }
  }
}

function setup({ files = {}, listing, frontmatter } = {}) {
  const fs = createMemfs({ cwd: HOME, now: () => 1_700_000_000_000 })
  const trashCalls = []
  const requests = []
  const fileMap = files
  const fetchImpl = async (url) => {
    requests.push(url)
    if (url.includes('/api/v1/skills/demo-notes/files')) {
      return jsonResponse(listing || {
        files: Object.entries(fileMap).map(([name, content]) => ({
          path: name,
          size: Buffer.byteLength(content),
          sha256: sha256(content)
        }))
      })
    }
    if (url.includes('/api/v1/skills/demo-notes/file?')) {
      const pathname = decodeURIComponent(new URL(url).searchParams.get('path') || '')
      if (!(pathname in fileMap)) return bytesResponse('', 404)
      return bytesResponse(fileMap[pathname])
    }
    if (url.includes('/api/skills?')) {
      return jsonResponse({
        data: {
          total: 3,
          skills: [
            { slug: 'demo-notes', name: 'Demo Notes', description_zh: '演示笔记', downloads: 12, installs: 3, ownerName: 'tester' }
          ]
        }
      })
    }
    if (url.includes('/api/v1/skills/demo-notes')) {
      return jsonResponse({ data: { name: 'demo-notes', description_zh: '演示笔记', latestVersion: { version: '1.0.0' } } })
    }
    return jsonResponse({}, 404)
  }
  const hub = createSkillHub({
    fetchImpl,
    fs,
    paths: { dshHome: DSH_HOME },
    frontmatter: {
      parse(content) {
        if (frontmatter) return frontmatter(content)
        const match = /^---\n[\s\S]*?name:\s*([a-z0-9-]+)[\s\S]*?description:\s*(.+?)\n/u.exec(content)
        return match ? { ok: true, name: match[1], description: match[2] } : { ok: false, reason: 'bad yaml' }
      }
    },
    trash: {
      trash(targets) {
        trashCalls.push(targets)
        const bin = path.join(HOME, '.Trash')
        fs.mkdirSync(bin, { recursive: true })
        const moved = []
        targets.forEach((target, index) => {
          if (!fs.existsSync(target)) return
          const destination = path.join(bin, path.basename(String(target)) + '-' + index)
          fs.renameSync(target, destination)
          moved.push(destination)
        })
        return { ok: true, paths: moved }
      }
    }
  })
  return { fs, hub, trashCalls, requests }
}

test('skill-hub：search 映射条目并限制 pageSize', async () => {
  const { hub } = setup()
  const result = await hub.search({ text: '笔记', page: 2, pageSize: 100 })
  assert.equal(result.ok, true)
  assert.equal(result.page, 2)
  assert.equal(result.pageSize, 50)
  assert.equal(result.total, 3)
  assert.equal(result.entries[0].slug, 'demo-notes')
  assert.equal(result.entries[0].name, 'Demo Notes')
  assert.equal(result.entries[0].description, '演示笔记')
  assert.equal(result.entries[0].downloads, 12)
  assert.equal(result.entries[0].installs, 3)
  assert.equal(result.entries[0].owner, 'tester')
  assert.deepEqual(result.source, SKILL_HUB_SOURCE)
})

test('skill-hub：search 服务错误归一化为 skillhub-failed', async () => {
  const fs = createMemfs({ cwd: HOME })
  const hub = createSkillHub({
    fetchImpl: async () => jsonResponse({}, 500),
    fs,
    paths: { dshHome: DSH_HOME },
    frontmatter: { parse: () => ({ ok: false }) }
  })
  const result = await hub.search({ text: 'x' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'skillhub-failed')
})

test('skill-hub：install 拒绝非法 slug', async () => {
  const { hub } = setup()
  const result = await hub.install({ slug: '../evil' })
  assert.equal(result.code, 'invalid-skill')
  const upper = await hub.install({ slug: 'Demo' })
  assert.equal(upper.code, 'invalid-skill')
})

test('skill-hub：install 下载全部文件、校验大小与 sha256 并落盘', async () => {
  const files = {
    'SKILL.md': '---\nname: demo-notes\ndescription: 演示笔记\n---\n\n# Demo\n',
    'references/guide.md': '# guide\n'
  }
  const { fs, hub, requests, trashCalls } = setup({ files })
  const result = await hub.install({ slug: 'demo-notes' })
  assert.equal(result.ok, true)
  assert.equal(result.name, 'demo-notes')
  assert.equal(result.description, '演示笔记')
  assert.equal(result.replaced, false)
  assert.equal(result.files, 2)
  const dir = path.join(DSH_HOME, 'skills', 'demo-notes')
  assert.equal(fs.existsSync(dir), true)
  assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), files['SKILL.md'])
  assert.equal(fs.readFileSync(path.join(dir, 'references/guide.md'), 'utf8'), '# guide\n')
  assert.equal(trashCalls.length, 0)
  assert.ok(requests.some((url) => url.includes('/api/v1/skills/demo-notes/file?path=SKILL.md')))
})

test('skill-hub：install 已存在且未强装时返回 already-installed；force 时先移入废纸篓', async () => {
  const files = { 'SKILL.md': '---\nname: demo-notes\ndescription: 演示笔记\n---\n' }
  const { fs, hub, trashCalls } = setup({ files })
  fs.mkdirSync(path.join(DSH_HOME, 'skills', 'demo-notes'), { recursive: true })
  fs.writeFileSync(path.join(DSH_HOME, 'skills', 'demo-notes', 'old.txt'), 'old')

  const blocked = await hub.install({ slug: 'demo-notes' })
  assert.equal(blocked.code, 'already-installed')
  assert.equal(fs.existsSync(path.join(DSH_HOME, 'skills', 'demo-notes', 'old.txt')), true)

  const forced = await hub.install({ slug: 'demo-notes', force: true })
  assert.equal(forced.ok, true)
  assert.equal(forced.replaced, true)
  assert.deepEqual(trashCalls[0], [path.join(DSH_HOME, 'skills', 'demo-notes')])
  assert.equal(fs.existsSync(path.join(DSH_HOME, 'skills', 'demo-notes', 'old.txt')), false)
})

test('skill-hub：install 校验和不符时中止并清理临时目录', async () => {
  const files = { 'SKILL.md': '---\nname: demo-notes\ndescription: 演示笔记\n---\n' }
  const { fs, hub, trashCalls } = setup({
    files,
    listing: { files: [{ path: 'SKILL.md', size: Buffer.byteLength(files['SKILL.md']), sha256: 'deadbeef' }] }
  })
  const result = await hub.install({ slug: 'demo-notes' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'checksum-mismatch')
  assert.equal(fs.existsSync(path.join(DSH_HOME, 'skills', 'demo-notes')), false)
  assert.equal(trashCalls.length, 1)
})

test('skill-hub：install 拒绝越界路径与超大文件', async () => {
  const { hub } = setup({
    files: { 'SKILL.md': '---\nname: demo-notes\ndescription: 演示笔记\n---\n' },
    listing: { files: [{ path: '../../evil.md', size: 1, sha256: 'x' }] }
  })
  const unsafe = await hub.install({ slug: 'demo-notes' })
  assert.equal(unsafe.code, 'unsafe-path')

  const huge = createSkillHub({
    fetchImpl: async () => jsonResponse({ files: [{ path: 'SKILL.md', size: 3 * 1024 * 1024 }] }),
    fs: createMemfs({ cwd: HOME }),
    paths: { dshHome: DSH_HOME },
    frontmatter: { parse: () => ({ ok: true, name: 'demo-notes' }) }
  })
  const tooLarge = await huge.install({ slug: 'demo-notes' })
  assert.equal(tooLarge.code, 'too-large')
})

test('skill-hub：install 要求 SKILL.md 存在、可解析且 name 与目录一致', async () => {
  const missing = setup({ files: { 'notes.md': 'x' } })
  const missingResult = await missing.hub.install({ slug: 'demo-notes' })
  assert.equal(missingResult.code, 'missing-skill-file')

  const badYaml = setup({ files: { 'SKILL.md': 'not yaml' }, frontmatter: () => ({ ok: false, reason: 'nope' }) })
  const badResult = await badYaml.hub.install({ slug: 'demo-notes' })
  assert.equal(badResult.code, 'invalid-skill-file')
  assert.match(badResult.message, /nope/u)

  const mismatch = setup({
    files: { 'SKILL.md': '---\nname: other-skill\ndescription: x\n---\n' },
    frontmatter: () => ({ ok: true, name: 'other-skill', description: 'x' })
  })
  const mismatchResult = await mismatch.hub.install({ slug: 'demo-notes' })
  assert.equal(mismatchResult.code, 'name-mismatch')
})

test('skill-hub：detail 校验 slug 并映射详情', async () => {
  const { hub } = setup()
  const detail = await hub.detail('demo-notes')
  assert.equal(detail.ok, true)
  assert.equal(detail.name, 'demo-notes')
  assert.equal(detail.description, '演示笔记')
  assert.equal(detail.version, '1.0.0')
  const invalid = await hub.detail('Bad Slug')
  assert.equal(invalid.code, 'invalid-skill')
})

test('skill-hub：无 fetch 时 search 返回 fetch-unavailable', async () => {
  const fs = createMemfs({ cwd: HOME })
  const hub = createSkillHub({ fetchImpl: null, fs, paths: { dshHome: DSH_HOME }, frontmatter: { parse: () => ({ ok: false }) } })
  const result = await hub.search({ text: 'x' })
  assert.equal(result.code, 'fetch-unavailable')
  assert.equal(hub.available(), false)
})
