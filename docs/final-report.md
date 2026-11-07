# 最终验收报告（用户版）：描述汉化插件

- 日期：2026-11-06
- 结论：**v0.7.0 源码级验收通过（ready-for-restart）**。本轮完成三件事：适配 DSH 0.2.2-rc.1、用户可见名称统一为「描述汉化」、在插件管理 Tab 内新增只读「插件索引」子页。t38 首验发现 F1/F2，t40–t41 修复，t42 修复 F1R，t43 独立二次复验通过（229/229 单测、client 27/27、check 19/19、四套 e2e 全绿）。真实 GUI、真实 `remote.pluginMarket` 网络/事件时序与真实写操作仍需重启后人工确认。
- 插件：`dsh-skill-desc-zh@0.7.0`（本地源码 `~/dsh-plugins/skill-desc-zh`；profile 以 `link:` 指向）
- 宿主：DeepSeek Harness Desktop `0.2.2-rc.1`，profile `desktop`
- 详细证据：`docs/verification.md`（v0.7.0 t38/t41/t43 节）；使用说明：`README.md`；计划：`docs/v0.7.0-plan.md`；设计：`docs/design.md` §16

> 当前运行中的 DSH 进程仍是重启前的旧代码：源码包已是 0.7.0，但 v0.7.0 的 `settings.section.icon`、插件索引与相关客户端代码要等用户重启后才会加载。因此 Better Skill 页面、插件索引、真实认证、真实市场网络与真实写操作尚未在真实进程发生，本报告不把它们写成“已重启验证”。

---

## 1. v0.7.0 做了什么

### 1.1 适配 DSH 0.2.2-rc.1

- `engines.dsh` 为 `>=0.2.1-rc.2 <0.3.0-0`；`0.2.2-rc.1` 满足。
- **不添加** `@deepseek-ai/*` peerDependencies，避免宿主 peer 闸门把本插件判为不兼容。
- 新增 `settings.section.icon` 注册（name/id 均为 `skill-desc-zh`，内联 SVG「译」）；`PAGE_VERSION` 升到 `0.7.0`。
- 宿主客户端 bundle 契约、`settings.section`、`pluginManager`、`connection.requestRejection` 等均在 0.2.2 复核；4 套 e2e 用真实宿主模块通过。

### 1.2 用户可见名称统一为「描述汉化」

- README、locale 中文、client 内联 DICT、工具描述/卡片标题、status 摘要、命令层提示与当前文档全部使用「描述汉化」。
- 英文文案仍为 “Skill descriptions in Chinese”；内部标识（包名 `dsh-skill-desc-zh`、行 id `skill-desc-zh`、工具 `skill_desc_zh`、locale namespace、`localStorage` key）不变，避免破坏兼容性。
- 旧名只保留在 `docs/verification.md` 顶部说明与历史节；用户可见区域不再出现旧名。

### 1.3 只读「插件索引」子页

- 入口：Better Skill → 插件管理 Tab → 顶部「已安装 | 插件索引」；默认仍是「已安装」，原有检查更新/更新流程不变。
- 数据全部来自 `ctx.remote.pluginMarket`：`listIndexes()` 读取宿主「设置 → 插件 → 发现」已配置索引源；`search()` 负责搜索/分页；`plugin-market/changed`、`plugin-manager/changed`、`connection/reset` 驱动刷新。
- 展示：源下拉（标题经 `locale.resolveText`，缺失回退 URL 主机名；错误源禁用并显示原因）、250ms 防抖搜索、同 `fetchedAt` 分页去重、图标/标题/包名/描述/作者/默认版本/安装状态、兼容性摘要与全部版本列表。
- 兼容性：`exempted:true` 优先显示「已豁免」；`compatible:false` 显示「不兼容（宿主 X）」；`compatible:true` 无提示。分类/标签按宿主 `Record<id,{title}>` 声明解析，缺失 title 回退 id。
- 只读边界：不新增 host HTTP 路由，不调用 `setIndexes/readEntryDetail/installBundle/removeBundle/setPluginEnabled`，不执行安装；第三方文本纯文本渲染，禁用 `dangerouslySetInnerHTML`，外链/图标只接受 `http(s)`（图标另允许 `data:image`）。
- 降级：`ctx.remote.pluginMarket` 不存在时显示明确提示；索引源为空显示配置指引；sources 失败整块重试，search 失败保留旧列表 + 错误条 + 重试。

原有能力不变：12 个技能中文化（7 office + 4 preset + runtime browser-skill）、3 条命令描述汉化、restore/apply、升级自愈、唯一删除通道 `trash.mjs`。

## 2. 预检、安装与当前状态

- **本轮无安装/升级/启用禁用/重启**：profile 仍通过 `link:~/dsh-plugins/skill-desc-zh` 指向源码；未调用 `install_bundle`/`update`，未重启。
- **当前**：`include:skill-desc-zh` → `enabled=true`、`fiberPhase=active`；工具 `skill_desc_zh` 已注册，schema 含 8 个 action（含 `plugins`、`skills`）。
- **state**：v3（12/12 技能中文、3/3 命令中文，4 个 preset 影子在 `/Applications/dsh/.dsh/skills/`）；hostVersion 为 `0.2.2-rc.1`。
- **供应链**：本轮没有安装动作，因此没有新增预检结论；本地目录包的来源/发布者/签名/发布时间仍无法由 audit 判定，历史预检的“未验证”标注继续有效，不得说成“预检干净”。
- **live 旧进程**：旧进程仍持有重启前的旧代码（不包含 v0.7.0 的 icon/索引客户端）；真实页面与索引网络需重启后复验。
- **仓库无 `.git`**：不能用 `git revert`；改前快照在 `~/.dsh/.file-backups/`，删除/清理只走 `trash.mjs`。

## 3. 验收证据（重启前）

完整原始输出见 `docs/verification.md` 的 v0.7.0「t38 首验」「t41 复验」「t43 二次复验」章节。

| 检查项 | 结果 |
| --- | --- |
| 单元测试 | ✅ `npm test` **229/229**，0 失败（Node v24.20.0） |
| 语法检查 | ✅ 递归 `node --check` **49** 个文件 0 失败（lib/scripts/test/client.js） |
| 客户端静态检查 | ✅ `npm run check:client` **19/19**；单入口三 Tab、icon 槽、插件索引、locale zh/en 各 **345** keys（88 skill + 47 index）、icon 819 B、语法通过 |
| 客户端单测 | ✅ `node --test test/client.test.mjs` **27/27**：Tab、图标、索引源/搜索/分页/事件/降级、Record 分类/标签、缺失 title 回退、exempted、SemVer、伪协议拒绝 |
| 技能管理 e2e | ✅ `npm run e2e:skills` **32/32**：临时 HOME/项目，不碰真实技能 |
| 插件管理 e2e | ✅ `npm run e2e:plugin-admin` **21/21**：fake `installBundle`，A3.5 明确不发生真实安装 |
| 命令/agent e2e | ✅ `e2e:commands` **10/10**；`e2e:agent-layer` **7/7** |
| 文件级验收 | ✅ `node scripts/verify.mjs --expect-installed --expect-applied` 退出 0：**49** 个文件无永久删除调用、trash 通道、4 个影子标记、profile 依赖/bundle、state hostVersion 对账 |
| 真实宿主形状探针 | ✅ 独立探针覆盖 Record categories/labels、LocalizedText、缺失 title、exempted true/false、compatible true；无 `[object Object]` |
| 客户端 Slots 检查 | ⚠️ `cordis_inspect_query(client, Slots)` 仍 10 秒超时；单入口真实挂载待重启人工确认 |

v0.7.0 修复（t38 发现、t40–t43 修复/复验）：

- **F1 分类/标签**：`indexTextList` 支持宿主 `Record<id,{title}>` 与数组，`indexEntryTags` 用索引声明解析 title；缺失 title 回退 id，空对象安全丢弃。
- **F2 兼容性**：`indexCompatInfo` 优先判断 `exempted:true`，显示「已豁免」；否则 `compatible:false` 显示「不兼容（宿主 X）」；版本列表同步。
- **F1R 兜底**：`{}`、数组 `{}`、无 title 的 Record 均不再产生 `[object Object]`；t43 独立探针 PASS。
- **I1 基线**：无 pre-t31 逐字节基线；改为“未发现 lib/scripts 变更 + 30 条 sha 清单作为后续基准（历史 v0.6 文件，v0.7 未重建，不能当作当前全绿）”。

## 4. 已知限制 / 确实未验证项

1. **Better Skill 入口与三个 Tab 需重启验收**：设置左侧是否只出现一个“Better Skill”、默认 Tab、Tab 切换/记忆/键盘焦点、窄屏横向滚动。
2. **插件索引真实网络未验收**：源码级用 fake remote 与真实 host shape 探针覆盖源/搜索/分页/事件/降级/兼容性；真实索引源、认证后请求与事件时序未在运行 GUI 验证。
3. **真实技能写盘未验收**：`e2e:skills` 使用临时 HOME/项目，不写真实 `~/.dsh` 或 `/Applications/dsh/.dsh`。
4. **认证后的页面与路由**：未认证访问已确认 401 + no-store；认证后的 200、真实同源 fetch、cookie/CSP 与点击副作用未验证。
5. **真实插件更新未验收**：`e2e:plugin-admin` 使用 fake `installBundle`，只验证调用参数、失败分类、缓存与单飞。
6. **7 个 office 在“全新会话技能目录”里的中文显示**：历史快照可能停留在插件禁用窗口；state/provider/status 与 `skill("office-render")` 已证明覆盖生效，仍建议新开会话确认。
7. **v0.2.0 命令菜单与真实执行**：源码探针与 e2e 已证明 agent 中文、global/其它 agent 英文、执行委托原 handler；真实 GUI 菜单与点击副作用待重启。
8. **动态 `agent-teams-<profile>` 命令**：模板逻辑离线验证；当前 desktop 未配置 `profiles`，无真实别名可测。
9. **本地包供应链 / 仓库无 `.git`**：来源、签名、发布时间无法判定；仓库不能 `git revert`，源码回退依赖备份。
10. **真实插件更新 / 性能**：未对大量技能/插件/agent 做压测；registry 5 分钟缓存、列表 2 秒缓存。

## 5. 重启后的 9 项人工验收

1. 设置左侧只出现一个“Better Skill”，进入后是“描述汉化 / 插件管理 / 技能管理”三个 Tab，默认描述汉化，无重复入口。
2. 描述汉化 Tab 能读到真实状态（不是“无法读取状态”）；`apply`/`restore` 与工具 `skill_desc_zh` 结果一致，中文/英文往返正确。
3. 插件管理 Tab 能列出第三方插件并检查更新；遇到 `pending-builds`/隔离期/不兼容时提示正确；不把失败说成成功。
4. 插件索引子页能读到宿主「设置 → 插件 → 发现」的索引源；搜索、加载更多、状态徽章正常。
5. 兼容性：`exempted` 显示“已豁免”、`compatible:false` 显示“不兼容（宿主 X）”；分类/标签中文正常，无 `[object Object]`。
6. 索引源失败/无 `pluginMarket` 时只影响该子页；搜索失败保留旧列表并可重试；不出现空白崩溃。
7. 技能管理 Tab 区分可写/只读；在测试项目新建/编辑/禁用/删除/恢复，删除只进废纸篓，冲突不覆盖。
8. Tab 记忆/键盘 `←`/`→`/`Home`/`End`、焦点与 ARIA 正常；一个 Tab 崩溃后切到其它 Tab 仍可用；窄窗 Tab 栏可横向滚动。
9. Cmd+Q 完全退出并重启后：state 为 v3、无 401/403 循环、无持续轮询风暴；失败时页面有可见错误/降级。

## 6. 回滚（全程可逆，删除只走废纸篓）

| 级别 | 操作 |
| --- | --- |
| 只回英文 | 设置页关闭开关，或 `skill_desc_zh(action="restore")`；技能影子进废纸篓、命令影子注销 |
| 撤销技能编辑 | 用编辑前内容重新保存；或从 `~/.dsh/.file-backups/` 取快照，覆盖前先 `trash.mjs --snapshot` |
| 撤销禁用 | 技能管理 Tab 点“启用”，或 `skill_desc_zh(action="skills")` 再执行对应 enable 动作 |
| 撤销删除 | 技能管理 Tab“回收站 → 恢复”；目标已存在时先处理冲突，绝不覆盖 |
| 临时停用 | 原生“设置 → 插件”页禁用本插件 bundle（或 `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`） |
| 卸载 | 先 `restore`，再 `plugin_manager remove_bundle target="dsh-skill-desc-zh"`；源码目录不受影响 |
| 清状态 | `node ~/.dsh/skills/safe-delete-trash/trash.mjs ~/.dsh/.skill-desc-zh`（确认 restore/卸载已完成） |
| 源码回退 | 仓库无 `.git`；用改动前备份覆盖，覆盖前先 `trash.mjs --snapshot` 留档 |

被还原的影子目录在 `~/.Trash`（名称带序号），可用 Finder“放回原处”找回；每次移动记录在 `~/.dsh/.trash-log.jsonl`。命令影子只存在内存，回滚不产生文件。

## 7. 交付物

- `README.md`：v0.7.0 版本/功能行、§5.1 描述汉化、§5.2 插件索引子页、重启验收、回滚；同步 §1/§3/§9/§10/§11/§12 的版本、数字与导航描述。
- `docs/verification.md`：v0.1 A1–A12、v0.2.0 T1–T6/A1–A10、v0.3.0 A1–A15、v0.4.0 A1–A12 与复验、v0.5.0 A1–A28 与两次复验、v0.6.0 A1–A12 与二次验收、v0.7.0 t38/t41/t43 的原始证据。
- `docs/design.md` §16：插件索引数据契约、组件/状态、接线、locale、安全与未验证项。
- `docs/v0.7.0-plan.md`：A/B/C 计划；文末「执行结果」记录 t36–t39 状态与证据数字。
- `docs/v0.6.0-sha256.txt`：历史 v0.6 的 lib/scripts 30 条基线（仅回滚对照；v0.7.0 未重建）。
- `docs/skill-admin-design.md` / `docs/skill-admin-plan.md`、`docs/settings-ui-design.md`、`docs/plugin-admin-design.md`、`docs/command-desc-design.md` / `docs/command-desc-investigation.md`：前序能力设计与调查证据。
- 源码：`lib/`（18 个 JS 模块）、`client.js`（单个 `settings.section`、icon 槽、三个 Tab、插件索引）、`locale/{zh,en}.json`（各 345 keys）、`icon.svg`、`scripts/`（含 `skills-e2e.mjs`、`check-client.mjs`）、`test/`（17 个测试文件、229 个用例）、`cordis.patch.yml`。

本次 t39 只更新 `README.md`、`docs/final-report.md`、`docs/design.md`、`docs/v0.7.0-plan.md`；未改代码/package.json/locale/tests，未安装/升级/重启，无永久删除。
