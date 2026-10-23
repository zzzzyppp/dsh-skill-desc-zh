/**
 * 对外工具：单个 `skill_desc_zh`，用 action 区分
 * status / apply / restore / retranslate / refresh / doctor。
 *
 * 工具定义使用宿主支持的 JSON Schema 子集（不 import dsh 包），输出用宽松对象
 * schema + 自定义 render，保证任何字段组合都能通过 validateJsonSchemaValue。
 */

export const TOOL_NAME = 'skill_desc_zh'
export const TOOL_ACTIONS = ['status', 'apply', 'restore', 'retranslate', 'refresh', 'doctor', 'plugins', 'skills']

const DESCRIPTION = [
  '管理“技能描述中文化”插件：把内置 office / agent-preset 技能的 description 显示为中文，',
  '同时保留随时恢复英文原文的能力。runtime 注册的技能（如 browser-skill）也在覆盖范围内：',
  '插件在对应 agent 的 scope 层注册同名 provider（rank 50 < 250）来替换描述。',
  '',
  'action：',
  '- status：查看当前中文/英文生效状态、每个技能的机制与影子路径（只读）；',
  '- apply：启用中文化并立即生效（幂等；已翻译且指纹未变时复用缓存）；',
  '- restore：一键恢复英文原文，并把本插件创建的项目级影子目录移入废纸篓（幂等）；',
  '- retranslate：强制重新翻译（忽略缓存），技能升级后可手动触发；',
  '- refresh：检查宿主/源技能指纹，仅在变化时重建译文与影子；',
  '- doctor：路径、yaml、LLM、废纸篓与层级覆盖自检（只读）。',
  '- plugins：列出当前 profile 的第三方插件并检查 npm 更新（只读；实际更新请到「设置 → 插件管理」页）。',
  '- skills：列出可写技能与回收站（只读，与设置页“技能管理”同一载荷）。',
  '',
  '不会修改任何内置技能源文件；项目级影子只写入 <project>/.dsh/skills/<name>/。',
].join('\n')

function summarize(value) {
  if (!value || typeof value !== 'object') return String(value)
  if (typeof value.summary === 'string' && value.summary.length > 0) {
    return value.summary
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function renderText(value) {
  const head = summarize(value)
  const lines = [head]
  if (Array.isArray(value?.details) && value.details.length > 0) {
    lines.push('', ...value.details.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))))
  }
  if (Array.isArray(value?.warnings) && value.warnings.length > 0) {
    lines.push('', '警告：', ...value.warnings.map((item) => `- ${item}`))
  }
  return lines.join('\n')
}

/**
 * @param {{ controller: object, logger?: {warn?: Function} }} options
 */
export function createTool(options) {
  const controller = options.controller
  const logger = options.logger ?? {}

  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: TOOL_ACTIONS,
          description: '要执行的操作',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：只处理这些技能名（默认全部目标）',
        },
        force: {
          type: 'boolean',
          description: 'apply/retranslate 时忽略缓存强制重新翻译',
        },
        projectRoot: {
          type: 'string',
          description: '可选：显式指定项目根（默认取当前会话工作目录向上找到的 .git 根）',
        },
        dryRun: {
          type: 'boolean',
          description: 'restore 时只报告会移入废纸篓的目录，不实际执行',
        },
        scope: {
          type: 'string',
          enum: ['user', 'project'],
          description: 'skills 时可选：只列某个来源',
        },
        name: {
          type: 'string',
          description: 'skills/detail 时可选：技能名（kebab-case）',
        },
        source: {
          type: 'string',
          enum: ['all', 'user', 'project'],
          description: 'skills 时可选：来源过滤',
        },
        refresh: {
          type: 'boolean',
          description: 'skills 时可选：绕过 2s 列表缓存',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          summary: { type: 'string' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    timeoutMs: 180_000,
    isConcurrencySafe: (args) => args?.action === 'status' || args?.action === 'doctor' || args?.action === 'plugins' || args?.action === 'skills',
    presentCall: (args) => ({
      card: 'generic',
      title: '技能描述中文化',
      kind: 'skill-desc-zh',
      rawInput: args,
    }),
    async execute(args = {}, exec = {}) {
      const action = args.action
      if (!TOOL_ACTIONS.includes(action)) {
        return {
          ok: false,
          action: String(args.action ?? ''),
          summary: `未知 action：${String(args.action ?? '(空)')}`,
          warnings: [`可用 action：${TOOL_ACTIONS.join(' / ')}`],
        }
      }
      if (typeof controller[action] !== 'function') {
        return {
          ok: false,
          action,
          summary: `插件内部错误：controller.${action} 不可用`,
        }
      }
      try {
        const result = await controller[action](args, exec)
        if (!result || typeof result !== 'object') {
          return { ok: false, action, summary: `controller.${action} 返回了非对象结果` }
        }
        if (action === 'skills' && result.ok !== false && !result.summary) {
          const skills = Array.isArray(result.skills) ? result.skills : []
          const trash = result.trash?.count ?? 0
          return {
            ...result,
            action,
            ok: true,
            summary: `技能 ${skills.length} 个（可写 ${skills.filter((item) => item.editable).length}，只读 ${skills.filter((item) => !item.editable).length}），回收站 ${trash} 项；项目根：${result.projectRoot ?? '无'}`,
          }
        }
        return { ...result, action: result.action ?? action, ok: result.ok !== false }
      } catch (error) {
        if (exec.signal?.aborted) {
          return { ok: false, action, summary: `${action} 已取消`, aborted: true }
        }
        logger.warn?.(`skill_desc_zh(${action}) 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
        return {
          ok: false,
          action,
          summary: `${action} 失败：${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
  }
}
