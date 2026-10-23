#!/usr/bin/env node
/**
 * 技能管理 Host 端到端脚本（s2）。
 *
 * 在系统临时目录里造一个真实文件系统的 HOME + 项目，装配真实的
 * skill-files / skill-admin / state / http-api，用假 WebServer 发真实 HTTP
 * 形状的请求，覆盖 create → list → detail → save → 冲突 → disable → delete →
 * restore → dryRun 全链路。不启动 DSH、不碰真实 ~/.dsh 技能目录、不联网。
 *
 * 运行：npm run e2e:skills
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

import { createFrontmatter } from '../lib/host-yaml.js'
import { createSkillFiles } from '../lib/skill-files.js'
import { createSkillAdmin } from '../lib/skill-admin.js'
import { createStateStore } from '../lib/state.js'
import { registerHttpApi, API_SKILL_PATHS, API_PREFIX } from '../lib/http-api.js'

let checks = 0
function check(condition, label) {
  assert.ok(condition, label)
  checks += 1
  process.stdout.write(`  ✓ ${label}\n`)
}

function makeDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-desc-zh-skills-e2e-'))
  const home = path.join(base, 'home')
  const project = path.join(home, 'work', 'proj')
  const stateDir = path.join(home, '.dsh', '.skill-desc-zh')
  const trashRoot = path.join(base, 'trash')
  fs.mkdirSync(project, { recursive: true })
  fs.mkdirSync(stateDir, { recursive: true })
  fs.mkdirSync(trashRoot, { recursive: true })
  fs.mkdirSync(path.join(project, '.git'), { recursive: true })
  return { base, home, project, stateDir, trashRoot, stateFile: path.join(stateDir, 'state.json') }
}

function makeTrash(trashRoot) {
  let seq = 0
  return {
    calls: [],
    available: true,
    script: '<e2e>',
    trash(targets, options = {}) {
      this.calls.push({ targets, options })
      const results = []
      for (const target of targets) {
        const to = path.join(trashRoot, `${path.basename(target)}-${seq++}`)
        fs.renameSync(target, to)
        results.push({ target, abs: target, status: 'trashed', to })
      }
      return { results }
    },
    snapshot(file) {
      const dir = path.join(trashRoot, '..', 'backups')
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(file, path.join(dir, `${path.basename(file)}-${seq++}`))
      return { ok: true }
    },
  }
}

class FakeResponse {
  constructor() { this.statusCode = 200; this.headers = {}; this.body = ''; this.headersSent = false; this.writableEnded = false }
  writeHead(status, headers = {}) { this.statusCode = status; this.headers = { ...headers }; this.headersSent = true }
  end(chunk = '') { this.body += chunk; this.writableEnded = true }
  json() { return JSON.parse(this.body) }
}

class FakeRequest extends EventEmitter {
  constructor({ method, url, headers = {} }) { super(); this.method = method; this.url = url; this.headers = headers }
}

function makeServer() {
  const routes = []
  return { routes, register(route) { routes.push(route); return () => {} } }
}

async function call(server, method, url, body) {
  const route = server.routes[0]
  assert.ok(route, 'HTTP 路由已注册')
  const req = new FakeRequest({
    method,
    url,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  })
  const res = new FakeResponse()
  const pending = route.handler(req, res)
  if (body !== undefined) {
    req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    req.emit('end')
  }
  await pending
  return res
}

const dirs = makeDirs()
const stateStore = createStateStore({
  paths: { stateFile: dirs.stateFile, stateDir: dirs.stateDir, home: dirs.home },
  fs,
  trash: makeTrash(dirs.trashRoot),
  now: () => new Date(),
})
const loaded = stateStore.load()
const state = loaded.state
const trash = makeTrash(dirs.trashRoot)
const frontmatter = createFrontmatter({ fs })
const skillFiles = createSkillFiles({
  paths: { home: dirs.home, dshHome: path.join(dirs.home, '.dsh'), stateDir: dirs.stateDir },
  frontmatter,
  trash,
  fs,
  now: () => new Date(),
  allowlist: [],
  getState: () => state,
})
let invalidated = 0
const admin = createSkillAdmin({
  paths: { home: dirs.home, dshHome: path.join(dirs.home, '.dsh'), stateDir: dirs.stateDir, stateFile: dirs.stateFile },
  config: { projectAllowlist: [] },
  skillFiles,
  fs,
  now: () => new Date(),
  getState: () => state,
  saveState: (current, meta) => stateStore.save(current, meta),
  invalidate: () => { invalidated += 1 },
  readOnlyRows: () => [{ name: 'office', description: 'Office documents', source: 'bundled' }],
})

const context = (args = {}) => ({
  projectRoot: args.projectRoot ?? dirs.project,
  projectSource: args.projectRootSource ?? 'explicit',
  cwd: dirs.project,
})
const controller = {
  state: () => state,
  async skills(args) { return admin.list(args, context(args)) },
  async skillDetail(args) { return { ...admin.detail(args, context(args)), projectRoot: args.projectRoot ?? dirs.project } },
  async skillAction(args) { return { ...admin.action(args, context(args)), projectRoot: args.projectRoot ?? dirs.project } },
}
const server = makeServer()
const api = registerHttpApi({
  server,
  gate: () => ({ requestRejection: () => undefined }),
  controller,
  version: '0.5.0-e2e',
  exists: fs.existsSync,
})
assert.equal(api.ok, true)
const projectRootQuery = encodeURIComponent(dirs.project)

console.log('技能管理 e2e：')
const createdUser = await call(server, 'POST', API_SKILL_PATHS.action, {
  action: 'create', scope: 'user', name: 'alpha', description: '阿尔法技能。', body: '# Alpha\n\n用户技能正文。\n',
})
check(createdUser.statusCode === 200 && createdUser.json().ok === true, 'create(user) 返回 200/ok')
check(fs.existsSync(path.join(dirs.home, '.dsh', 'skills', 'alpha', 'SKILL.md')), 'create(user) 写入真实文件')
check((fs.statSync(path.join(dirs.home, '.dsh', 'skills', 'alpha', 'SKILL.md')).mode & 0o777) === 0o600, '新建 SKILL.md 权限 600')

const createdProject = await call(server, 'POST', API_SKILL_PATHS.action, {
  action: 'create', scope: 'project', name: 'beta', description: '贝塔技能。', body: '# Beta\n', projectRoot: dirs.project,
})
check(createdProject.statusCode === 200 && createdProject.json().ok === true, 'create(project) 返回 200/ok')
check(fs.existsSync(path.join(dirs.project, '.dsh', 'skills', 'beta', 'SKILL.md')), 'create(project) 写入项目技能目录')

const listed = await call(server, 'GET', `${API_SKILL_PATHS.list}?projectRoot=${projectRootQuery}`)
const listedJson = listed.json()
check(listed.statusCode === 200 && listedJson.ok === true, 'list 返回 200/ok')
check(listedJson.skills.filter((row) => row.editable).length === 2, 'list 含 2 个可写技能')
check(listedJson.skills.some((row) => row.name === 'office' && row.editable === false), 'list 含只读内置技能')
check(listedJson.sources.user.exists === true && listedJson.sources.user.dir === path.join(dirs.home, '.dsh', 'skills'), 'list 返回 user 根')

const detail = await call(server, 'GET', `${API_SKILL_PATHS.detail}?scope=user&name=alpha&projectRoot=${projectRootQuery}`)
const detailJson = detail.json()
check(detail.statusCode === 200 && detailJson.ok === true, 'detail 返回 200/ok')
check(detailJson.body.trim() === '# Alpha\n\n用户技能正文。', 'detail 正文原样返回')
check(/^sha256:/u.test(detailJson.fingerprint), 'detail 返回指纹')

const conflict = await call(server, 'POST', API_SKILL_PATHS.action, {
  action: 'save', scope: 'user', name: 'alpha', description: '新描述。', expectedFingerprint: 'sha256:stale',
})
check(conflict.statusCode === 200 && conflict.json().ok === false && conflict.json().error.code === 'conflict', 'save 过期指纹 → 业务 conflict')

const saved = await call(server, 'POST', API_SKILL_PATHS.action, {
  action: 'save', scope: 'user', name: 'alpha', description: '新描述。', expectedFingerprint: detailJson.fingerprint,
})
check(saved.statusCode === 200 && saved.json().ok === true, 'save 正确指纹成功')
const savedDetail = (await call(server, 'GET', `${API_SKILL_PATHS.detail}?scope=user&name=alpha`)).json()
check(savedDetail.description === '新描述。' && savedDetail.body.trim() === '# Alpha\n\n用户技能正文。', 'save 只改 description，正文保留')

const disabled = await call(server, 'POST', API_SKILL_PATHS.action, { action: 'disable', scope: 'user', name: 'alpha' })
check(disabled.statusCode === 200 && disabled.json().ok === true, 'disable 成功')
check((await call(server, 'GET', `${API_SKILL_PATHS.list}?projectRoot=${projectRootQuery}`)).json().skills.find((row) => row.name === 'alpha').disabled === true, 'list 标记 disabled')
check(invalidated >= 2, 'create/save/disable 触发 invalidate')
const enabled = await call(server, 'POST', API_SKILL_PATHS.action, { action: 'enable', scope: 'user', name: 'alpha' })
check(enabled.statusCode === 200 && enabled.json().ok === true, 'enable 成功')

const deletion = await call(server, 'POST', API_SKILL_PATHS.action, { action: 'delete', scope: 'project', name: 'beta', projectRoot: dirs.project })
const deletionJson = deletion.json()
check(deletionJson.ok === true && typeof deletionJson.result.deletion.id === 'string', 'delete 成功')
check(!fs.existsSync(path.join(dirs.project, '.dsh', 'skills', 'beta')), 'delete 后源目录消失')
check(trash.calls.length === 1, 'delete 只经注入的 trash 通道')
const trashList = (await call(server, 'GET', `${API_SKILL_PATHS.list}?projectRoot=${projectRootQuery}`)).json().trash
check(trashList.count === 1 && trashList.items[0].name === 'beta', 'list 回收站显示 1 条记录')

const dry = await call(server, 'POST', API_SKILL_PATHS.action, { action: 'restore', id: deletionJson.result.deletion.id, dryRun: true })
check(dry.json().ok === true && dry.json().result.dryRun === true, 'restore dryRun 只预演，不移动目标')
check(!fs.existsSync(path.join(dirs.project, '.dsh', 'skills', 'beta')), 'restore dryRun 不提前落位')
fs.mkdirSync(path.join(dirs.project, '.dsh', 'skills', 'beta'), { recursive: true })
fs.writeFileSync(path.join(dirs.project, '.dsh', 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: 占位\n---\n\n占位\n')
const restoreConflict = await call(server, 'POST', API_SKILL_PATHS.action, { action: 'restore', id: deletionJson.result.deletion.id })
check(restoreConflict.json().ok === false && restoreConflict.json().error.code === 'conflict', 'restore 目标已存在 → conflict（不覆盖）')
fs.renameSync(path.join(dirs.project, '.dsh', 'skills', 'beta'), path.join(dirs.trashRoot, 'beta-conflict'))

const restored = await call(server, 'POST', API_SKILL_PATHS.action, { action: 'restore', id: deletionJson.result.deletion.id })
check(restored.json().ok === true, 'restore 成功')
check(fs.existsSync(path.join(dirs.project, '.dsh', 'skills', 'beta', 'SKILL.md')), 'restore 把目录搬回原位置')
check((await call(server, 'GET', `${API_SKILL_PATHS.list}?projectRoot=${projectRootQuery}`)).json().trash.count === 0, 'restore 后回收站计数归零')

const outside = await call(server, 'GET', `${API_SKILL_PATHS.list}?projectRoot=${encodeURIComponent('/Applications')}`)
check(outside.json().ok === true && outside.json().projectRoot === null, '不在 HOME/allowlist 的项目根不暴露技能')

const bad = await call(server, 'POST', API_SKILL_PATHS.action, { action: 'create', scope: 'user', name: 'Bad Name', description: 'x' })
check(bad.statusCode === 400, '非法 name → 400')
const noAuthServer = makeServer()
const noAuth = registerHttpApi({ server: noAuthServer, gate: () => undefined, controller, version: 'e2e', exists: fs.existsSync })
check(noAuth.ok === true && (await call(noAuthServer, 'GET', `${API_PREFIX}/skills`)).statusCode === 503, '认证服务缺失 → 503')
api.dispose()

console.log(`\n${checks} 项断言全部通过。`)
console.log(`临时目录：${dirs.base}（保留供排查；不含真实用户数据）`)
