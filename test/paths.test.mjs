import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import {
  DEFAULT_TARGETS,
  PROJECT_RANK,
  PROVIDER_RANK,
  createPaths,
  findProjectRootFS,
  isProjectAllowed,
} from '../lib/paths.js'
import { createMemfs } from './helpers/memfs.mjs'
import { HOME, PROJECT } from './helpers/fixtures.mjs'

const RESOURCES = '/Applications/DSH/Resources'
const PRESET = path.join(RESOURCES, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills')
const OFFICE = path.join(RESOURCES, 'runtime', 'office-skills')

test('paths：rank 与默认目标符合设计（provider 50 < office 600；shadow 100 < preset 300）', () => {
  assert.equal(PROVIDER_RANK, 50)
  assert.equal(PROJECT_RANK, 100)
  assert.equal(DEFAULT_TARGETS.global.length, 8)
  assert.ok(DEFAULT_TARGETS.global.includes('office-render'))
  assert.ok(DEFAULT_TARGETS.global.includes('browser-skill'))
  assert.deepEqual(DEFAULT_TARGETS.preset, [
    'agent-experience',
    'cordis-composition-reference',
    'cordis-plugin-development',
    'editing-cordis-compositions',
  ])
})

test('paths：hostVersion 依次取 env、runtime.json、profile 依赖；候选目录实证可用', () => {
  const fs = createMemfs()
  fs.seed({
    [path.join(PRESET, 'office')]: null,
    [OFFICE]: null,
    [path.join(HOME, '.dsh', 'skills', 'safe-delete-trash', 'trash.mjs')]: '// trash',
    [path.join(HOME, '.dsh', 'profiles', 'desktop', 'package.json')]: JSON.stringify({
      dependencies: { '@deepseek-ai/dsh': '0.2.1-rc.2' },
    }),
  })
  const paths = createPaths({ env: {}, fs, home: HOME, resourcesPath: RESOURCES, execPath: '/node' })
  assert.equal(paths.hostVersion(), '0.2.1-rc.2')
  assert.equal(paths.presetSkillsDir(), PRESET)
  assert.equal(paths.officeSkillsDir(), OFFICE)
  assert.equal(paths.trashScript(), path.join(HOME, '.dsh', 'skills', 'safe-delete-trash', 'trash.mjs'))
  assert.equal(paths.stateFile, path.join(HOME, '.dsh', '.skill-desc-zh', 'state.json'))

  fs.seed({
    [path.join(RESOURCES, 'runtime', 'primary-runtime', 'runtime.json')]: JSON.stringify({ desktopVersion: '1.2.3' }),
  })
  const fromRuntime = createPaths({ env: {}, fs, home: HOME, resourcesPath: RESOURCES, execPath: '/node' })
  assert.equal(fromRuntime.hostVersion(), '1.2.3')

  const fromEnv = createPaths({ env: { DSH_HOST_VERSION: '9.9.9' }, fs, home: HOME, resourcesPath: RESOURCES, execPath: '/node' })
  assert.equal(fromEnv.hostVersion(), '9.9.9')
})

test('paths：项目根与写入白名单（$HOME 下 / allowlist / env 放行，$HOME 本身拒绝）', () => {
  const fs = createMemfs()
  fs.seed({ [path.join(PROJECT, '.git')]: null })
  assert.equal(findProjectRootFS(path.join(PROJECT, 'a', 'b'), fs), PROJECT)
  assert.equal(findProjectRootFS('/tmp/no-git', fs), undefined)

  assert.equal(isProjectAllowed(PROJECT, { home: HOME, env: {} }), true)
  assert.equal(isProjectAllowed(HOME, { home: HOME, env: {} }), false)
  assert.equal(isProjectAllowed('/Applications/dsh', { home: HOME, env: {} }), false)
  assert.equal(isProjectAllowed('/Applications/dsh', { home: HOME, env: {}, allowlist: ['/Applications/dsh'] }), true)
  assert.equal(isProjectAllowed('/opt/work/x', {
    home: HOME,
    env: { DSH_SKILL_DESC_ZH_ALLOW: `/opt/work${path.delimiter}/srv/y` },
  }), true)
  assert.equal(isProjectAllowed('/etc', { home: HOME, env: {} }), false)
})
