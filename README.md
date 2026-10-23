# skill-desc-zh（技能描述中文化）

把 DSH 内置技能与常用斜杠命令的 **description（列表/菜单里显示的描述）** 自动翻译成中文，并且随时可以一键恢复英文原文。

- **只改描述，不改正文**：office 技能通过 global provider 原样透传正文；agent-preset 技能复制整目录、只替换 frontmatter 的 `description` 一行；斜杠命令只改 agent scope 里的描述，执行仍委托原 handler。
- **Better Skill 单入口（v0.6.0）**：DSH 设置左侧只有一个“Better Skill”入口，内含三个 Tab：**描述中文化**（状态/覆盖清单/自检/应用/还原/刷新/重译）、**插件管理**（第三方列表/检查更新/一键更新）、**技能管理**（创建/编辑/禁用/删除/恢复）。三个 Tab 共用同一套 controller 与 HTTP 后端。
- **插件管理（v0.4.0）**：列出 profile 中已安装的第三方插件，检查 npm 最新版并一键更新；官方 bundle 与 `link:` 本地插件永不被更新，更新安全边界仍由宿主把守。
- **技能管理（v0.5.0）**：可创建/编辑/删除/禁用/恢复 `$HOME/.dsh/skills` 与 `<project>/.dsh/skills` 下的可写技能；内置技能只读；删除只进废纸篓，恢复前检查目标是否已存在。
- **随时可逆**：`restore` 立即下架中文 provider，并把本插件创建的影子目录移入 macOS 废纸篓；再 `apply` 即可恢复中文。
- **升级安全**：宿主升级后首次启动会先还原旧影子、清空旧译文，再重新翻译；翻译失败就保持英文，绝不写半成品。
- **零运行时依赖**：不额外安装 npm 包；`yaml` 从宿主 profile 加载，客户端只 `require('react')`。
- **删除只走废纸篓**：代码中没有 `rm` / `unlink` / `rmdir`，唯一删除通道是 `~/.dsh/skills/safe-delete-trash/trash.mjs`。

| 项 | 值 |
| --- | --- |
| 源码 | `~/dsh-plugins/skill-desc-zh` |
| 包名 / 版本 | `dsh-skill-desc-zh@0.6.0` |
| 宿主要求 | DSH ≥ `0.2.1-rc.2`（desktop profile） |
| 对外工具 | `skill_desc_zh`（单工具，8 个 action） |
| 设置页 | 设置 → **Better Skill**（单入口、三个 Tab：描述中文化／插件管理／技能管理；同一个 `settings.section`，id `skill-desc-zh`，order 16） |
| 状态文件 | `~/.dsh/.skill-desc-zh/state.json`（v3；v1/v2 自动迁移） |
| 事件日志 | `~/.dsh/.skill-desc-zh/events.ndjson` |

> 设计说明：最初设计是 4 个独立工具，实现时按评审意见合并为**一个 `skill_desc_zh` 工具 + `action` 参数**，避免工具列表膨胀；下文按实际接口说明。

---

## 1. 功能一览

| 能力 | 说明 |
| --- | --- |
| 自动中文化 | 安装后 bootstrap 捕获 12 个目标技能 + 3 条命令，批量调用宿主 LLM 翻译；失败回落随包词典 `lib/dictionary.zh.json` |
| Better Skill 设置页（v0.6.0） | 设置左侧**单一入口**，内含三个 Tab：描述中文化（状态/开关/应用/还原/刷新/重译/自检/15 行覆盖清单）、插件管理（第三方列表/检查更新/一键更新）、技能管理（创建/编辑/禁用/删除/恢复/回收站） |
| 命令菜单中文化 | `/acp`、`/acp-cache`、`/agent-teams`（含动态 `agent-teams-<profile>`）只在当前 agent 的菜单显示中文；global 视角永远英文，执行行为不变 |
| 一键恢复英文 | `restore` 把 `enabled=false` 写入 state，provider 立即下架，4 个影子目录进废纸篓 |
| 随时再中文化 | `apply` 幂等启用；指纹未变时复用缓存，不重复调模型 |
| 升级自愈 | 检测 `hostVersion` 变化：先还原旧影子 → 清缓存 → 重译 → 重建影子 |
| 指纹刷新 | `refresh` 按 `hostVersion + name/description/content/resourceBase` 指纹判断，变化才重建 |
| 安全删除 | 只有带 `.skill-desc-zh.json` 标记的影子目录才会被管理；未标记目录绝不覆盖/删除 |
| 自检 | `doctor` 检查路径、yaml、LLM、废纸篓、覆盖层级 |

### 覆盖范围（技能 12 个 + 命令 3 条）

| 层 | 技能 | 机制 | 是否写磁盘 |
| --- | --- | --- | --- |
| global（office，rank 600） | `office`、`office-docx`、`office-export-pdf`、`office-pptx`、`office-recalculate`、`office-render`、`office-xlsx` | 注册 global 层 skill provider（rank 50）；`get()` 返回中文 description + **原样透传** content/resourceBase | 否 |
| preset（agent-preset，rank 300） | `agent-experience`、`cordis-composition-reference`、`cordis-plugin-development`、`editing-cordis-compositions` | 项目级影子 `<project>/.dsh/skills/<name>/`（文件系统 rank 100，与 preset 同层） | 是，仅项目内 `.dsh/skills/` |
| runtime（agent scope，rank 250） | `browser-skill` | 发现阶段捕获其 runtime 定义，再经 `agent.ctx` 在该 agent 层注册同名 provider（`skill-desc-zh-agent`，rank 50 < 250）覆盖描述；content/resourceBase 原样透传 | 否 |
| 用户级（rank 400） | `dsh-plugin-preinstall-audit`、`safe-delete-trash` | 本身已是中文，不在目标内 | — |
| 命令（agent scope） | `/acp`、`/acp-cache`、`/agent-teams`；配置含 `agent-teams` 时自动纳入动态 `agent-teams-*` | 在每个 agent 的 `agent.ctx.get("commands").register()` 注册同名命令影子；`handler` 每次实时委托原实现 | 否 |

---

## 2. 安装（先预检，再应用内安装）

### 2.1 预检（强制）

按 `~/.dsh/AGENTS.md` 的约定，安装任何插件前必须先做兼容性/冲突预检：

```sh
# 推荐：本仓库的包装脚本（自动补本地目录检查）
node ~/dsh-plugins/skill-desc-zh/scripts/preflight.mjs

# 等价的官方脚本
node ~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs --profile desktop \
  ~/dsh-plugins/skill-desc-zh
```

退出码：`0` 干净、`2` 只有警告（需逐条向用户确认）、`1` 有阻塞项（**禁止安装**）。

> **本地目录包的限制**：`audit.mjs` 无法判定本地目录的“仓库来源 / 发布者签名 / 发布时间 / 隔离期”，`scripts/preflight.mjs` 会固定输出 ⚠️“未验证”。这不等于“没问题”，必须如实转述给用户。
>
> 本插件为**零依赖、无 install/postinstall 生命周期脚本、`private:true`** 的本地 bundle。2026-10-21 的安装预检中，audit 报出的 2 条 ❌ 均指向 profile 中已存在的第三方插件版本（`minimumReleaseAge` 隔离期），且这些版本恰在 profile 的 `minimumReleaseAgeExclude` 豁免列表中；用户明确批准 override 后才安装。详见 `docs/verification.md` §1。

### 2.2 应用内安装

```text
plugin_manager install_bundle
  target: ~/dsh-plugins/skill-desc-zh
```

- **必须用应用内 `plugin_manager`**；CLI `dsh plugin --profile desktop add` 会被桌面端拒绝（“profile "desktop" is managed exclusively by the Electron application”）。
- 本地目录传**绝对路径**；宿主会写成 `link:` 依赖，不会复制源码。
- 安装后确认：

```text
plugin_manager list_plugins
→ {"entryId":"include:skill-desc-zh","enabled":true,"fiberPhase":"active"}

cordis_inspect_query(platform=host, provider=Tool, method=listTools)
→ 应看到 skill_desc_zh
```

- 安装 bundle 本身可能由宿主热挂载；但**Better Skill 入口（v0.6.0）与其中三个 Tab 都必须重启后才会出现**，且模型可见的技能目录快照可能要到**下一个会话**才刷新。若 `link:` 源码已升级到新版本（本次为 v0.6.0），运行中的进程仍持有旧代码，**必须重启 DSH** 才会加载新代码和设置页。
- v0.3.0+ 的客户端半边（`exports["./client"]` + `dsh.client.platform="web"`）只在宿主启动扫描 bundle 时登记；**给已安装插件补设置页，第一次必须重启**。重启后左侧设置导航出现“技能描述中文化”“插件管理”“技能管理”，打开后应能读取状态。

### 2.3 配置（`cordis.patch.yml` 的 `config`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 插件总开关（`restore` 会写成 `false`） |
| `engine` | `"auto"` | `auto`：LLM 优先，失败回落词典；`llm`：只用 LLM；`dictionary`：只用随包词典 |
| `translatePreset` | `true` | 是否处理 4 个 agent-preset 技能（需要项目影子） |
| `restoreOnQuit` | `false` | 宿主退出时是否自动还原英文（默认保留中文） |
| `projectAllowlist` | 本仓库配置为 `["/Applications/dsh"]` | 额外允许写影子的项目根；代码默认 `[]`。`$HOME` 下的项目默认允许 |
| `llm.provider` / `llm.model` | `null` | 留空用当前会话的 `agentDefaultModel.currentSelection()` |
| `llm.timeoutMs` | `30000` | 单次批量翻译超时 |
| `targets.global` / `targets.preset` | 8 + 4 个 | 目标技能名单；global = 7 个 office + `browser-skill`，preset = 4 个 agent-preset |
| `targets.commands` | `["acp","acp-cache","agent-teams"]` | 目标命令名单；设 `[]` 可单独关闭命令中文化 |

---

## 3. 工具用法（`skill_desc_zh`）

所有操作都通过同一个工具完成，`action` 必填。v0.6.0 起也可以在 Better Skill 设置页的三个 Tab 里点按钮完成这些动作（语义相同）：描述中文化 Tab 见 §5.1，插件管理 Tab 对应 `plugins` action（§5.2），技能管理 Tab 对应 `skills` action（§5.3）。

```jsonc
{ "action": "status" }
{ "action": "apply" }
{ "action": "restore", "dryRun": true }
{ "action": "restore" }
{ "action": "retranslate", "names": ["office-render"] }
{ "action": "refresh" }
{ "action": "doctor" }
{ "action": "plugins" }
{ "action": "skills" }
```

可选参数：

- `names: string[]`：只处理指定技能（默认全部 12 个技能目标；命令由 `targets.commands` 控制，不受 `names` 影响）。
- `projectRoot: string`：显式指定项目根（默认从当前会话工作目录向上找第一个含 `.git` 的目录）。
- `dryRun: boolean`：`restore` 时只报告会移入废纸篓的目录，不实际执行。
- `force: boolean`：`apply` / `retranslate` 时忽略缓存强制重译。

### 3.1 `status`（只读）

```text
技能描述中文化已生效（phase=active）：中文 12/12；项目 /Applications/dsh；宿主 0.2.1-rc.2

office [global/provider] 中文 · engine=llm · hash=493220ec71be
…
agent-experience [preset/shadow] 中文 · engine=llm · hash=7fd16448d780
  影子 /Applications/dsh/.dsh/skills/agent-experience
```

同时返回每个技能的机制、指纹、影子路径、warnings。恢复英文后：

```text
已还原英文原文（state.enabled=false）；当前无中文覆盖；发现 12 个目标
agent-experience [preset/shadow] 英文 · engine=llm · hash=… · 无影子
```

### 3.2 `apply`（中文化 / 启用）

```text
apply 完成：中文 12/12（office 7，preset 4，runtime 1），影子 4/4；宿主 0.2.1-rc.2
```

幂等；指纹未变时直接复用 state 缓存与已有影子。已翻译过的技能不会重复调用 LLM。

### 3.3 `restore`（一键恢复英文）

```text
已恢复英文原文：4 个影子目录移入废纸篓；provider 已下架，下一步技能列表为英文；命令描述已恢复英文（3 条影子）
```

- `enabled=false` 写入 state，provider 立即 `invalidate()`；
- 命令影子先注销（数条内存条目，无文件删除）；
- 4 个带标记影子目录走 `trash.mjs` 移入 `~/.Trash`；
- 不删除 state，随时可以再 `apply`。

预演：`{ "action": "restore", "dryRun": true }`。

### 3.4 `retranslate`（强制重译）

```text
retranslate 完成：中文 12/12（office 7，preset 4，runtime 1），影子 4/4
```

忽略缓存，重新调用 LLM；适合手动改了词典、怀疑译文过时，或想换模型时使用。可配 `names` 只重译单条，`force` 同义。

### 3.5 `refresh`（按指纹刷新）

只在宿主版本/源技能内容/资源变化时重建；未变化时不重写影子、不重新调模型。日常无需手动执行，安装、升级、`agent/created` 时都会自动跑。

### 3.6 `doctor`（自检）

检查：state/路径可读写、`cordis.patch.yml` 与 profile 配置、LLM 可用性、`trash.mjs` 是否存在、覆盖层级是否如预期。只读，不改任何文件。

### 3.7 命令描述（v0.2.0）

`/acp`、`/acp-cache`、`/agent-teams`（以及动态 `agent-teams-<profile>`）的 agent 菜单描述中文化是 v0.2.0 的独立能力；机制、用法、限制、状态迁移与回滚见 **§4**。`status` 的 `commands` 段和 `doctor` 的 `command-layer` 也会一并检查命令层。

### 3.8 `plugins`（插件管理 Tab，v0.4.0）

只读列出当前 profile 中已安装的第三方插件（官方 bundle 与自身除外），并返回版本、来源、registry、最新版与可更新标记；不会安装/更新任何东西。Better Skill 的“插件管理”Tab 读取同一份数据，更新动作走单独的 HTTP `POST /plugins/skill-desc-zh/plugins/action`。完整说明见 §5.2。

### 3.9 `skills`（技能管理 Tab，v0.5.0）

只读列出可写技能（用户级/项目级）与只读技能（plugin/preset/bundled/runtime），并返回回收站摘要；不写文件。完整用法、写操作（新建/编辑/禁用/删除/恢复）与错误语义见 §5.3。`status` 不包含技能管理计数，页面读取 `skills` 同一载荷。

---

## 4. 斜杠命令描述中文化（v0.2.0）

v0.2.0 把 `/acp`、`/acp-cache`、`/agent-teams` 在**会话命令菜单**里的描述也翻译成中文。它不修改任何命令实现，也不改全局注册表；执行行为保持原样。

> 设计细节见 [`docs/command-desc-design.md`](docs/command-desc-design.md)，机制调查与真实宿主证据见 [`docs/command-desc-investigation.md`](docs/command-desc-investigation.md)，验收见 [`docs/verification.md`](docs/verification.md) 的 v0.2.0 章节。此前“只处理技能描述、斜杠命令不在范围内”的口径自 v0.2.0 起作废。

### 4.1 覆盖的命令

| 命令 | 中文描述 | 说明 |
| --- | --- | --- |
| `/acp` | 显示 bili 上下文压缩状态 | billion-context 注册的 global 命令 |
| `/acp-cache` | 提示词缓存对账（与 acp_cache 工具同源同报） | billion-context 注册的 global 命令 |
| `/agent-teams` | 以多智能体团队运行目标（你将成为队长） | agent-teams 注册的 global 命令 |
| `agent-teams-<profile>` | 以 AgentTeams「`<profile>`」配置运行一个团队目标 | 仅当 agent-teams 配置了 `profiles` 时动态出现；当前 desktop profile 未配置，实际不注册 |

内置的 `goal`、`plan`、`feedback`、`compact`、`permission`、`export` 六条由 GUI 自带本地化，本插件**不注册、不修改**；即使 `targets.commands` 误配，也会按 `definitionId` 跳过。

### 4.2 机制：只注册 agent scope 影子

宿主对同名命令的全局注册会直接抛错（错误信息会提示改为挂到该 agent 的 `agent.ctx`）。因此本插件：

- 在**每个 agent 的 `agent.ctx.get("commands")`** 注册同名影子，只替换 `description`；`definitionId`、`input`（含 `hint`/`attachments`）、`recordInput` 原样保留；
- `handler` 每次执行时实时 `commands.find(undefined, name)` 解析原实现并委托；原实现暂时缺失时用注册期快照兜底，彻底失效则返回明确错误，不 catch、不重写返回值；
- **global 视角永远英文**；agent A 的菜单中文，agent B、其它会话不受影响；
- 只存在内存，**零文件写入**；命令影子不随插件 fiber 自动回收，`restore`/`restoreOnQuit`/插件 `dispose` 都会显式调用注册时返回的 disposer；
- 生命周期：`agent/created` 时同步注册（不阻塞 agent 创建）、`startup` 为已知会话补注册、`commands/change` 用 50ms debounce + 全局 digest 比较避免自触发；每个 agent 用签名去重，重复事件不会重复注册。

`commands.register()` 通过 `layers.effect(this.ctx)` 把定义写进调用者所在的 scope 层；`list(agent)` 按“最近层优先”解析。这正是“global 英文、agent 中文”能同时成立的原因。

### 4.3 用法

```jsonc
// 查看状态：status.commands 会给出每条命令的中文/引擎/是否 stale/是否缺失
{ "action": "status" }

// 一并恢复英文（命令影子立即注销；技能影子照旧进废纸篓）
{ "action": "restore" }

// 预演 restore，不实际改动
{ "action": "restore", "dryRun": true }

// 重新启用/注册，指纹未变时复用缓存
{ "action": "apply" }

// 强制重译命令描述（忽略缓存）
{ "action": "retranslate" }
```

`status.commands` 的常用字段：`enabled`、`targets`、`translations`（每条命令的 `zh`/`engine`/`stale`/`missing`）、`registered`（已注册影子数）、`missing`（未捕获到的命令）、`restored`/`restoredAt`。`doctor` 的 `command-layer` 会用最近一个 agent 实测“agent 中文 / global 英文 / `definitionId` 一致 / 非内置”。

只想关闭命令中文化、保留技能中文化：把 `cordis.patch.yml` 的 `targets.commands` 设为 `[]` 后重新加载插件；把 `targets.commands` 留空不是“翻译失败”，而是明确不注册。

### 4.4 state v1 → v2 自动迁移

v0.2.0 把 state 版本从 1 升到 2，新增 `commands.byName`（每条命令的 `en`/`zh`/`engine`/`fingerprint`/`hint` 等）与 `restoredAt`：

- 读取旧 state 时，`normalizeState` 会补上空的 `commands.byName`/`restoredAt` 并归一化为 `version=2`；技能、项目影子、缓存、历史都原样保留；
- 第一次以 v2 保存前，`save()` 先用 `trash.snapshot` 给旧文件留档，再写临时文件并原子 `rename`，权限 `0600`；
- state 文件损坏时只告警并使用空状态；原文件在覆盖前同样会留档，不会直接丢弃；
- `restore` 会写入 `commands.restoredAt`，但**不删除 state**；之后 `apply` 可重建命令记录。命令译文本身是可重建缓存，删掉 state 不会影响命令实现。

### 4.5 限制与尚未在线验证的项

1. **需要重启/新会话生效**：v0.2.0 源码目前通过 profile 的 `link:` 依赖加载；用户重启 DSH 后才会运行新代码，菜单快照也要等新会话或 GUI 刷新。
2. **GUI 软刷新**：`commands/change` 会让客户端后台重拉，已打开的菜单可能短暂显示旧文案，重新打开即恢复。
3. **只覆盖 agent 视角**：global 视图始终英文；这是宿主命令注册表的约束，不是失败。
4. **不覆盖内置 6 条**：`goal`/`plan`/`feedback`/`compact`/`permission`/`export` 的中文由 GUI 自带字典提供，插件不参与。
5. **动态 profile 命令**：只有 agent-teams 配置了 `profiles` 才会出现 `agent-teams-<profile>`；当前 profile 未配置，故 README 中的模板是离线规则，未在真实宿主触发。
6. **真实菜单/真实执行尚未在线验收**：v0.2.0 的验收是源码级（真实宿主模块探针 + 生产 e2e）；`/acp`、`/acp-cache`、`/agent-teams` 的真实点击、副作用与菜单像素需重启后由用户确认。
7. **真实 LLM 翻译命令描述未联网验证**：离线词典/模板路径已实测；LLM 路径有单测（fake llm）。
8. **多 agent 性能未压测**：每个 agent 都会注册一份内存影子；当前 profile 的 agent 数量下无异常。

### 4.6 回滚

| 目标 | 操作 |
| --- | --- |
| 只回英文 | `skill_desc_zh { "action": "restore" }`：注销全部命令影子，并把技能影子移入废纸篓 |
| 临时停用 | `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`：插件 `dispose` 会注销命令影子；技能影子按 `restoreOnQuit` 语义处理，彻底回英文请先 `restore` |
| 彻底卸载 | 先 `restore`，再 `plugin_manager remove_bundle target="dsh-skill-desc-zh"`；源码目录不受影响 |
| 只关命令 | 把 `targets.commands` 设为 `[]`，保留技能中文化 |
| 源码回退 | 本仓库**没有 `.git`**，不能 `git revert`；改动前把 `lib/` 备份到仓库外，回滚时用 `trash.mjs --snapshot` 留档后覆盖 |

命令影子只存在于内存，回滚不需要删除任何文件；技能影子与 state 的删除/清理仍只能走 `trash.mjs`。

---

## 5. Better Skill 设置页（v0.6.0）

v0.6.0 把设置导航收敛为**一个入口、三个 Tab**：DSH 设置 → 左侧导航“Better Skill”，进入后用 Tab 切换“描述中文化 / 插件管理 / 技能管理”。三个 Tab 与 `skill_desc_zh` 调用同一套 controller，页面动作、返回状态与工具结果语义一致；页面只是可视化入口，不改变底层还原/升级自愈逻辑。

> **状态说明**：截至 2026-10-23，源码 v0.6.0 已完成源码级验收（215/215 单测、`check:client` 17/17、技能/插件/命令/agent 层 e2e），但**当前运行进程仍是重启前的旧代码**；Better Skill 入口与三个 Tab 都要重启 DSH 后才会出现。本章是重启后的使用说明，“已验证”仅指源码/单测/真实模块探针层，真实页面、认证与真实写操作仍需重启后人工确认。

> 设计见 [`docs/settings-ui-design.md`](docs/settings-ui-design.md)、[`docs/skill-admin-design.md`](docs/skill-admin-design.md)；重启前验收、F1/F2 修复与 I1 基线裁定见 [`docs/verification.md`](docs/verification.md) 的 v0.3.0/v0.4.0/v0.5.0/v0.6.0 章节。

**入口与 Tab 切换**

1. **重启 DSH**。v0.3.0+ 的客户端半边与 HTTP 路由需要宿主启动时重新扫描 bundle；升级 `link:` 源码后不重启，Better Skill 不会出现。
2. 打开设置，左侧只有一个“Better Skill”一级项；进入后默认显示“描述中文化”Tab。
3. 顶部 Tab 栏可点击，也支持键盘：`←`/`→` 在三个 Tab 间循环，`Home`/`End` 跳到第一个/最后一个；焦点跟随选中项，`role=tab`/`tablist`/`tabpanel` 与 `aria-selected`/`aria-controls` 完整。
4. 当前 Tab 写入 `localStorage` 的 `dsh-skill-desc-zh.activeTab`；重开设置会恢复到上次的 Tab；值非法/读写抛错时回退到“描述中文化”。
5. 只有当前 Tab 的内容会挂载；每个 Tab 的错误边界带 `key=active`，一个 Tab 崩溃不会让切换永久卡在 fallback。切换 Tab 会卸载旧面板、停止其请求/轮询。

### 5.1 描述中文化 Tab

**第一次使用**：重启后进入 Better Skill → 页面顶部应显示运行状态；若显示“无法读取状态”，先看下面的故障排查。需要中文化时点“应用”，已生效会显示 `phase=active` 与覆盖数量；想回英文点“还原”（二次确认），确认后 provider 下架、影子目录进废纸篓、命令影子注销。

页面只在**可见时**每 5 秒轮询一次；切到后台会停止，失败按 5→10→20→30 秒退避，不会持续打满宿主。

#### 页面组成

| 区块 | 内容 |
| --- | --- |
| 状态摘要 | `phase`、技能/命令中文计数、宿主版本、项目根与来源、warnings |
| 启用开关 | 开：等同 `apply`；关：等同 `restore`（先弹确认） |
| 操作按钮 | 应用、还原、刷新、重译、自检 |
| 覆盖清单 | 15 行：8 个全局技能（office ×7 + `browser-skill`，provider 覆盖）+ 4 个 agent-preset 影子 + 3 条斜杠命令（agent 作用域影子）；含当前语言、引擎、stale/missing、影子路径 |
| 自检 | `doctor` 的 mandatory/optional 检查项与限制 |
| 最近事件 | `events.ndjson` 的 `lastAction` 与文件位置 |
| 只读配置 | Host 未通过 state 暴露的 allowlist / restoreOnQuit / 模型路由会显示“Host 未提供”，不会伪造默认值 |

#### 按钮与开关语义

| 操作 | 等价工具调用 | 说明 |
| --- | --- | --- |
| 应用 | `skill_desc_zh(action="apply")` | 重新捕获/翻译；指纹未变复用缓存；按需重建影子 |
| 还原 | `skill_desc_zh(action="restore")` | 下架 provider、注销命令影子、影子目录走 `trash.mjs`；不删除 state，可再应用 |
| 刷新 | `skill_desc_zh(action="refresh")` | 按 `hostVersion`/内容指纹检查，只有变化才重建 |
| 重译 | `skill_desc_zh(action="retranslate")` | 忽略缓存强制重译全部技能与命令 |
| 自检 | `skill_desc_zh(action="doctor")` | 只读检查路径、yaml、LLM、trash、层级覆盖 |
| 开关关闭 | `restore` | 会弹确认；取消则不改动 |
| 开关打开 | `apply` | 若之前是 `restore` 状态，则重新中文化 |

`restore` 只管理本插件创建、带 `.skill-desc-zh.json` 标记的目录；不会改内置技能源文件，也不会碰用户自建技能。

#### 覆盖清单怎么读

清单固定 15 行，分三组：

- **全局技能组（8 行）**：7 个 office + `browser-skill`。office 由 global provider 覆盖（零文件写入，正文原样透传）；`browser-skill` 由对应 agent 层的 provider 覆盖。页面上的 `engine` 表示译文来源，`sourcePath` 是原始技能位置。
- **preset 组（4 行）**：4 个 agent-preset 技能，通过项目级影子 `<project>/.dsh/skills/<name>/` 覆盖；`shadowPath` 指向影子目录，只有带标记的目录才归本插件管理。
- **命令组（3 行）**：`/acp`、`/acp-cache`、`/agent-teams`，只在 agent scope 注册内存影子；`shadowPath` 为空是正常的，命令不写文件。

`stale=true` 表示源技能/宿主版本已变化、当前译文待刷新；`missing=true` 表示发现阶段没有捕获到该目标（例如项目未放行、运行时技能未注册）。这两类都会在 `status` 与页面 warnings 中显示，不会静默当作成功。

#### 状态字段

| 字段 | 取值 / 含义 |
| --- | --- |
| `phase=booting` | 插件刚开始启动，尚未完成捕获/翻译 |
| `phase=active` | 中文覆盖已生效（技能与命令均按配置处理） |
| `phase=degraded` | 部分目标回退词典或英文；看 warnings 与 events 原因 |
| `phase=stale` | 指纹变化，旧译文待刷新 |
| `phase=restored` | 已执行还原，当前英文原文生效 |
| `phase=failed` | 捕获/翻译/影子/还原失败；插件保持 fail-closed，不会乱写 |
| `engine=llm` | 当前译文由宿主 LLM 生成 |
| `engine=dictionary` | 使用随包词典（离线可用） |
| `engine=source` | 使用源技能原文（通常表示该目标本身已是中文，无需翻译） |
| `engine=none` | 没有可用译文/未处理 |
| `engine=unknown` | 宿主返回了未知引擎，按未翻译处理 |

#### 自检（doctor）

页面“自检”调用 `doctor`，检查：state/路径可读写、`cordis.patch.yml` 与 profile 配置、LLM 可用性、`trash.mjs` 是否存在、global/preset/命令三层覆盖是否符合预期。只读，不改任何文件。

- `mandatory` 失败通常意味着插件无法安全继续（例如 trash 通道不可用、yaml 解析失败），应保持英文并排查；
- `optional` 失败通常只影响某种引擎/项目（例如当前项目未放行、LLM 不可用但词典可用），会降级而不是崩溃。

#### 故障排查

| 现象 | 排查 |
| --- | --- |
| 设置里看不到“Better Skill” | 最常见是**没重启**（v0.3.0+ 新客户端需重启扫描）；确认 `plugin_manager list_plugins` 中 `include:skill-desc-zh` 为 `enabled=true`、`fiberPhase=active`；确认包版本 0.6.0 且 `exports["./client"]` 存在 |
| 页面显示“无法读取状态 / 设置页后端不可用” | 路由未注册或认证失败：确认已重启；用工具 `skill_desc_zh(status)` 对照插件是否正常；看宿主日志中 `/plugins/skill-desc-zh/state` 的 401/403/503；未重启时该路径返回 404 属正常 |
| 页面能开但数据一直 loading | 检查浏览器/宿主同源 fetch、cookie 与 CSP；`GET /state` 应返回 `cache-control: no-store`；必要时用工具 `status` 判断是 UI 还是 Host |
| 技能描述仍是英文 | 看 `phase`、每个目标的 `engine` 与 warnings；preset 需要项目根满足 `.git` + `$HOME`/allowlist；office 看 provider 是否 ready；目录快照可能需新会话 |
| 命令菜单仍是英文 | 确认重启后加载 v0.2.0+；`status.commands.registered` 是否 >0；global 视角本来就英文 |
| 点“还原”后英文没恢复 | 看页面 `phase=restored` 与 warnings；确认没有未标记同名目录冲突；必要时 `doctor` 看 trash 通道 |
| 重译失败 | LLM 不可用时自动回落词典；看 warnings/events；可改用离线词典或稍后重试 |
| Tab 切换后白屏/卡在错误页 | 确认加载的是 v0.6.0（单个 `settings.section` + 三个 Tab）；旧版多入口页面需重启刷新；单个 Tab 崩溃应只影响该 Tab，切换后新 Tab 会重建错误边界 |

### 5.2 插件管理 Tab

**入口：Better Skill → “插件管理”Tab**（同一个 `settings.section`，id `skill-desc-zh`，order 16；不再单独占用左侧一级项）。

#### 功能

| 能力 | 说明 |
| --- | --- |
| 第三方插件列表 | 读取当前 profile 的 `pluginManager.listBundles()`，过滤掉官方 bundle 与本插件；显示名称、版本、来源（`npm` / 本地 `link:`/`file:` / workspace / git / tarball）、启用状态、registry、检查时间 |
| 检查更新 | 对可更新的 npm 插件请求 registry 的 `/<包名>/latest`，5 分钟缓存，并发上限 6、单请求 8 秒超时；只判断“有没有新版”，不抓取发布时间 |
| 一键更新 | 二次确认后调用宿主 `pluginManager.installBundle(name@latest)`；宿主返回 `restart-required` 时页面提示重启，`pendingBuilds` 时提示构建脚本待批准 |
| 只读边界 | 页面不启用/禁用/卸载插件（这些操作仍在原生“设置 → 插件”页）；不写 profile 的任何配置或豁免白名单 |

#### 依赖与 profile 解析

- 宿主服务：`pluginManager`（`listBundles` / `installBundle`；版本与可用性从宿主读取，不可用时页面显示“需要重启加载 0.4.0+”，不会自行安装）。
- registry：优先使用 `pluginManager` 提供的 registry；缺省回退 `https://registry.npmjs.org/`。请求失败不阻塞其他插件，逐行显示“检查失败”。
- profile 解析优先级（`lib/plugin-admin.js:199-256`）：`desktopProfiles.current`（桌面端权威）→ `profileContext`（CLI 启动器）→ `DSH_PROFILE_DIR` → `--profile` 参数 → `web` → `desktop`；只有含 `package.json` 的目录才算命中。
- 本插件的 profile 依赖是 `link:~/dsh-plugins/skill-desc-zh`，因此它自身显示“当前插件（link: 安装，不参与更新）”。

#### 更新安全边界

- **只更新已安装的第三方 npm 插件**：`official===true` 的官方 bundle、`link:`/`file:`/workspace/tarball 等非 npm 来源、以及本插件自身，全部标记为“不参与更新”。
- **不绕过供应链闸门**：不写 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`，也不加 `--config.minimumReleaseAge=0`；新版本仍在隔离期时，更新会失败并原样显示宿主错误。
- **构建脚本批准与兼容性闸门仍由宿主执行**：更新只是调用宿主 `installBundle`，不自行执行 pnpm，也不代替用户批准构建脚本；遇到 `pending-builds` 时按宿主错误提示处理（构建脚本批准、启用/禁用、卸载统一到原生“设置 → 插件”页）。
- **不删除文件**：更新只改 profile 依赖与 node_modules，源码目录不受影响；卸载/清理仍走原生插件页或 `trash.mjs`。

#### 错误分类

页面把失败原因归一为以下类别（都显示为失败行/提示，不会把失败说成成功）：

| code | 含义 / 用户动作 |
| --- | --- |
| `quarantine` | 新版本仍在 24h 供应链隔离期；等隔离期结束或按 AGENTS.md 走人工审批，页面不提供绕过 |
| `pending-builds` | 新版本含需要批准的构建脚本；到原生“设置 → 插件”页查看并批准，或放弃更新 |
| `incompatible` | 宿主兼容性闸门拒绝（如 engines.dsh 不满足）；不要强行安装 |
| `no-update` | 已是最新版；无需操作 |
| `busy` | 另一个更新/设置动作正在执行；稍后重试（同一插件并发更新由宿主与插件层单飞拦截） |
| `unavailable` | 宿主 `pluginManager` 或设置页后端未加载；确认已重启并加载 v0.4.0+ |

另有 `unknown-plugin`（不在可管理列表）、`not-updateable`（非 npm 来源）、`network`（registry 请求失败）、`install-failed` / `operation-error`（宿主安装失败）。更新结果里的 `restart-required` 不是错误，页面会提示重启 DSH。

#### 工具与 HTTP 接口

| 接口 | 用途 |
| --- | --- |
| `skill_desc_zh(action="plugins")` | 只读：返回 `{ profile, registry, plugins, details, warnings }`；与页面读取同一 controller；不会安装/更新 |
| `GET /plugins/skill-desc-zh/plugins` | 插件列表；`?refresh=1` 跳过 5 分钟列表缓存，强制重查 registry（仍受单请求 8 秒超时与并发 6 限制） |
| `POST /plugins/skill-desc-zh/plugins/action` | body `{ "action": "check" }` 或 `{ "action": "update", "name": "<插件名>" }`；更新前会二次确认 |

所有设置页 HTTP 接口都复用宿主认证围栏（未认证 401/403、后端缺失 503）、JSON-only、body ≤64 KiB、`cache-control: no-store`；有动作在跑时返回 409，而不是排队重复安装。`skill_desc_zh(action="plugins")` 是只读工具，不会触发更新。

> **当前限制**：更新动作未做真实安装验收（e2e 使用 fake `installBundle`，只验证调用参数与错误分类）；真实 Electron 进程、认证后的页面与一次实际更新需重启 DSH 后人工确认。官方 bundle 与 `link:` 本地插件永远不参与更新。

### 5.3 技能管理 Tab

**入口：Better Skill → “技能管理”Tab**（同一个 `settings.section`，id `skill-desc-zh`，order 16；不再单独占用左侧一级项）。

#### 能做什么

| 能力 | 说明 |
| --- | --- |
| 列出技能 | 合并用户级 `$HOME/.dsh/skills` 与当前项目 `<project>/.dsh/skills` 的可写技能，并单列 plugin/preset/bundled/runtime 只读技能；`source=user\|project\|all` 可过滤，默认 `all` |
| 新建 | 只写 `user` 或（已放行的）`project` 根，生成 `<name>/SKILL.md`，校验 kebab-case、单行 description、body ≤200 KiB |
| 编辑 | 可改 description 与正文；保存时带 `expectedFingerprint` 做乐观锁，其他 frontmatter 字段与注释原样保留 |
| 禁用/启用 | 写入 state 的 `skillAdmin.disabled[]`；只影响 agent 作用域：provider rank 40 覆盖同名技能，候选 `modelInvocable:false`，global 视角仍英文；可随时恢复 |
| 删除 | 只走 `trash.mjs` 移入废纸篓，不永久删除；记录删除元数据，可从页面“恢复” |
| 恢复 | 按删除记录把文件从废纸篓移回；目标已存在时返回 `conflict`，绝不覆盖；恢复时重新检查项目 allowlist |
| 回收站 | 列出最近删除（上限 200 条），支持恢复与查看原路径；不提供永久清空 |

所有写操作都只在用户级或已放行项目的 `.dsh/skills` 内；内置技能源文件与插件包永不修改。写盘前对已有文件做 `--snapshot` 留档，临时文件原子替换。

#### 可写与只读边界

| 来源 | 可写 | 说明 |
| --- | --- | --- |
| `user` | 是 | `$HOME/.dsh/skills` |
| `project` | 是 | `<project>/.dsh/skills`，仅 `$HOME` 下项目或 `projectAllowlist` 放行；必须满足项目根规则 |
| `plugin` / `preset` / `bundled` / `runtime` | 否 | 只读展示；页面不提供编辑/禁用/删除，API 也拒绝写入 |
| 任意 `../`、绝对路径、非 kebab 名称 | 否 | `invalid`，不会拼出根目录外的路径 |

只读技能仍会显示在“只读”折叠区，用于查看来源和中文描述；它们不参与可写统计，也不会混入 `source=user` 列表。真实运行中 `browser-skill` 属 runtime、office 属 bundled、四个 agent-preset 属 preset。

#### 冲突、错误与安全

| 情况 | 返回/行为 |
| --- | --- |
| 文件在打开后被改过（指纹不符） | HTTP 409 / `conflict`，页面提示“重新加载”，不覆盖对方修改 |
| 目标已存在（新建/恢复） | `conflict`；恢复不会静默覆盖现有目录 |
| body 超过 256 KiB | HTTP 413 / `too-large` |
| 非法名称、scope、source、projectRoot | HTTP 400 / `invalid` 或 `unsupported-source` |
| 项目根不在 allowlist | `unsupported-source`，不读也不写 |
| 并发保存/动作 | 一个 `skillBusy` 单飞；第二个请求 409，不会同时改同一棵树 |
| trash.mjs 不可用/失败 | 失败关闭，绝不降级为 `rm`；页面显示错误 |
| 未认证 | 401/403；后端未加载 503；所有响应 `cache-control: no-store` |

正文首尾空白在保存时按设计归一化；description 使用 YAML 单行字符串，含换行会被拒绝。YAML 锚点/别名无法安全定点改写时返回 `unsupported-frontmatter`，原文件保持字节不变。

#### 已知限制（重启前）

- 页面像素、真实认证、真实点击与真实文件写入尚未在运行中的 GUI 验收；本章的“通过”仅指源码、单测、真实模块探针与临时目录 e2e。
- 只管理文本技能；不处理二进制资源，不提供批量导入/导出。
- 禁用只在 agent 作用域生效，global 视角仍英文；这是宿主层级机制，不是页面 bug。
- `link:` 源码升级后必须重启 DSH 才会加载 v0.6.0 的 client/server 两半。
- 仓库没有 `.git`，回滚依赖快照/备份而非 `git revert`。
- 真实 `~/.dsh` 的写操作未在本次验收中执行；首次使用请先在一个测试项目里试新建/删除/恢复。

#### Host API（v0.5.0）

| 接口 | 用途 |
| --- | --- |
| `skill_desc_zh(action="skills")` | 只读列表：`{ ok, projectRoot, skills, trash, counts, warnings }`；与页面同一载荷 |
| `GET /plugins/skill-desc-zh/skills?projectRoot=&source=&refresh=1` | 列表；`source=user\|project\|all`，`refresh=1` 跳过 2 秒缓存 |
| `GET /plugins/skill-desc-zh/skills/detail?scope=&name=&projectRoot=` | 单个技能详情（frontmatter/body/fingerprint/mtime/size/resources） |
| `POST /plugins/skill-desc-zh/skills/action` | body `{ action, scope?, name?, description?, body?, expectedFingerprint?, id?, dryRun? }`；action 为 create/save/delete/restore/disable/enable |

业务失败仍返回 HTTP 200 + `{ ok:false, code, message }`（如 `conflict`、`invalid`、`unsupported-source`、`too-large`、`not-writable`）；协议/认证/忙状态用 400/401/403/409/413/503。成功保存返回 `{ ok:true, skill:{…}, changed:true }`，列表中的 `fingerprint` 形如 `sha256:<64 hex>`，由 description、body、relativePath 计算，不是整文件原始字节哈希。

### 5.4 重启后人工验收

以下项目在重启前只做了静态/单元/真实模块探针验证，页面像素、真实认证与点击副作用必须重启后由用户确认：

1. 设置左侧只有**一个**“Better Skill”入口；进入后看到“描述中文化 / 插件管理 / 技能管理”三个 Tab，默认描述中文化，Tab 栏不重复、不缺失。
2. 刷新/重开设置后恢复上次 Tab；键盘 `←`/`→`/`Home`/`End` 可切换，焦点与 `aria-selected` 正确；窄窗 Tab 栏可横向滚动。
3. 描述中文化 Tab 能读到真实状态（不是“无法读取状态”）；应用/还原与工具 `skill_desc_zh` 结果一致，中文/英文往返正确，页面不可见时停止轮询。
4. 插件管理 Tab 能列出第三方插件并检查更新；遇到 `pending-builds`/隔离期/不兼容时提示正确；不把失败说成成功。
5. 技能管理 Tab 能区分可写（user/project）与只读（plugin/preset/bundled/runtime），数量与来源正确；只读项无编辑/禁用/删除。
6. 在测试项目新建/编辑/禁用/删除/恢复各走一遍；删除只进废纸篓，恢复不覆盖同名目标，禁用后 agent 目录不可调用。
7. 并发保存/并发动作返回 409 且页面提示重载；非法名称/路径、超限 body、未认证分别得到 400/413/401/403，不出现“保存成功但文件没变”。
8. 一个 Tab 渲染崩溃后切到其它 Tab 仍能正常渲染（`key=active` 重建错误边界）；客户端加载失败时主界面不被拖垮。

> 文案/元数据已在 t19 修正：`confirm.restore` 不再写“4 个项目”，`group.global` 改为“global 层 · provider 覆盖（office 系列 + browser-skill）”，命令组改为“命令 · agent 作用域影子（3 个斜杠命令）”，`notices.scope` 改为“8 个全局技能（office ×7 + browser-skill）”；`package.json` 同时提供 `./icon` 与 `./icon.svg` 两个导出说明符。真实页面文案仍以重启后的 client 加载结果为准。

### 5.5 回滚

设置页提供最直接的 L0 回滚：关闭开关或点“还原”。插件管理 Tab 的更新可用原生“设置 → 插件”页重装/降级；技能管理 Tab 的编辑/删除/禁用分别用“重新保存/回收站恢复/启用”回滚。更彻底的分级回滚（停用 bundle、卸载、清 state）见 **§8**；命令影子只在内存，回滚不需要删除文件。

- **停用 Better Skill**：在原生“设置 → 插件”页禁用本插件 bundle；三个 Tab 一起消失，已安装的第三方插件与用户技能不受影响。
- **彻底移除本插件**：先 `skill_desc_zh(action="restore")`，恢复所有技能删除项，再在原生插件页移除 bundle；源码目录不受影响，清理状态走 `trash.mjs`。
- **回退文档/源码**：本次文档修改前的快照在 `~/.dsh/.file-backups/`；仓库没有 `.git`，不要执行不存在的 `git revert`。


---

## 6. 影子机制与 rank 原理

### 6.1 为什么 office 用 provider、preset 用影子

宿主技能选择规则：**先比层级，层级相同再比 rank，rank 小者胜**。

- office 在 **global 层**，内置 provider `dsh-office` 的 `rank=600`；本插件注册 global 层 provider `rank=50` → 50 < 600，直接胜出，**零文件写入**。
  - 关键：`get()` 只替换 `description`，`content` / `resourceBase` / `whenToUse` / `path` 全部沿用捕获到的原始定义，所以 `office-render` / `office-recalculate` / `office-export-pdf` 正文末尾的 `## Installed LibreOffice Kit` 运行期附录不会丢。
- agent-preset 在 **preset 层**（自带 `skill-filesystem`，`rank=300`）。global 层再低的 rank 也跨不了层，所以只能写**项目级** `<project>/.dsh/skills/<name>/`（文件系统 `rank=100`，与 preset 同层）→ 100 < 300，影子胜出。
  - 影子是整目录复制（含 `references/`、`templates/`），只把 `SKILL.md` 的 `description` 一行换成中文；
  - 目录内写 `.skill-desc-zh.json` 标记（含源路径、`sourceHash`/`shadowHash`、资源清单、`hostVersion`），用于防误删和升级对账。
- `browser-skill` 在 **agent scope 的 runtime 层（rank 250）**，描述与正文硬编码在插件代码里；本插件发现阶段捕获原始定义，再经 `agent.ctx.get("skills")` 在**同一个 agent 层**注册 `skill-desc-zh-agent`（rank 50 < 250）覆盖描述，正文仍原样透传。
- 用户级 `~/.dsh/skills`（rank 400）本可覆盖 global 层，但会污染用户目录并外溢到其它 profile，**本插件不写**。

### 6.2 防自噬（bootstrap 顺序）

1. provider 注册后先 `ready=false`，`list()` 返回空，避免自己覆盖自己；
2. 在“原始 provider 仍生效”时用 `skills.get()` 捕获 12 个原始定义；
3. 翻译、写影子、落 state；
4. 最后 `ready=true` + `invalidate()`，技能目录切到中文。

### 6.3 项目根与生效范围

- 项目根 = 当前会话工作目录向上找第一个含 `.git` 的目录（与宿主 `findProjectRoot` 一致）；
- 只有 **项目在 `$HOME` 下**，或**列在 `projectAllowlist`** 时才会写影子；
- 影子只在**对应项目/工作区**打开时生效；换一个 workspace，该工作区看不到这些中文（office 不受影响，因为 provider 是 global 的）；
- 仓库默认把 e2e 工作区 `/Applications/dsh` 放进 allowlist；普通用户的项目在 `$HOME` 下无需配置。

### 6.4 命令为什么只能注册在 agent scope

见 §4.2。核心约束是：全局同名 `commands.register()` 会直接抛错，只有调用方所在的 scope 层能安全插入同名影子；因此命令中文化与技能中文化一样，按 agent/项目生效，global 视角保持英文。

---

## 7. 升级前后自动流程

宿主没有“插件升级前”事件，插件用**启动自愈**实现等价语义：

```text
宿主升级（或插件更新替换了内置 SKILL.md）
        │
        ▼
下次启动 bootstrap 读取 state.hostVersion
        │  与当前 hostVersion 不同
        ▼
① 把已登记的项目影子全部走 trash.mjs 移入废纸篓（校验无残留）
② 清空 state.skills / state.cache，并 resetCommands / 清空命令层旧影子
③ 重新捕获 12 个技能原始定义 + 3 条命令定义
④ 重译（LLM 失败回落词典；再失败保留英文 + warning）
⑤ 重建 4 个影子目录、重新注册命令影子，写新 hostVersion
        │
        ▼
事件：host-version-heal restored=N → startup → agent-created
```

实测事件（2026-10-20，模拟 0.2.0-rc.2 → 0.2.1-rc.2）：

```json
{"action":"host-version-heal","ok":true,"from":"0.2.0-rc.2","to":"0.2.1-rc.2","restored":4}
{"action":"startup","phase":"degraded","zhCount":7,"warnings":["检测到宿主版本变化…开始重新翻译"]}
{"action":"agent-created","phase":"active","zhCount":12,"shadows":[{"name":"agent-experience","status":"created"}, …]}
```

补充：

- **命令层同样自愈**：hostVersion 变化会清空 `state.commands` 与命令层旧影子，重新捕获命令定义后按 agent 重新注册；命令影子只在内存，不产生废纸篓记录。
- **指纹**：`hostVersion + sha256(name\0description\0content\0resourceBase)`，配 `mtime/size` 快路径（仅文件捕获通道；`skills.get()` 带运行时附录的必须重算）。
- **`refresh`**：指纹变化 → 作废旧译文、重建影子；未变化 → 不动。
- **`restoreOnQuit: true`**：宿主退出时同步还原并记事件（默认 `false`，即保留中文）。
- 翻译失败绝不写半成品：`zh=null` 时该技能显示英文，`phase` 降为 `degraded`/`failed`，事件与 `status` 都能看到原因。

---

## 8. 废纸篓回滚与找回

### 8.1 分级回滚

| 级别 | 操作 | 效果 |
| --- | --- | --- |
| L0 只回英文 | `skill_desc_zh { "action": "restore" }` | 影子进废纸篓，provider 下架，命令影子注销；插件保留，可再 `apply` |
| L1 临时停用 | `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false` | provider 注销、命令影子随 `dispose` 注销；注意 `restoreOnQuit=false` 时技能影子不会自动清，彻底回英文请先 L0 |
| L2 卸载 | 先 L0，再 `plugin_manager remove_bundle target="dsh-skill-desc-zh"` | 移除 profile 依赖/bundle/软链；源码目录不受影响 |
| L3 清状态 | `node ~/.dsh/skills/safe-delete-trash/trash.mjs ~/.dsh/.skill-desc-zh` | state + events 进废纸篓（先确认 L0/L2 已完成） |
| L4 源码回退 | 本仓库**没有 `.git`**，不能 `git revert`；改动前把 `lib/` 备份到仓库外，回滚时用 `trash.mjs --snapshot` 留档后覆盖 | 只影响源码，不影响已安装 profile |

> 移除 `link:` 依赖前先完成 L0，并由用户确认移除范围；`plugin_manager remove_bundle` 只改 profile 依赖/bundle，**不会删除 `~/dsh-plugins/skill-desc-zh` 源码**。若 `node_modules` 残留软链，交由包管理器处理或先与用户确认后用 `trash.mjs` 清理，禁止手删/`rm`。

### 8.2 找回被还原的英文影子 / 状态

- 所有移入废纸篓的目录名形如 `agent-experience 3`、`cordis-plugin-development 4`（macOS 自动加序号）；
- 用 Finder 打开“废纸篓”，把对应目录**放回原处**（`/Applications/dsh/.dsh/skills/`）即可恢复；
- 操作留痕：`~/.dsh/.trash-log.jsonl` 记录每次 rename 的源/目标/时间，可按时间定位；
- 本插件**从不永久删除**；`trash.mjs` 拒绝时插件会失败关闭，绝不降级为 `rm`。

### 8.3 手动清理残留（仅限带标记目录）

```sh
# 只删本插件创建的影子（每个目录内应有 .skill-desc-zh.json）
node ~/.dsh/skills/safe-delete-trash/trash.mjs /Applications/dsh/.dsh/skills/<name>
```

未标记目录、用户自建技能目录**不要**用本插件清理。

---

## 9. 故障排查

| 现象 | 排查 |
| --- | --- |
| 设置里没有“Better Skill” | 先确认已重启（v0.3.0+ client 需启动扫描）；再看 `list_plugins` 的 `fiberPhase=active` 与包版本 0.6.0；完整排查见 §5.1 |
| 只有旧的多入口，没有三个 Tab | 运行进程仍是旧 client；确认已重启并加载 v0.6.0，`list_plugins` 的 `include:skill-desc-zh` 为 `active`；页面标题旁显示“需要重启加载”即说明旧进程未加载新 client |
| 技能管理 Tab 列表为空 / 只读区为空 | 确认项目根满足 `.git`+`$HOME`/allowlist；`skill_desc_zh(action="skills", source="all")` 对照；只读技能只在 `source=all` 出现；旧 client 可能没有只读分组 |
| 技能管理 Tab 列表为空 / 只读区为空 | 确认项目根满足 `.git`+`$HOME`/allowlist；`skill_desc_zh(action="skills", source="all")` 对照；只读技能只在 `source=all` 出现；旧 client 可能没有只读分组 |
| 技能管理保存返回 409 | 文件已被其他窗口改动；页面点“重新加载”取新指纹再改，不要强行覆盖；目标已存在的新建/恢复也会返回 `conflict` |
| 删除/恢复失败 | 确认 `trash.mjs` 可执行、目标在允许技能根内；错误码 `trash-unavailable`/`unsupported-source`/`conflict` 会原样显示，插件不会降级为永久删除 |
| 插件管理 Tab 显示“宿主 pluginManager 不可用” | 宿主未注册 `pluginManager` 服务或旧进程未加载 0.4.0+；重启后仍不可用则看 doctor/status 的 `pluginAdmin` 字段 |
| 检查更新全部失败 | 看 registry 是否可达、是否被代理拦截；单插件失败不影响其他行；`GET /plugins/skill-desc-zh/plugins?refresh=1` 可强制重查 |
| 更新按钮点不动 / 返回 409 | 另一个更新/设置动作仍在执行；等当前动作结束再试。页面和 HTTP 都有单飞保护，不会并发安装 |
| 设置页打不开 / 一直 loading | 多为路由未加载或认证失败：确认已重启；用 `skill_desc_zh(status)` 对照；重启前 `/plugins/skill-desc-zh/state` 返回 404 属正常 |
| 工具列表里没有 `skill_desc_zh` | `plugin_manager list_plugins` 看 `include:skill-desc-zh` 是否 `enabled=true` / `fiberPhase=active`；新安装后新开一个会话，工具在下个模型步才可见 |
| 技能描述仍是英文 | `status` 看 `phase` 与每个技能 `engine`；office 看 provider 是否 ready（`doctor`）；preset 看项目根是否含 `.git`、是否在 `$HOME`/`projectAllowlist`；目录快照可能需要新会话或刷新 GUI |
| 命令菜单仍是英文（`/acp` 等） | 确认已在**重启后**加载 v0.2.0；`status.commands` 看 `enabled`/`targets`/`registered`；`doctor` 看 `command-layer.checked`；global 视角本来就应英文；内置 6 条由 GUI 本地化，不归本插件 |
| 只有 4 个 preset 中文、7 个 office 英文（或反之） | 正常的分层现象：office 走 global provider（必须 bootstrap 完成），preset 走项目影子（必须在对应项目内）；`status` 会写明每个技能的机制。若在插件 disable 窗口看过目录，快照会停留在当时状态，需新会话刷新 |
| `phase=degraded` | 部分技能回退词典或英文：`status` 的 `warnings`、`events.ndjson` 的 `startup` 事件会给出原因（LLM 不可用/项目未放行/影子冲突） |
| `phase=failed` | 看 `~/.dsh/.skill-desc-zh/events.ndjson` 最后一条的 `reason`：常见为 trash.mjs 缺失/拒绝、yaml 解析失败、影子写入权限、state 损坏（state 损坏时插件只 fail-closed，不会乱写） |
| 已有同名目录但没被接管 | 目录缺少 `.skill-desc-zh.json` 标记时，插件只告警跳过，绝不覆盖/删除。确认是旧残留后，手动 `trash.mjs` 移走再 `apply` |
| 升级后中文没自动恢复 | 检查 `events.ndjson` 是否有 `host-version-heal`；确认 state.hostVersion 已更新；必要时 `refresh` 或 `retranslate` |
| 想强制换模型/重译 | 改 `config.llm.provider`/`llm.model` 后 `retranslate`；或在 `doctor` 中确认 LLM 可用 |
| 预检报 ❌ 隔离期 | 先看 `~/.dsh/profiles/desktop/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 是否已含对应版本；不要自行忽略，按 AGENTS.md 向用户说明并取得确认。注意 audit 存在“不读该豁免列表”的已知误报 |
| 预检报“来源未验证” | 本地目录包无法做供应链校验，属预期提示；确认绝对路径内容可信后再安装 |

更多自检：

```sh
node ~/dsh-plugins/skill-desc-zh/scripts/verify.mjs --expect-installed --expect-applied
node ~/dsh-plugins/skill-desc-zh/scripts/preflight.mjs
```

`verify.mjs` 会检查：代码无永久删除调用、`trash.js` 通道、影子标记、profile 依赖/bundle、state 与 hostVersion 对账；无法从 Node 判定的项会明确打印 “ℹ️ 未验证”。

---

## 10. 已知限制

1. **`app.asar` 只读**：内置技能源文件不能改；本插件只通过 provider（office）或项目影子（preset）覆盖描述，从不写宿主安装目录。
2. **runtime 技能的覆盖依赖宿主 scope 语义**：`browser-skill` 的描述硬编码在其插件代码里，由它自己在 `agent/created` 时用 `agent.ctx.get("skills").register()` 写进该 agent 的 scope 层（rank 250）。本插件用同样方式在该 agent 层注册 `skill-desc-zh-agent`（rank 50）覆盖描述；这依赖宿主 `dsh-skill` 当前“最近层获胜、同层 rank 小者胜”的合并规则（已在 0.2.1-rc.2 实测）。宿主若改变 scope 语义，本项会退化为显示英文，`status` 的 `agentLayer.checked` 会给出原因。
3. **插件/宿主更新会替换内置 `SKILL.md`**：旧译文与影子会随指纹变化失效，启动自愈会自动重译；不要手动编辑影子里的正文（下次 apply/refresh 会以源为准重建）。
4. **项目级影子只在对应 workspace 生效**：换项目打开时，该项目的 agent-preset 显示英文（除非它也放行并已 apply）；office 是 global 的，不受影响。
5. **必须满足项目根条件**：agent-preset 影子只在“含 `.git` 的项目根、且位于 `$HOME` 下或列入 `projectAllowlist`”时创建；这是为了避免污染用户目录/其它 profile。
6. **LLM 不可用时**：回落随包词典（15 条：技能 12 + 命令 3），再失败保持英文 + warning；不会写半成品，也不会阻塞宿主。
7. **本地包预检无法验证供应链**：来源/签名/发布时间不可判定，已在预检中如实标注。
8. **`restoreOnQuit` 默认关闭**：退出宿主不会自动回英文；需要时显式 `restore`。
9. **命令描述只在 agent scope 生效**：global 视角始终英文；v0.2.0 代码需重启宿主后才加载；已打开的命令菜单可能因 GUI 软刷新短暂显示旧文案，重开即恢复。
10. **Better Skill 需要重启一次才出现**：v0.3.0+ 的 client 半与 HTTP 路由只在宿主启动扫描 bundle 时登记；`link:` 源码热更新不会自动加载客户端。v0.6.0 的“单入口三 Tab”（描述中文化/插件管理/技能管理）与新增 HTTP 路由同理，重启后真实认证、键盘/焦点与点击仍需人工验收。
11. **HTTP 错误路径的两个缺陷已修复（t18/t21）**：动作抛异常后 `busy` 会释放（500 后 GET/POST 不再 409）；超时/迟到 reject 不再产生 unhandled rejection；插件更新的单飞改为在首个 await 前占位，避免并发重复安装。已加回归测试；真实 Electron 进程仍需重启后复验。
12. **页面文案与 icon 元数据已修正（t19）**：还原确认不再写“4 个项目”，global 组改为“global 层 · provider 覆盖（office 系列 + browser-skill）”，命令组改为“命令 · agent 作用域影子”，`notices.scope` 写“8 个全局技能（office ×7 + browser-skill）”；`package.json` 同时提供 `./icon` 与 `./icon.svg`。真实页面渲染待重启确认。
13. **插件管理 Tab 只覆盖 npm 第三方插件**：官方 `@deepseek-ai/*` bundle、`link:` 本地插件、workspace/git/tarball 来源都不参与更新；启用/禁用/卸载仍需原生“设置 → 插件”页。更新只调用宿主 `pluginManager`，不会绕过隔离期或代替用户批准构建脚本；`pending-builds` 会显示宿主错误，构建脚本批准在原生页完成。
14. **更新未做真实安装验收**：`e2e:plugin-admin` 用 fake `installBundle` 验证调用参数、失败分类、缓存与并发单飞，但没有真实拉取/安装一个新版本；真实更新、降级与重启后生效需用户重启后手动验收。插件列表中的最新版来自 registry `/<pkg>/latest`，5 分钟缓存，不显示发布时间。
15. **技能管理只处理文本技能**：不处理二进制资源，不提供批量导入/导出；只改 description/正文，frontmatter 的锚点/别名无法安全定点改写时返回 `unsupported-frontmatter`，原文件不变。
16. **技能管理的真实写操作尚未在线验收**：单测、真实模块探针与临时目录 e2e 已覆盖创建/保存/禁用/删除/恢复/冲突/只读拒绝，但本次没有写真实 `~/.dsh` 或 `/Applications/dsh/.dsh`；页面像素、真实认证与点击副作用需重启后人工确认。首次使用建议先在测试项目试新建/删除/恢复。
17. **禁用只在 agent 作用域生效**：global 技能列表仍显示英文；这是宿主层级/scope 机制，不是技能管理 Tab 的 bug。禁用 provider 的 rank 40 依赖宿主当前合并规则，宿主升级后需 `doctor`/回归复验。
18. **state v1/v2 → v3 自动迁移**：首次写 state 前会对旧文件做快照；迁移只增加 `skillAdmin.disabled/deletions`，不改写技能翻译。仓库没有 `.git`，回滚依赖 `~/.dsh/.file-backups/` 与 `trash.mjs`，不要执行不存在的 `git revert`。

---

## 11. 验收结论（2026-10-23，v0.6.0）

完整报告见 [`docs/verification.md`](docs/verification.md)：v0.1 A1–A12、v0.2.0 T1–T6 / A1–A10、v0.3.0 A1–A15、v0.4.0 A1–A12 与复验、v0.5.0 A1–A28 与两次复验、v0.6.0 A1–A12 与二次验收。当前结论是**源码级 pass、ready-for-restart**：Better Skill 单入口三 Tab、F1/F2 修复与 I1 基线裁定均已独立复核；运行中的旧进程尚未加载 13:20 后的源码。

| 项 | 结果 |
| --- | --- |
| 预检如实、退出码正确 | ✅（历史 v0.1 的 2 条 ❌ 为用户批准的 override；本轮无安装动作；本地目录来源仍标注未验证） |
| 应用内安装、`fiberPhase=active` | ✅（profile 为 `link:~/dsh-plugins/skill-desc-zh`；源码版本 0.6.0，运行进程待重启后加载；未安装/升级/重启） |
| 工具 `skill_desc_zh` 注册 | ✅；8 个 action（`status/apply/restore/retranslate/refresh/doctor/plugins/skills`）语义不变 |
| office 7 个中文（provider，正文透传） | ✅ 机制与调用验证；**全新会话目录肉眼快照待用户确认** |
| runtime 1 个中文（agent 层 provider，rank 50 < 250） | ✅ 单元/机制验证；需重启后的新会话目录确认 |
| preset 4 个中文（影子 + 标记 + 资源完整） | ✅ |
| restore → 英文原文 / apply → 再次中文 | ✅（历史实测；影子进废纸篓，trash 日志可查） |
| 命令描述（v0.2.0） | ✅ 源码级：3 条命令 agent 中文、global 英文、执行委托原 handler；真实菜单/点击待重启后验收 |
| **Better Skill 单入口（v0.6.0）** | ✅ 源码级：唯一 `settings.section` id `skill-desc-zh` order 16；三 Tab（描述中文化/插件管理/技能管理）；默认 translate；`localStorage` 记忆非法值回退；键盘/ARIA 完整 |
| **F1 Tab 崩溃隔离** | ✅ 源码级：`Boundary key={active}`；A 崩溃后切 B 会新建错误边界并正常渲染（独立探针 `remounted_renders_child:true`） |
| **F2 aria-controls** | ✅ 源码级：仅 active Tab 带 `aria-controls=sdzh-panel-<active>`；非激活为 null；panel `aria-labelledby` 正确 |
| 插件管理 Tab（v0.4.0 能力） | ✅ 源码级：列表/检查更新/更新预检与分类/单飞；B1/P1/P2/V1/C1 已修复并回归 |
| 技能管理 Tab（v0.5.0 能力） | ✅ 源码级：可写 user/project、只读 plugin/preset/bundled/runtime 分离；新建/编辑/禁用/删除/恢复/冲突/只读拒绝均已验证；真实页面与真实写盘待重启 |
| 技能/插件 HTTP 路由 | ✅ 单元/真实模块探针：认证 401/403、no-store、body 限额、并发 409；真实认证后 200 待重启 |
| **state v3 与删除纪律** | ✅ v2→v3 自动迁移；唯一删除通道 `lib/trash.js` → `trash.mjs`；`verify.mjs` 扫描 49 文件无永久删除调用 |
| 单测 / e2e / 静态检查 | ✅ `npm test` **215/215**；`check:client` **17/17**、locale **298** keys；`client` **13/13**；`skills-e2e` **32/32**；`e2e:plugin-admin` 21/21；`e2e:commands` 10/10；`e2e:agent-layer` 7/7；`node --check` 49 文件 0 失败；`verify.mjs` 49 文件通过 |
| **I1 基线裁定** | ✅ 接受替代证据（无 pre-t31 逐字节基线；未发现 lib/scripts 变更）；`docs/v0.6.0-sha256.txt` 30/30 校验通过，作为后续基准 |
| 设置页真实 UI / 认证 / 点击 | ⏳ **待重启后人工确认**（Better Skill 单入口、三个 Tab、焦点/键盘、页面真实写操作、可见性轮询、失败降级） |
| **真实插件更新 / 真实技能写盘** | ⏳ **确实未验证**：plugin-admin e2e 用 fake `installBundle`；技能管理 e2e 用临时 HOME/项目，不碰真实 `~/.dsh` 或 `/Applications/dsh/.dsh` |

**待重启确认 / 已知边界**：

1. **Better Skill 入口与三个 Tab 需重启验收**：v0.6.0 客户端与 HTTP 路由要重启 DSH 后才加载；重启前旧进程的 `/plugins/...` 返回 401（认证先于路由），不是页面可用。
2. **live 旧进程**：旧进程仍持有旧版代码，`skill_desc_zh(action="plugins")` 可能仍报旧 lossless 错误；源码已修复，重启后才会消失。
3. **7 个 office 在“全新会话技能目录”里的中文显示**：历史快照可能停留在插件禁用窗口；state/provider/`status` 与 `skill("office-render")` 已证明覆盖生效，仍建议新开会话或刷新 GUI 技能页确认。
4. **v0.2.0 命令菜单与真实执行**：源码级探针与 e2e 已证明 agent 中文、global/其它 agent 英文、执行委托原 handler；真实 GUI `/` 菜单与点击副作用待重启后确认。
5. **动态 `agent-teams-<profile>` 命令**：模板逻辑已离线验证；当前 desktop 未配置 `profiles`，没有真实动态别名可测。
6. **本地包供应链 / profile lockfile 隔离期 / 仓库无 `.git`**：来源、签名、发布时间无法判定；仓库不能 `git revert`，源码回退依赖备份；见 §8 与 §10。
7. **v0.5.0 修复已复核（t29/t30）**：F1 幽灵资源项、F2 只读分组/统计、F3 只读译文、F4 禁用 provider definition、F5 restore allowlist、F6 同名 scope 均已修复；独立探针与回归测试通过，真实 Electron 环境仍需重启后复验。
8. **v0.4.0 / v0.6.0 修复**：B1 lossless JSON、P1 更新单飞、P2 HTTP 并发单飞、V1 `clipText` 删除纪律误报、C1 检查更新改走 POST；F1 Boundary key 重置、F2 aria-controls 仅激活、I1 sha 基线；独立探针与回归测试均通过。

当前安装状态：desktop profile 通过 `link:~/dsh-plugins/skill-desc-zh` 指向源码，包版本已是 `0.6.0`，`enabled=true`、`fiberPhase=active`；**运行中的进程仍是重启前的旧代码**，state 为 v2（12/12 技能中文、3 条命令中文，4 个影子在 `/Applications/dsh/.dsh/skills/`）。重启 DSH 后才会加载 Better Skill 单入口、三个 Tab、HTTP 路由与 v0.4.0–v0.6.0 修复，并把 state 迁移到 v3。

> v0.6.0（Better Skill 单入口三 Tab）为**源码级验收**：215/215 单测 + `check:client` 17/17 + client 13/13 + `skills-e2e` 32/32 + `e2e:plugin-admin` 21/21 + `e2e:commands` 10/10 + `e2e:agent-layer` 7/7；独立复验确认 F1/F2，I1 接受替代证据。本轮未安装/升级/重启 profile，profile 仍为 `link:` 指向源码；真实页面、真实插件更新与真实技能写盘尚未验收。

---

## 12. 开发与测试

```sh
cd ~/dsh-plugins/skill-desc-zh

node --check lib/index.js && node --check client.js
npm test                                   # node --test test/*.test.mjs，215 个用例
npm run e2e:agent-layer                    # agent 层覆盖机制端到端（用宿主真实 cordis/dsh-skill 模块）
npm run e2e:commands                       # 命令影子端到端（真实 CommandRuntime/createScope/execute）
npm run e2e:plugin-admin                   # 插件管理端到端（fake installBundle，不真实安装）
npm run e2e:skills                         # 技能管理端到端（临时 HOME/项目，不碰真实技能）
npm run check:client                       # 客户端 17 项静态检查（单入口三 Tab/active-only aria/Boundary key/locale）
node scripts/preflight.mjs                 # 安装预检（包装官方 audit.mjs）
node scripts/verify.mjs --expect-installed --expect-applied   # 文件级验收
sha256sum -c docs/v0.6.0-sha256.txt        # lib/scripts 基线自检（30 条）
```

代码结构：

```text
lib/index.js       插件入口：配置、bootstrap、HTTP 路由接线、动作编排、事件
lib/http-api.js    设置页 HTTP 桥：/plugins/skill-desc-zh 的 state/doctor/action/plugins/skills，认证/限额/单飞
lib/plugin-admin.js 插件管理后台：profile 解析、第三方列表、registry 最新版、更新预检与分类、单飞
lib/skill-admin.js 技能管理后台：列表合并、只读过滤、创建/保存/删除/恢复/禁用/启用、统计
lib/skill-files.js 技能文件系统：扫描、安全路径、frontmatter 定点改写、原子写、trash 删除/恢复
lib/discover.js    枚举技能（skills.list/get + 文件系统）
lib/translate.js   LLM 批量翻译 + 词典回落 + 校验
lib/dictionary.zh.json   15 条随包中文词典（技能 12 + 命令 3）
lib/provider.js    global provider（rank 50，正文透传）
lib/agent-layer.js  agent scope 层 provider（rank 50/禁用 rank 40，覆盖 runtime 技能如 browser-skill）
lib/shadow.js      项目影子创建/删除/对账（.skill-desc-zh.json）
lib/state.js       原子 state、history、互斥与留档、v1/v2→v3 迁移
lib/host-yaml.js   宿主 yaml 定点重写（只改 description）
lib/trash.js       唯一删除通道（spawn trash.mjs，失败关闭）
lib/events.js      events.ndjson 审计日志
lib/tool.js        skill_desc_zh 工具定义
lib/command-layer.js  命令描述影子（捕获/委托/指纹/模板/注册自检）
lib/paths.js       路径/项目根解析（生命周期编排在 lib/index.js）

client.js          Better Skill 客户端（__ModuleLoader__ + React，单个 settings.section、三个 Tab、locale，15 行清单）
locale/zh.json / locale/en.json  各 298 keys，页面文案
icon.svg           设置页插件图标
scripts/check-client.mjs  客户端静态检查
scripts/preflight.mjs / scripts/verify.mjs  预检与验收
scripts/agent-layer-e2e.mjs  用宿主真实模块验证 agent 层覆盖（Electron-as-node）
scripts/commands-e2e.mjs     用宿主真实 CommandRuntime 验证命令影子（Electron-as-node）
scripts/plugin-admin-e2e.mjs 插件管理端到端（fake installBundle，不联网安装）
scripts/skills-e2e.mjs       技能管理端到端（临时 HOME/项目，不碰真实技能）
docs/v0.6.0-sha256.txt       lib/scripts 30 条 sha256 基线（`sha256sum -c` 校验）
test/*.test.mjs    215 个用例（17 个文件），覆盖控制器/state/影子/翻译/命令/HTTP/客户端/插件管理/技能管理/Better Skill 三 Tab；默认不联网、不动真实技能
```

客户端侧的 `client.js` 不参与 Node 单测运行，需用 `npm run check:client` 做 manifest/入口/locale 静态检查；真实浏览器渲染与认证点击仍需重启后人工验收。

许可证：MIT。

