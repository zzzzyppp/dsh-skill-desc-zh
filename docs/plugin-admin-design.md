# v0.4.0 插件管理（设置页）设计说明

> 版本：0.4.0 · 日期：2026-10-22 · 代码：`lib/plugin-admin.js`、`lib/http-api.js`、`client.js`
> 状态：源码级实现完成（153 单测 / check:client 14 / plugin-admin e2e 19 项全过），待重启 DSH 后在线验收。

## 1. 目标与范围

仿照 `@michengai/dsh-skills-manager` 的插件更新能力的**范围 A**：

- **做**：在「设置」中新增一级页面「插件管理」（`settings.section`，id `plugin-admin`，order 17）。
  - 列出当前 profile 中已安装的**第三方**插件（名称、版本、来源类型、启用状态、是否本地链接、是否与插件自述官方关联）。
  - **检查更新**：对 npm 来源插件查询 registry 最新版，给出可更新提示。
  - **一键更新**：确认后经宿主 `pluginManager` 更新单个插件，返回是否需要重启，并如实给出失败原因。
- **不做**（边界）：
  - 不重复实现启用/禁用/卸载——宿主「设置 → 插件」页已有完整能力，本页只做提示与跳转语义。
  - 不自动更新任何插件；不做批量更新队列（单飞串行，避免并发写 profile）。
  - 不绕过 24h 供应链隔离期（`minimumReleaseAge`），**不写 `minimumReleaseAgeExclude` 白名单**，**不使用 `--config.minimumReleaseAge=0`**（与 skills-manager 的有意差异，见 §8）。
  - 不更新官方 `@deepseek-ai/*` bundle、不更新 `link:`/`file:`/`workspace:` 等本地来源、不更新本插件自身（`dsh-skill-desc-zh`，profile 中为 `link:`）。

## 2. 架构总览

```
设置 → 插件管理（client.js: PluginAdminPage）
        │  fetch 同源（浏览器鉴权 cookie，credentials: same-origin）
        ▼
GET  /plugins/skill-desc-zh/plugins            POST /plugins/skill-desc-zh/plugins/action
        │                                              │
        ▼                                              ▼
lib/http-api.js（单 prefix 路由 / 认证闸门 / busy 串行 / 64KiB body 限制）
        │  controller.action = "plugins"                │  pluginAdmin.update()
        ▼                                              ▼
lib/index.js（controller.plugins，只读）     lib/plugin-admin.js（createPluginAdmin）
        │                                              │
        └──────────────► 宿主服务 ctx.get('pluginManager') ◄──────────────┘
                          （listBundles / inspect / installBundle）
                                     + registry /<pkg>/latest（只读 GET）
```

- **Host 侧** `lib/plugin-admin.js`：纯 Node 模块，零外部依赖，`fs`/`fetch`/`now` 可注入以便单测；不直接依赖 React/客户端。
- **传输层** `lib/http-api.js`：新增两条路径，仍由既有单 prefix 路由统一分发，复用同一套认证（`connection.requestRejection` → 503/401/403）、`cache-control: no-store`、JSON-only、body ≤ 64 KiB、busy 409 语义。行为与既有 `/state`、`/action` 完全一致，既有 T1–T13 测试不变。
- **工具面**：`skill_desc_zh` 新增只读 `action="plugins"`，供 agent/无浏览器场景查看同一份列表（便于重启后在线验收）。
- **可观测性**：`status.pluginAdmin`（profile / 解析来源 / pluginManager 可用性 / 缓存摘要）、`doctor` 新增非强制检查 `plugin-admin`。

## 3. 关键数据流

### 3.1 profile 解析（`resolveProfileTarget`）

按优先级（首个合法者胜）：

1. 宿主服务 `desktopProfiles.current` → `{name, dir}`（**官方桌面应用**下的权威来源，本机即走此路径）；
2. 宿主服务 `profileContext`（launched profile）；
3. 环境变量 `DSH_PROFILE_DIR`；
4. 命令行 `--profile <name>`；
5. 兜底候选：`$DSH_HOME/profiles/web`（若存在）→ `$DSH_HOME/profiles/desktop`。

合法性：profile 名需匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`，目录必须存在且含 `package.json`。全部失败返回 `{ok:false, code:'profile-not-found'}`，页面显示原因而不是猜测路径。

### 3.2 列表（GET `/plugins`，可 `?refresh=1` 强制）

1. 解析 profile → 读 `package.json` 的 `dependencies`（spec 决定来源类型：`npm` / `local` / `workspace` / `git` / `tarball` / `unknown`；v0.4.0 起无法识别者按 `npm` 处理并在 UI 标注）。
2. `pluginManager.listBundles()` 取 bundle 行（含 `official`、`installed`、`version`、`enabled`、`meta` 等）；服务不可用时降级为空列表并给出 warning。
3. 过滤：`official === true` 不参与更新；`installed === false` 跳过；本插件自身标记 `self`。
4. 版本：优先 `bundle.version`，缺失时回退读 `node_modules/<name>/package.json`。
5. 对可更新（npm 来源且非自身）的插件并发（≤6）请求 `<registry>/<encoded>/latest`，超时 8s；失败只记单条 `latestError`，不影响整体。
6. 结果缓存 5 分钟（按 profileDir 区分）；`force` 或更新成功后缓存失效。
7. 返回 `{ok, profile{name,dir,source}, registry, pluginManager, checkedAt, officialCount, plugins[], warnings[]}`。

### 3.3 更新（POST `/plugins/action`，`action:"update", name`）

1. 单飞：已有插件管理动作在跑 → 409 `busy`；与技能动作（apply/restore…）共用互斥，任一在跑都拒绝交叉执行。
2. 校验 `name` 必须是当前 profile 的**可更新 npm 第三方插件**；否则 `unknown-plugin` / `not-updateable`。
3. 取缓存列表中的最新版本；无更新 → `no-update`（幂等，不报错）。
4. 宿主预检：`pluginManager.inspect("<name>@<latest>")`；`status === "refused"` 时直接返回 `incompatible-version`/原因，**不调用安装**。
5. 安装：`pluginManager.installBundle("<name>@<latest>")`（保留宿主的依赖解析、兼容性闸门、构建脚本批准流程）。
6. 结果映射：
   - 成功：`{ok, name, from, to, application, restartRequired, restartReason?, warnings?}`；`application === "applied"` 表示免重启热加载，`restart-required` 等提示用户重启。
   - 失败分类（见 §6），并把宿主原始诊断做安全截断（≤500 字符）后回传。
7. 成功后清除列表缓存，下次 GET 重新查询。

## 4. 失败分类（`classifyInstallFailure`）

| 场景 | 识别方式 | 返回 code | 页面提示 |
| --- | --- | --- | --- |
| 版本仍在 24h 隔离期 | 结果/错误文本匹配 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` / `minimumReleaseAge` | `quarantine` | 提示 24 小时内自动解除，本页不绕过；请稍后重试 |
| 需要批准构建脚本 | 结果或错误中的 `builds`/`ERR_PNPM_IGNORED_BUILDS`/`approve` 语义 | `pending-builds` | 引导到「设置 → 插件」页批准后重试 |
| 宿主兼容性拒绝 | `inspect` 返回 `refused` | `incompatible-version` | 原样给出不兼容原因 |
| 其它安装失败 | 其余 | `install-failed` | 宿主诊断摘要 |

所有分类都**不重试、不降级绕过**，失败后 busy 释放，可再次点击。

## 5. API 契约

### 5.1 HTTP

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/plugins/skill-desc-zh/plugins` | 列表；`?refresh=1` 强制刷新缓存 |
| POST | `/plugins/skill-desc-zh/plugins/action` | `{action:"check"|"update", name?}`；`check` 等价于强制列表；`update` 必填 `name` |

响应：成功 200 `{ok:true, action, result?, plugin?…, serverTime}`；业务失败 200 `{ok:false, error:{code,message}}`（页面可展示）；服务/内部错误 500/503；串行冲突 409 `busy`；认证失败由既有闸门返回 401/403/503。

### 5.2 工具

`skill_desc_zh(action="plugins", force?)`：只读，返回 summary/details/warnings 与 `plugins[]`（name、version、latestVersion、updateAvailable、kind、enabled、self、local、latestError）。

### 5.3 状态与自检

- `status.pluginAdmin = {version, ok, profile{name,dir,source}, pluginManager, cached?{checkedAt,updateable,total}}`；
- `doctor` 新增非强制检查 `plugin-admin`：profile 可解析 + `pluginManager` 可用。

### 5.4 客户端

- 第二个 `settings.section` 注册：`{name:'settings.section', id:'plugin-admin', order:17, label: () => t('plugins.nav'), locale: NS}`；
- i18n：`locale/zh.json`、`locale/en.json` 与 `client.js` 内联 DICT 三处同步（各 209 键），缺一即 check:client 失败；
- 交互：5 秒首查、无轮询；刷新/检查按钮手动触发；更新前确认弹窗；结果条区分成功/失败/需重启；错误不吞（显示 code + message）；无外部网络依赖（只经宿主同源路由）。

## 6. 更新语义与安全边界

- **只经宿主服务**：`inspect` + `installBundle`，行为与内置「设置 → 插件」页一致，兼容性/供应链/构建脚本策略由宿主统一执行。
- **不触碰 pnpm 配置**：不写 `minimumReleaseAgeExclude`，不传 `--config.minimumReleaseAge=0`；隔离期条目一律按失败处理并提示用户等待（该策略是相对 skills-manager 的显式收紧，避免 profile lockfile 被白名单污染后所有安装被 pnpm 拒绝）。
- **不并发写 profile**：插件管理动作与技能动作互斥，页面按钮在请求期间禁用。
- **来源可信**：只操作当前 profile `dependencies` 中已有的第三方插件名（白名单即 profile 依赖），天然拒绝任意 spec 注入；不提供添加新插件的入口。
- **路径不泄露**：页面展示 profile 目录（本机用户可见），错误信息截断，不返回 registry token 或环境变量。
- **删除纪律**：本功能不删除任何文件；更新由 pnpm/宿主完成。全仓删除唯一通道仍是 `lib/trash.js → trash.mjs`。

## 7. 缓存与性能

- 列表缓存 5 分钟；`refresh=1`/更新成功后失效。
- registry 查询并发 6，单请求 8s 超时；不可达时逐插件记录 `latestError`，列表本身仍返回。
- `listBundles()` 由宿主提供，本模块不做额外磁盘扫描（版本回退读取为兜底，单文件同步读取）。

## 8. 与 skills-manager 的差异（有意为之）

| 维度 | skills-manager | 本实现 v0.4.0 |
| --- | --- | --- |
| 管理范围 | 技能管理 + 自身更新 | 第三方插件列表 + 更新（不重复宿主插件页能力） |
| 更新通道 | pnpm（`--config.minimumReleaseAge=0`）+ 白名单写入，失败逐级回退 | 宿主 `pluginManager.inspect` + `installBundle`，保留全部闸门 |
| 隔离期策略 | 绕过（写 `minimumReleaseAgeExclude`） | 不绕过（提示等待，避免污染 profile lockfile） |
| 构建脚本 | 直接安装 | 失败提示去宿主插件页批准（页面不做敏感批准） |
| 依赖注入 | 直接改 profile 文件 | 交给宿主插件管理器（含回滚/校验） |

## 9. 失败模式与降级

- `pluginManager` 不可用（旧进程未加载 / 服务缺失）：页面显示“需重启加载 0.4.0 且宿主服务不可用”，列表空态 + 原因，不抛异常。
- profile 解析失败：页面显示原因；不猜测写入路径。
- registry 全不可达：列表照常（无 latest），提示网络问题。
- 客户端页面加载失败：仅影响设置页，技能描述中文化（host provider/影子）不受影响；可用禁用 bundle 回滚。
- 更新失败：宿主侧回滚由 pluginManager 负责；本页只报告，不写 profile。

## 10. 测试与验收

- 单元：`test/plugin-admin.test.mjs` 20 例（profile 解析/来源分类/版本比较/registry/list 缓存与强制/update 各分支/失败分类/未知与 busy）；全仓 `npm test` **153/153**。
- 静态：`scripts/check-client.mjs` 14 项（含第二个 settings.section、locale 209 键、icon、语法）。
- 端到端（假安装器，不真装）：`scripts/plugin-admin-e2e.mjs` **19/19**（profile 解析、官方过滤、link 不可更新、registry 查询、更新成功/需重启映射、inspect 先行、隔离期/构建脚本/不兼容分类、缓存失效）。
- 回归：`npm run e2e:commands` 10/10、`npm run e2e:agent-layer` 7/7、`node --check` 全过。
- 待重启后在线验收（A1–A12，见 verification.md）：真实列表、页面可见性、真实“检查更新”呈现、一键更新真实点击（验收期不真装）。

## 11. 已知限制

- 客户端页面不轮询更新（避免后台请求噪音）；需手动点「检查更新」。
- 更新按钮不提供批量操作；每次一个插件、连续点击有 busy 保护。
- 官方 bundle 的版本信息仅展示，不参与更新（宿主自身升级路径不在本页）。
- 依赖 npm registry 可达性；离线环境只能看到列表与缓存。
- 页面验收仍依赖重启后人工确认（本机无已连接浏览器可自动截图）。

## 12. 回滚

- 功能级回滚：不改动 `cordis.patch.yml` 与 profile 依赖；如页面异常可仅在宿主「设置 → 插件」页禁用 bundle（或 `include:skill-desc-zh` 行），技能描述中文化随之停止。
- 文件级回滚：所有文档/配置覆盖前均有 `trash.mjs --snapshot`；代码回滚可回退到 v0.3.0 文件（无迁移，state 仍为 v2，向后兼容）。
- 更新本身失败由宿主负责回滚；本页不写 profile，无额外回滚面。

## 13. 文件清单

| 文件 | 变更 |
| --- | --- |
| `lib/plugin-admin.js` | 新增：profile 解析、列表、registry 查询、更新流水线、失败分类 |
| `lib/http-api.js` | 新增两条插件管理路由 + `pluginAdmin` 注入 + busy 联锁 |
| `lib/index.js` | 接线 `createPluginAdmin`、`status.pluginAdmin`、`doctor.plugin-admin`、controller `plugins` action、dispose |
| `lib/tool.js` | 新增 `action="plugins"`（只读） |
| `client.js` | 新增第二个设置页（`PluginAdminPage`）、API 封装、UI/样式/i18n 内联字典 |
| `locale/zh.json`、`locale/en.json` | 各 +66 键（共 209 键） |
| `test/plugin-admin.test.mjs` | 新增 20 例 |
| `test/http-api.test.mjs`、`test/tool.test.mjs`、`test/client.test.mjs` | 增补对应断言 |
| `scripts/plugin-admin-e2e.mjs`、`scripts/check-client.mjs`、`package.json` | e2e 脚本 / 静态检查 14 项 / 版本 0.4.0 |
| `docs/plugin-admin-design.md`（本文件）、`README.md`、`docs/final-report.md`、`docs/verification.md` | 文档 |

## 14. t21 复审修复记录（v0.4.0-fix，2026-10-22）

t21 独立验收判不通过（B1 blocker + P1/P2 + V1/C1），Lead 已按下列方式修复并补回归：

| 编号 | 问题 | 修复 |
| --- | --- | --- |
| B1 | `skill_desc_zh(action="plugins")` 实机报 `value is not lossless JSON` | 新增 `toLosslessJson()`（`lib/plugin-admin.js`），在 `list/describe/update` 与 `lib/index.js` 的 `controller.plugins()` 返回边界递归清洗：丢弃 `undefined` 属性、数组 `undefined`→`null`、`NaN/Infinity/-0`→`null`、BigInt→字符串、Date→ISO；补单测（JSON round-trip 无损）与 e2e A1.7/A3.6 |
| P1 | 两个并发 `update()` 都进入安装（`INSTALL_CALLS_BEFORE_RELEASE=2`） | 单飞预约提前到首个 `await` 之前同步完成（`reservation.token`）；`finally` 按 token 幂等释放；补单测「并发调用只安装一次」 |
| P2 | 两个并发 `POST /plugins/action` 都执行（`CHECK_CALLS_BEFORE_RELEASE=2`） | `lib/http-api.js` 新增 `takePluginBusy()/releasePluginBusy()`：在解析 body 等首个 `await` 前同步占位并携带 token，所有分支 `finally` 释放；补 T20 并发测试 |
| V1 | `scripts/verify.mjs` 把 `lib/plugin-admin.js:43` 的字符串辅助 `truncate()` 误判为 `fs.truncate` 删除 | 辅助函数改名 `clipText()`（行为不变），扫描恢复 0 命中 |
| C1 | 客户端「检查更新」走 GET 而非 `POST {action:"check"}`，`api.checkPlugins` 未使用 | 新增页面 `checkUpdates()` 调用 `api.checkPlugins({})`；「刷新」仍走 GET（可走缓存），语义分开 |

修复后本地证据（Lead 复跑，2026-10-22 13:2x）：

- `npm test`：**157/157**（plugin-admin 22、http-api 19、client 7、tool 8）
- `npm run check:client`：14 项 / 209 键
- `npm run e2e:plugin-admin`：**21/21**（新增 A1.7、A3.6 无损 JSON 断言）
- `npm run e2e:commands`：10/10；`npm run e2e:agent-layer`：7/7
- `node --check lib/*.js scripts/*.mjs test/*.mjs client.js`：0 失败
- `node scripts/verify.mjs --expect-installed --expect-applied`：通过，删除痕迹 0

注意：当前运行的 DSH（12:28 启动）加载的是修复前的 0.4.0，**必须重启 DSH** 才能加载修复后的宿主代码；客户端页面同理。
