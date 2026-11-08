# 最终验收报告（用户版）：描述汉化插件

- 日期：2026-11-08
- 结论：**v0.7.1 源码级验收通过（ready-for-restart）**。本轮只做一件事：把 Better Skill 的入口迁移到 DSH「设置 → 插件」页的顶部 Tab（`plugins.tab`，id `skill-desc-zh`，order 20，位于「发现」之后），并完成入口契约、启动风险与全量回归的独立验收。t44 实现、t45 独立验收通过（229/229 单测、check-client 18/18、client 27/27、四套 e2e 全绿）。真实插件页 Tab 渲染、真实认证/市场与重启启动仍需用户人工确认。
- 插件：`dsh-skill-desc-zh@0.7.1`（本地源码 `~/dsh-plugins/skill-desc-zh`；profile 以 `link:` 指向）
- 宿主：DeepSeek Harness Desktop `0.2.2-rc.1`，profile `desktop`
- 详细证据：`docs/verification.md` v0.7.1 t45 节；使用说明：`README.md`；计划：`docs/v0.7.1-plan.md`；设计：`docs/design.md` §16

> **当前运行中的 DSH 进程仍是重启前的旧代码**：源码包已是 0.7.1，但 v0.7.1 的 `plugins.tab` 入口、v0.7.0 的插件索引与相关客户端代码要等用户重启后才会加载。因此插件页 Tab、真实认证、真实市场网络与真实写操作尚未在真实进程发生，本报告不把它们写成“已重启验证”。

---

## 1. v0.7.1 做了什么

### 1.1 入口迁移：旧入口 → 设置 → 插件页 Tab

- 历史说明（仅此一处）：v0.6.0–v0.7.0 的 Better Skill 是设置侧栏里的独立入口；v0.7.1 已迁移，侧栏不再出现。
- 新入口：**设置 → 插件 → 顶部 Tab「Better Skill」**（`plugins.tab`，id `skill-desc-zh`，order 20）。
- 位置顺序：宿主插件页当前 `plugins.tab` 的既有 occupant 只有「发现」（order 0）；本插件 order 20，排在「发现」之后。
- 内容不变：进入后仍是三个内层 Tab：**描述汉化 / 插件管理 / 技能管理**；v0.7.0 的只读「插件索引」子页仍在插件管理内。
- 旧入口（v0.6.0–v0.7.0）不再注册；`settings.section.icon`、`PAGE_ORDER`、`BetterSkillIcon` 一并删除，不再有重复入口或死代码。

### 1.2 启动安全改动

- `package.json` 的 `dsh.client` 去掉 `"immediately": true`，保留 `{ "platform": "web" }`；不再在宿主启动早期强制加载客户端。
- `inject` 保持 `['slots','locale']`，不新增服务依赖、不新增 npm 依赖。
- `apply()` 保留外层 `try/catch`：初始化异常只写 `console.error` 与 `window.__SDZH_CLIENT_ERROR__`，不向宿主抛出，避免拖垮插件页。
- `ctx.slots.inject('plugins.tab', ...)`：插件页未声明该 slot 时只保持等待，不注册、不抛错；插件页插件被禁用/旧宿主时自动降级。

### 1.3 与 v0.7.0 的差异

| 项 | v0.7.0 | v0.7.1 |
| --- | --- | --- |
| 入口 slot | 旧入口 `settings.section`（order 16） | `plugins.tab`（设置 → 插件页 Tab，order 20） |
| 图标 | `settings.section.icon` + `BetterSkillIcon` | 删除；使用插件页 Tab 自带标签 |
| 立即加载 | `dsh.client.immediately: true` | 移除 |
| 页面内容 | 三个内层 Tab + 只读插件索引 | 不变 |
| 其它能力 | 描述汉化/命令/插件管理/技能管理 | 不变 |

## 2. 入口契约（t45 独立核对）

- `client.js` 仅注册一个 `plugins.tab`：`{ name:'plugins.tab', id:'skill-desc-zh', order:20, label:()=>t('nav') }`；`label` 为 thunk，locale 切换会跟随。
- 宿主 0.2.2-rc.1：`dsh-client-ui-plugin-manager/lib/client.js:7764-7767` 声明 `plugins.tab { kind:'list', scope:'root' }`；`:7236-7246` 以 `{ install, openPackage }` 渲染；`:7639` 解析 label thunk。
- `inject: ['slots','locale']`；`apply` 有 try/catch；无 `settings.section`、无 `plugin-admin`/`skill-admin` id、无 `PAGE_ORDER`/`BetterSkillIcon` 死代码。
- 启动探针：正常只注册 1 个 slot；slots 缺失、slot 未声明、`ctx.effect` 抛错三种异常均不向宿主抛出，并设置错误标记。

## 3. 验收证据（重启前）

完整原始输出见 `docs/verification.md` 的「v0.7.1 入口迁移」t45 节。

| 检查项 | 结果 |
| --- | --- |
| 单元测试 | ✅ `npm test` **229/229**，0 失败（Node v24.20.0，722.65ms） |
| 客户端静态检查 | ✅ `check-client` **18/18**；唯一 `plugins.tab` 注入、order 20、无 `settings.section`、locale **345** keys |
| 客户端单测 | ✅ `node --test test/client.test.mjs` **27/27**：单入口、三内层 Tab、Tab 记忆/键盘、插件索引/降级 |
| 技能管理 e2e | ✅ `skills-e2e` **32/32**（临时 HOME/项目，不碰真实技能） |
| 插件管理 e2e | ✅ `plugin-admin-e2e` **21/21**（fake `installBundle`，不真实安装） |
| 命令/agent e2e | ✅ `e2e:commands` **10/10**；`e2e:agent-layer` **7/7** |
| 语法检查 | ✅ `node --check` client+scripts **12/12**；全量 lib/scripts/test/client.js **49/49** |
| 文件级验收 | ✅ `verify.mjs --expect-installed --expect-applied` 退出 0：**49** 文件无永久删除、trash 通道、4 个影子、profile 依赖/bundle、state hostVersion `0.2.2-rc.1`、skills 12 |
| 独立入口探针 | ✅ `PLUGINS_TAB_PROBE PASS`：injected 唯一 `plugins.tab`，order 20，label 返回 `Better Skill` |
| 独立启动探针 | ✅ `STARTUP_PROBE`：normal/noSlots/slotAbsent/effectThrows 四路径均不向宿主抛出 |

## 4. 已知限制 / 确实未验证项

1. **真实插件页 Tab 尚未验收**：需重启后确认设置 → 插件页出现「Better Skill」、位置在「发现」之后、点击能渲染三个内层 Tab。
2. **Tab 记忆/键盘/locale**：`localStorage` 三内层 Tab 记忆、`←`/`→`/`Home`/`End`、locale 切换后的 label/文案仍需真实 GUI 确认。
3. **重启启动成功**：去掉 `immediately` 后启动正常、无 `__SDZH_CLIENT_ERROR__`、无崩溃回滚需重启确认；源码探针只能证明异常被捕获。
4. **真实插件索引网络未验收**：源码级用 fake `pluginMarket` 与真实 host shape 探针覆盖源/搜索/分页/事件/降级/兼容性；真实索引源、认证后请求与事件时序未在运行 GUI 验证。
5. **真实插件更新/技能写盘未验收**：plugin-admin e2e 使用 fake `installBundle`；skills-e2e 使用临时 HOME/项目，不写真实 `~/.dsh` 或 `/Applications/dsh/.dsh`。
6. **7 个 office 在“全新会话技能目录”里的中文显示**：历史快照可能停留在插件禁用窗口；state/provider/status 与 `skill("office-render")` 已证明覆盖生效，仍建议新开会话确认。
7. **v0.2.0 命令菜单与真实执行**：源码探针与 e2e 已证明 agent 中文、global/其它 agent 英文、执行委托原 handler；真实 GUI 菜单与点击副作用待重启。
8. **动态 `agent-teams-<profile>` 命令**：模板逻辑离线验证；当前 desktop 未配置 `profiles`，无真实别名可测。
9. **本地包供应链 / 未提交改动**：来源、签名、发布时间无法判定；仓库 `.git` 基线为 `bf7cdc7` 但 v0.7.1 改动未提交，不能 `git revert` 未提交内容，源码回退依赖备份/`git checkout --`。
10. **真实插件更新 / 性能**：未对大量技能/插件/agent 做压测；registry 5 分钟缓存、列表 2 秒缓存。

## 5. 重启后的 9 项人工验收

1. **设置 → 插件** 顶部 Tab 行出现「Better Skill」（在「发现」之后）；点击后是「描述汉化 / 插件管理 / 技能管理」三个内层 Tab，默认描述汉化，无重复入口。
2. 描述汉化 Tab 能读到真实状态（不是“无法读取状态”）；`apply`/`restore` 与工具 `skill_desc_zh` 结果一致，中文/英文往返正确。
3. 插件管理 Tab 能列出第三方插件并检查更新；遇到 `pending-builds`/隔离期/不兼容时提示正确；不把失败说成成功。
4. 插件索引子页能读到宿主「设置 → 插件 → 发现」的索引源；搜索、加载更多、状态徽章正常。
5. 兼容性：`exempted` 显示“已豁免”、`compatible:false` 显示“不兼容（宿主 X）”；分类/标签中文正常，无 `[object Object]`。
6. 索引源失败/无 `pluginMarket` 时只影响该子页；搜索失败保留旧列表并可重试；不出现空白崩溃。
7. 技能管理 Tab 区分可写/只读；在测试项目新建/编辑/禁用/删除/恢复，删除只进废纸篓，冲突不覆盖。
8. 内层 Tab 记忆/键盘 `←`/`→`/`Home`/`End`、焦点与 ARIA 正常；一个 Tab 崩溃后切到其它 Tab 仍可用；窄窗 Tab 栏可横向滚动。
9. Cmd+Q 完全退出并重启后：DSH 正常启动、插件页 Tab 存在、state 为 v3、无 401/403 循环、无持续轮询风暴；失败时页面有可见错误/降级。

## 6. 回滚（全程可逆，删除只走废纸篓）

| 级别 | 操作 |
| --- | --- |
| 只回英文 | 设置页关闭开关，或 `skill_desc_zh(action="restore")`；技能影子进废纸篓、命令影子注销 |
| 撤销技能编辑 | 用编辑前内容重新保存；或从 `~/.dsh/.file-backups/` 取快照，覆盖前先 `trash.mjs --snapshot` |
| 撤销删除 | 技能管理 Tab“回收站 → 恢复”；目标已存在时先处理冲突，绝不覆盖 |
| 临时停用 | 原生“设置 → 插件”页禁用本插件 bundle（或 `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`） |
| 卸载 | 先 `restore`，再 `plugin_manager remove_bundle target="dsh-skill-desc-zh"`；源码目录不受影响 |
| 清状态 | `node ~/.dsh/skills/safe-delete-trash/trash.mjs ~/.dsh/.skill-desc-zh`（确认 restore/卸载已完成） |
| 源码回退 | 仓库 `.git` 基线为 `bf7cdc7`，但 v0.7.1 改动未提交；不能 `git revert` 未提交内容；用改动前备份覆盖或 `git checkout -- <file>`，覆盖前先 `trash.mjs --snapshot` 留档 |

被还原的影子目录在 `~/.Trash`（名称带序号），可用 Finder“放回原处”找回；每次移动记录在 `~/.dsh/.trash-log.jsonl`。命令影子只存在内存，回滚不产生文件。

## 7. 交付物

- `README.md`：v0.7.1 版本/功能行、§5 插件页 Tab 入口与三内层 Tab、§9 插件页排障、§11 t45 实测数字、§12 结构与命令；删除旧入口描述（仅保留一处“已迁移”历史说明）。
- `docs/verification.md`：v0.7.1 t45 节（A1–A8、原始输出、未验证项、回滚）。
- `docs/final-report.md`：本报告。
- 源码：`client.js`（唯一 `plugins.tab`、三内层 Tab、插件索引）、`package.json`（0.7.1、`dsh.client` 无 `immediately`）、`scripts/check-client.mjs`（18 项）、`test/client.test.mjs`（27 用例）。
- 历史证据：v0.1–v0.7.0 各节保留在 `docs/verification.md`，不修改。

本次 t46 只更新 `README.md`、`docs/final-report.md`；未改代码/package/locale/tests，未安装/升级/重启，无永久删除。
