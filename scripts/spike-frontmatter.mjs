#!/usr/bin/env node
/**
 * v0.5.0 s1 spike C：frontmatter 切片保留算法（真实 lib/host-yaml.js + 宿主 yaml）。
 *
 *   ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
 *     scripts/spike-frontmatter.mjs
 *
 * 目标：证明「只替换 description 标量与正文，其余原文逐字节保留」可行，并钉死边界。
 * 本脚本在实验里实现 s2 要加的 `renderEdit(raw, {description, body})` 原型，
 * 用例覆盖：注释 / 多行 plain / 双引号 / 单引号 / 块标量(|- >) / 锚点+别名 / CRLF /
 * 正文含 --- / 缺 description；最后验证 create() 的规范构造能通过同一解析器。
 */

import assert from 'node:assert/strict'
import path from 'node:path'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const { createFrontmatter, loadHostYaml } = await import(path.join(REPO, 'lib', 'host-yaml.js'))

const loaded = loadHostYaml()
assert.ok(loaded.yaml, `宿主 yaml 不可用：${loaded.error ?? ''}`)
const yaml = loaded.yaml
const fm = createFrontmatter({ yaml })

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

const checks = []
async function check(name, fn) {
  await fn()
  checks.push(name)
  console.log(`✔ ${name}`)
}
const info = (m) => console.log(`· ${m}`)

/**
 * s2 原型：同时替换 description 与正文，其余字节不动。
 * 失败关闭（返回 {ok:false}），绝不输出半成品。
 */
function renderEdit(raw, { description, body } = {}) {
  const parsed = fm.parse(raw)
  if (!parsed.ok) return parsed
  if (typeof description !== 'string' || description.trim().length === 0) {
    return { ok: false, reason: 'description 不能为空' }
  }
  if (typeof body !== 'string') return { ok: false, reason: 'body 必须是字符串' }
  const match = FRONTMATTER.exec(raw)
  const fmRaw = match[1]
  const prefix = raw.slice(0, match[0].indexOf(fmRaw))
  const closing = raw.slice(prefix.length + fmRaw.length, match[0].length)
  const doc = yaml.parseDocument(fmRaw)
  if (doc.errors.length > 0) return { ok: false, reason: 'frontmatter YAML 解析失败' }

  // 锚点：description 自身带锚点，或有别名指向它 → 改值会连带改变别名指向的字段
  const node = doc.get('description', true)
  if (!node || !Array.isArray(node.range)) return { ok: false, reason: '找不到可定位的 description 节点' }
  if (node.anchor !== undefined || doc.anchors?.has?.('d')) {
    return { ok: false, reason: 'description 带 YAML 锚点/别名，切片重写会连带改变别名字段' }
  }

  const [start, end] = node.range
  const original = fmRaw.slice(start, end)
  const newline = original.endsWith('\r\n') ? '\r\n' : original.endsWith('\n') ? '\n' : ''
  const nextFm = `${fmRaw.slice(0, start)}${JSON.stringify(description)}${newline}${fmRaw.slice(end)}`
  const nextBody = body.length === 0 ? '\n' : `\n${body.replace(/\s+$/u, '')}\n`
  const markdown = `${prefix}${nextFm}${closing}${nextBody}`

  const verify = fm.parse(markdown)
  if (!verify.ok) return { ok: false, reason: `重写后解析失败：${verify.reason}` }
  if (verify.name !== parsed.name) return { ok: false, reason: '重写改变了 name' }
  if (verify.description !== description) return { ok: false, reason: '重写后 description 不一致' }
  if (verify.body !== body.trim()) return { ok: false, reason: '重写后正文不一致' }
  // 逐字节校验：frontmatter 里除 description 区间外必须完全一致
  const stripped = (text) => {
    const m = FRONTMATTER.exec(text)
    const rawFm = m[1]
    const d = yaml.parseDocument(rawFm)
    const n = d.get('description', true)
    return rawFm.slice(0, n.range[0]) + '\u0000DESC\u0000' + rawFm.slice(n.range[1])
  }
  if (stripped(raw) !== stripped(markdown)) {
    return { ok: false, reason: 'frontmatter 其它字节被改动' }
  }
  if (!markdown.endsWith(nextBody)) return { ok: false, reason: '正文结构异常' }
  return { ok: true, markdown }
}

const PARTS = {
  name: 'name: demo-skill',
  description: 'description: "English description"',
}

await check('C1 单行 description + 注释 + 额外键 + 锚点外的行：其余字节零改动', () => {
  const raw = [
    '---',
    '# 顶部注释',
    PARTS.name,
    PARTS.description,
    'metadata:',
    '  owner: ops   # 行尾注释',
    'whenToUse: "when releasing"',
    '---',
    '',
    '# 正文标题',
    '',
    '原始内容',
    '',
  ].join('\n')
  const out = renderEdit(raw, { description: '生成发布说明：从 git log 汇总变更。', body: '# 新正文\n\n内容' })
  assert.equal(out.ok, true, out.reason)
  assert.ok(out.markdown.includes('# 顶部注释'))
  assert.ok(out.markdown.includes('  owner: ops   # 行尾注释'))
  assert.ok(out.markdown.includes('whenToUse: "when releasing"'))
  assert.ok(out.markdown.includes('description: "生成发布说明：从 git log 汇总变更。"'))
  assert.ok(out.markdown.endsWith('\n# 新正文\n\n内容\n'))
})

await check('C2 多行 plain 标量：整段被替换，不留残行', () => {
  const raw = '---\nname: demo-skill\ndescription: first line\n  second line\n  third line\nother: 1\n---\n\nbody\n'
  const out = renderEdit(raw, { description: '多行原文 → 单行中文', body: 'body' })
  assert.equal(out.ok, true, out.reason)
  assert.ok(out.markdown.includes('description: "多行原文 → 单行中文"\nother: 1'))
  assert.ok(!out.markdown.includes('second line'))
})

await check('C3 单引号 / 双引号 description（含转义字符）：语义正确落盘', () => {
  const a = renderEdit("---\nname: demo-skill\ndescription: 'it''s: ok'\n---\n\nb\n", {
    description: '含 "引号" 与 \\ 反斜杠',
    body: 'b',
  })
  assert.equal(a.ok, true, a.reason)
  const parsed = fm.parse(a.markdown)
  assert.equal(parsed.description, '含 "引号" 与 \\ 反斜杠')
})

await check('C4 块标量 |- / > ：整块替换为单行双引号标量', () => {
  const block = '---\nname: demo-skill\ndescription: |-\n  line one\n  line two\n---\n\nbody\n'
  const folded = '---\nname: demo-skill\ndescription: >\n  line one\n  line two\n---\n\nbody\n'
  for (const raw of [block, folded]) {
    const out = renderEdit(raw, { description: '块标量替换', body: 'body' })
    assert.equal(out.ok, true, out.reason)
    assert.ok(out.markdown.includes('description: "块标量替换"\n---'))
  }
})

await check('C5 锚点 + 别名：检测到 anchor 时失败关闭（不让别名字段被连带改值）', () => {
  const raw = '---\nname: demo-skill\ndescription: &d "hello: world"\nwhenToUse: *d\n---\n\nbody\n'
  const out = renderEdit(raw, { description: '新值', body: 'body' })
  assert.equal(out.ok, false)
  assert.match(out.reason, /锚点/u)
  // 反证：直接用现有 renderDescription 会连带改掉 whenToUse
  const legacy = fm.renderDescription(raw, '新值')
  assert.equal(legacy.ok, true)
  const p = fm.parse(legacy.markdown)
  assert.equal(p.whenToUse, '新值')
  info('现有 renderDescription 对锚点会连带改别名字段 → s2 必须在写路径前拒绝')
})

await check('C6 CRLF 文件：换行风格保持，description 正确替换', () => {
  const raw = '---\r\nname: demo-skill\r\ndescription: "old"\r\n---\r\n\r\nbody\r\n'
  const out = renderEdit(raw, { description: '中文', body: 'body' })
  assert.equal(out.ok, true, out.reason)
  assert.ok(out.markdown.includes('\r\nname: demo-skill\r\n'))
  assert.ok(out.markdown.includes('description: "中文"\r\n'))
})

await check('C7 正文含 --- 分隔线与 code fence：不受影响', () => {
  const raw = '---\nname: demo-skill\ndescription: "old"\n---\n\n```\n---\n```\n'
  const out = renderEdit(raw, { description: '中文', body: '```\n---\n```\n\n## 尾' })
  assert.equal(out.ok, true, out.reason)
  assert.ok(out.markdown.includes('```\n---\n```'))
})

await check('C8 缺少 description：失败关闭', () => {
  const raw = '---\nname: demo-skill\n---\n\nbody\n'
  const out = renderEdit(raw, { description: '中文', body: 'body' })
  assert.equal(out.ok, false)
})

await check('C9 无 frontmatter：失败关闭', () => {
  const out = renderEdit('# 只有正文\n', { description: '中文', body: 'body' })
  assert.equal(out.ok, false)
  assert.match(out.reason, /frontmatter/u)
})

await check('C10 create() 规范构造：name/description/body 往返一致，name 守卫', () => {
  const build = (name, description, body) => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.replace(/\s+$/u, '')}\n`
  const text = build('new-skill', '新建技能描述', '# 标题\n\n步骤')
  const parsed = fm.parse(text)
  assert.equal(parsed.ok, true, parsed.reason)
  assert.equal(parsed.name, 'new-skill')
  assert.equal(parsed.description, '新建技能描述')
  assert.equal(parsed.body, '# 标题\n\n步骤')
  assert.equal(parsed.frontmatter.name, 'new-skill')
  // 非法 name 由上层用正则挡（这里只记录解析器本身不校验 kebab-case）
  assert.equal(fm.parse(build('Bad_Name', 'x', 'y')).ok, true)
  info('parser 本身不校验 kebab-case：name 白名单必须由 skill-files.js 守')
})

await check('C11 空正文：合法（正文替换为空）', () => {
  const raw = '---\nname: demo-skill\ndescription: "old"\n---\n\nbody\n'
  const out = renderEdit(raw, { description: '中文', body: '' })
  assert.equal(out.ok, true, out.reason)
  assert.equal(fm.parse(out.markdown).body, '')
})

info(`yaml=${loaded.path}`)
console.log(`\nspike C（frontmatter 切片）：${checks.length}/${checks.length} 项通过`)
process.exit(0)
