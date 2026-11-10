# 最终验收报告（用户版）：描述汉化插件

- 日期：2026-11-10
- 结论：**v0.8.0 源码级验收通过（ready-for-restart）**。本轮做三件事：把 Better Skill 的入口从设置页/插件页 Tab 迁到**左侧栏面板图标行**（「插件」之上）；把「插件索引」从只读升级为**可直接安装/更新**；给技能管理新增**技能索引**（搜索并安装 SkillHub 技能）。源码级 252/252 单测、`check:client` 18/18、四套 e2e 全绿；真实侧栏渲染、真实索引网络与真实安装仍需重启后人工确认。
- 插件：`dsh-skill-desc-zh@0.8.0`（本地源码 `~/dsh-plugins/skill-desc-zh`；profile 以 `link:` 指向）
- 宿主：DeepSeek Harness Desktop `0.2.2-rc.1`，profile `desktop`
- 详细证据：`docs/verification.md` 的 v0.8.0 节；使用说明：`README.md`；计划：`docs/v0.8.0-plan.md`

> **当前运行中的 DSH 进程仍是重启前的旧代码**：源码包已是 0.8.0，但侧栏入口、可安装插件索引、技能索引与全部客户端改动要等重启后才会加载。本报告不把它们写成“已重启验证”。

---

## 1. v0.8.0 做了什么

### 1.1 入口：设置页/插件页 → 左侧栏面板行

- 新入口：**左侧栏面板图标行 →「Better Skill」**（`sidebar.panellist`，id `skill-desc-zh`，order -10，位于「插件」之上）。
- 主区域：`main` key `skill-desc-zh`，整页包在 `.sdzh-panel-root` 内，自带滚动与内边距。
- 不再注册 `settings.section` 与 `plugins.tab`；`PAGE_ORDER`、`BetterSkillIcon` 等旧代码删除，避免重复入口。
- 图标：自绘「译」字方块（`{size, active}` props），随主题色与激活态变化。

### 1.2 插件索引：只读 → 可安装

- 插件管理 Tab 内「已安装 | 插件索引」二级切换保留。
- 索引仍来自宿主「设置 → 插件 → 发现」已配置的源；本页**不新增/删除索引源**。
- 对 `not-installed` / `update-available` / `different-version` 且带 `install.spec` 的条目，显示“安装 / 更新 / 切换版本”按钮：
  - 页面 → `POST /plugins/skill-desc-zh/market/install`（认证路由、JSON、64 KiB 限额、单飞 409）。
  - Host → `pluginManager.installBundle(spec, { registry })`，保留宿主兼容性闸门、`pending-builds` 批准流程与 `restart-required` 语义。
  - 失败按宿主返回的 `error.code` 原样提示，不把失败说成成功。

### 1.3 技能索引：SkillHub 搜索 + 安装

- 技能管理 Tab 顶部新增「本地技能 | 技能索引」切换。
- 搜索：`GET https://api.skillhub.cn/api/skills?page=&pageSize=&keyword=`，展示名称/描述/下载量/安装量/作者，分页与失败重试。
- 安装：`GET /api/v1/skills/<slug>/files` → 逐个 `GET /api/v1/skills/<slug>/file?path=` 下载，校验字节数 + sha256、拒绝越界路径、单文件 ≤2MB、总量 ≤6MB、文件数 ≤64。
- 落盘：写入 `$DSH_HOME/skills/<slug>`（临时目录原子替换）；已存在时返回 `already-installed`，勾选覆盖安装才先把旧目录移入废纸篓；`SKILL.md` 的 `name` 必须等于 slug。
- 边界：只安装技能文件，不执行来源脚本；SkillHub 不可达时只影响该子页。

## 2. 本轮修复与加固

| 项 | 说明 |
| --- | --- |
| 路由补齐 | `lib/http-api.js` 的 dispatch 曾漏挂 5 条新路由（market sources/search/install、skill-index search/install），已补齐；`test/http-api.test.mjs` 新增 T20/T21 覆盖参数透传、503、400/405 |
| 结果归一化 | 插件安装结果经 `toLosslessJson` 归一化，避免宿主 `snapshotJsonValue` 因 `undefined`/非法值拒绝工具输出 |
| 单飞 | `pluginManager.installBundle` 与本插件 HTTP 动作共用单飞：进行中再次请求返回 `busy`/409，不重复安装 |
| 安全校验 | 技能索引下载校验 sha256/size/路径/限额；安装前临时目录、失败清理；覆盖前废纸篓留档 |
| 启动安全 | 客户端仍 `inject: ['slots','locale']`、无 `immediately`、`apply` 外层 try/catch；`ctx.remote` 惰性访问，服务缺失时索引页降级 |

## 3. 验收证据（源码级）

- `npm test`：**252/252**（新增 `test/plugin-index.test.mjs` 9 个、`test/skill-hub.test.mjs` 10 个、http-api T20/T21、client 29 个）
- `npm run check:client`：**18/18**，locale **370** keys，禁止旧 `settings.section`/`plugins.tab` 注册
- `npm run e2e:skills`：**32/32**；`npm run e2e:plugin-admin`：**21/21**；`e2e:commands`：**10/10**；`e2e:agent-layer`：**7/7**
- `node --check`：lib/client/scripts 全部通过
- 未安装/升级/重启 profile；profile 仍为 `link:` 指向源码

## 4. 重启后人工验收清单

1. 左侧栏面板图标行出现「Better Skill」，位于「插件」之上；设置页不再有独立入口。
2. 主区域打开三内层 Tab，默认「描述汉化」；Tab 记忆、键盘 `←/→/Home/End`、ARIA 正常。
3. 描述汉化：状态可读，应用/还原与 `skill_desc_zh` 一致。
4. 插件管理：列表/检查更新正常；插件索引源来自「设置 → 插件 → 发现」，搜索/分页/状态/兼容性正常。
5. 对一条 `update-available` 点“更新”：确认走宿主安装；`restart-required`/`pending-builds` 提示正确。
6. 技能管理：本地技能增删改查正常；删除进废纸篓、恢复不覆盖。
7. 技能索引：搜索 SkillHub，安装一个新技能到 `$DSH_HOME/skills`；重复安装提示 `already-installed`，覆盖安装前旧目录进废纸篓。
8. 断网/服务缺失：索引页降级提示，其余功能不受影响；客户端加载失败不拖垮主界面。

## 5. 已知限制与回滚

- 索引源的增删/排序只在宿主「设置 → 插件 → 发现」管理；本插件只读源列表。
- 插件索引安装仍受宿主兼容性闸门、隔离期与构建脚本批准约束；本插件不绕过、不代批。
- SkillHub 可用性取决于网络；技能来源与许可请以 SkillHub 页面为准。
- 回滚：`plugin_manager set_bundle dsh-skill-desc-zh enabled=false` 或 `git revert` 提交；索引安装失败不影响本地已装插件与技能。

> 本次未执行安装/升级/重启；以上“通过”均为源码、单测、真实模块探针与 e2e 级证据，真实 GUI 与真实网络行为待重启后确认。
