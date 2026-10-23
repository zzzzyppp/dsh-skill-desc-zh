# 最终验收报告（用户版）：技能描述中文化插件

- 日期：2026-10-23
- 结论：**v0.6.0 源码级验收通过（ready-for-restart）**。设置导航收敛为 **Better Skill 单入口、三个 Tab**（描述中文化 / 插件管理 / 技能管理）；t32 发现的 F1（Tab 崩溃后错误边界卡死）与 F2（非激活 Tab 的 `aria-controls` 悬空）已由 t34 修复，t35 独立复验通过。真实页面、键盘/焦点、认证后的点击与真实写盘仍需重启后人工确认。
- 插件：`dsh-skill-desc-zh@0.6.0`（本地源码 `~/dsh-plugins/skill-desc-zh`；profile 以 `link:` 指向）
- 宿主：DeepSeek Harness Desktop `0.2.1-rc.2`，profile `desktop`
- 详细证据：`docs/verification.md`；使用说明：`README.md`；技能管理设计/计划：`docs/skill-admin-design.md`、`docs/skill-admin-plan.md`

> 当前运行中的 DSH 进程仍是重启前的旧代码：源码包已是 0.6.0，但 v0.3.0–v0.6.0 的客户端半边与 HTTP 路由要等用户重启后才会加载。因此 Better Skill 单入口、三个 Tab、真实认证、页面点击、真实技能写盘与一次真实插件更新尚未在真实进程发生。

---

## 1. v0.6.0 做了什么

在“技能/命令描述中文化”、设置页（v0.3.0）、插件管理（v0.4.0）和技能管理（v0.5.0）之上，把原先多个设置页面合并为**一个入口、三个 Tab**：

- **唯一入口**：`settings.section` 只注册一次，id `skill-desc-zh`，order 16，label 走 `t('nav')`；左侧导航显示“Better Skill”，不再为每个功能单列入口。
- **三个 Tab**：描述中文化（`translate`，默认）、插件管理（`plugins`）、技能管理（`skills`）；Tab 标签与面板标题来自 locale，active Tab 记忆在 `localStorage` 的 `dsh-skill-desc-zh.activeTab`，非法值回退 `translate`。
- **键盘与 ARIA**：`tablist` / `tab` / `tabpanel` 完整；Left/Right 循环、Home/End 跳首尾；焦点随 active Tab 移动；只有 active Tab 带 `aria-controls`，非激活 Tab 不再指向未挂载的面板。
- **崩溃隔离**：错误边界 `key={active}`，某个 Tab 渲染崩溃后切到另一个 Tab 会重建边界并正常渲染，不会永久卡在 fallback。
- **功能保持**：描述中文化（apply/restore/retranslate/doctor/覆盖清单）、插件管理（第三方列表/检查更新/更新预检与分类/单飞）、技能管理（新建/编辑/禁用/删除/恢复/冲突/只读边界）行为不变，只是改为 Tab 内呈现。

原有能力不变：12 个技能中文化（7 office + 4 preset + runtime browser-skill）、3 条命令描述中文化、restore/apply、升级自愈、唯一删除通道 `trash.mjs`。

## 2. 预检、安装与当前状态

- **本轮无安装/升级/启用禁用/重启**：profile 仍通过 `link:~/dsh-plugins/skill-desc-zh` 指向源码；未调用 `install_bundle`/`update`，未重启。
- **当前**：`include:skill-desc-zh` → `enabled=true`、`fiberPhase=active`；工具 `skill_desc_zh` 已注册，schema 含 8 个 action（含 `plugins`、`skills`）。
- **state**：运行中的旧进程仍是 v2（12/12 技能中文、3/3 命令中文，4 个 preset 影子在 `/Applications/dsh/.dsh/skills/`）；源码会在重启/首次写 state 时迁移到 v3 并增加 `skillAdmin.disabled/deletions`。
- **供应链**：本轮没有安装动作，因此没有新增预检结论；本地目录包的来源/发布者/签名/发布时间仍无法由 audit 判定，历史预检的“未验证”标注继续有效，不得说成“预检干净”。
- **live 旧进程**：旧进程仍持有重启前的旧代码（不包含 v0.5.0/v0.6.0 客户端与路由）；`skill_desc_zh(action="plugins")` 的 lossless 错误需重启后复验，源码已修复。
- **仓库无 `.git`**：不能用 `git revert`；改前快照在 `~/.dsh/.file-backups/`，删除/清理只走 `trash.mjs`。

## 3. 验收证据（重启前）

完整原始输出见 `docs/verification.md` 的 v0.6.0「t32 独立验收」「t35 二次验收」章节。

| 检查项 | 结果 |
| --- | --- |
| 单元测试 | ✅ `npm test` **215/215**，0 失败（Node v24.20.0，约 360–380ms） |
| 语法检查 | ✅ `node --check lib/*.js scripts/*.mjs client.js` 退出 0；循环检查 **49** 个文件 0 失败 |
| 客户端静态检查 | ✅ `npm run check:client` **17/17**；单入口三 Tab、active-only `aria-controls`、Boundary key、locale zh/en 各 **298** keys、icon 819 B、语法均通过 |
| 客户端单测 | ✅ `node --test test/client.test.mjs` **13/13**：默认 translate、存储非法值回退、nextTabId 循环/Home/End、切 Tab 卸载、单注册 |
| 技能管理 e2e | ✅ `npm run e2e:skills` **32/32**：新建/保存/禁用/删除/恢复/冲突不覆盖/非法名称/未授权项目/503；临时 HOME/项目，不碰真实技能 |
| 插件管理 e2e | ✅ `npm run e2e:plugin-admin` **21/21**：列表/official 过滤/latest、lossless、单飞、隔离期/构建脚本/兼容性分类、缓存失效；A3.5 明确不发生真实安装 |
| 命令/agent e2e | ✅ `e2e:commands` **10/10**；`e2e:agent-layer` **7/7** |
| 文件级验收 | ✅ `node scripts/verify.mjs --expect-installed --expect-applied` 退出 0：**49** 个文件无永久删除调用、trash 通道、4 个影子标记、profile 依赖/bundle、state hostVersion 对账 |
| 独立真实模块探针 | ✅ 生产 `client.js`：默认 translate；切 plugins 后只有 plugins Tab 有 `aria-controls`；`Boundary key` 随 active 变化，旧实例崩溃不影响新实例渲染 |
| 基线自检 | ✅ `sha256sum -c docs/v0.6.0-sha256.txt` **30/30 OK**（lib/scripts 基线）；无 pre-t31 逐字节基线，I1 接受替代证据（见 §4） |
| 客户端 Slots 检查 | ⚠️ `cordis_inspect_query(client, Slots)` 仍 10 秒超时；单入口真实挂载待重启人工确认 |

v0.6.0 修复（t32 发现、t34 修复、t35 独立复验）：

- **F1 Tab 崩溃隔离**：`client.js:2519` 使用 `h(Boundary,{key:active,t:t},...)`；切 Tab 会新建错误边界并清除旧 fallback。探针 `remounted_renders_child:true`。
- **F2 ARIA**：`client.js:2508` 只给 selected Tab 设置 `aria-controls=sdzh-panel-<active>`；非激活 Tab 为 null；panel `aria-labelledby` 指向当前 Tab。
- **I1 基线裁定**：没有 t31 之前的 lib/scripts 逐字节基线；替代证据（lib mtime 早于 t31、无 0.6 符号、package 只改 version、`cordis.patch.yml` 未变）未发现变更。`docs/v0.6.0-sha256.txt` 作为后续基准；这不是“逐字节证明未改”，已在 verification 中如实标注。

## 4. 已知限制 / 确实未验证项

1. **Better Skill 入口与三个 Tab 需重启验收**：设置左侧是否只出现一个“Better Skill”、默认 Tab、Tab 切换/记忆/键盘焦点、窄屏横向滚动，均需用户重启 DSH 后确认。
2. **真实技能写盘未验收**：`e2e:skills` 使用临时 HOME/项目，不写真实 `~/.dsh` 或 `/Applications/dsh/.dsh`；首次使用建议先在测试项目试新建/删除/恢复。
3. **认证后的页面与路由**：未认证访问已确认 401 + no-store；认证后的 200、真实同源 fetch、cookie/CSP 与点击副作用未在真实 GUI 验证。
4. **真实插件更新未验收**：`e2e:plugin-admin` 使用 fake `installBundle`，只验证调用参数、失败分类、缓存与单飞；没有真实拉取/安装新版本。
5. **7 个 office 在“全新会话技能目录”里的中文显示**：历史快照可能停留在插件禁用窗口；state/provider/status 与 `skill("office-render")` 已证明覆盖生效，仍建议新开会话或刷新 GUI 技能页确认。
6. **v0.2.0 命令菜单与真实执行**：源码探针与 e2e 已证明 agent 中文、global/其它 agent 英文、执行委托原 handler；真实 GUI 菜单与点击副作用待重启后确认。
7. **动态 `agent-teams-<profile>` 命令**：模板逻辑离线验证；当前 desktop 未配置 `profiles`，无真实别名可测。
8. **本地包供应链 / profile lockfile 隔离期 / 仓库无 `.git`**：来源、签名、发布时间无法判定；仓库不能 `git revert`，源码回退依赖备份。
9. **I1 无逐字节历史基线**：只能给替代证据；若要求严格证明，需要在 t31 前已保存哈希，当前不可补造。
10. **技能管理只处理文本技能**：不处理二进制资源，不提供批量导入/导出；YAML 锚点/别名无法安全定点改写时返回 `unsupported-frontmatter`，原文件不变。
11. **禁用只在 agent 作用域生效**：global 技能列表仍显示英文；这是宿主层级/scope 机制，不是页面 bug。
12. **性能**：未对大量技能/插件/agent 做压测；页面列表缓存 2 秒，registry 5 分钟，真实大目录未压测。

## 5. 重启后的 8 项人工验收

1. 设置左侧只出现一个“Better Skill”，不再为每个功能单列入口；点击后页面不空白、不报 Boundary fallback。
2. 默认落在“描述中文化”Tab；状态显示 12/12 技能中文、3/3 命令中文；`apply` / `restore` 往返后仍一致。
3. 切到“插件管理”Tab：能列出第三方插件并检查更新；切回描述中文化仍正常；刷新页面后记住上次 Tab。
4. 手工把 `localStorage` 的 `dsh-skill-desc-zh.activeTab` 改成非法值，刷新应回退到 `translate`。
5. 键盘 Left/Right 循环、Home/End、Tab 焦点顺序正常；读屏语义为 `tablist`/`tab`/`tabpanel`。
6. “技能管理”Tab：列表与只读区分组正确；在测试项目新建/编辑/禁用/删除/恢复，确认冲突与只读拒绝提示符合预期。
7. 窄窗口下 Tab 条横向滚动、不遮挡内容；某个 Tab 异常时切到另一个 Tab 仍可用（F1）。
8. Cmd+Q 完全退出并重启后，state 迁移到 v3；无 401/403 循环、无持续轮询风暴；失败时页面有可见错误/降级。

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

- `README.md`：§5“Better Skill 设置页（v0.6.0）”单入口三 Tab、Tab 记忆/键盘/ARIA、8 项重启验收、回滚；同步 §1/§3/§9/§10/§11/§12 的版本、数字与导航描述。
- `docs/verification.md`：v0.1 A1–A12、v0.2.0 T1–T6/A1–A10、v0.3.0 A1–A15、v0.4.0 A1–A12 与复验、v0.5.0 A1–A28 与 t29/t30 复验、v0.6.0 A1–A12 与 t35 二次验收的原始证据。
- `docs/v0.6.0-sha256.txt`：lib/scripts 30 条基线，供后续 `sha256sum -c` 复核。
- `docs/skill-admin-design.md` / `docs/skill-admin-plan.md`：技能管理契约、错误码、UI 规格、验收切分；已按实现校正字段/路径/命令/指纹算法。
- `docs/settings-ui-design.md`、`docs/plugin-admin-design.md`、`docs/command-desc-design.md` / `docs/command-desc-investigation.md`：前序能力设计与调查证据。
- 源码：`lib/`（18 个 JS 模块）、`client.js`（单个 `settings.section`、三个 Tab）、`locale/{zh,en}.json`（各 298 keys）、`icon.svg`、`scripts/`（含 `skills-e2e.mjs`、`check-client.mjs`）、`test/`（17 个测试文件、215 个用例）、`cordis.patch.yml`。

本次 t33 只更新 `README.md`、`docs/final-report.md`；未改代码/package.json/locale，未安装/升级/重启，无永久删除。
