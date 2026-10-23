#!/usr/bin/env node
/**
 * v0.5.0 s1 spike B：删除→废纸篓→恢复 链路（真实 trash.mjs + 真实文件系统，只在 /tmp 与 ~/.Trash 上操作）。
 *
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
 *     scripts/spike-trash-restore.mjs
 *
 * 验证：
 *  B1 trash.mjs --json 返回 trashed + to；DSH_TRASH_LOG 生效且行含 {t,action,from,to,kind}；
 *  B2 ~/.Trash 里的条目可 stat / 可读（TCC 实测）；
 *  B3 可 readdir 废纸篓目录；
 *  B4 rename 回原路径成功且内容一致；
 *  B5 目标已存在时 rename 的两种行为（文件=静默覆盖！目录=ENOTEMPTY）→ 必须前置存在性检查；
 *  B6 父目录缺失 → ENOENT；B7 父目录不可写 → EACCES/EPERM；B8 废纸篓条目已不在 → ENOENT；
 *  B9 废纸篓同名冲突 → trash.mjs 自动改名 "name 2"。
 *
 * 本脚本不做任何永久删除：所有临时条目最终都留在废纸篓或 /tmp。
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TRASH_MJS = process.env.DSH_TRASH_SCRIPT
  ?? path.join(os.homedir(), '.dsh/skills/safe-delete-trash/trash.mjs')
const NODE = process.env.DSH_NODE_BIN ?? process.execPath
const HOME = os.homedir()
const TRASH_DIR = path.join(HOME, '.Trash')
const LOG = path.join(os.tmpdir(), `spike-trash-log-${process.pid}.jsonl`)

const checks = []
async function check(name, fn) {
  await fn()
  checks.push(name)
  console.log(`✔ ${name}`)
}
const info = (m) => console.log(`· ${m}`)

function runTrash(args) {
  const stdout = execFileSync(NODE, [TRASH_MJS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_TRASH_LOG: LOG },
  })
  return JSON.parse(stdout)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-trash-'))
const work = path.join(root, 'work')
fs.mkdirSync(work, { recursive: true })
const target = path.join(work, 'demo-skill')
fs.mkdirSync(target)
fs.writeFileSync(path.join(target, 'SKILL.md'), '---\nname: demo-skill\ndescription: hello\n---\n\nbody\n')

let trashedTo
await check('B1 trash.mjs 移入废纸篓，输出 trashed + to，日志含 {t,action,from,to,kind}', () => {
  const out = runTrash(['--json', target])
  assert.equal(out.mode, 'trash')
  const item = out.results[0]
  assert.equal(item.status, 'trashed')
  assert.equal(item.via, 'rename')
  assert.equal(item.from ?? item.abs, target)
  assert.ok(path.isAbsolute(item.to))
  assert.equal(item.kind, 'dir')
  trashedTo = item.to

  const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  const entry = lines.at(-1)
  assert.equal(entry.action, 'trash')
  assert.equal(entry.via, 'rename')
  assert.equal(entry.from, target)
  assert.equal(entry.to, trashedTo)
  assert.equal(typeof entry.t, 'string')
  assert.match(entry.t, /^\d{4}-\d{2}-\d{2}T/u)
  assert.equal(fs.existsSync(target), false)
})

await check('B2 ~/.Trash 条目可 stat 且内容可读（macOS TCC 实测）', () => {
  const st = fs.statSync(trashedTo)
  assert.equal(st.isDirectory(), true)
  const raw = fs.readFileSync(path.join(trashedTo, 'SKILL.md'), 'utf8')
  assert.match(raw, /name: demo-skill/u)
})

await check('B3 ~/.Trash 目录 readdir 被 TCC 拒绝（EPERM），只能按精确路径访问', () => {
  let code
  try {
    fs.readdirSync(TRASH_DIR)
  } catch (error) {
    code = error?.code
  }
  assert.equal(code, 'EPERM')
  info('readdir(~/.Trash) → EPERM（macOS TCC）；stat/read 精确路径仍然可用')
})

await check('B4 rename 回原路径成功，内容一致', () => {
  fs.renameSync(trashedTo, target)
  assert.equal(fs.existsSync(trashedTo), false)
  const raw = fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')
  assert.match(raw, /description: hello/u)
})

await check('B5a 恢复时目标为已存在文件：rename 是覆盖语义（必须前置检查）', () => {
  const file = path.join(work, 'note.txt')
  fs.writeFileSync(file, 'ORIGINAL-CONTENT\n')
  const to = runTrash(['--json', file]).results[0].to
  fs.writeFileSync(file, 'USER-NEW-CONTENT\n')
  fs.renameSync(to, file)
  assert.equal(fs.readFileSync(file, 'utf8'), 'ORIGINAL-CONTENT\n')
  info('rename(file → 已存在 file) 静默覆盖：恢复必须先 stat 目标，存在就报 target-exists')
})

await check('B5b 恢复时目标为已存在目录：rename 报 ENOTEMPTY/EEXIST', () => {
  const src = path.join(root, 'dir-src')
  fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'a.txt'), 'a')
  const out = runTrash(['--json', src])
  const to = out.results[0].to
  const occupied = path.join(root, 'dir-src')
  fs.mkdirSync(occupied)
  fs.writeFileSync(path.join(occupied, 'keep.txt'), 'keep')
  assert.throws(() => fs.renameSync(to, occupied), /ENOTEMPTY|EEXIST|EPERM|EACCES/u)
  fs.renameSync(to, path.join(root, 'dir-src-restored'))
})

await check('B6 父目录缺失 → ENOENT', () => {
  const alt = path.join(root, 'alt')
  fs.mkdirSync(alt)
  fs.writeFileSync(path.join(alt, 'x.txt'), 'x')
  const out = runTrash(['--json', path.join(alt, 'x.txt')])
  const to = out.results[0].to
  const missingParent = path.join(root, 'gone', 'x.txt')
  assert.throws(() => fs.renameSync(to, missingParent), /ENOENT/u)
  fs.writeFileSync(path.join(alt, 'x2.txt'), 'x2')
})

await check('B7 父目录不可写 → EACCES/EPERM', () => {
  const locked = path.join(root, 'locked')
  fs.mkdirSync(locked)
  fs.writeFileSync(path.join(locked, 'y.txt'), 'y')
  const out = runTrash(['--json', path.join(locked, 'y.txt')])
  const to = out.results[0].to
  fs.chmodSync(locked, 0o555)
  try {
    assert.throws(() => fs.renameSync(to, path.join(locked, 'y.txt')), /EACCES|EPERM/u)
  } finally {
    fs.chmodSync(locked, 0o755)
    fs.renameSync(to, path.join(locked, 'y.txt'))
  }
})

await check('B8 废纸篓条目已不在（被 Finder 清理）→ ENOENT', () => {
  const missing = path.join(TRASH_DIR, 'definitely-not-there-spike')
  assert.throws(() => fs.renameSync(missing, path.join(root, 'nope')), /ENOENT/u)
})

await check('B9 废纸篓同名冲突自动改名（name → name 2）', () => {
  const dupName = `spike-dup-${process.pid}`
  const src = path.join(root, dupName)
  fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'f.txt'), 'one')
  const first = runTrash(['--json', src]).results[0].to
  fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'f.txt'), 'two')
  const second = runTrash(['--json', src]).results[0].to
  assert.notEqual(first, second)
  assert.equal(path.basename(second), `${dupName} 2`)
  fs.renameSync(second, path.join(root, 'restored-dup'))
})

info(`log=${LOG}`)
info(`临时根目录保留在 ${root}（未永久删除；需要时用 trash.mjs 移走）`)
console.log(`\nspike B（trash 恢复链路）：${checks.length}/${checks.length} 项通过`)
process.exit(0)
