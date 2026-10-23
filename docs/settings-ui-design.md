# skill-desc-zh v0.3.0 设计：设置页（Client 半）

> 状态：**设计稿**。本文件是 t13 的唯一交付物；本轮未修改 `lib/`、未新增 `client.js`、未改 `package.json`、未安装任何东西、未重启 DSH。
> 目标版本：`0.3.0`。前置版本：`0.2.1`（host 半 + 工具 `skill_desc_zh`，已以 `link:` 装入 desktop profile，bundle row `id=skill-desc-zh`）。
> 读者：t14（host 桥接）、t15（client UI）与 captain。文中所有结论都带 `file:line` 证据；**未实测**的项在 §9 单列。

---

## 0. 结论速览

1. **入口可行且只有一条正路**：DSH 设置弹窗由 `@deepseek-ai/dsh-client-ui-settings-general` 全权提供，它把 `settings.section` 声明为 `sidebar.settings` 的子槽（`kind:'list', scope:'root'`，`/tmp/dsh-client-ui-settings-general.js:1249-1258`）；插件按 `ctx.slots.inject("settings.section", () => ctx.slots.register({name, id, order, label, locale}, Component))` 注册即得到「设置左侧一级页面」，宿主负责导航行、选中态与渲染（`:1136-1160`、`:337`）。**没有第二套注册入口**，也不需要改宿主。
2. **Client 半清单**：`package.json` 必须有 `exports["./client"]` + `dsh.client.platform === "web"`；bundle 必须 `window.__ModuleLoader__.load({id, factory(require){…}})` 且 `id` **等于包名**；React 由 `require('react')` 取自平台基线表。缺任一项的表现与报错原文见 §2.2。
3. **必须重启一次**：新增 `client.js` 与 `package.json` 字段属于「包元数据变化」，Host 半只在这些时机扫描并**永久缓存**（含负结论），HMR 也检测不到 `package.json` 变化；重启后 `client.js` 内容变化才走 500ms 轮询 + SSE 的页内热替换，不需要刷新页面。矩阵见 §2.2.6。
4. **通道选 HTTP 认证路由**：`GET /plugins/skill-desc-zh/state|doctor`、`POST /plugins/skill-desc-zh/action`，用与 `dsh-agent-teams` 相同的 `authenticatedWebRoutes(server, () => ctx.get('connection'))` 围栏（裸 `webServer` 路由**不继承**认证）。实测对照：`GET /plugins/dsh-agent-teams/state` → `401 {"error":"unauthorized"}`，`GET /plugins/nonexistent-probe` → `404`。备选（session command + `ctx.remote.commands.execute`）不选，理由见 §3.5。
5. **页面不重写业务**：t14 把现有 `status()` / `doctor()` 的结果原样暴露，并**新增一个附加字段** `status.targets[]`（结构化覆盖清单：技能 12 + 命令 3），UI 只做渲染；工具与页面共用同一个 controller，写入路径统一走 `runExclusive`。
6. **UI 规格**：9 个区块（页头/状态摘要/开关与操作/覆盖清单/自检/事件/配置/警告限制/页脚）、5 个页面状态（loading/ready/busy/degraded/error）叠加 5 个业务相位（booting/active/degraded/stale/restored，另有 failed）；覆盖清单 15 行（8 office/provider + 4 agent-preset/影子 + 3 命令/agent 层）。
7. **轮询**：页面挂载且 `document.visibilityState === 'visible'` 时 5s 一次；隐藏或卸载立即停；动作成功后用响应内联的 `status` 直接刷新，不发第二次请求；连续失败指数退避（5→10→20→30s 封顶）。
8. **失败隔离**：slot 渲染器按 entry 捕获异常（`slot entry crashed in '<slot>':`），页面崩了只会让这一页空白；host 半、工具、技能/命令描述机制完全不受影响。
9. **改动面**：新增 `lib/http-api.js`（约 260 行）+ `client.js`（约 600 行）+ `locale/{zh,en}.json` + `icon.svg`；`lib/index.js` 接线约 10 行、`status()` 增加 `targets`/`api` 两个附加字段（向后兼容）；`package.json` 版本 → 0.3.0 并加 4 个字段。
10. **未验证项**已如实列出（§9）：真实浏览器 200/页面渲染、desktop Electron 窗口内的 cookie 行为、中文标签在导航行切换语言时的实际重渲染、与三方页面 order 并列时的最终顺序。

---

## 1. 目标 / 非目标 / 硬约束

### 1.1 目标（来自任务 m00962 与用户 m02721）

用户原话：「把翻译功能做成插件安装到设置页面中」。范围 = **完整设置页**，入口 = **设置左侧一级页面**。

页面必须做到：

| # | 能力 | 说明 |
|---|------|------|
| G1 | 实时状态 | phase、技能中文 x/12、命令 3/3、宿主版本、项目根、warnings |
| G2 | 开关 | 启用/停用，语义分别映射 `apply` / `restore` |
| G3 | 五个动作 | 应用/重新应用、还原原文、刷新/重译、重新翻译（force）、自检 |
| G4 | 逐条覆盖清单 | 15 行：中文/英文、engine、stale、影子路径、当前层 |
| G5 | 自检呈现 | `doctor()` 的 checks（✓/✗ + mandatory）与 limitations |
| G6 | 只读配置 | targets、projectAllowlist、restoreOnQuit、模型、state/events 文件路径 |
| G7 | 失败降级 | client 加载/渲染失败不影响 host 半与工具；页面本身给出可读错误 |
| G8 | 可访问 + 双语 | `role="switch"` + `aria-checked`、键盘可达、zh/en 两套文案、跟随宿主语言 |

### 1.2 非目标

- 不做插件市场、不做任意配置编辑（配置只读展示）；首版不提供「修改 targets/模型」的表单（写入配置需要改 cordis patch，风险高，留作 v0.4）。
- 不替换宿主设置弹窗，不改 `settings.section` 之外的任何槽。
- 不新增斜杠命令，不改技能/命令描述机制本身（v0.1/v0.2 已冻结）。
- 不引入构建步骤：`client.js` 为纯 JS（`window.__ModuleLoader__`），无 bundler、无 TS。
- 不改任何三方插件（billion-context / dsh-agent-teams / dsh-better-sidebar / dsh-our-free-model 只作为参考实现）。

### 1.3 硬约束（`~/.dsh/AGENTS.md` + 技能规范）

1. **禁止永久删除**：删除/清理一律走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs <path>…`（`--dry-run`、`--snapshot`；退出码 0/1/2；日志 `~/.dsh/.trash-log.jsonl`）。覆盖已有文件前先 `trash.mjs --snapshot <file>` 留档。**本设计里所有「回滚/移除」动作都按此执行**（§7）。
2. **装/升插件前先预检**：`node ~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs <目标> --profile desktop`（退出码 0 干净 / 2 仅警告 / 1 阻塞）。本任务不安装；t16 若需重装/升级必须重新跑。
3. **UI 规范**（`cordis-plugin-development` 技能 references）：只渲染在 slot 内、禁止 iframe；样式只用 `--dsw-alias-*` token，禁止硬编码颜色；不 `require` Harness Client 包（`dsh-client-ui-primitives` 等）；文案走 `ctx.locale`；开关用 `role="switch"` + `aria-checked`；light/dark 都要检查。
4. **失败隔离**：客户端半不得影响 host 半与 `skill_desc_zh` 工具。
5. **证据诚实**：未实测的写「未验证」，不把代码推断说成已运行结果。

---

## 2. 调研证据（六问逐条）

### 2.1 ① `settings.section` 槽位契约

#### 2.1.1 声明（谁创建这个槽）

设置弹窗整体由 `@deepseek-ai/dsh-client-ui-settings-general/lib/client.js` 注册为 `sidebar.settings` 单槽（`:1180-1273`），其 `children` 里声明了 `settings.section`：

```js
// /tmp/dsh-client-ui-settings-general.js:1258-1261（= app.asar 内同名文件）
"settings.section": {
        kind: "list",
        scope: "root"
},
```

同级的还有 `settings.launcher|trigger|header|action|close|onboarding`。**结论**：`settings.section` 是 `sidebar.settings`（设置弹窗）的子 list 槽，`scope: root`，只在弹窗挂载期间存在。

#### 2.1.2 注册参数

宿主自己的「通用」页（`:1293-1302`）就是最小范例：

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "general",
        order: 0,
        label: () => t("general.nav"),
        locale: NS,
        children: { "settings.general.item": { kind: "list", scope: "root" } }
}, GeneralSection));
```

| 参数 | 必填 | 语义 | 证据 |
|------|------|------|------|
| `name` | 是 | 必须是 `"settings.section"` | 同上 |
| `id` | **是**（list 槽） | 导航项稳定标识，也是 `entries` 去重键；同 priority 下同 id 重复注册直接抛错 | `/tmp/shell.js` SlotCore `register`：`list slot "<name>" requires options.id`、`list slot "<name>" already has an entry with id "<id>"` |
| `order` | 否 | 导航行排序键；SlotCore 先按 `priority` 再按 `order` 升序，设置壳再按 `order` 排序生成导航行。缺省 0 | `/tmp/shell.js` SlotCore；`:1145-1152` |
| `label` | 否 | 导航文字，**可以是 thunk**：`resolveSlotLabel = e => typeof e === "function" ? e() : e`；缺省渲染为空串 | `/tmp/shell.js`（`resolveSlotLabel`） |
| `locale` | 否 | 命名空间 id。声明后渲染器注入 `props.t`；**若声明了但客户端没装 locale 服务，会抛** `SlotAssemblyError: entry declares locale namespace '<ns>' but no locale face is installed (locale plugin missing from the composition?)` | `/tmp/ui-renderer.js:742-745` |
| `children` | 否 | 本页内可再声明的子槽（我们不需要） | 宿主 general 页 |
| 组件 | 是 | React 组件（函数），渲染在 page 区 | `:337` |

#### 2.1.3 导航行为

`:1136-1160` 把 entries 映射成导航行：

```js
ctx.slots.entries("settings.section")
  .map((entry) => ({ id: entry.options.id ?? "", order: entry.options.order ?? 0, label: resolveSlotLabel(entry.options.label) ?? "" }))
  .sort((a, b) => a.order - b.order);
```

并同时订阅 `ctx.slots` 版本与 `ctx.locale` revision（`getSnapshot().revision`）⇒ 新增页面、切语言都会重算导航行；`label` 用 thunk 才能吃到最新 `t`。

现有 order 一览（决定我们插在哪）：账号 `-10`（`dsh-client-ui-settings-account/lib/client.js:4774-4781`）、通用 `0`、模型 `10`（`settings-models .../client.js:4486-4490`）、插件 `15`（`settings-plugins .../client.js:201-206`）、Agent 预设 `20`（`settings-agent-presets .../client.js:2456-2460`）。**本插件取 `order: 16`**（紧跟在「插件」之后，语义最近）。

#### 2.1.4 ownerProps 与组件可用能力

`SettingsPanel` 渲染选中页（`:337`）：

```js
renderSlot("settings.section", { close: onClose }, { only: active });
```

- `ownerProps = { close }`，与 scope 注入 props 合并后传给页面组件 ⇒ 组件可从 props 拿 `close`（关闭弹窗）。
- `only: active` ⇒ **只有选中的那一页被挂载**；没有隐藏的常驻页。这意味着「页面打开才轮询」是天然成立的，关闭弹窗即卸载、即停轮询（组件 `useEffect` 清理）。
- 渲染器按需注入：`t`（有 `locale` 时）、`renderSlot`（声明了 children 时）、`useStore/actions`（声明了 store 时）；plain JS 组件可以直接用 `props.t`、`props.close`。`standardKit` 见 `/tmp/ui-renderer.js:736-760`；`localeSeat` 按 `(face, ns, revision)` 缓存并在 revision 变化时换引用（`:542-560`），保证 memo 组件在切语言后重渲染。
- **图标不可定制**：左侧导航行的图标由宿主 `navIcon(id)` 决定，只认 `account|models|agent-presets|plugins|archived-sessions` 五个 id，其余一律 `IconSettingsOutlineMedium size=16`（`:244-270`）。`./icon` 只用于插件清单/详情展示（§2.2.2）。
- **尺寸约束**：设置面板固定 `width: 800px; height: min(800px, 100vh-48px)`，左侧导航 188px，页面容器 `.options` 有 `padding: 0 24px 24px` 且自身纵向滚动（`:60` 的 CSS 常量、`:327-334` 结构）⇒ 页面可用宽度约 **564px**；导航 label 是 `white-space: nowrap; text-overflow: ellipsis`（`.Dws9Sa_navLabel`）⇒ 名称要短。
- **样式上下文**：页面渲染在设置弹窗的 `.options` 滚动容器内（`.Dws9Sa_options{flex:1;min-height:0;padding:0 24px 24px;overflow-y:auto}`，`:327-334`），宽度由容器决定；不要假设全屏，不要 `position: fixed` 覆盖导航。

#### 2.1.5 失败与边界

- entry 组件抛错由渲染器捕获：`console.error("slot entry crashed in '<slot>':", error)`，**只有该 entry 空白**，其他页面与宿主不受影响（`/tmp/ui-renderer.js` 错误边界）。这是 G7 的天然保障，我们仍要做自己的 React error boundary 以获得可读错误。
- 槽只存在于设置弹窗挂载期间：`ctx.slots.inject("settings.section", …)` 是标准写法（等待父槽声明后再注册），宿主 general 页与三方插件都用它。
- **纯 JS 客户端不需要 `store`**：轮询结果放组件 state 即可；`store` 只解决跨 slot 共享。

### 2.2 ② Client 半清单与加载

#### 2.2.1 package.json 必需字段（最小可用）

```json
{
  "name": "dsh-skill-desc-zh",
  "version": "0.3.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json",
    "./icon": "./icon.svg",
    "./locale/*.json": "./locale/*.json"
  },
  "files": ["lib", "client.js", "locale", "icon.svg", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  },
  "engines": { "dsh": ">=0.2.1-rc.2" }
}
```

- `exports["./client"]` **必须解析到文件**（字符串或 `{default}` 均可）；缺失且声明了 `dsh.client` 时 Host 抛：`client-modules: <pkg> declares dsh.client but exports no "./client" bundle`（`client-modules/lib/index.js:738`）。
- `dsh.client.platform` 必须是字符串且等于 `"web"`，否则**静默忽略**（`client-modules/lib/index.js:66`、`:733-737`）。
- `dsh.client` 其它字段：`immediately: boolean`（预取优先级）、`inject: string[]`（客户端条目 id 数组，声明加载/激活先后；**不是 cordis 服务注入**）、`external: string[]`（声明非基线模块名，供打包器使用）。**本插件只需 `platform`**。
- 清单元数据（`meta.title`/`description`/`icon`）由 Plugin Manager 与 Settings **在不激活插件的情况下**直接读取 exports 资源（`references/host-plugin.md:29-53`），因此写错不会影响页面，但会影响插件清单的展示。
- 现有 `dsh.bundle.patch` 保持不动；**不要**为了 client 改 `main`/`type`。

#### 2.2.2 显示清单（可选但推荐）

`host-plugin.md` / 平台规范：插件在「设置 → 插件」清单里展示 `meta.title` / `meta.description` 与图标，来源是包内：

- `locale/en.json`、`locale/zh.json` 里的 `{ "meta": { "title": "…", "description": "…" } }`；
- `exports["./icon"]` 指向包内 SVG/PNG/JPEG/WebP，**≤256 KiB**；
- `files` 必须包含 `locale` 与 `icon.svg`（否则发布/打包后丢失）。

注意：**这是插件清单的展示元数据，不是设置页左侧导航的图标**（后者不可定制，见 §2.1.4）。首版建议加上，成本极低。

#### 2.2.3 bundle 文件形态（纯 JS）

```js
// client.js（无构建、无 import 语句）
window.__ModuleLoader__.load({
  id: "dsh-skill-desc-zh",          // 必须 === package.json name
  factory(require) {
    const React = require("react");
    const { useEffect, useMemo, useState } = React;
    // …组件与 apply…
    return module.exports;           // 必须返回 exports 对象
  },
});
```

- `id` 不匹配时报：`client-modules: bundle <url> loaded without registering "<id>" via __ModuleLoader__.load`（`/tmp/cm-client.js:758`、`:874`）⇒ 整个 client 行加载失败（其它行不受影响）。
- 可 `require` 的**平台基线表**（`/tmp/shell.js` 的 `SZ()`）：`react`(18.3.1)、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。**规范禁止** `require` primitives/slots/dockkit 这类 Harness Client 包（会随宿主变化、无类型检查、组件抛错会让 entry 空白）；我们只 `require('react')`。
- factory 必须**无副作用**（除了 `load` 注册本身）；不要在这里发请求、不要改 DOM。
- 插件对象形态（与 billion-context 相同）：`module.exports = { inject: ["slots", "locale"], apply(ctx) { … } }`；`ctx.slots.inject(...)` 注册页面，`ctx.effect(...)` 注册 locale 字典。

#### 2.2.4 宿主如何发现与服务

| 环节 | 行为 | 证据 |
|------|------|------|
| 扫描 | Host 半遍历 **Host Loader 的 entries**（组合里的行），读各包 `package.json`，`parseDshClient` 校验后用包名做 id | `client-modules/lib/index.js:62-77`、`:690-750` |
| 缓存 | 结果按 `sourceUrl` 缓存在 `pkgMeta` 里，**进程内不复核**（负结论也缓存） | 同上 `resolveMeta` |
| 组图 | 生成 `window.__DSH_BOOT__` 图：`{rows:[{id,initialUrl,url,rev}], seeds, baseline}` | 同上 |
| 服务 | `/plugins/<pkg>/client.js?v=<rev>`（单文件）与 `/plugins/??<combo>`（组合）；`<pkg>` 由包名派生 | `client-modules/lib/index.js:205`、`:260`、`:294` |
| 加载 | 浏览器 `kZ()` → `entries.start` → `await loader.await` → 渲染 | `/tmp/shell.js` 偏移 ~913478 / ~918690 |
| 失败 | `arrive()` 对单条重试/回退，最终只让该 entry 报错 | `/tmp/cm-client.js:741-772` |

**结论**：`link:` 安装的 bundle 同样生效——Host 解析 `exports["./client"]` 得到包内真实文件路径后由组合路由直接服务，不经过打包，也没有「必须发布 npm」的限制。

#### 2.2.5 何时需要重启（矩阵）

| 变更 | 是否需要重启 | 依据 |
|------|--------------|------|
| 给已安装包**新增** `client.js` + `package.json` 字段（本次） | **需要，一次** | 包元数据在扫描时缓存且 `package.json` 改动不被 HMR 监听（`dsh-hmr/README.md`） |
| `client.js` 内容变化（已注册后） | 不需要 | client-hmr 每 500ms stat 各行 bundle，变化即 `clientModules.rebuilt(id)` → SSE `/plugins/events` → 浏览器 `entries.reload(id, rev)` 页内替换（`dsh-client-hmr/lib/index.js:22,50,96`；`/tmp/cm-client.js:272,431`） |
| 新增一个**全新包**且首次安装就带 `dsh.client` | 预计不需要（未实测） | 安装走 `hmr.reconcileProfile`，新行进入 Loader 后 Host 半重新扫描；**本任务不是这条路径**（我们是给已装包补 client 半），不要拿它当依据 |
| 删除 `exports["./client"]` 或 `dsh.client` | 需要 | 负结论缓存 |
| 改 `dsh.client.platform/immediately/inject` | 需要 | 同上 |

#### 2.2.6 字体 / 图标 / 图片资源

- **不要自带字体**：继承宿主 `--dsw-font-family` 即可（体积与一致性都更好）。
- 页面内图标：**内联 SVG**（直接写在组件里，`stroke="currentColor"` 继承文字色）。
- 清单图标：`icon.svg` 放包根，`exports["./icon"]` 暴露，≤256 KiB；必须是包内文件（`host-plugin.md` 校验）。
- 不要把图片放进 `lib/`（`files` 已含 `lib`，但语义混乱）；若要位图，新增 `assets/` 并加入 `files`。

### 2.3 ③ Host↔Client 通道选型

#### 2.3.1 `webServer` 服务

`@deepseek-ai/dsh-host-webserver/lib/index.js`：

- `:287 super(ctx, "webServer")`；
- `:327 register(route)`：`route = {kind:"exact"|"prefix", path, handler(req,res)}`，返回移除函数；重复注册抛 `webserver: duplicate <kind> route "<path>"`；
- `:341 registerUpgrade`、`:356 registerFallback`（单 owner，不用）。

**关键**：裸注册的路由**不继承任何认证**——`connection` 的围栏必须自己套。

#### 2.3.2 `connection` 服务（认证围栏）

`@deepseek-ai/dsh-client-connection/lib/index.js`：

- `:737 requestRejection(request)`：先 `admit`，`isTrusted` 失败 → `403`；未认证 → `401`；
- `:743 admit(request)`：`isTrusted(request)` → 403；`browserAuth.isAuthenticated(request, secure)` 或 `authenticateApi(...)` 成功 → peer；
- `:240-264 isTrustedApiRequest`：Host 必须 loopback / trustedHosts / bind 地址；`sec-fetch-site === "cross-site"` 直接拒；`Origin` 存在时必须与 Host 同 authority。

#### 2.3.3 参考实现（nanzmicoder/dsh-agent-teams）

`~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/web-routes.js`：

```js
// :3-30 readJsonRequest：限制字节数，413 / 400
// :41-70 authenticatedWebRoutes(rawWebServer, () => ctx.get('connection'))
//   无 connection → 503；requestRejection → JSON {error:"unauthorized"|"forbidden"}
```

`lib/index.js`：

- `:170-185` 惰性注册：`ctx.get('webServer') ?? ctx.get('httpServer')` 存在才注册，并在 `internal/service` 事件后重试；
- `:200-215` `register({kind:'exact', path:'/plugins/dsh-agent-teams/state', handler})`、`/halt` POST（405 + `Allow`，JSON body，409 冲突）；
- `:458-463` `ctx.on('internal/service', …)`。

#### 2.3.4 实测对照（本机，未登录）

| 请求 | 响应 |
|------|------|
| `GET /plugins/dsh-agent-teams/state` | `401 {"error":"unauthorized"}` |
| `GET /plugins/skill-desc-zh/state`（当前未实现） | `404` |
| `GET /plugins/nonexistent-probe` | `404` |

⇒ 路由表先过围栏再匹配；我们的路由未实现时是 404，实现后未认证是 401（可作为 t16 的验收探针）。

#### 2.3.5 备选对比与结论

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. HTTP 认证路由（选定）** | 与三方插件同构、可 GET 轮询、不污染会话日志、全局状态天然适配、实测围栏可用 | 需自己套认证、需处理 CSRF/方法/体积 | ✅ 选 A |
| B. session command + `ctx.remote.commands.execute` | 走宿主类型化 RPC、无需 HTTP | 需要活跃 session；每次动作会在会话里留下 `command/run|done` 记录（设置页操作被记进对话）；轮询状态还得再想办法（命令只能「执行」不能「查询」，要额外做只读命令并解析文本） | ✗ |
| C. `plugins.bundle.config` slot | 官方配置表单 | 只能编辑 `cordis.patch.yml` 里的配置字段，无法承载状态/动作/清单 | ✗ |
| D. `wire.view` 类型化视图 | 类型安全 | 需要 Host FaceModel + 生成客户端绑定，工程量大；且状态是插件全局而非会话投影 | ✗ |

> **技能规范的分歧点**：`user-actions.md` 建议「一次实现、两个调用者」，并举例用 session command 做 client 入口。我们保留「一次实现」（controller 方法同时服务工具与 HTTP），但选择 HTTP 作为 UI 入口，理由：设置页是**全局**状态、动作不应写入会话日志、GET 轮询无命令等价物。此分歧已记录在 §9.4。

#### 2.3.6 安全设计

| 面 | 措施 |
|----|------|
| 认证 | 全部路由套 `authenticatedWebRoutes`（403/401 由 `connection` 决定） |
| CSRF | 仅接受 `Content-Type: application/json` 的 POST；`Origin` 必须同 authority（宿主已做）；不使用 GET 做副作用 |
| 输入 | action 白名单；`names` 最多 64 个、每项 kebab-case ≤64 字符；`projectRoot` 必须绝对路径；body ≤64 KiB（413） |
| 输出 | `Cache-Control: no-store`；错误只回 `{error, message}`，不回堆栈/绝对路径（除非 `doctor` 本来就会展示路径——那属于本机可信 UI） |
| 删除 | HTTP API **不提供删除**能力；还原只把影子移入废纸篓（`trash.mjs`） |
| 并发 | 单飞（409）；所有写操作走 `controller.runExclusive` |
| 生命周期 | 路由随插件 dispose 移除（`register` 返回的 disposer），不泄漏 |

### 2.4 ④ 主题 token / 样式约束

`dsh-web-frontend/dist/assets/index-BxpfOGf3.css` 实测 55 个 `--dsw-alias-*`，常用：

```
背景  --dsw-alias-bg-base / bg-layer-1..4 / bg-mask-1
边框  --dsw-alias-border-l1..l4（l1 最弱）/ border-l2-darkmode-thin
文字  --dsw-alias-label-primary / secondary / tertiary / dimmed / caption / error / primary-foreground
品牌  --dsw-alias-brand-primary
交互  --dsw-alias-interactive-bg-hover / interactive-bg-active / interactive-bg-hover-danger
状态  --dsw-alias-state-success-primary / state-warn-primary / state-warn-label / state-error-primary
控件  --dsw-alias-switch-thumb（宿主没有 track-on/off token；轨道用 border/bg token 自绘）
其它  --dsw-alias-link / menu-icon / tooltip-bg / tooltip-key-bg / markdown-inline-code / markdown-code-block / toast-bg / toast-label
字体  --dsw-font-family
圆角  --dsw-radius-xs|sm|md|lg|panel
```

深色主题用 `[data-ds-dark-theme]` 选择器切换 ⇒ **只写 token，不写死颜色**，深色自动适配。禁止全局选择器（`body`、`*`）；组件内联 style 或注入 `<style>` 时所有类名加前缀 `.sdzh-`。

### 2.5 ⑤ 现有 host 半可复用能力（t14 的输入）

| controller 方法/字段 | 位置 | 用途 |
|---|---|---|
| `status(args, exec)` | `lib/index.js:1513` | 页面主数据源 |
| `doctor(args, exec)` | `:1675` | 自检 checks |
| `apply(args, exec)` | `:1367` | 应用/重新应用 |
| `restore(args, exec)` | `:1434` | 还原英文（含命令层 dispose） |
| `retranslate(args, exec)` | `:1392` | 强制重译（LLM 或词典） |
| `refresh(args, exec)` | `:1413` | 廉价补齐（stale/缺失） |
| `commandsStatus()` | `:530` | 命令层快照 |
| `commandCheck()` | `:564` | 命令层自检 |
| `runExclusive(task)` | `:658` | 串行化写操作 |
| `resolveCwd(exec)` | `:610` | cwd 解析（settings 页无 exec，需新增解析，见 §3.4） |
| `state` / `stateStore` | `:1998-2025` / `lib/state.js:13` | 状态读取 |
| `events` | `lib/events.js` | 最近事件 |
| `computePhase(...)` | `:61` | 相位判定规则 |

`status()` 现有返回（`:1652-1673`）：`{ok, action:'status', summary, enabled, restored, ready, phase, phaseReason, hostVersion, projectRoot, projectAllowed:{allowed,reason}, stateFile, eventsFile, counts:{zh,total}, commands, agentLayer, details[], limitations[], warnings[]}`。
`doctor()` 返回：`{ok, action:'doctor', summary, checks:[{key, ok, detail, mandatory}], limitations, details, warnings, hostVersion, projectRoot}`（`:1773-1784`）。
相位集合：`booting | active | degraded | stale | restored | failed`（`computePhase`，`:61-81`）。
事件读取：`lib/events.js` 的 `read(limit)`（`events.read` 已在 controller 暴露面里）。

---

## 3. 架构设计

### 3.1 组件图

```
┌──────────────────────────── 浏览器（Web GUI） ────────────────────────────┐
│ 设置弹窗（宿主 dsh-client-ui-settings-general）                            │
│  ├─ 导航行：settings.section entries（order 排序，我们 order=16）          │
│  └─ 选中页：<SkillDescZhPage>  ← 本插件 client.js                          │
│        ├─ usePoll：5s 可见性轮询 GET state                                 │
│        ├─ 动作按钮 → POST action（同一路由，JSON）                          │
│        └─ 渲染：摘要 / 开关 / 清单 / 自检 / 事件 / 配置 / 警告              │
└───────────────────────────────┬────────────────────────────────────────────┘
                    fetch（同源，cookie 由宿主 browser-auth 管）
┌───────────────────────────────▼────────────────────────────────────────────┐
│ Host（desktop profile 主进程）                                              │
│  connection.requestRejection（403/401 围栏）                               │
│  webServer /plugins/skill-desc-zh/{state,doctor,action}                    │
│  lib/http-api.js  ── 认证包装、体解析、action 白名单、projectRoot 解析      │
│         │                                                                   │
│         ▼                                                                   │
│  controller（lib/index.js，单例）  ←── 工具 skill_desc_zh（同一实现）       │
│    runExclusive / status / doctor / apply / restore / retranslate / refresh │
│         │                                                                   │
│         ├─ state（$DSH_HOME/.skill-desc-zh/state.json，v2 schema）          │
│         ├─ events（$DSH_HOME/.skill-desc-zh/events.jsonl）                  │
│         ├─ skills 服务（L1 provider + L2 影子 + agent 层命令影子）          │
│         └─ trash.mjs（所有删除/还原）                                       │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流

1. 页面挂载 → `GET /plugins/skill-desc-zh/state?projectRoot=<可选>`。
2. Host 校验认证 → 解析 projectRoot（§3.4）→ `await controller.status({projectRoot})` → 返回 `{ok, state, busy, lastAction, serverTime, plugin}`。
3. UI 渲染；之后每 5s 重复（可见时）。
4. 用户点按钮 → `POST /action` `{action, names?, projectRoot?, dryRun?, force?}`。
5. Host 置 `busy` → `runExclusive(controller[action])` → 完成后在同一响应里附带最新 `status()`（避免二次往返）。
6. 页面用响应里的 `state` 覆盖本地（`serverTime` 单调保证不回退），清理 busy。
7. 失败：返回 `{ok:false, error:{code,message}, busy}`；页面显示错误条 + 用 GET 再校准一次。

### 3.3 HTTP 契约

前缀：`/plugins/skill-desc-zh`。所有响应 `Content-Type: application/json; charset=utf-8`、`Cache-Control: no-store`。

#### 3.3.1 `GET /state?projectRoot=<abs>`

```json
{
  "ok": true,
  "plugin": { "name": "dsh-skill-desc-zh", "version": "0.3.0" },
  "serverTime": 1761123456789,
  "busy": null,
  "lastAction": { "action": "apply", "ok": true, "at": 1761123000000 },
  "state": { "...": "controller.status() 原样返回，另加 targets 与 api 字段" }
}
```

`state.targets[]`（t14 新增，附加向后兼容）：

```json
{
  "id": "skill:office",
  "kind": "skill",              // skill | command
  "layer": "global",            // global（L1 provider）| preset（L2 项目影子）| agent（命令影子）
  "name": "office",
  "current": "zh",              // zh | en | pending | missing
  "engine": "dictionary",       // llm | dictionary | source | none
  "stale": false,
  "missing": false,
  "sourcePath": "/Applications/…/office/SKILL.md",
  "shadowPath": null,           // L2 才有
  "rank": 600,
  "note": null
}
```

> 现有 `details[]` 是半结构化中文行（技能行 `:1589-1593`、命令行 `:1604-1607`），适合 README/日志，不适合表格；`targets[]` 为 UI 而加。t14 必须保证 `targets` 与 `details` 同源，禁止两套判断。

#### 3.3.2 `GET /doctor?projectRoot=<abs>`

`{ ok:true, serverTime, doctor: { …doctor() 原样… } }`

#### 3.3.3 `POST /action`

请求：

```json
{ "action": "apply", "names": ["office"], "projectRoot": "~/work/x", "dryRun": false, "force": false }
```

- `action` ∈ `apply|restore|retranslate|refresh|doctor`（`status` 只读，走 GET）。
- `names` 可选，≤64 项，kebab-case；缺省 = 全部。
- `dryRun` 仅 `restore` 支持（现有语义，`:1434`）。
- `force` 仅 `retranslate` 有意义（默认 true）。

响应：`{ ok:true, action, result:<controller 返回>, state:<最新 status()>, serverTime }`。

#### 3.3.4 错误码

| HTTP | code | 触发 |
|------|------|------|
| 400 | `bad-request` | JSON 解析失败 / action 不合法 / names 非法 / projectRoot 非绝对路径 |
| 401 | — | 未认证（由 connection 围栏产生，`{"error":"unauthorized"}`） |
| 403 | — | Host/Origin 不可信（`{"error":"forbidden"}`） |
| 404 | — | 路径不匹配 |
| 405 | `method-not-allowed` | 方法错误，响应头带 `Allow` |
| 409 | `busy` | 已有动作在跑，附 `{busy:{action,startedAt}}` |
| 413 | `payload-too-large` | body > 64 KiB |
| 500 | `internal` | 未捕获异常（日志留堆栈，响应不含） |
| 503 | `unavailable` | `connection` / `webServer` 服务缺失（宿主启动早期） |
| 504 | `timeout` | 动作超过 180s（动作继续在后台跑，下次 GET 会看到最终状态） |

#### 3.3.5 超时与并发

- 服务端 `Promise.race(action, 180s)`；超时不清空 `busy`（后台继续），只在响应里标明。
- 单飞：`busy` 非空时新写请求立即 409（不排队，避免用户以为没点到而狂点）。
- 只读 GET 不阻塞。

### 3.4 `projectRoot` 解析链（settings 页没有 `exec`）

`resolveCwd(exec)`（`:610`）依赖 `exec.agent.session`，设置页没有。`lib/http-api.js` 提供 `resolveRequestProjectRoot`，顺序：

1. 请求显式 `projectRoot`（绝对路径；不存在 → 400）。
2. `state.projects` 里 `updatedAt` 最新、且目录仍存在的 root。
3. 最近活跃会话的 cwd：`agents.list()` 中 `updatedAt` 最新的 agent，取 `workingDirectory.get(agent.session)`（与 `ensureShadowsForKnownSessions`（`:1488`）同一数据源）。
4. `process.cwd()`。

返回值同时带 `projectRootSource`（`explicit|state|session|cwd`），UI 显示来源，避免用户误以为页面在管另一个项目。

### 3.5 与工具/命令的关系

- **一个实现**：HTTP 路由与工具 `skill_desc_zh` 都调用同一 controller 方法；不在 `http-api.js` 里复制业务逻辑。
- **写操作串行**：全部经 `controller.runExclusive`（`:658`）。
- **为什么不用 session command**：见 §2.3.5 表格；补充：命令必须有 agent，设置页在无会话（或会话未激活）时也要能用；命令会在会话日志里产生 `command/run`/`command/done`，把「设置页点了一下」变成对话内容；命令只能执行、不能查询，轮询状态还得另做只读通道。
- **工具保持不变**：`skill_desc_zh` 的 action 集合不扩（避免模型侧行为变化）；页面不新增工具。

### 3.6 安全与隐私

- 认证 + 同源 + JSON-only（§2.3.6）。
- 页面展示的路径（sourcePath/shadowPath/stateFile）本来就是本机用户自己的文件路径，不跨用户；不写入日志。
- 动作不提供删除；`restore` 只调用 `trash.mjs`（`lib/trash.js` 已封装），失败时返回 `refused/failed` 给 UI 显示，绝不降级成 `rm`。
- `names` 白名单校验：必须是当前 `targets` 里存在的 id，否则 400（防止拿任意字符串去撞文件路径）。

---

## 4. UI 规格

### 4.1 线框

```
┌─ 设置 › 技能中文化 ──────────────────────────────────────────────── [关闭] ┐
│  技能描述中文化                                          ● 已生效 (active) │
│  把内置技能与斜杠命令的描述翻译成中文；随时可还原英文。                        │
├───────────────────────────────────────────────────────────────────────────┤
│  ┌ 状态 ──────────────────────────────────────────────────────────────┐   │
│  │ 相位 active · 中文 12/12 技能 · 3/3 命令 · 宿主 0.2.1-rc.2          │   │
│  │ 项目根 /Applications/dsh（来源：会话）· L2 已放行 · 警告 0           │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  启用中文描述  [ ●——]    （关闭 = 还原英文原文，可随时重新应用）             │
│  引擎 auto（当前 llm） · 还原策略：应用时自动备份影子                      │
│                                                                           │
│  [应用 / 重新应用]  [刷新]  [重新翻译]  [自检]  [还原英文原文]              │
│  ⏳ 正在重新翻译…（12 项，已用 8s）                                        │
│  ⚠ 上次操作失败：…                                                        │
│                                                                           │
│  ┌ 覆盖清单（15） ───────────────────────────────────────────────────┐    │
│  │ 目标            类型   层      当前   引擎   状态        影子       │    │
│  │ office          技能   global  中文   dict   ✓           —          │    │
│  │ agent-experience技能   preset  中文   llm    ✓   .dsh/skills/…      │    │
│  │ /acp            命令   agent   中文   dict   ✓           —          │    │
│  │ …                                                                  │    │
│  └────────────────────────────────────────────────────────────────────┘   │
│  ┌ 自检 ✓ 8/9 ───────────────────────────────────────────────────────┐    │
│  │ ✓ host-version 宿主版本：0.2.1-rc.2                                │    │
│  │ ✗ trash-script  废纸篓脚本：未找到（将用内建 rename 兜底）  [必需]  │    │
│  └────────────────────────────────────────────────────────────────────┘   │
│  ▸ 最近事件（5）                                                          │
│  ▸ 配置（只读）                                                           │
│  ⚠ 警告 / 已知限制                                                        │
└───────────────────────────────────────────────────────────────────────────┘
```

### 4.2 页面状态机

| 状态 | 触发 | 呈现 | 交互 |
|------|------|------|------|
| `loading` | 首次 GET 未返回 | 骨架屏（摘要 + 清单占位） | 全禁用 |
| `ready` | GET 成功且无动作 | 正常 | 全部可用 |
| `busy` | POST 在途 | 顶部进度条 + 当前动作按钮 spinner + 文案（已用秒数） | 所有写按钮禁用，开关禁用；「刷新」禁用 |
| `degraded` | `phase ∈ {degraded, stale}` 或 warnings>0 | 琥珀色横幅（`--dsw-alias-state-warn-primary`）+ 解释 + 「刷新」CTA | 正常 |
| `restored` | `state.restored === true`（`state.enabled=false`） | 信息横幅「当前为英文原文」+ 主 CTA「应用中文」 | 开关显示关闭 |
| `error` | GET 连续失败 / 首次失败 | 错误卡片（message + 重试） | 只留「重试」 |

业务相位（来自 `computePhase`）作为徽章颜色映射：`active` 绿、`degraded`/`stale` 琥珀、`restored` 蓝、`failed` 红、`booting` 灰。

### 4.3 区块细则

1. **页头**：`h2` 标题（`t('title')`）+ 一行说明；右上徽章 `phase`（含 `phaseReason` tooltip）。
2. **状态摘要**：网格 2×3：
   - 技能 `counts.zh/counts.total`；
   - 命令 `commands.zh/commands.total`（来自 `status().commands`）；
   - 宿主版本 `hostVersion`；
   - 项目根 `projectRoot` + `projectRootSource` + `projectAllowed.allowed`（未放行显示琥珀「L2 未放行」）；
   - `warnings.length`；
   - 引擎分布 `engineCounts`（`llm/dictionary/source/none` 各几项；t14 在 `status()` 新增，与 `details[]` 同源计算，不允许两套判断）。
3. **开关**：`role="switch"`、`aria-checked={enabled}`、`aria-label`。
   - 打开：`POST apply`（若 `restored` 则等同「应用」；若已生效则按钮文案「重新应用」）。
   - 关闭：先弹确认（原生 `<dialog>` 或内联确认条）：「将把 15 项切回英文并移除项目影子；译文缓存保留，可随时重新应用。」确认后 `POST restore`。
   - 进行中禁用并显示 spinner。
4. **操作按钮**（顺序固定）：
   | 按钮 | action | 二次确认 | 说明 |
   |------|--------|----------|------|
   | 应用 / 重新应用 | `apply` | 否 | 幂等 |
   | 刷新 | `refresh` | 否 | 廉价补齐 |
   | 重新翻译 | `retranslate`（`force:true`） | 是（会调用模型，可能几十秒） | 显示「引擎 auto→llm」 |
   | 自检 | `doctor` | 否 | 结果在自检区展开 |
   | 还原英文原文 | `restore` | **是** | 危险色描边（`--dsw-alias-label-error`），文案强调可恢复 |
   - 每个按钮 `disabled` 条件见 §4.4；成功后 `aria-live="polite"` 播报「已完成」。
5. **覆盖清单**（15 行，可折叠，默认展开）：
   - 列：目标（技能名或 `/命令`）、类型、层、当前、引擎、状态、影子路径（可复制）。
   - 排序：技能（global 8）→ 技能（preset 4）→ 命令（3）。
   - 行状态图标：✓ 生效 / ◐ 待注册（missing） / ⚠ stale / ✗ 失败。
   - 空态：`targets` 为空时显示「未发现目标，请检查宿主版本或项目根」。
   - 逐条勾选（可选增强，v0.4）：复选框选择 `names` 后执行 apply/restore——首版只做「全部」，避免部分失败语义复杂。**决定：首版不做逐条操作**，但保留 `names` 通道（t14 已支持）以备后用。
6. **自检**：`doctor.checks` 列表（✓/✗ + `mandatory` 标签 + detail）；顶部汇总「✓ n/m」；`limitations` 用 `<details>`。
7. **最近事件**：`events.read(8)`（t14 在 GET state 里附 `events[]`，或单独 `GET /events?limit=`）。首版直接放进 `state.events`，减少端点。
8. **配置（只读）**：`targets.global/preset/commands`、`projectAllowlist`、`restoreOnQuit`、`llm.provider/model/timeoutMs`、`stateFile`、`eventsFile`、插件版本。只读行用 `<code>`，长路径可复制。
9. **警告与限制**：`warnings` + `limitations`（`LIMITATIONS` 常量）逐条。

### 4.4 控件禁用矩阵

| 控件 | loading | busy | error | restored | degraded |
|------|---------|------|-------|----------|----------|
| 开关 | 禁用 | 禁用 | 禁用 | 可用（=开） | 可用 |
| apply | 禁用 | 禁用 | 禁用 | 可用 | 可用 |
| restore | 禁用 | 禁用 | 禁用 | 禁用（已是英文） | 可用 |
| refresh | 禁用 | 禁用 | 禁用 | 可用 | 可用 |
| retranslate | 禁用 | 禁用 | 禁用 | 可用 | 可用 |
| doctor | 禁用 | 禁用 | 禁用 | 可用 | 可用 |

### 4.5 轮询与可见性

```js
useEffect(() => {
  let timer; let failures = 0; let cancelled = false;
  const tick = async () => {
    if (document.visibilityState !== "visible") return schedule(5_000);
    try { const data = await fetchState(); if (cancelled) return; apply(data); failures = 0; }
    catch (e) { if (cancelled) return; failures += 1; showStaleWarning(failures); }
    schedule(backoff(failures));
  };
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(tick, ms); };
  const onVis = () => { if (document.visibilityState === "visible") { clearTimeout(timer); tick(); } };
  document.addEventListener("visibilitychange", onVis);
  tick();
  return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
}, [projectRoot]);
```

- 基数 5s；退避 `min(5s * 2^failures, 30s)`；成功后复位。
- 动作成功后用响应里的 `state` 立即覆盖 + `failures = 0`。
- 页面卸载（关弹窗）即清定时器。
- **不要**在 `hidden` 时继续轮询。

### 4.6 i18n

- 命名空间：`skill-desc-zh`（client 侧，`NS = "skill-desc-zh"`）。
- `ctx.locale.register(NS, { zh, en })` 在 `apply` 里用 `ctx.effect` 注册（可重载）；`const t = ctx.locale.bind(NS)`；注册页面时 `locale: NS`。
- **两份字典必须完整**（缺 key 会回退到 key 本身）；zh/en 键表见附录 B。
- 与宿主清单元数据（`locale/zh.json` 的 `meta.*`）分开：前者给页面，后者给插件清单。

### 4.7 可访问性

- 开关：`role="switch"` + `aria-checked` + `aria-label`；键盘 Space/Enter 可切换。
- 按钮：原生 `<button type="button">`；危险操作有明确的 `aria-describedby`。
- 进度：`role="status" aria-live="polite"`；错误 `role="alert"`。
- 清单：真表格（`<table>` + `<th scope="col">`）或 `role="table"`；行可聚焦。
- 对比度：只用 token（label-secondary 以上用于正文）。
- 焦点：确认条出现时把焦点移到确认按钮；关闭后回到触发按钮。

### 4.8 样式与 token 映射

| 元素 | token |
|------|-------|
| 页面背景 | `--dsw-alias-bg-base` |
| 卡片 | `--dsw-alias-bg-layer-1` + `1px solid --dsw-alias-border-l2` + `--dsw-radius-lg` |
| 标题 | `--dsw-alias-label-primary`，`font-weight: 600` |
| 说明 | `--dsw-alias-label-secondary` |
| 徽章-成功 | `--dsw-alias-state-success-primary`（背景用 `color-mix(in srgb, … 12%, transparent)`） |
| 徽章-警告 | `--dsw-alias-state-warn-primary` |
| 徽章-错误 | `--dsw-alias-label-error` |
| 按钮-primary | 背景 `--dsw-alias-button-primary-fill`，文字 `--dsw-alias-label-primary-foreground` |
| 按钮-次 | 透明底 + `--dsw-alias-border-l2` |
| 危险描边 | `--dsw-alias-label-error` |
| 表格分隔 | `--dsw-alias-border-l1` |
| 等宽路径 | `font-family: var(--dsw-font-family)` + `font-variant-numeric: tabular-nums`（不引第三方字体） |

布局：面板内容宽约 564px（§2.1.4）⇒ 摘要用 2 列网格、清单表 7 列在窄宽度下允许横向滚动（`overflow-x: auto` + 固定首列），不堆叠成卡片以免跳变。

### 4.9 失败降级

| 故障 | 表现 | 兜底 |
|------|------|------|
| client bundle 未构建/404 | 设置里无此导航项（entry 加载失败） | host 半与工具照常 |
| 页面组件抛错 | 该页空白 + console `slot entry crashed in 'settings.section':` | 其它设置页正常 |
| `locale` 服务缺失 | cordis `inject` 未满足 ⇒ 本客户端插件保持 inactive，页面不注册 | 不影响宿主；不需要运行时兜底（`inject: ['slots','locale']` 声明即保证依赖存在才 apply） |
| GET 401 | 页面错误态「会话未认证，请刷新页面」 | 重试按钮 |
| GET 404 | 「host 半未加载（插件版本过旧？）」，只显示说明 | 不显示按钮 |
| 动作超时 | 错误条 + 提示「仍在后台执行」 | 继续轮询 |
| `busy` 409 | 提示「另一操作进行中」并同步 busy 状态 | — |

---

## 5. 文件级实施计划

### 5.1 文件清单

| 文件 | 动作 | 归属 | 说明 |
|------|------|------|------|
| `lib/http-api.js` | 新增（~260 行） | t14 | 认证包装、路由注册、体解析、action 校验、projectRoot 解析、busy/lastAction |
| `test/http-api.test.mjs` | 新增（~300 行） | t14 | 纯函数 + 假 webServer 路由测试 |
| `lib/index.js` | 改（~10 行接线 + `status()` 增字段 ~40 行） | t14 | `registerHttpApi`、`status().targets/api/engineCounts` |
| `client.js` | 新增（~600 行） | t15 | 页面组件 + 轮询 + 动作 + 字典 |
| `locale/zh.json` / `locale/en.json` | 新增 | t15 | 仅 `meta.title/description`（清单展示） |
| `icon.svg` | 新增 | t15 | ≤256 KiB，清单图标 |
| `package.json` | 改 | t15（t14 可先改） | version 0.3.0、exports、files、`dsh.client`、`scripts.check:client` |
| `scripts/check-client.mjs` | 新增（~60 行） | t15 | 静态检查：`node --check client.js`、`__ModuleLoader__.load` 存在、id 与包名一致、只 require 基线模块、无 `dsh-client-ui-*` require、文件大小 |
| `README.md` | 改 | t15 | 加「设置页」一节 |
| `docs/settings-ui-design.md` | 本文件 | t13 | — |

- **不改**：`lib/translate.js`、`lib/state.js`（schema 不变，见 §5.4）、`lib/discover.js`、`lib/shadow.js`、`lib/provider.js`、`cordis.patch.yml`（配置不变）。

> 注意（`references/host-plugin.md:35`）：**`files` 不会过滤 `link:` 安装的目录**——本地 link 安装直接链接整个 checkout，所以 `files` 只是发布/打包时的清单；`client.js`/`locale`/`icon.svg` 只要在仓库里，link 安装即可见。但仍要写全 `files`，否则将来发布 npm 会丢文件。

### 5.2 t14 接口冻结

```js
// lib/http-api.js
export const API_PREFIX = "/plugins/skill-desc-zh";
export const API_ACTIONS = ["apply", "restore", "retranslate", "refresh", "doctor"];

/**
 * @param {object} input
 * @param {import('@deepseek-ai/cordis').Context} input.ctx
 * @param {object} input.controller
 * @param {{info:Function, warn:Function, error:Function}} input.logger
 * @param {string} input.version
 * @returns {{ ok: boolean, prefix: string, dispose: () => void, reason?: string }}
 */
export function registerHttpApi(input) {}

/** 纯函数：校验 POST body，返回 {ok, value} 或 {ok:false, code, message} */
export function parseActionRequest(raw, { maxNames = 64, maxBytes = 64 * 1024 } = {}) {}

/** 纯函数：projectRoot 解析（依赖注入，便于测试） */
export function resolveRequestProjectRoot({ explicit, state, agents, workingDirectory, cwd }) {}

/** 认证包装（与 agent-teams 同构；connection 缺失时 503） */
export function authenticatedRoutes(server, getConnection) {}
```

接线（`lib/index.js` `apply()`，约 `:2172` 之前）：

```js
const httpApi = registerHttpApi({ ctx, controller, logger, version: PLUGIN_VERSION });
…
return () => { httpApi?.dispose(); … };
```

- 注册时机：`ctx.get("webServer") ?? ctx.get("httpServer")` 存在时立即注册；否则挂 `ctx.on("internal/service", …)` 一次性重试（不把 `webServer/connection` 加进 `inject`，否则 CLI profile 会等待）。
- `status()` 增加：`targets: [...]`、`api: {version, prefix, actions}`、`engineCounts: {llm,dictionary,source,none}`、`projectRootSource: "explicit|state|session|cwd"`（GET 时由 http-api 回填）；现有字段一律保留（向后兼容）。
- **禁止**在 `http-api.js` 内直接读写 state 文件或调用 `trash`——只经 controller。

`test/http-api.test.mjs` 用例（节点 `node --test`，不依赖宿主）：

| # | 用例 |
|---|------|
| T1 | `parseActionRequest`：接受 5 个 action；拒绝未知 action / 非数组 names / >64 项 / 非 kebab-case / 非绝对 projectRoot / 超大 body |
| T2 | 方法不符 → 405 + `Allow` |
| T3 | `connection` 缺失 → 503 |
| T4 | `requestRejection` 返回 401/403 时透传 JSON |
| T5 | `GET /state` → 200，body 含 `ok/state/serverTime` |
| T6 | busy 时 POST → 409 |
| T7 | POST 成功 → 200，含 `result` 与最新 `state` |
| T8 | 动作抛错 → 500 且不泄漏堆栈 |
| T9 | `resolveRequestProjectRoot` 四级顺序（fakes） |
| T10 | `dispose()` 调用所有路由 disposer |

### 5.3 t15 任务（client UI）

1. `client.js` 骨架：`__ModuleLoader__.load({id: "dsh-skill-desc-zh", factory})` → `module.exports = { inject: ["slots","locale"], apply(ctx) }`。
2. 字典常量 `DICT = { zh: {...}, en: {...} }`；`ctx.effect(() => ctx.locale.register(NS, DICT), "skill-desc-zh: locale")`；`t = ctx.locale.bind(NS)`。`inject: ["slots","locale"]` 已保证服务存在，**不要**写 `ctx.get(...)` 探测（§4.9 第 4 行）。
3. `ctx.slots.inject("settings.section", () => ctx.slots.register({ name:"settings.section", id:"skill-desc-zh", order:16, label:()=>t("nav"), locale:NS }, Page))`。
4. 组件拆分（同文件内，函数组件）：
   - `Page`（error boundary + 状态机）
   - `StatusSummary`、`Toggle`、`ActionBar`、`TargetTable`、`DoctorPanel`、`EventsList`、`ConfigPanel`、`Notice`
   - `useRemoteState(projectRoot)`（轮询 hook）、`useAction()`（POST + busy）
5. `scripts/check-client.mjs` + `scripts` 加 `"check:client": "node scripts/check-client.mjs"`，并入 `npm test` 前置。
6. README 增「设置页」一节（截图位、重启说明、还原语义）。

**t15 不得**：改 host 半、改 `cordis.patch.yml`、加依赖、加构建步骤、`require` 非基线模块。

### 5.4 package.json 与 state schema

- `version: 0.3.0`（新功能，minor）。
- `exports` 加 `./client`、`./icon`、`./locale/*.json`；`files` 加 `client.js`、`locale`、`icon.svg`。
- `dsh.client = { platform: "web" }`（不加 `immediately`：boot 已 await 全量加载，加它只是预取提示）。
- `scripts.test` 保持 `node --test test/*.test.mjs`；`scripts` 增 `check:client`。
- **state schema 不变**（仍 `STATE_VERSION=2`）：页面只读，不改持久化结构；`projectRoot` 不落盘（避免与 `projects` 语义冲突），每次按 §3.4 解析。若未来要记住手动选择的项目根，再升 v3 + 迁移。

### 5.5 依赖与并行

- t14 与 t15 **可并行**：t14 冻结 §3.3 的 JSON 形状；t15 先按 mock JSON 开发，联调时切真接口（`client.js` 里 `MOCK` 开关，默认关）。
- t14 必须先合入 `status().targets`，否则 t15 的清单区只能渲染 `details` 字符串（降级方案：首版临时解析 `details`，不推荐）。
- 无新 npm 依赖；Node 侧只用 `node:http` 类型（不 import，仅 JSDoc）。

### 5.6 提交顺序与验证命令

```bash
cd ~/dsh-plugins/skill-desc-zh
node --test test/*.test.mjs          # 现有 + T1–T10
node scripts/check-client.mjs        # 静态检查
node -e "JSON.parse(require('node:fs').readFileSync('package.json'))"  # 清单合法
```

安装/升级前（t16）必须：

```bash
# audit.mjs 只接受 包名 | 包名@范围 | github:owner/repo | GitHub URL（`audit.mjs:22-35` 位置参数），
# 不接受本地目录 ⇒ 本地 link 包无法走它。t16 必须：
#   1) 如实记录「本地 link 包未走 npm 预检」；
#   2) 人工核对 engines.dsh、exports、dsh.client、files、require 黑名单；
#   3) 若将来发布 npm，再跑：
#      node ~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs <包名>@0.3.0 --profile desktop
#   4) 安装后复核：node …/audit.mjs --verify <包名>（对 link 包是否适用未验证；
#      无论如何都要用 plugin_manager list_plugins 确认 fiberPhase=active）
```

---

## 6. 风险清单

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | `id` 与包名不一致 | client 行加载失败，设置里无页面 | `check-client.mjs` 断言；加载报错原文进 README |
| R2 | 忘记重启就排查 | 误判「不生效」 | 页面首版无法出现；README/验收写死「必须重启一次」 |
| R3 | 裸 `webServer` 路由未套认证 | 本机任意网页可读状态/触发动作 | 统一 `authenticatedRoutes`；单测 T3/T4；不提供删除 |
| R4 | CSRF（跨站表单 POST） | 触发 apply/restore | JSON-only + 宿主 Origin/Host 围栏 + `sec-fetch-site` 拒绝 |
| R5 | 动作重入/并发 | 状态错乱、重复调用 LLM | 单飞 409 + `runExclusive` |
| R6 | 动作超时但仍在跑 | UI 以为失败 | 504 文案 + 继续轮询；`lastAction` 落事件 |
| R7 | 大响应（15 行 + 详情）拖慢轮询 | 页面卡 | 响应裁剪：`details` 只在 `?verbose=1` 返回；默认 8–12 KB |
| R8 | settings 弹窗关闭后定时器泄漏 | 后台请求 | `useEffect` 清理 + visibility 检查 |
| R9 | 轮询把宿主日志刷满 | 噪音 | 不记 access log；仅动作写 events |
| R10 | 失败时误显示「已生效」 | 用户误判 | 只用服务端 `state`；`serverTime` 单调；错误条不清空旧数据但标「数据可能过期」 |
| R11 | locale 服务缺失导致注册抛错（`SlotAssemblyError`） | 若在 apply 里强行注册会抛错 | 用 `inject: ['slots','locale']` 声明依赖：服务缺失时整插件 inactive、页面不注册，宿主不受影响；**不写运行时探测** |
| R12 | 组件 require 了 Harness Client 包 | 宿主升级后崩 | `check-client.mjs` 黑名单 |
| R13 | 与三方 `settings.section` id 冲突 | SlotCore 抛错/覆盖 | id 用包名 `skill-desc-zh`；`order=16` 唯一 |
| R14 | 宿主升级后 slot 契约变化 | 页面不显示 | A2/A3 验收；失败降级到工具 |
| R15 | 还原动作误解为「删除」 | 用户担心不可逆 | 开关关闭/还原按钮都有确认文案「译文缓存保留，可随时重新应用」 |
| R16 | 在 `apply()` 早期注册路由时 `connection` 未就绪 | 401/503 | `internal/service` 重试注册（幂等） |

---

## 7. 回滚方案（全程可回滚，删除只走废纸篓）

| 级别 | 动作 | 命令 | 影响 |
|------|------|------|------|
| L0（默认可用） | 不装 client 半 | — | 页面不存在，host 半/工具照常（v0.2.1 行为） |
| L1（回滚本次改动） | 还原 `package.json`、移除 `client.js` 等 | `trash.mjs --snapshot package.json` → 改回 v0.2.1 字段 → `trash.mjs client.js locale icon.svg scripts/check-client.mjs` → 重启 | 恢复 v0.2.1 |
| L2（回滚整个插件包） | 目录整体换回快照 | 先 `trash.mjs --snapshot`（逐文件）；整目录用 `trash.mjs ~/dsh-plugins/skill-desc-zh` 移入废纸篓后从备份复制 | 需重启 |
| L3（从 profile 移除） | `plugin_manager remove_bundle`（或 UI 插件页移除） | 属破坏性操作，需用户确认；profile `package.json`/lock 会被改写 | 插件彻底消失（state 文件保留在 `~/.dsh/.skill-desc-zh/`） |
| L4（还原英文描述） | 页面「还原英文原文」/ 工具 `restore` | `POST /action {"action":"restore"}` | 立即生效，不动包 |

**任何一级都不得使用 `rm`/`rm -rf`/`git clean`**；`trash.mjs` 报 `refused/failed` 时停下来告知用户。

---

## 8. 验收标准

### 8.1 重启前（静态/单测）

| # | 标准 | 方法 |
|---|------|------|
| A1 | 现有测试全绿 | `node --test test/*.test.mjs` |
| A2 | 新 API 单测 T1–T10 全绿 | 同上 |
| A3 | client 静态检查通过（id 匹配、只 require 基线、无黑名单、`node --check`） | `node scripts/check-client.mjs` |
| A4 | `package.json` 合法且 `exports["./client"]` 指向存在的文件 | `node -e` 脚本 |
| A5 | 文档与实现一致（端点、字段、order） | 人工 diff |

### 8.2 重启后（必须重启一次）

| # | 标准 | 方法 |
|---|------|------|
| A6 | `cordis_inspect_query` client 槽树：`settings.section` 下出现 `id=skill-desc-zh` 的 occupant | `client`/Slots/`listSubTree`（注意：本会话曾 10s 超时，失败则用浏览器实测替代并如实标注） |
| A7 | 设置弹窗左侧出现「技能中文化」，点击进入页面且无 console 报错 | 人工目视 |
| A8 | `GET /plugins/skill-desc-zh/state` 未认证 401、认证后 200 且 JSON 含 `state.targets`(≥15) | `curl`（本机带 cookie 可用 `curl -b`） |
| A9 | 页面显示 phase/计数/清单 15 行与工具 `status` 一致 | 目视 + `skill_desc_zh` 输出对照 |
| A10 | 点「还原英文原文」→ 技能/命令描述变英文；再「应用」→ 变中文；两次工具 `status` 一致 | 目视 + 工具 |
| A11 | 关闭开关（=restore）与按钮语义一致；确认框出现；取消不产生请求 | 目视 + 宿主日志 |
| A12 | 切到英文语言，页面文案与导航 label 变英文；切回中文恢复 | 目视 |
| A13 | 隐藏窗口（切到别的应用）后不再有 `/state` 请求；显示后立即恢复 | DevTools Network |
| A14 | 故障注入：把 `client.js` 改名（重启后）→ 设置里无入口但工具正常；恢复后重启即回归 | 人工 |
| A15 | 无永久删除：所有还原/回滚路径的日志只出现 `trash.mjs` | `~/.dsh/.trash-log.jsonl` 检查 |

### 8.3 未验证项的处理

A6 若因 inspect 超时无法执行，必须在 `verification` 文档中写明「未验证（inspect 超时）」，并补 A7/A9 的人工截图证据；**不得**把 A7 通过当成 A6 通过。

---

## 9. 未验证项与分歧

### 9.1 未验证（必须在 t16 实测后补证）

1. **真实浏览器 200 响应**：本会话用 `curl` 只验证了 401/404；认证后的 200 需带宿主 cookie，未实测。
2. **desktop Electron 窗口内 `fetch` 的相对路径与 cookie**：代码与 agent-teams 先例支持，但未在本会话目视。
3. **`settings.section` 的中文 label 在切语言时是否立即重渲染**：`localeSeat` 按 revision 换引用（`ui-renderer.js:542-560`）+ 导航行订阅 locale revision（`settings-general:1136-1160`）⇒ 代码上应当立即生效，未目视。
4. **`cordis_inspect_query` client Slots**：本会话两次 10s 超时，A6 可能执行不了。
5. **`client.js` 实际被 combo 路由服务**：只读了 Host 半源码与 `/tmp/cm-client.js`，未抓包。
6. **Electron 窗口缩放/窄宽度下布局**：未测。

### 9.2 分歧

- **HTTP 路由 vs session command**：技能 `user-actions.md` 倾向 session command；本设计选 HTTP（理由 §2.3.5）。若 captain/用户坚持「必须走类型化 RPC」，替代方案是新增只读命令 `skill-desc-zh:status` 并让 UI `commands.execute` + 文本解析——工程更脆，不推荐。
- **「启用开关」语义**：任务把它与「应用/还原」并列。本设计将开关 OFF 定义为 `restore`（还原英文），因为 state 里 `enabled=false` 本身就表示「已还原」；不引入第三种「停用但不还原」状态（会让 phase 语义混乱）。若用户期望「停用但保留中文」，需要 state schema 扩展，列为 v0.4。
- **首版是否支持逐条勾选**：不做（§4.3.5），但保留 `names` 参数。

### 9.3 依赖 captain 决策

- 是否把页面 order 放在「插件」(15) 之后——本设计取 16，若希望更靠前（例如紧邻「通用」）改一个常量即可。
- 是否在 v0.3.0 一并发布 `icon.svg`/`locale/*.json`（清单展示）——本设计建议做，成本低。

---

## 10. 证据索引

| 证据 | 位置 |
|------|------|
| `settings.section` 声明（list/root） | `app.asar …/dsh-client-ui-settings-general/lib/client.js:1249-1258` |
| 设置弹窗注册 + children | 同文件 `:1180-1273` |
| 宿主 general 页注册（最小范例） | 同文件 `:1293-1301` |
| 导航行生成（order/label/resolve） | 同文件 `:1136-1160` |
| 页面渲染 + ownerProps `{close}` | 同文件 `:337` |
| 导航图标映射（不可定制） | 同文件 `:230-269` |
| 既有 order：账号/模型/插件/预设 | `…-settings-account/lib/client.js:4774-4781`；`…-settings-models/...:4486-4490`；`…-settings-plugins/...:201-206`；`…-settings-agent-presets/...:2456-2460` |
| `dsh.client` 解析/报错 | `app.asar …/dsh-client-modules/lib/index.js:62-77`、`:733-738` |
| bundle 路由 | 同文件 `:205`、`:260`、`:294`、`:937` |
| 浏览器加载器 `arrive/reload` | `app.asar …/dsh-client-modules/lib/client.js:431`、`:741-772`、`:874` |
| 平台基线表 | `dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（`SZ()`）；`/tmp/shell.js` |
| boot 加载流程 | `/tmp/shell.js` 偏移 ~913478（`kZ`）、~918690 |
| HMR 500ms 轮询 / rebuilt / SSE | `app.asar …/dsh-client-hmr/lib/index.js:22,50,96`；`…/lib/client.js:272` |
| webServer 服务/注册 | `app.asar …/dsh-host-webserver/lib/index.js:287,327,341,356` |
| connection 认证 | `app.asar …/dsh-client-connection/lib/index.js:737,743,240-264` |
| agent-teams 路由包装 | `~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/web-routes.js:3-30,41-70`；`lib/index.js:170-185,200-215,458-463` |
| 实测 401/404 | 本会话 `curl` 结果（§2.3.4） |
| slot 渲染/注入/locale seat | `app.asar …/dsh-client-ui-renderer/lib/client.js:542-560`、`:736-760` |
| SlotCore 校验 | `/tmp/shell.js`（`register` 错误文案、`resolveSlotLabel`） |
| locale 服务 | `app.asar …/dsh-client-locale/lib/client.js:1246-1255,1387,1414` |
| 主题 token | `dsh-web-frontend/dist/assets/index-BxpfOGf3.css`（55 个 `--dsw-alias-*`，`[data-ds-dark-theme]`） |
| 插件 host 半锚点 | `~/dsh-plugins/skill-desc-zh/lib/index.js:530,564,610,658,1367,1392,1413,1434,1513,1675,2067`；`lib/state.js:13`；`lib/events.js` |
| 现有清单 | `~/dsh-plugins/skill-desc-zh/package.json`；`cordis.patch.yml` |
| 技能规范 | `/Applications/dsh/.dsh/skills/cordis-plugin-development/{SKILL.md,references/{ui-plugin,host-plugin,practices,user-actions,verification}.md}` |

---

## 附录 A：`GET /state` 响应示例（裁剪后）

```json
{
  "ok": true,
  "plugin": { "name": "dsh-skill-desc-zh", "version": "0.3.0" },
  "serverTime": 1761123456789,
  "busy": null,
  "lastAction": { "action": "refresh", "ok": true, "at": 1761123000000 },
  "state": {
    "ok": true,
    "summary": "技能描述中文化已生效（phase=active）：中文 12/12；命令 3/3；项目 /Applications/dsh；宿主 0.2.1-rc.2",
    "enabled": true, "restored": false, "ready": true,
    "phase": "active", "phaseReason": "12 项中文全部生效",
    "hostVersion": "0.2.1-rc.2",
    "projectRoot": "/Applications/dsh",
    "projectRootSource": "session",
    "projectAllowed": { "allowed": true, "reason": "project allowlisted" },
    "counts": { "zh": 12, "total": 12 },
    "engineCounts": { "llm": 0, "dictionary": 15, "source": 0, "none": 0 },
    "commands": { "zh": 3, "total": 3, "translations": { "…": "…" } },
    "agentLayer": { "registered": 1, "covered": 3, "names": ["acp","acp-cache","agent-teams"] },
    "targets": [ { "id": "skill:office", "kind": "skill", "layer": "global", "name": "office", "current": "zh", "engine": "dictionary", "stale": false, "missing": false, "sourcePath": "…/office/SKILL.md", "shadowPath": null, "rank": 600, "note": null } ],
    "events": [ { "at": 1761123000000, "action": "refresh", "ok": true, "summary": "…" } ],
    "warnings": [],
    "limitations": ["browser-skill 由 runtime 注册（rank 250），不可覆盖", "…"],
    "api": { "version": "0.3.0", "prefix": "/plugins/skill-desc-zh", "actions": ["apply","restore","retranslate","refresh","doctor"] }
  }
}
```

---

## 附录 B：locale 键表（zh/en 必须齐全）

| key | zh | en |
|-----|----|----|
| `nav` | 技能中文化 | Skills (zh) |
| `title` | 技能描述中文化 | Skill descriptions in Chinese |
| `subtitle` | 把内置技能与斜杠命令的描述翻译成中文；随时可还原英文。 | Built-in skill and slash-command descriptions in Chinese, restorable at any time. |
| `phase.active` | 已生效 | Active |
| `phase.degraded` | 部分降级 | Degraded |
| `phase.stale` | 需要刷新 | Stale |
| `phase.restored` | 已还原英文 | Restored |
| `phase.booting` | 启动中 | Starting |
| `phase.failed` | 失败 | Failed |
| `summary.skills` | 技能中文 | Skills in Chinese |
| `summary.commands` | 命令中文 | Commands in Chinese |
| `summary.host` | 宿主版本 | Host version |
| `summary.project` | 项目根 | Project root |
| `summary.warnings` | 警告 | Warnings |
| `toggle.on` | 启用中文描述 | Enable Chinese descriptions |
| `toggle.offHint` | 关闭即还原英文原文（译文缓存保留） | Turning off restores English (translations stay cached) |
| `action.apply` | 应用 / 重新应用 | Apply / Re-apply |
| `action.refresh` | 刷新 | Refresh |
| `action.retranslate` | 重新翻译 | Retranslate |
| `action.doctor` | 自检 | Run checks |
| `action.restore` | 还原英文原文 | Restore English |
| `confirm.restore.title` | 还原英文原文？ | Restore English? |
| `confirm.restore.body` | 将把 15 项切回英文并移除项目影子；译文缓存保留，可随时重新应用。 | This switches 15 entries back to English and removes project shadows. Translations stay cached; you can re-apply anytime. |
| `confirm.retranslate` | 重新翻译会调用模型，可能需要几十秒。 | Retranslation calls the model and may take tens of seconds. |
| `table.target` | 目标 | Target |
| `table.kind` | 类型 | Kind |
| `table.layer` | 层 | Layer |
| `table.current` | 当前 | Current |
| `table.engine` | 引擎 | Engine |
| `table.status` | 状态 | Status |
| `table.shadow` | 影子路径 | Shadow path |
| `state.zh` | 中文 | Chinese |
| `state.en` | 英文 | English |
| `state.missing` | 待注册 | Not registered yet |
| `state.stale` | 需刷新 | Stale |
| `doctor.title` | 自检 | Checks |
| `doctor.mandatory` | 必需 | required |
| `events.title` | 最近事件 | Recent events |
| `config.title` | 配置（只读） | Configuration (read-only) |
| `notices.title` | 警告与限制 | Warnings and limits |
| `error.load` | 加载失败 | Failed to load |
| `error.retry` | 重试 | Retry |
| `error.busy` | 另一操作进行中 | Another action is running |
| `error.unauthorized` | 会话未认证，请刷新页面 | Session not authenticated; refresh the page |
| `error.unavailable` | host 半未加载（插件版本过旧？） | Host half not loaded (outdated plugin?) |

---

## 附录 C：`client.js` 骨架（t15 起点）

```js
window.__ModuleLoader__.load({
  id: "dsh-skill-desc-zh",
  factory(require) {
    const React = require("react");
    const { useCallback, useEffect, useRef, useState } = React;

    const NS = "skill-desc-zh";
    const DICT = { zh: { nav: "技能中文化", /* …附录 B… */ }, en: { nav: "Skills (zh)", /* … */ } };

    const BASE = "/plugins/skill-desc-zh";
    async function request(path, init) {
      const res = await fetch(BASE + path, { credentials: "same-origin", ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status, body });
      return body;
    }

    function Page(props) {
      const t = props.t || ((k) => DICT.zh[k] || k);
      const [phase, setPhase] = useState("loading");
      const [state, setState] = useState(null);
      const [busy, setBusy] = useState(null);
      const [error, setError] = useState(null);

      const failures = useRef(0);
      const load = useCallback(async () => {
        try {
          const data = await request("/state");
          setState(data.state); setBusy(data.busy); setError(null); setPhase("ready");
          failures.current = 0;
        } catch (e) {
          failures.current += 1;
          setError(e);
          setPhase((prev) => (prev === "ready" ? "ready" : "error"));
        }
      }, []);

      useEffect(() => {
        let timer, cancelled = false;
        const tick = async () => {
          if (cancelled) return;
          // 页面只在可见时轮询；隐藏时保留一个 5s 计时器等待重新可见。
          if (document.visibilityState === "visible") await load();
          const delay = Math.min(5000 * 2 ** failures.current, 30000);
          timer = setTimeout(tick, delay);
        };
        tick();
        const onVisible = () => { if (document.visibilityState === "visible") load(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
          cancelled = true; clearTimeout(timer);
          document.removeEventListener("visibilitychange", onVisible);
        };
      }, [load]);

      const run = useCallback(async (action, extra = {}) => {
        setBusy({ action, startedAt: Date.now() });
        try {
          const data = await request("/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, ...extra }),
          });
          setState(data.state); setError(null);
        } catch (e) { setError(e); await load(); }
        finally { setBusy(null); }
      }, [load]);

      // …渲染 §4.1 的区块…
      return React.createElement("div", { className: "sdzh-page" }, /* … */);
    }

    // 简单错误边界
    class Boundary extends React.Component {
      constructor(p) { super(p); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      render() {
        if (!this.state.failed) return this.props.children;
        return React.createElement("div", { role: "alert", className: "sdzh-error" },
          (this.props.t || ((k) => DICT.zh[k] || k))("error.load"));
      }
    }

    function apply(ctx) {
      // inject: ['slots','locale'] 保证这两个服务存在，直接取用（与 billion-context 一致）。
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, DICT), "skill-desc-zh: locale");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "skill-desc-zh",
        order: 16,
        label: () => t("nav"),
        locale: NS,
      }, (p) => React.createElement(Boundary, { t }, React.createElement(Page, { ...p, t }))));
    }

    module.exports = { inject: ["slots", "locale"], apply };
    return module.exports;
  },
});
```

> 注：客户端插件**不使用** `ctx.get(...)` 探测服务——cordis 的 `inject` 声明未满足时插件保持 inactive，页面自然不注册，这正是我们要的降级；`ctx.locale`/`ctx.slots` 直接取用（billion-context 同样写法）。
