#!/usr/bin/env node
/**
 * v0.5.0 s1 spike D：projectRoot 解析与写盘白名单（真实 lib/paths.js，临时目录）。
 *
 *   node scripts/spike-project-root.mjs
 *
 * 验证 findProjectRootFS / findProjectRoot / isProjectAllowed / projectDshDir：
 *  - `.git` 目录与 `.git` 文件（worktree）都算项目根；
 *  - 从深层子目录向上找到最近的 `.git`；
 *  - 没有 `.git` → undefined，页面只应展示用户来源；
 *  - isProjectAllowed：$HOME 之下 true、$HOME 自身 false、/tmp false、allowlist true。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const pathsMod = await import(path.join(REPO, 'lib', 'paths.js'))
const { createPaths, findProjectRoot, findProjectRootFS, isProjectAllowed } = pathsMod

const checks = []
async function check(name, fn) {
  await fn()
  checks.push(name)
  console.log(`✔ ${name}`)
}
const info = (m) => console.log(`· ${m}`)

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-proj-'))
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-home-'))

// A：.git 目录
const repoA = path.join(root, 'repoA')
const deepA = path.join(repoA, 'pkg', 'sub')
fs.mkdirSync(path.join(repoA, '.git'), { recursive: true })
fs.mkdirSync(deepA, { recursive: true })
// B：.git 文件（worktree）
const repoB = path.join(root, 'repoB')
fs.mkdirSync(repoB, { recursive: true })
fs.writeFileSync(path.join(repoB, '.git'), 'gitdir: /tmp/elsewhere\n')
// C：没有 .git
const plain = path.join(root, 'plain', 'child')
fs.mkdirSync(plain, { recursive: true })
// D：$HOME 下的项目
const homeProj = path.join(home, 'proj', 'x')
fs.mkdirSync(homeProj, { recursive: true })
fs.mkdirSync(path.join(home, 'proj', '.git'), { recursive: true })

await check('D1 .git 目录：从深层子目录向上解析到项目根（同步版）', () => {
  assert.equal(findProjectRootFS(deepA), repoA)
})

await check('D2 .git 文件（worktree）：同样算项目根（同步与异步一致）', async () => {
  assert.equal(findProjectRootFS(repoB), repoB)
  assert.equal(await findProjectRoot(repoB), repoB)
})

await check('D3 没有 .git：返回 undefined（页面只展示用户来源）', () => {
  assert.equal(findProjectRootFS(plain), undefined)
})

await check('D4 项目根内部再次向上：深度优先命中最近的 .git', () => {
  const nested = path.join(repoA, 'pkg', 'inner')
  fs.mkdirSync(nested, { recursive: true })
  assert.equal(findProjectRootFS(nested), repoA)
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true })
  assert.equal(findProjectRootFS(nested), nested)
})

await check('D5 isProjectAllowed：$HOME 之下 true，$HOME 自身 false，/tmp false', () => {
  assert.equal(isProjectAllowed(homeProj, { home }), true)
  assert.equal(isProjectAllowed(home, { home }), false)
  assert.equal(isProjectAllowed(root, { home }), false)
})

await check('D6 isProjectAllowed：显式 allowlist 放行（前缀匹配）', () => {
  assert.equal(isProjectAllowed(path.join(root, 'repoA'), { home, allowlist: [root] }), true)
  assert.equal(isProjectAllowed(path.join(root, 'repoA'), { home }), false)
})

await check('D7 isProjectAllowed：空/非法输入返回 false', () => {
  assert.equal(isProjectAllowed(undefined, { home }), false)
  assert.equal(isProjectAllowed('', { home }), false)
})

await check('D8 projectDshDir：有项目根 → <root>/.dsh/skills；无 → undefined', () => {
  const paths = createPaths({ env: { DSH_HOME: path.join(home, '.dsh') }, home })
  assert.equal(paths.projectDshDir(repoA), path.join(repoA, '.dsh', 'skills'))
  assert.equal(paths.projectDshDir(undefined), undefined)
})

await check('D9 符号链接的项目目录：解析按 realpath 语义（fs 层，路径本身不归一）', () => {
  const link = path.join(root, 'link-to-repoA')
  fs.symlinkSync(repoA, link)
  assert.equal(findProjectRootFS(link), link, 'findProjectRootFS 不解析 symlink：调用方需自行 realpath')
  info('写盘前必须 realpath(dir) 并与项目根比对，防 symlink 逃逸')
})

info(`临时目录：${root} / ${home}（未永久删除）`)
console.log(`\nspike D（projectRoot 解析）：${checks.length}/${checks.length} 项通过`)
process.exit(0)
