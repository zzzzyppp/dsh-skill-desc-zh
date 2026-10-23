# 获批计划：dsh-skill-desc-zh v0.5.0 —— 「技能管理」设置页

> 本文件是 Lead 提交并由用户批准的执行计划（2026-10-22）。所有实现任务以本文件为准；如需偏离，由 Lead 裁决并更新本文件。

## 1. 目标与范围

在现有插件 `~/dsh-plugins/skill-desc-zh`（v0.4.0，profile 以 `link:` 安装）中新增独立设置页「技能管理」（settings.section，order 18，id `skill-admin`），仿照 MichengAI/dsh-skills-manager 的基本能力：

- 列表 / 搜索 / 详情 / 删除 / 启用禁用 / 新建 / 编辑（description 与正文）。
- 删除走系统废纸篓（`trash.mjs`）并可恢复；写前快照；乐观锁；frontmatter 校验。
- 启用/禁用**不修改源文件**。
- **不含** GitHub 仓库导入。

## 2. 已确认的宿主机制（实现依据）

1. 预设 `cordis` 自带 `skill-filesystem`（`customSkillDirs` 含 agent-preset/skills，默认根开启），base host 的 `skill-filesystem` 在 web-app patch 中被禁用 ⇒ 用户/项目技能候选位于 **agent scope 层**。
2. 同层 rank（小者胜）：项目 `.dsh`=100、`.agents`=200、custom=300、用户 `$DSH_HOME/skills`=400、`~/.agents`=500；近层整体获胜。
3. `@deepseek-ai/dsh-tool-skill`：模型可见目录 = `snapshot().skills.filter(isModelInvocable)`；`skill` 工具执行校验 `modelInvocable`；用户显式调用校验 `userInvocable`。
4. 禁用方案：agent 层注册同名候选（rank 40 < 400），`invocation:{modelInvocable:false,userInvocable:false}`，description 前缀「（已禁用）」，content 透传；不改文件；可移除恢复。**此机制须先由 spike 证伪/证实（s1）。**
5. 可写来源仅两处：`$DSH_HOME/skills/<name>/SKILL.md`（DSH_HOME=`~/.dsh`）与 `<projectRoot>/.dsh/skills/<name>/SKILL.md`；插件/预设/asar 技能只读。
6. 删除只经 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`（`lib/trash.js` 封装；日志 `~/.dsh/.trash-log.jsonl` 含 `{t,action,from,to,kind}`）；恢复 = rename 回原路径（父目录存在且目标不存在）。
7. 写前 `trash.mjs --snapshot`；乐观锁 = `mtimeMs + size + sha256 指纹`。
8. projectRoot 解析/白名单复用 `lib/paths.js`：`findProjectRootFS/findProjectRoot/isProjectAllowed`。
9. `state.js` 现 `STATE_VERSION=2` → 升 v3，新增 `state.skillAdmin`，v2→v3 归一化迁移。

## 3. 改动清单

### Host
1. 新 `lib/skill-files.js`：可写根解析、scan、readDetail、create、save（临时文件+rename、写前快照、期望指纹校验→`conflict`）、delete（trash 返回 from/to）、restore（rename 回来）、fingerprint、frontmatter **切片式**保留（只改 description 与正文，其余键/注释/多行原样）、name 必须等于目录名、realpath 防 symlink 逃逸。
2. 新 `lib/skill-admin.js`：list/detail/create/save/delete/restore/disable/enable/trashList；单飞锁；错误码 `invalid/not-found/not-writable/conflict/trash-unavailable/too-large/unsupported-source`；与 agent 层 provider 联动 invalidate。
3. 改 `lib/state.js`：`STATE_VERSION=3`；`state.skillAdmin={disabled:[{scope,name,disabledAt}],deletions:[{id,scope,name,from,to,deletedAt,size}],updatedAt}`；迁移与 helper。
4. 改 `lib/agent-layer.js`：provider 扩展为「runtime 覆盖 + 禁用影子」；`AGENT_DISABLED_RANK=40`；候选 invocation 全 false、description 前缀、content 透传；无 content 不注册；`refresh()` 支持 invalidate。
5. 改 `lib/http-api.js`：`API_SKILL_PATHS={list:'/plugins/skill-desc-zh/skills',detail:'…/skills/detail',action:'…/skills/action'}`；GET list / GET detail / POST action；`skillBusy` 单飞并与 `pluginBusy` 互斥；skills 路由 body 上限 256KiB；统一 `{ok,error{code,message}}`、`cache-control:no-store`、认证沿用 `authenticatedRoutes`；响应 lossless JSON（复用 `toLosslessJson`）。
6. 改 `lib/index.js`：装配 skillAdmin；`controller.skills()` 只读；status 增 `skillAdmin:{sources,counts,disabledCount,trashCount}`；doctor 增非强制 `skill-admin/skill-roots/trash-restore`；apply/dispose。
7. 改 `lib/tool.js`：`TOOL_ACTIONS` += `skills`，DESCRIPTION 增行，`isConcurrencySafe` 加 skills。

### Client
8. 改 `client.js`：`SKILL_ORDER=18`、`id:'skill-admin'`、label 技能管理；`SkillAdminPage`（搜索/来源筛选/新建/编辑抽屉/删除确认/回收站 tab/禁用开关/只读区/loading/error/notice/冲突弹窗）；`createApi` 增 `listSkills/getSkillDetail/skillAction`；DICT zh/en 各 +约 55 键；CSS 仅 DSH token；`__test__` 导出。
9. 改 `locale/zh.json`、`locale/en.json`：与内联 DICT 严格 parity（约 264 keys）。
10. 改 `scripts/check-client.mjs`：version 0.5.0；order 18 断言；新 key 清单；文案断言。
11. 改 `package.json`：version 0.5.0，`scripts.e2e:skills`。

### 测试与文档
12. 新 `test/skill-files.test.mjs`、`test/skill-admin.test.mjs`；改 `state.test.mjs`、`agent-layer.test.mjs`、`http-api.test.mjs`（T21+）、`tool.test.mjs`、`client.test.mjs`。
13. 新 `scripts/skills-e2e.mjs`：临时 DSH_HOME + 临时 project root（/tmp，真实 fs），真实 trash.mjs（`DSH_TRASH_LOG` 临时文件）跑 create→list→detail→save→conflict→delete→restore→disable→enable 全链路 + lossless JSON；断言 ≥22；不触碰真实目录。
14. 文档：README 新增「技能管理」章节；`docs/skill-admin-design.md`；`docs/verification.md` v0.5.0 节；`docs/final-report.md` 更新。

## 4. API 契约

- `GET …/skills?projectRoot&source&refresh=1` → `{ok,projectRoot,sources:{user:{dir,exists,writable},project:{dir,allowed,exists}},skills:[{name,scope,description,dir?,editable,deletable,disableable,disabled,readOnlyReason?,mtimeMs?,size?,fingerprint?,translation?}],trash:{count},warnings,checkedAt,serverTime}`。
- `GET …/skills/detail?scope&name&projectRoot` → `{ok,scope,name,frontmatter,body,raw?,fingerprint,mtimeMs,size,editable}`。
- `POST …/skills/action` `{action:'create'|'save'|'delete'|'restore'|'disable'|'enable',…}` → `{ok,action,result?,error?{code,message},warnings,serverTime}`；业务失败 200+`ok:false`；参数/上限 400/405/413；忙碌 409；不可用 503。
- 持久化：`~/.dsh/.skill-desc-zh/state.json` v3。

## 5. UI 规格

- 头部：说明 + 刷新 + 新建（选用户/项目来源）。
- 工具栏：搜索、来源筛选、状态筛选。
- 列表：名称（mono）、描述、来源徽章、状态徽章（已中文化/已禁用/只读）、操作（编辑/禁用·启用/删除）。
- 只读折叠区：插件/预设/内置技能（附只读原因）。
- 回收站 tab：名称/来源/删除时间/大小 + 恢复。
- 编辑器：name（编辑时只读）、description、正文 textarea（等宽+字数）、「其它 frontmatter 键原样保留」提示；冲突弹窗只允许重新载入后重试。
- 删除确认：移入系统废纸篓、本页可恢复。
- 禁用提示：不改源文件，仅在技能目录中隐藏。

## 6. 安全与边界（硬性）

- 仅写两处根；realpath 校验；name 白名单 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。
- projectRoot 必须通过 `isProjectAllowed`。
- API 不接受任意路径；删除只经 trash.mjs（禁止 rm/unlink/rmdir/truncate）；写前 snapshot；失败临时文件也移入废纸篓。
- 不触碰 asar、node_modules、插件源码；不改禁用技能源文件。
- 禁用仅对用户/项目可写来源；插件/预设/内置只读。
- 所有响应 lossless JSON。

## 7. 验收

- `node --check` 全 lib/scripts；`npm test` **≥205/205**；`node scripts/check-client.mjs`（≥16 检查、约 264 locale keys、strict parity）；`node scripts/skills-e2e.mjs` **≥22/22**；`e2e:agent-layer 7/7`、`e2e:commands 10/10`、`e2e:plugin-admin 21/21` 不退；`node scripts/verify.mjs --expect-installed --expect-applied` exit 0；无永久删除扫描通过；被改文件均有 `trash --snapshot` 留档。
- 无需安装/升级；用户 Cmd+Q 重启 DSH 后人工验收：页面出现、新建/编辑/禁用/启用/删除/恢复全链路、`skill_desc_zh({"action":"skills"})` 无损 JSON、`curl /skills` 401、既有两页行为不变。
- 回滚：快照、启用/恢复、`skill_desc_zh(action="restore")`。

## 8. 分工（既有团队 skill-desc-zh，不新建团队）

- s1 researcher（无依赖）：机制 spike（禁用影子/Catalog filter/trash 恢复/frontmatter 切片/projectRoot）+ `docs/skill-admin-design.md`，冻结接口。
- s2 core-engineer（依赖 s1）：Host 实现（第 1–7、11–13 项）+ 单测 + e2e，独占 `lib/**`、`test/{skill-files,skill-admin,state,agent-layer,http-api,tool}.test.mjs`、`scripts/skills-e2e.mjs`、`package.json`。
- s3 automation-engineer（依赖 s1，可与 s2 并行）：client/locale/check-client/client 测试，独占 `client.js`、`locale/**`、`scripts/check-client.mjs`、`test/client.test.mjs`。
- s4 verifier（依赖 s2,s3）：独立验收 + `docs/verification.md` v0.5.0 节 + verdict。
- s5 verifier（依赖 s4）：README/final-report/最终报告。

## 9. 风险与备选

1. 禁用影子层级不生效（唯一高风险假设）：s1 spike 先验证；失败则停下上报，改走 frontmatter 原生 `disable-model-invocation` 需用户放宽约束。
2. 回收站恢复遇 TCC/权限/目标已存在：保留记录并提示精确路径，不自动销毁。
3. YAML 序列化丢键：切片式最小改动 + 保留原文；覆盖多行/注释/锚点用例。
4. 外部并发修改：乐观锁 + 409 + 重新载入。
5. 项目根依赖 `.git` 标记：无项目时仅用户来源可用。
6. 大正文：256KiB 上限。
7. 文档/测试计数以 verifier 实测为准。

## 10. 假设

- 独立一级设置页（order 18），不合并现有两页。
- 仅管理 DSH 用户级与当前项目 `.dsh/skills`；其余只读展示。
- 回收站恢复依赖本插件删除记录中的精确路径。

## 11. Lead 决策（s1 设计偏差，2026-10-22）

s1（researcher）已完成机制 spike：A 禁用影子 11/11、B trash 恢复 10/10、C frontmatter 切片 11/11、D projectRoot 9/9，均用真实宿主模块实测（详见 `docs/skill-admin-design.md` §13）。其 §10 的 7 条偏差**全部批准**，s2/s3 按此实现：

- **D1 批准**：description 含锚点/别名等不可安全切片的结构 → `400 unsupported-frontmatter`，该技能只读展示（UI 需说明原因）。
- **D2 批准**：`restore` 以 `deletionId` 为主键（`deletions` 记录含 id），不接受任意路径。
- **D3 批准**：`deletions` 记录增 `projectRoot`/`kind`/`restoredAt`。
- **D4 批准**：禁用影子 content 以磁盘读取为准（项目来源按 agent cwd 匹配；不缓存陈旧内容）。
- **D5 批准**：不扫描 `~/.Trash`（readdir 为 EPERM/TCC），回收站**仅列本插件删除记录**并按精确路径恢复；UI 如实说明。
- **D6 批准**：skills 路由 body 上限 256 KiB（其余路由维持 64 KiB）。
- **D7 批准**：tool `skills` 返回与 HTTP 列表同形。

安全补充（B 实测）：rename 到已存在文件会静默覆盖 ⇒ 恢复前必须检查目标存在；目录 `ENOTEMPTY`、父目录缺失 `ENOENT`、`EACCES` 均返回明确错误，不自动销毁。frontmatter 锚点+别名必须失败关闭，kebab-case 白名单由 `skill-files.js` 落实。

计数基线（实测，覆盖计划估算）：现 157 用例 / 209 locale keys / 14 check-client checks；s2+s3 合计至少新增 48 用例（目标 ≥205），s3 后 locale 287 keys、check-client ≥16 checks。

## 12. t26 验收发现（F1–F6）与修复约定（2026-10-22）

t26 独立验收 verdict=needs_revision（主链路全绿：npm test 208/208、check-client 17/17、skills-e2e 32/32、三个 e2e 不退、verify.mjs exit 0；F1/F2/F3/F4 为用户可见或契约级偏差，F5/F6 为安全/匹配边界）。修复约定（s2 → 复验 → s5 文档）：

- **F1**：技能识别规则收敛为「根层 `<name>/SKILL.md`（相对路径长度=2）或根层 `<name>.md`」；`references/`、`assets/` 等子目录内 `.md` 一律不得成为技能行（`lib/skill-files.js:322-359`）。
- **F2**：只读行 `scope` 改为其 `origin`（`plugin`/`preset`/`bundled`/`runtime` 之一），不得为 `user`/`project`；`user`/`project` 只统计可写行；`client.js:1777-1778` 既有分组逻辑不改（`lib/skill-admin.js:188-210`）。
- **F3**：只读行若 `state.skills[name]` 有中文且 `saved.en === 当前 description`，则 `description` 用中文、`translation:{engine: saved.engine ?? 'cached', zh:true}`；否则英文 + `zh:false`（`lib/index.js:217-234`、`lib/skill-admin.js:207`）。
- **F4**：禁用影子 `definition` 与 candidate 一致：`description = '（已禁用）' + 原文`、`invocation = {modelInvocable:false, userInvocable:false}`；保留 `content`/`resourceBase`/`whenToUse`（`lib/agent-layer.js:185-191`）。
- **F5**：`restore` 前按 `deletion.projectRoot` 重新校验 `projectPermission`/allowlist；不在 allowlist → `400 unsupported-source`，不写盘（`lib/skill-admin.js:356-369`）。
- **F6**：禁用 provider `get()` 匹配必须含 `projectRoot`（用户条目为空、项目条目精确匹配），不得 fallback 到其它 projectRoot 的同名条目，找不到返回 `undefined`（`lib/agent-layer.js:201-215`）。
- 每项都要有「复现→修复→验证」证据与单测；F2 仅 host 修改，若必须改 client 需先报告 Lead。
- 修复后由 verifier 复验（t29），t27 文档任务改为依赖 t29；复验通过才可交付。
