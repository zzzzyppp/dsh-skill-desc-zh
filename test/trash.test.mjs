import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { createTrash } from '../lib/trash.js'
import { createMemfs } from './helpers/memfs.mjs'
import { HOME, makePaths } from './helpers/fixtures.mjs'

const now = () => new Date('2026-01-02T03:04:05.000Z')

function setup(options = {}) {
  const fs = createMemfs()
  fs.seed({ [path.join(HOME, 'work', 'victim.txt')]: '要删除的内容\n' })
  const paths = makePaths({ trashScript: () => undefined })
  const trash = createTrash({ paths, fs, env: { PATH: '/usr/bin' }, now, ...options })
  return { fs, paths, trash, victim: path.join(HOME, 'work', 'victim.txt') }
}

test('trash：未找到 trash.mjs 时内建 rename 到 ~/.Trash 并写审计日志', () => {
  const { fs, trash, victim } = setup()
  const result = trash.trash([victim])
  assert.equal(result.ok, true)
  assert.equal(result.via, 'builtin')
  assert.equal(result.results[0].status, 'trashed')
  assert.equal(fs.existsSync(victim), false)
  assert.equal(fs.readText(path.join(HOME, '.Trash', 'victim.txt')), '要删除的内容\n')
  const log = fs.readText(path.join(HOME, '.dsh', '.trash-log.jsonl')).trim().split('\n')
  assert.equal(log.length, 1)
  assert.equal(JSON.parse(log[0]).mode, 'builtin')
  assert.equal(JSON.parse(log[0]).status, 'trashed')
})

test('trash：dry-run 不移动，缺失路径视为已清理，受保护路径拒绝', () => {
  const { fs, trash, victim } = setup()
  const dry = trash.trash([victim], { dryRun: true })
  assert.equal(dry.ok, true)
  assert.equal(dry.results[0].status, 'would-trash')
  assert.equal(fs.existsSync(victim), true)

  const missing = trash.trash([path.join(HOME, 'work', 'nope.txt')])
  assert.equal(missing.ok, true)
  assert.equal(missing.results[0].status, 'skipped')

  const refused = trash.trash([HOME])
  assert.equal(refused.ok, false)
  assert.equal(refused.results[0].status, 'refused')
  assert.equal(fs.existsSync(HOME), true)
})

test('trash：优先调用 trash.mjs，并把 DSH_HOME 与参数传对', () => {
  const fs = createMemfs()
  const victim = path.join(HOME, 'work', 'victim.txt')
  fs.seed({ [victim]: 'x', '/fake/trash.mjs': '// fake' })
  const calls = []
  const exec = (bin, args, options) => {
    calls.push({ bin, args, options })
    return JSON.stringify({ results: [{ target: victim, abs: victim, status: 'trashed', to: '/Users/tester/.Trash/victim.txt' }] })
  }
  const paths = makePaths({
    trashScript: () => '/fake/trash.mjs',
    nodeBin: () => '/usr/local/bin/node',
  })
  const trash = createTrash({ paths, fs, exec, env: { PATH: '/usr/bin' }, now })
  const result = trash.trash([victim], { dryRun: true })
  assert.equal(result.via, 'script')
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].bin, '/usr/local/bin/node')
  assert.deepEqual(calls[0].args, ['/fake/trash.mjs', '--json', '--dry-run', victim])
  assert.equal(calls[0].options.env.DSH_HOME, path.join(HOME, '.dsh'))
})

test('trash：trash.mjs 明确拒绝（退出码 1）时不降级、不动文件', () => {
  const fs = createMemfs()
  const victim = path.join(HOME, 'work', 'victim.txt')
  fs.seed({ [victim]: 'x' })
  const exec = () => {
    const error = new Error('refused')
    error.status = 1
    error.stdout = JSON.stringify({ results: [{ target: victim, status: 'refused', reason: '受保护' }] })
    error.stderr = 'refused'
    throw error
  }
  const paths = makePaths({ trashScript: () => '/fake/trash.mjs' })
  const trash = createTrash({ paths, fs, exec, now })
  const result = trash.trash([victim])
  assert.equal(result.ok, false)
  assert.equal(result.code, 1)
  assert.equal(fs.existsSync(victim), true, '拒绝后绝不回退到内建删除')
})

test('trash：trash.mjs ENOENT 时回退内建移动', () => {
  const { fs, trash, victim } = setup({
    exec: () => {
      const error = new Error('spawn ENOENT')
      error.code = 'ENOENT'
      throw error
    },
  })
  // 让 paths.trashScript 返回一个路径，触发脚本分支后 ENOENT 回退。
  const paths = makePaths({ trashScript: () => '/fake/trash.mjs' })
  const fallback = createTrash({
    paths,
    fs,
    exec: () => {
      const error = new Error('spawn ENOENT')
      error.code = 'ENOENT'
      throw error
    },
    now,
  })
  const result = fallback.trash([victim])
  assert.equal(result.via, 'builtin')
  assert.equal(result.ok, true)
  assert.equal(fs.existsSync(victim), false)
  void trash
})
