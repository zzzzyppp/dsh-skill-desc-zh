/**
 * 生命周期事件日志：$DSH_HOME/.skill-desc-zh/events.ndjson。
 *
 * 只追加、不删除、不覆盖；每行一个 JSON 对象，便于升级/还原后追查发生了什么。
 * 写入失败只告警，绝不影响主流程（审计日志是辅助，不是功能前置条件）。
 */

import fsDefault from 'node:fs'
import path from 'node:path'

export const EVENTS_FILE = 'events.ndjson'

/**
 * @param {{
 *   paths: ReturnType<import('./paths.js').createPaths>,
 *   fs?: typeof fsDefault,
 *   logger?: {warn?: Function},
 *   now?: () => Date,
 * }} options
 */
export function createEventLog(options) {
  const paths = options.paths
  const fs = options.fs ?? fsDefault
  const logger = options.logger ?? {}
  const now = options.now ?? (() => new Date())
  const file = path.join(paths.stateDir, EVENTS_FILE)

  function timestamp() {
    const value = now()
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  }

  /**
   * @param {object} event
   * @returns {object|undefined} 实际写入的记录；失败时 undefined
   */
  function append(event) {
    const record = { at: timestamp(), ...event }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 })
      return record
    } catch (error) {
      logger.warn?.(`写入生命周期日志失败：${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /** 读取最近 limit 条（只用于诊断；损坏行跳过）。 */
  function read(limit = 200) {
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      return []
    }
    const lines = raw.split(/\r?\n/u).filter(Boolean)
    const selected = Number.isFinite(limit) && limit > 0 ? lines.slice(-limit) : lines
    const events = []
    for (const line of selected) {
      try {
        const value = JSON.parse(line)
        if (value && typeof value === 'object') events.push(value)
      } catch {
        /* 损坏行不影响其它记录 */
      }
    }
    return events
  }

  return { file, append, read }
}
