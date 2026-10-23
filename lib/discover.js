/**
 * 目标发现：枚举需要中文化的技能，并拿到“宿主当前实际提供的定义”。
 *
 *  - global/office（L1）：通过 skills.get() 捕获当前生效的定义，content 含
 *    office provider 追加的 “## Installed LibreOffice Kit” 附录，必须原样透传；
 *  - preset（L2）：直接读 dsh-agent-preset 包内 skills/<name>/SKILL.md，得到英文
 *    原文与资源目录；影子目录整目录复制，因此这里不依赖 skills.get（避免读到
 *    上一次遗留的中文影子，形成自噬）。
 *
 * 本模块只读，不写文件。
 */

import fsDefault from 'node:fs'
import path from 'node:path'
import { contentHash, sourceHash } from './translate.js'
import { DEFAULT_TARGETS, RUNTIME_RANK, findProjectRootFS } from './paths.js'

export const OFFICE_PROVIDER = 'dsh-office'
export const RUNTIME_PROVIDER = 'runtime'
export const OFFICE_RANK = 600
export const PRESET_RANK = 300
export const PRESET_PROVIDER = 'dsh-skill-filesystem'

const DEFAULT_INVOCATION = Object.freeze({ modelInvocable: true, userInvocable: true })

function safeStat(fs, file) {
  try {
    const st = fs.statSync(file)
    return { size: st.size, mtimeMs: st.mtimeMs, isFile: st.isFile(), isDirectory: st.isDirectory() }
  } catch {
    return undefined
  }
}

function normalizeDescription(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
}

/**
 * mtime/size 快路径：源文件大小与修改时间未变、宿主版本一致时，复用上次的
 * contentHash/sourceHash，避免每次启动都把全部技能正文重新 sha256。
 * 只用于直接读文件的来源；skills.get 的运行时附录可能变化，必须重新计算。
 */
function reusableHashes(known, { name, sourcePath, stat, hostVersion, knownHostVersion, capturedVia }) {
  const saved = known?.[name]
  if (!saved || typeof saved !== 'object') return undefined
  if (!sourcePath || saved.sourcePath !== sourcePath) return undefined
  if (!stat || saved.size !== stat.size || saved.mtimeMs !== stat.mtimeMs) return undefined
  // 同一文件在不同捕获通道下内容可能不同（skills.get 带运行时附录、文件回退不带），
  // 不能只凭 mtime/size 复用哈希。旧 state 没有 capturedVia 时宁可不复用。
  if (saved.capturedVia !== capturedVia) return undefined
  const savedVersion = knownHostVersion ?? saved.hostVersion
  if (savedVersion !== hostVersion) return undefined
  const contentHash = typeof saved.enHash === 'string' ? saved.enHash : saved.contentHash
  const sourceHash = typeof saved.sourceHash === 'string' ? saved.sourceHash : saved.fingerprint
  if (!contentHash || !sourceHash) return undefined
  return { contentHash, sourceHash }
}

function targetNames(config) {
  const targets = config?.targets ?? {}
  const global = Array.isArray(targets.global) && targets.global.length > 0
    ? targets.global
    : DEFAULT_TARGETS.global
  const preset = Array.isArray(targets.preset) && targets.preset.length > 0
    ? targets.preset
    : DEFAULT_TARGETS.preset
  return {
    global: global.filter((name) => typeof name === 'string' && name.length > 0),
    preset: preset.filter((name) => typeof name === 'string' && name.length > 0),
  }
}

function makeRecord({
  name, layer, mechanism, description, content, resourceBase, invocation, whenToUse,
  source, provider, rank, sourcePath, sourceDir, hostVersion, stat, extra = {},
  known, knownHostVersion, allowHashReuse = false,
}) {
  const en = normalizeDescription(description)
  const reused = allowHashReuse
    ? reusableHashes(known, {
        name, sourcePath, stat, hostVersion, knownHostVersion, capturedVia: extra.capturedVia,
      })
    : undefined
  const hash = reused?.contentHash ?? contentHash({ description: en, content, resourceBase })
  const fingerprint = reused?.sourceHash
    ?? sourceHash({ name, description: en, content, resourceBase, hostVersion })
  return {
    name,
    layer,
    mechanism,
    description: en,
    en,
    content,
    resourceBase,
    invocation: invocation ?? DEFAULT_INVOCATION,
    ...(whenToUse ? { whenToUse } : {}),
    source,
    provider,
    rank,
    sourcePath,
    sourceDir,
    size: stat?.size ?? 0,
    mtimeMs: stat?.mtimeMs ?? 0,
    hostVersion,
    contentHash: hash,
    sourceHash: fingerprint,
    fingerprint,
    ...extra,
    ...(reused ? { hashReused: true } : {}),
  }
}

/**
 * @param {{
 *   paths: ReturnType<import('./paths.js').createPaths>,
 *   frontmatter: ReturnType<import('./host-yaml.js').createFrontmatter>,
 *   fs?: typeof fsDefault,
 *   config?: object,
 *   logger?: {info?: Function, warn?: Function, debug?: Function},
 * }} options
 */
export function createDiscovery(options) {
  const fs = options.fs ?? fsDefault
  const paths = options.paths
  const frontmatter = options.frontmatter
  const config = options.config ?? {}
  const logger = options.logger ?? {}

  /**
   * @param {{cwd?: string, skills?: object, signal?: AbortSignal, hostVersion?: string, known?: object}} [input]
   */
  async function discover(input = {}) {
    const cwd = input.cwd
    const skills = input.skills
    const signal = input.signal
    const known = input.known
    const knownHostVersion = input.knownHostVersion
    const hostVersion = input.hostVersion ?? paths.hostVersion()
    const names = targetNames(config)
    const warnings = []
    const targets = []
    const projectRoot = cwd ? findProjectRootFS(cwd, fs) : undefined
    const officeDir = paths.officeSkillsDir()
    const presetDir = paths.presetSkillsDir()

    /** ---------------- L1: office ---------------- */
    for (const name of names.global) {
      signal?.throwIfAborted?.()
      let definition
      let getError
      if (skills && typeof skills.get === 'function') {
        try {
          definition = await skills.get(name, { cwd, signal })
        } catch (error) {
          getError = error instanceof Error ? error.message : String(error)
        }
      }
      if (definition && definition.provider !== OFFICE_PROVIDER && definition.source !== 'bundled') {
        warnings.push(`${name}: 当前生效技能来自 ${definition.provider ?? '未知 provider'}，不是内置 office，跳过以免覆盖用户技能`)
        continue
      }
      if (!definition) {
        const reason = getError ? `skills.get 失败：${getError}` : 'skills.get 未返回定义'
        const fallback = officeDir ? path.join(officeDir, name, 'SKILL.md') : undefined
        if (fallback && fs.existsSync(fallback)) {
          const parsed = frontmatter.readSkillFile(fallback)
          if (parsed.ok) {
            warnings.push(`${name}: ${reason}，回退直接读取 ${fallback}（不含 office 运行时附录）`)
            targets.push(makeRecord({
              name,
              layer: 'global',
              mechanism: 'provider',
              description: parsed.description,
              content: parsed.body,
              resourceBase: { kind: 'directory', path: path.dirname(fallback) },
              invocation: parsed.invocation ?? DEFAULT_INVOCATION,
              whenToUse: parsed.whenToUse,
              source: 'bundled',
              provider: OFFICE_PROVIDER,
              rank: OFFICE_RANK,
              sourcePath: fallback,
              sourceDir: path.dirname(fallback),
              hostVersion,
              stat: safeStat(fs, fallback),
              extra: { capturedVia: 'file' },
              known,
              knownHostVersion,
              allowHashReuse: true,
            }))
            continue
          }
        }
        warnings.push(`${name}: 未发现内置 office 技能（${reason}）`)
        continue
      }
      const resourceBase = definition.resourceBase
        ?? (officeDir ? { kind: 'directory', path: path.join(officeDir, name) } : undefined)
      const sourceDir = resourceBase?.kind === 'directory' ? resourceBase.path : undefined
      const sourcePath = definition.path
        ?? (sourceDir ? path.join(sourceDir, 'SKILL.md') : undefined)
      // runtime 技能（browser-skill）由插件在 agent scope 里注册；这里按普通
      // global 目标捕获英文原文，index.js 会把它交给 agent 层 provider 覆盖。
      const isRuntime = definition.provider === RUNTIME_PROVIDER
      targets.push(makeRecord({
        name,
        layer: 'global',
        mechanism: 'provider',
        description: definition.description,
        content: definition.content ?? '',
        resourceBase,
        invocation: definition.invocation ?? DEFAULT_INVOCATION,
        whenToUse: definition.whenToUse,
        source: definition.source ?? 'bundled',
        provider: definition.provider ?? OFFICE_PROVIDER,
        rank: isRuntime ? RUNTIME_RANK : OFFICE_RANK,
        sourcePath,
        sourceDir,
        hostVersion,
        stat: sourcePath ? safeStat(fs, sourcePath) : undefined,
        extra: { capturedVia: 'skills.get', isRuntime, hasRuntimeAppendix: /\n## Installed LibreOffice Kit/u.test(definition.content ?? '') },
      }))
    }

    /** ---------------- L2: preset ---------------- */
    if (config.translatePreset === false) {
      if (names.preset.length > 0) warnings.push('translatePreset=false：跳过 agent-preset 技能')
    } else if (!presetDir || !safeStat(fs, presetDir)?.isDirectory) {
      warnings.push(`未找到 dsh-agent-preset skills 目录（候选：${paths.candidates.preset.join(', ')}）`)
    } else {
      for (const name of names.preset) {
        signal?.throwIfAborted?.()
        const sourceDir = path.join(presetDir, name)
        const sourcePath = path.join(sourceDir, 'SKILL.md')
        const parsed = frontmatter.readSkillFile(sourcePath)
        if (!parsed.ok) {
          warnings.push(`${name}: ${parsed.reason}`)
          continue
        }
        targets.push(makeRecord({
          name,
          layer: 'preset',
          mechanism: 'shadow',
          description: parsed.description,
          content: parsed.body,
          resourceBase: { kind: 'directory', path: sourceDir },
          invocation: parsed.invocation ?? DEFAULT_INVOCATION,
          whenToUse: parsed.whenToUse,
          source: 'bundled',
          provider: PRESET_PROVIDER,
          rank: PRESET_RANK,
          sourcePath,
          sourceDir,
          hostVersion,
          stat: safeStat(fs, sourcePath),
          extra: { capturedVia: 'file' },
          known,
          knownHostVersion,
          allowHashReuse: true,
        }))
      }
    }

    logger.debug?.(`发现 ${targets.length} 个目标（global ${targets.filter((item) => item.layer === 'global').length}，runtime ${targets.filter((item) => item.isRuntime).length}，preset ${targets.filter((item) => item.layer === 'preset').length}）`)
    return {
      targets,
      warnings,
      projectRoot,
      officeDir,
      presetDir,
      hostVersion,
      targetNames: names,
      complete: targets.length === names.global.length + (config.translatePreset === false ? 0 : names.preset.length),
    }
  }

  return { discover, targetNames: () => targetNames(config) }
}
