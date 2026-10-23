/**
 * 唯一的删除通道：包装 $DSH_HOME/skills/safe-delete-trash/trash.mjs。
 *
 * 本模块永远不会永久删除文件：优先调用官方的 trash.mjs（移入废纸篓 + 写审计日志），
 * 只有脚本缺失时才退化为“同一文件系统内 rename 到 ~/.Trash”的内建实现；跨卷时直接
 * 报失败，绝不 copy + 删除。覆盖状态文件前用 snapshot() 留档。
 */

import { execFileSync } from 'node:child_process'
import fsDefault from 'node:fs'
import path from 'node:path'

/** trash.mjs 的退出码：0 成功 / 1 被拒绝或不安全 / 2 执行失败。 */
export const TRASH_OK = 0
export const TRASH_REFUSED = 1
export const TRASH_FAILED = 2

function parseJsonOutput(text) {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    /* trash.mjs 可能混有诊断文本，尝试最后一个 JSON 行 */
  }
  const lines = trimmed.split(/\r?\n/u)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(line)
    } catch {
      /* continue */
    }
  }
  return undefined
}

function uniqueDestination(fs, dir, basename) {
  let candidate = path.join(dir, basename)
  if (!fs.existsSync(candidate)) return candidate
  const ext = path.extname(basename)
  const stem = ext ? basename.slice(0, -ext.length) : basename
  for (let index = 2; index < 10_000; index += 1) {
    candidate = path.join(dir, `${stem} ${index}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error(`废纸篓中同名条目过多：${basename}`)
}

/**
 * @param {{
 *   paths: ReturnType<import('./paths.js').createPaths>,
 *   fs?: typeof fsDefault,
 *   env?: NodeJS.ProcessEnv,
 *   exec?: typeof execFileSync,
 *   logger?: {warn?: Function, debug?: Function},
 *   now?: () => Date,
 *   timeoutMs?: number,
 * }} options
 */
export function createTrash(options) {
  const paths = options.paths
  const fs = options.fs ?? fsDefault
  const env = options.env ?? process.env
  const exec = options.exec ?? execFileSync
  const logger = options.logger ?? {}
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? 30_000

  const childEnv = {
    ...env,
    DSH_HOME: paths.dshHome,
  }
  const nodeBin = paths.nodeBin()
  if (paths.isElectron && nodeBin === paths.execPath) {
    // Electron 二进制加此环境变量后按 Node 运行；真实 node 不受影响。
    childEnv.ELECTRON_RUN_AS_NODE = '1'
  }

  function run(args) {
    const script = paths.trashScript()
    if (!script) return { ok: false, unavailable: true, code: TRASH_FAILED, results: [] }
    try {
      const stdout = exec(nodeBin, [script, ...args], {
        encoding: 'utf8',
        timeout: timeoutMs,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { ok: true, code: TRASH_OK, stdout, results: parseJsonOutput(stdout)?.results ?? [] }
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : TRASH_FAILED
      const stdout = typeof error?.stdout === 'string' ? error.stdout : ''
      const stderr = typeof error?.stderr === 'string' ? error.stderr : ''
      const parsed = parseJsonOutput(stdout)
      const reason = error?.message ?? stderr ?? 'trash.mjs 执行失败'
      if (!error?.code || status === TRASH_REFUSED || status === TRASH_FAILED) {
        logger.warn?.(`trash.mjs 返回 ${status}：${reason}`)
      }
      return {
        ok: false,
        code: status,
        spawnFailed: error?.code === 'ENOENT',
        stdout,
        stderr,
        results: parsed?.results ?? [],
        error: reason,
      }
    }
  }

  function builtinTrash(targets) {
    const results = []
    let hardFailure = false
    const trashDir = path.join(paths.home, '.Trash')
    try {
      fs.mkdirSync(trashDir, { recursive: true })
    } catch (error) {
      return {
        ok: false,
        code: TRASH_FAILED,
        via: 'builtin',
        results: targets.map((target) => ({ target, status: 'failed', reason: String(error?.message ?? error) })),
      }
    }
    const protectedPaths = new Set(
      [path.parse(trashDir).root, paths.home, paths.dshHome].map((item) => path.resolve(item)),
    )
    for (const target of targets) {
      let abs
      try {
        abs = path.resolve(target)
      } catch {
        results.push({ target, status: 'failed', reason: '无法解析路径' })
        hardFailure = true
        continue
      }
      if (protectedPaths.has(abs) || abs === path.parse(abs).root) {
        results.push({ target, abs, status: 'refused', reason: '受保护路径，拒绝移入废纸篓' })
        hardFailure = true
        continue
      }
      try {
        if (!fs.existsSync(abs)) {
          results.push({ target, abs, status: 'skipped', reason: '路径不存在（视为已清理）' })
          continue
        }
        const destination = uniqueDestination(fs, trashDir, path.basename(abs))
        fs.renameSync(abs, destination)
        results.push({ target, abs, status: 'trashed', to: destination, kind: 'rename' })
      } catch (error) {
        const message = error?.code === 'EXDEV'
          ? '跨卷且 trash.mjs 不可用，拒绝 copy+删除'
          : String(error?.message ?? error)
        results.push({ target, abs, status: 'failed', reason: message })
        hardFailure = true
      }
    }
    try {
      const logFile = path.join(paths.dshHome, '.trash-log.jsonl')
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      const at = now().toISOString()
      for (const result of results.filter((item) => item.status === 'trashed')) {
        fs.appendFileSync(logFile, `${JSON.stringify({ at, mode: 'builtin', ...result })}\n`)
      }
    } catch (error) {
      logger.warn?.(`写废纸篓审计日志失败：${String(error?.message ?? error)}`)
    }
    return { ok: !hardFailure, code: hardFailure ? TRASH_FAILED : TRASH_OK, via: 'builtin', results }
  }

  /**
   * 移入废纸篓（幂等：不存在的路径视为已清理）。
   * @param {string[]} targets
   * @param {{dryRun?: boolean}} [opts]
   */
  function trash(targets, opts = {}) {
    const list = (Array.isArray(targets) ? targets : [targets]).filter((item) => typeof item === 'string' && item.length > 0)
    if (list.length === 0) return { ok: true, code: TRASH_OK, results: [], via: 'noop' }
    const script = paths.trashScript()
    if (script) {
      const args = ['--json']
      if (opts.dryRun) args.push('--dry-run')
      args.push(...list)
      const result = run(args)
      if (!result.unavailable && !result.spawnFailed) return { ...result, via: 'script' }
    }
    if (opts.dryRun) {
      return {
        ok: true,
        code: TRASH_OK,
        via: 'builtin',
        dryRun: true,
        results: list.map((target) => ({ target, abs: path.resolve(target), status: fs.existsSync(target) ? 'would-trash' : 'skipped' })),
      }
    }
    logger.warn?.('未找到 trash.mjs，使用内建 rename→~/.Trash 兜底（不永久删除）')
    return builtinTrash(list)
  }

  /**
   * 覆盖前留档：复制到 $DSH_HOME/.file-backups/<时间戳>/。
   * @param {string} file
   */
  function snapshot(file) {
    if (!file || !fs.existsSync(file)) return { ok: true, skipped: true }
    const script = paths.trashScript()
    if (script) {
      try {
        exec(nodeBin, [script, '--snapshot', file], {
          encoding: 'utf8',
          timeout: timeoutMs,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        return { ok: true, via: 'script' }
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : TRASH_FAILED
        if (status === TRASH_REFUSED) {
          return { ok: false, refused: true, reason: error?.stderr ?? error?.message ?? 'snapshot 被拒绝' }
        }
        logger.warn?.(`trash.mjs --snapshot 失败，改用内建留档：${String(error?.message ?? error)}`)
      }
    }
    try {
      const stamp = now().toISOString().replace(/[:.]/gu, '-')
      const backupDir = path.join(paths.dshHome, '.file-backups', stamp)
      fs.mkdirSync(backupDir, { recursive: true })
      const destination = path.join(backupDir, path.basename(file))
      fs.copyFileSync(file, destination)
      return { ok: true, via: 'builtin', path: destination }
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) }
    }
  }

  return {
    available: () => Boolean(paths.trashScript()),
    script: () => paths.trashScript(),
    nodeBin,
    trash,
    snapshot,
    run,
  }
}
