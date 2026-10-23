# skill-desc-zh v0.2 设计：斜杠命令描述中文化（agent 层命令影子）

> 状态：设计稿（未改生产代码）。作者：researcher。日期：2026-10-21。
> 目标版本：`0.2.0`。前置：v0.1.1（技能描述中文化，已安装并验收）。
> 本文所有结论都来自本机真实源码（app.asar 内宿主包 / desktop profile 内第三方包）与一次真实模块探针，
> 证据行号见 §12。凡未实测的点都显式标注「未实测」。

---

## 0. 结论速览

1. **机制可行，且已实测**。在 agent 的 scope 里注册同名 command 影子（`agent.ctx.get('commands').register(...)`），
   只对该 agent 生效；`list(agent)` 返回中文描述、保留 `definitionId`，`execute()` 仍走原 handler。
   全局视角、其它 agent、内置 6 条命令都不受影响。（§2.7 探针，真实 `@deepseek-ai/dsh-commands` + `dsh-scope` + `cordis`）
2. **全局层不可行（不是取舍，是硬约束）**：`commands.register()` 在全局层遇到同名会直接抛
   `command "acp" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's agent.ctx)`
   —— 宿主自己在错误信息里给出了唯一正解：agent 作用域影子。
3. **不改三方、不改客户端、不改全局**：影子只存在于每个 agent 的 scope 层；第三方插件的注册与 handler 原封不动；
   GUI 无需任何改动（它本来就把 `list()` 的 `description` 原样渲染，只有 6 条内置命令按 `definitionId` 本地化）。
4. **可一键还原**：`restore` 直接把影子 dispose 掉，立即回落英文；`apply` 再注册回来。全程不写任何第三方文件。
5. **升级自愈**：指纹 = `sha256(hostVersion ∥ name ∥ sha256(description ∥ hint))`；宿主版本变化或源描述漂移时，
   先下架影子（回英文）→ 重新翻译 → 再注册，绝不展示与当前英文原文不匹配的旧译文。
6. **风险 Top3**：①handler 委托的「过期快照」——用「每次调用实时 `find(undefined,name)` + 快照兜底」消除；
   ②`commands/change` 自触发抖动——用 digest 比较 + 50ms debounce + 自增代次消除；
   ③GUI 缓存导致短暂英文——`commands/change` 会触发客户端 `invalidateAll()`（软刷新），已确认链路，最多一次菜单重开延迟。
7. **建议实施**：是。改动集中在一个新文件 `lib/command-layer.js` + `lib/index.js` 少量接线，约 1 人日，版本 `0.2.0`。

---

## 1. 目标、非目标与硬约束

### 1.1 目标

用户在会话里输入 `/` 时，斜杠菜单中这三条第三方命令的描述显示为中文：

| 命令 | 当前英文描述（实测） | 注册方 |
| --- | --- | --- |
| `/acp` | `Show bili context-compression status` | billion-context `dist/agent/dsh-native.js`（全局层） |
| `/acp-cache` | `Prompt-cache reconciliation (same report as the acp_cache tool)` | 同上 |
| `/agent-teams` | `run a goal with a multi-agent team (you become the captain)` | `@nanmicoder/dsh-agent-teams` `lib/command.js`（全局层） |
| `/agent-teams-<profile>` | `run a goal with the AgentTeams <name> profile` | 同上，按 profile 动态生成 |

附加要求：

- **执行完全不变**：命令参数、附件校验、`command/run`+`command/done` 生命周期、返回结果都保持原语义。
- **可随时还原**：一次 `skill_desc_zh({action:"restore"})` 即回英文；再 `apply` 回中文。
- **升级自愈**：宿主或第三方插件升级后，不展示过期译文；自动重新翻译。
- **失败不放大**：翻译不可用/命令未注册/服务缺失时，只是「描述保持英文」，命令仍可正常执行。

### 1.2 非目标

- 不翻译内置 6 条命令（`/goal` `/plan` `/feedback` `/compact` `/permission` `/export`）——客户端已按 `definitionId` 本地化，见 §2.5。
- 不改命令名、不新增命令、不改 `hint` 文案语义（原样透传）。
- 不改第三方包文件、不改 GUI/客户端 bundle、不做全局层替换。
- 不做「命令执行结果」的本地化。

### 1.3 硬约束（沿用团队与 `~/.dsh/AGENTS.md`）

- **只读第三方**：第三方命令定义只能读取；中文化只发生在内存里的影子层。
- **删除只走废纸篓**：本方案本身不产生需要删除的文件（state 文件覆盖前仍走 `trash.snapshot`）。
- **插件安装预检**：v0.2 是本地 link 包的版本升级，安装动作仍走 `plugin_manager install_bundle`（见 design.md §3⑤），
  并先跑 `scripts/preflight.mjs`（内部调用 `audit.mjs`）。
- **不碰全局命令表**：任何情况下都不在 `undefined` scope 注册同名命令（否则宿主直接报错，见 §2.7 实测）。

---

## 2. 现状调研（证据）

### 2.1 命令注册表 `@deepseek-ai/dsh-commands`

源码：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-commands/lib/index.js`

- `:78` `const name = "commands"`；`:216` `class CommandRuntime`（TypertRemoteService）。
- `:267` `register(definition)`：
  ```js
  const registered = normalizeDefinition(definition)
  return this.layers.effect(this.ctx, (layer) => layer.commands.insert(registered.definition.name, registered),
                           { label: 'commands.register()' })
  ```
  **关键**：注册落点由 `this.ctx` 决定（`layers.effect` 内部 `scopeOf(ctx)`）。
- `:150` `normalizeDefinition()`：名称必须匹配 `COMMAND_NAME`（`/^[a-z][a-z0-9_-]*$/u`）；
  `description` 非空字符串；`handler` 必须是函数；`input.hint` 必须是非空字符串，`input.attachments` 仅接受 `true`；
  只保留 `{definitionId?, name, description, input?, recordInput?, handler}` 七个字段，**其余字段静默丢弃**；
  `input` 与结果都会被 `Object.freeze`。
- `:288` `list(agent)` → name 排序的 `CommandDescriptor[]`（`{definitionId?, name, description, input?}`，**不含 handler**）。
- `:297` `find(agent, name)` → 完整 `CommandDefinition`（含 handler）。
- `:328` `execute(agent, line, submittedAttachments, signal)`：`parseCommand` → `view(agent).get(name)` →
  追加 `command/run` → 校验附件 → `command.definition.handler(invocation)` → `normalizeResult` → 追加 `command/done`；
  handler 抛错时 `settleThrown` 后再抛出（错误语义原样保留）。
- `:424` `view(agent)` = `this.layers.merge(agent, (layer) => layer.commands)`，注释原文：
  `/** Resolve global definitions followed by exact scoped shadows. */`
- `:428` `notifyChange()`：`this.ctx.events.dispatch("emit", ["commands/change"])`。
- 类注释（`:207-209`，宿主在线契约同文）：
  > `Human-command registry. Plain-context definitions are global; definitions registered through a command-injected child of an agent context shadow globals for that agent.`

宿主在线契约（`cordis_inspect_query(platform=host, provider=Service, method=listService, input={service:"commands"})`）同文，
并给出 `register(definition: CommandDefinition): () => void`、`CommandDefinition`/`CommandDescriptor` 的精确字段——与源码一致。

### 2.2 作用域合并 `@deepseek-ai/dsh-scope`

- `ScopedLayers.effect(ctx, action, {label, notify})`：用 `scopeOf(ctx)` 取层键；`undefined` = 全局层；
  返回的 undo 会移除空层并触发 `onChange()`。
- `merge(scope, pick)`：先放全局层 `Map`，再沿 `scopeChainOf(scope)` **从最远祖先到最近**逐层覆盖 ⇒ **最近层胜出**。
- 全局层同名重复 → 抛错；不同层同名是**合法覆盖**（`NamedEntries` 只在单层内查重）。

### 2.3 `this.ctx` 为什么是调用方 ctx（traceable）

`@deepseek-ai/cordis/lib/index.js` 的 `Service` + traceable 机制：通过 `agent.ctx.get('commands')` 拿到的服务对象，
其方法被调用时 `this.ctx` 被重绑为**调用方 ctx**（`createShadowMethod` / `getTraceable`）。
v0.1 的 agent 层 skills provider 用同一条路径，并已用真实模块 e2e 验证（`scripts/agent-layer-e2e.mjs`）；真实会话内的在线自检列为验收项 A2/A3。本次 commands 探针再次验证（§2.7）。

### 2.4 agent 的 scope key 就是 agent 对象

`@deepseek-ai/dsh-agent-loop/lib/index.js:777-781`：

```js
var ReactLoopAgent = class {
  ...
  constructor(loopCtx, id, options, session) {
    ...
    this.scope = createScope(loopCtx, this)   // key = this（即 agent 对象）
    this.ctx = this.scope.ctx
```

`dsh-agent/lib/index.js` 的 `agents.enter(agent, parent)` / `agents.announce(agent, source, signal)` 用的也是这个对象，
`agent/created` 的 payload `{agent}` 即它；`commands.list(agent)` / `execute(agent,...)` 的 `agent` 也是它。
⇒ `scopeOf(agent.ctx)` === `agent`，注册与查询用的是同一把钥匙。

### 2.5 GUI 如何取命令描述

`@deepseek-ai/dsh-client-ui-commands/lib/client.js`：

- `:1417` 拉取：`const result = await ctx.remote.commands.list(sessionId)`（RPC 声明 `scope:{context:'agent', wire:'agentId'}`，
  宿主按 agentId 解析到**精确 agent** 再调 `list(agent)`）。
- `:781` `BUILTINS`（6 条内置的 `definitionId`）；`:794` `builtinCommandName(descriptor)` 仅按 `definitionId` 匹配；
  `:1329` `builtinRowFace(descriptor, t)` 只对命中内置的命令返回本地化文案。
- `:1541` 候选行：`...builtinRowFace(c, this.t) ?? { description: c.description }` ⇒ **非内置命令原样展示注册时的 description**。
- `:859` `invalidateAll()`；`:1436-1437` `ctx.remote.$on("commands/change", () => this.directory.invalidateAll())`。
  这是软刷新：ready 快照继续服务，后台重新拉取后替换。

⇒ 我们的影子只要出现在 `list(agent)` 里，菜单就会显示中文；**无需改客户端**。

### 2.6 三条目标命令的真实注册代码

**billion-context**（`~/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js`，单行压缩）：

```js
ctx.commands.register({ name:"acp", description:"Show bili context-compression status",
                        handler: invocation => statusOutcome(ctx, invocation) });
ctx.commands.register({ name:"acp-cache", description:"Prompt-cache reconciliation (same report as the acp_cache tool)",
                        handler: invocation => cacheOutcome(ctx, invocation) });
```

插件名 `bili-native`，`inject:["tools","commands","agents"]`，在 host ctx 注册（全局层），无 `definitionId`、无 `input`。
handler 闭包持有插件自己的 `ctx` 与模块状态 ⇒ **必须委托原 handler，不能重写**。

**agent-teams**（`~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/command.js`）：

```js
ctx.commands.register({
  name: AGENT_TEAMS_COMMAND,                       // 'agent-teams'
  description: 'run a goal with a multi-agent team (you become the captain)',
  input: { hint: '[--profile <name>] <goal>' },
  handler(invocation) { ... invocation.agent.followup(createUserMessage(...)); return {kind:'success'|'error', text} },
})
// 每个配置的 profile 再注册一条：
{ name: `agent-teams-${profile}`, description: `run a goal with the AgentTeams ${profile} profile`, input: { hint: '<goal>' } }
```

`lib/index.js:157-162`：`ctx.inject(['commands'], (commandCtx) => registerAgentTeamsCommand(commandCtx, () => config.profiles ?? {}))`。
`registerAgentTeamsCommand` 整体包在 `ctx.effect(...)` 里，返回时逐个 unregister。
另有一个 **gesture boundary**（`installAgentTeamsGestureBoundary`）在 `agent/pre-step` 重新解析注入消息文本
（`/^\/agent-teams(?=$|[\t\n\r ])/u`）——它看的是**消息文本**，与描述无关，handler 委托不会破坏它。

### 2.7 实测探针（本次新增，真实宿主模块）

脚本 `/tmp/verify-command-scope.mjs`，用 Electron-as-node 直接 import app.asar 内的真实包：

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  /tmp/verify-command-scope.mjs
```

装配：`new Context()` → `ctx.plugin(CommandRuntime)` → 在**全局层**注册 `acp`/`acp-cache`（复刻 billion-context）→
`createScope(ctx, agentKey)` → 从 `agentScope.ctx.get('commands')` 注册同名影子（中文描述 + 委托 handler）。

实测输出（原样）：

```
agent ctx has commands: true
after shadow, agent view: 显示 bili 上下文压缩状态
after shadow, global view: Show bili context-compression status
list(agent) names: acp,acp-cache
execute(agent,/acp) => {"commandId":"cmd-45bf219c-1","result":{"kind":"success","text":"original-acp#1"}}
after dispose, agent view: Show bili context-compression status
commands/change events: 4
same-layer duplicate error: command "acp" is already registered in this scope
ALL PROBE CHECKS PASSED
```

结论（全部为实测，不是推断）：

1. agent scope 注册成功，`find/list` 的 agent 视角是中文，**global 视角仍是英文**；
2. `list(agent)` 的 `descriptor` 的 `definitionId` 与原始定义一致（本次探针两条命令本就没有 `definitionId`，两者同为 `undefined`；「带 id 原样保留」由单测 U1 与 e2e 用合成定义覆盖），且**不暴露 handler**；
3. `execute(agent,'/acp')` 走影子 handler → 委托到原 handler（计数器 `acpRuns` 从 0 变 1），返回原结果；
4. `dispose()` 后立即回落英文；
5. `commands/change` 在 host 层 listener 上收到 4 次（2 次全局注册 + 1 次影子 + 1 次 dispose）——
   **agent 作用域的变更也会通知全局监听者**，这就是 GUI 软刷新的触发链；
6. 同层重复注册报 `command "acp" is already registered in this scope`；跨层同名合法。

唯一未实测项：真实宿主进程里 `agent/created` 回调时刻的 `agent.ctx` 是否为 scope ctx。
证据链：`dsh-agent-loop` 构造函数（§2.4）+ v0.1 在同位置注册 agent 层 skills provider（真实模块 e2e 通过；其在线自检同样列在验收项里）。
实施时用 §10 的 A2/A3 在真实会话里闭环（`status.commands.checked.ok === true`）。

### 2.8 被排除的方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 全局层覆盖（provider 式） | ❌ 不可行 | commands 无 provider 扩展点；全局同名注册直接抛错（§2.7） |
| 改第三方包的 SKILL/JS 文件 | ❌ 禁止 | 违反「只读第三方」，升级即失效，且不可回滚 |
| 改 GUI 客户端加 locale | ❌ 越界 | 需改客户端 bundle；且 GUI 已按 `definitionId` 本地化内置命令，非内置只能靠描述 |
| Monkey-patch `commands.list` | ❌ 不稳 | 跨包内部实现，宿主导出只读对象；effect/handler 也拿不到 agent 参数外的上下文 |
| agent 层影子 | ✅ 采用 | 宿主契约明文支持，实测通过，天然可还原 |

---

## 3. 机制设计

### 3.1 影子定义

对 `targets.commands` 里每个 `name`：

```js
const original = commands.find(undefined, name)   // 全局视角；注册前捕获，避免自引用
if (!original) { 记为 missing，跳过（等 commands/change 再试） }

const dispose = agent.ctx.get('commands').register({
  ...(original.definitionId === undefined ? {} : { definitionId: original.definitionId }),
  name,
  description: zh,                                 // 中文译文
  ...(original.input === undefined ? {} : { input: original.input }),  // hint/attachments 原样
  ...(original.recordInput === undefined ? {} : { recordInput: original.recordInput }),
  handler: makeDelegate(name, original, commands),
})
```

要点：

- **`definitionId` 原样保留**：GUI 的 `builtinCommandName()` 只有在命中 6 条内置时才本地化；三条目标命令都没有
  `definitionId`，所以保留与否都不影响渲染，但保留可以让宿主的遥测/关联逻辑拿到一致身份。
- **`input` 必须原样**：`execute()` 用 `definition.input?.attachments` 决定是否接受图片附件；
  `recordInput === false` 决定 `command/run` 是否记录 args。任何偷懒省略都会改变执行语义。
- **不传多余字段**：`normalizeDefinition` 会静默丢弃未知字段，传了也不会报错，但会掩盖拼写错误——所以只传这七个。
- **不注册全局**：`agent.ctx.get(...)` 的 `this.ctx` 必须是 agent scope（§2.3）。

### 3.2 handler 委托（三段式）

```js
function makeDelegate(name, snapshot, commands) {
  return function delegate(invocation) {
    // 1) 实时优先：源插件可能热重载/重注册，每次调用都重新解析全局定义
    const current = commands.find(undefined, name)
    const target = current ?? snapshot
    if (!target || typeof target.handler !== 'function') {
      return { kind: 'error', text: `/${name} 的原始实现已不可用（skill-desc-zh 命令影子）` }
    }
    // 2) 与原 execute 的调用形态一致：handler 作为 definition 的方法执行
    return target.handler.call(target, invocation)
  }
}
```

- **不 catch**：原 handler 抛错时保持「`command/done` 记 error 再向上抛」的原语义；影子不吞异常、不改错误文案。
- **返回值原样**：`execute()` 仍会走 `normalizeResult`，所以委托返回的 `CommandResult` 会被宿主校验（与原来一致）。
- **为什么不用 `find(agent,name)` 捕获**：注册完成后 `find(agent,name)` 命中**我们自己的影子**，会无限自调用。
  正确做法是「注册前用全局视角捕获快照」+「运行期用全局视角实时解析」；这两处都用 `find(undefined, ...)`。
- **为什么实时解析**：billion-context / agent-teams 都可能因插件热重载而替换 handler 闭包；快照仅作兜底。

### 3.3 捕获时机与内容

- 时机：`agent/created`（与 v0.1 的 agent 层 provider 同一个回调）、以及插件启动后对 `agents.list()` 的补注册。
- 捕获内容：`{definitionId, name, description(en), input, recordInput, hasHandler}`（**不序列化 handler**）。
- 若捕获时目标命令尚未注册（例如第三方插件晚于本插件挂载）：记 `missing`，不注册影子；
  `commands/change` 到达后重新尝试（§4.2）。

### 3.4 为什么不用 `agent.ctx.inject(['commands'], ...)`

宿主契约的措辞是「command-injected child of an agent context」。两种写法等价（`inject` 只是保证服务可见并创建子 fiber），
但 `get()` 写法：

- 不需要 `inject` 的回调式生命周期管理，disposer 由 `layers.effect` 直接返回；
- v0.1 的 `agent-layer.js` 已验证同型写法（`agent.ctx.get('skills').registerProvider`）。
若实现时发现 `agent.ctx` 在极早期 `agent/created` 阶段拿不到 `commands`，回退用 `inject` 包一层即可（同一 scope 键）。

---

## 4. 生命周期

### 4.1 状态机

```
         ┌──────────────┐  translations ready  ┌────────────────┐
  boot → │  no-targets  │ ───────────────────► │ shadows-active │
         │ / untranslated│                     │ (per-agent)    │
         └──────┬───────┘                      └───────┬────────┘
                │ restore()                            │ restore()
                ▼                                      ▼
         ┌──────────────┐                       ┌─────────────┐
         │   restored   │ ◄─────────────────────│  restored   │
         └──────┬───────┘        apply()        └──────┬──────┘
                └──────────────► shadows-active ◄──────┘
```

- 影子是**每 agent 独立**的（scope 层），不是全局状态；「关闭」= 全部 dispose。
- 已翻译但没注册（还没 agent）= `translated, idle`；status 里如实显示 `registered: 0`。

### 4.2 事件表

| 事件 / 动作 | 行为 |
| --- | --- |
| 插件 `apply()` | 读 state；注册 `commands/change` 监听；后台预热翻译（缓存命中则跳过）；启动后 `agents.list()` 补注册 |
| `agent/created` | `ensureCommandShadows(agent)`：捕获 → 若译文就绪则注册；否则登记待翻译 |
| `agent/disposed`（payload `{agent}`，`dsh-agent/lib/index.js:551-556`） | 从 `WeakMap` 记录里删除；宿主随 agent fiber 自动清层 |
| `commands/change`（全局定义变化） | debounce 50ms → 重算 targets 的 digest；变化则重捕获并重注册（见 4.3） |
| 翻译完成（首次或重译） | 对 `agents.list()` 里每个 agent 注册/刷新影子 |
| `restore`（工具/配置） | 全部 dispose；`state.commands.restoredAt=now`；保留译文缓存 |
| `apply` | 重新注册（缓存命中则同步完成） |
| `retranslate` | 清空命令译文缓存 → 重新翻译 → 重注册 |
| 宿主版本变化（启动时 `state.hostVersion` 不匹配） | 清空命令译文缓存 + 全部 dispose → 重新翻译 → 注册 |
| 插件 `dispose()` | 全部 dispose + 摘监听；**必须显式做**（effect 归 agent fiber，不会随插件卸载自动回收） |

### 4.3 幂等、去重与自触发

- **每 agent 记录**：`WeakMap<agent, { signature, disposers: Function[] }>`，`signature = sha256(targets.join(',') ∥ 每条 en ∥ hint ∥ zh)`。
  相同则直接返回，不重复注册。
- **自触发**：我们自己的 `register()/dispose()` 也会触发 `commands/change`（实测 4 次事件）。
  监听器只比较「**全局视角**的 targets digest」——影子只存在于 agent 层，不影响全局视角，所以自触发不会引起重注册。
- **并发**：`runExclusive`（v0.1 已有）串行化「重捕获 + 重注册」，避免两个 agent 同时创建时的重复注册。
- **失败隔离**：单个 agent 注册失败只记 warning，不影响其它 agent；`status` 里如实计入 `failedAgents`。

### 4.4 还原 / 退出 / 卸载

| 场景 | 行为 | 用户可见结果 |
| --- | --- | --- |
| `restore` | dispose 全部影子 | 菜单立即回英文（下一次 `commands/change` 软刷新后） |
| `restoreOnQuit: true` | 退出前 dispose 并落 `restoredAt` | 下次启动默认英文，直到 `apply` |
| 插件卸载（HMR/禁用） | `dispose()` 里显式调用 disposers | 影子消失，菜单回英文 |
| 进程退出 | 内存影子随进程消失 | 无需清理磁盘 |

注意：agent 层 effect 的 owner 是 **agent fiber**，插件 fiber 卸载**不会**自动回收（v0.1 `agent-layer.js` 踩过同款坑），
所以 `controller.dispose()` 必须遍历所有记录的 disposers。

### 4.5 升级自愈与 fingerprint

```
commandFingerprint(name, en, hint, hostVersion)
  = sha256(hostVersion ∥ '\0' ∥ 'command' ∥ '\0' ∥ name ∥ '\0' ∥ sha256(en ∥ '\0' ∥ (hint ?? '')))
```

- 存进 `state.commands.byName[name].fingerprint`，同时作为 LLM 缓存键（复用 `state.cache`）。
- **漂移判定**：`current fingerprint !== stored` ⇒ 译文过期。
- **策略（与技能一致：先还原，再重译）**：
  1. 立即 dispose 该 name 的所有影子（回英文，绝不展示错配译文）；
  2. 后台重译（1 次 LLM 批量调用，最多 3+N 条，成本可忽略）；
  3. 成功后对所有已知 agent 重新注册；失败则保持英文并 `stale=true`，`status.warnings` 里给出原因。
- **宿主版本变化**：`state.hostVersion !== 当前版本` 时整体作废（清 `commands.byName` 与相关 cache），与技能的升级语义对齐。
- **是否纳入 targets 集合**：不纳入。targets 是配置，变化由 config 变更通知；纳入会让「改配置」和「升级」混淆。

---

## 5. 配置、译文与词典

### 5.1 配置

```yaml
# cordis.patch.yml（插件行 config）
- insert:
    - id: skill-desc-zh
      name: dsh-skill-desc-zh
      config:
        enabled: true
        engine: auto            # auto | llm | dictionary
        translatePreset: true
        restoreOnQuit: false
        projectAllowlist: ['/Applications/dsh']
        llm: { provider: null, model: null, timeoutMs: 30000 }
        targets:
          global: [office, office-docx, office-export-pdf, office-pptx,
                   office-recalculate, office-render, office-xlsx, browser-skill]
          preset: [agent-experience, cordis-composition-reference,
                   cordis-plugin-development, editing-cordis-compositions]
          commands: [acp, acp-cache, agent-teams]     # ← v0.2 新增
```

- `normalizeConfig` 增加 `targets.commands = asStringArray(targets.commands, DEFAULT_TARGETS.commands)`；
  **默认值就是三条**，profile 旧配置不写这一项也能生效。
- 语义：`targets.commands: []` = 关闭该功能；`state.enabled === false` = 全局还原（技能 + 命令一起）。
- 内置命令排除：若用户把 `goal/plan/feedback/compact/permission/export` 写进 targets，
  或某条命令的 `definitionId` 命中 `BUILTINS`，一律跳过并 warning（GUI 侧本来就按 `definitionId` 本地化，影子无效）。
- `inject`：`['skills','tools','commands']`。`commands` 由 base bundle 提供（`dsh-base/cordis.patch.yml:319`），
  加进 `inject` 可保证 apply 前服务已就绪；运行时仍用 `ctx.get('commands')` 兜底，缺失即功能降级。

### 5.2 三条建议译文（含校验）

校验器复用 `lib/translate.js:162 validateTranslation`：非空、单行、含汉字、≤400 字符、≤英文原文 1.6 倍、不得与原文相同、
不得是 frontmatter/代码块/`description:` 前缀/引号包裹。

| 命令 | 英文（字符数） | 建议中文（字符数） | 比值 | 结论 |
| --- | --- | --- | --- | --- |
| `acp` | `Show bili context-compression status`（36） | `显示 bili 上下文压缩状态`（15） | 0.42 | ✅ |
| `acp-cache` | `Prompt-cache reconciliation (same report as the acp_cache tool)`（63） | `提示词缓存对账（与 acp_cache 工具同源同报）`（27） | 0.43 | ✅ |
| `agent-teams` | `run a goal with a multi-agent team (you become the captain)`（59） | `以多智能体团队运行目标（你将成为队长）`（19） | 0.32 | ✅ |
| `agent-teams-dev`（模板） | `run a goal with the AgentTeams dev profile`（42） | `以 AgentTeams「dev」配置运行一个团队目标`（27） | 0.64 | ✅ |

`agent-teams-<profile>` 是动态命令，走**模板**（不依赖 LLM）：

```
en:  run a goal with the AgentTeams <name> profile
zh:  以 AgentTeams「<name>」配置运行一个团队目标
```

模板在 `command-layer.js` 里以两条正则表实现（`^run a goal with the AgentTeams (.+) profile$`），
匹配则 `engine: 'template'`；不匹配再走 LLM/词典。这样即使无模型，profile 命令也能中文化。

### 5.3 词典与缓存

- 复用 `lib/dictionary.zh.json`（key = 英文原文，value = 中文），新增 3 条命令描述。
  同一份文件、同一套 `loadDictionary` 校验，无需新文件。
- 模板条目**不放进词典**（它们是模式，不是精确匹配），写在 `lib/command-layer.js` 的常量表里。
- 缓存：`state.cache[fingerprint] = { zh, engine, updatedAt }`，与技能共用；`pruneCache` 需要扩展
  （当前只保留 skills/projects 引用的 key，见 §7.1）——否则命令译文每次启动都被清空、反复重译。

### 5.4 翻译调用

复用 `translateBatch`（`lib/translate.js:591`），新增两个**向后兼容**选项：

- `systemPrompt`：允许传入命令专用提示词（把「技能描述」改成「斜杠命令描述」，并要求保留命令名原文）；
- 条目名用 `command:<name>`，避免与技能名空间冲突（LLM 返回的 JSON 键即这个）。

```js
const items = targets.map((name) => ({
  name: `command:${name}`,
  description: capture.en,
  fingerprint: commandFingerprint(name, capture.en, capture.input?.hint, hostVersion),
}))
const out = await translateBatch({ items, llm, selection, engine, cache, dictionary, signal, logger })
```

成本：3 条短句 = 一次调用、约 200 输入 token；重译只发生在升级/漂移时。

---

## 6. status / doctor 与降级

### 6.1 `status.commands`

```jsonc
"commands": {
  "enabled": true,
  "targets": ["acp", "acp-cache", "agent-teams"],
  "translations": {
    "acp": { "zh": "显示 bili 上下文压缩状态", "engine": "llm", "stale": false },
    "acp-cache": { "zh": "…", "engine": "llm", "stale": false },
    "agent-teams": { "zh": "…", "engine": "dictionary", "stale": false }
  },
  "agents": 2,
  "registered": 6,          // 2 agents × 3 targets
  "failedAgents": 0,
  "lastRegisteredAt": "2026-10-21T…",
  "warnings": []
}
```

### 6.2 `doctor` 新增检查 `command-layer`

用**最近一个 agent** 的视角做只读自检（与 v0.1 的 `agentLayerCheck` 同型）：

1. `commands.list(agent)` 里每个 target 的 `description` === 期望中文；
2. 同一条的 `definitionId` 与捕获快照一致；
3. `commands.list(undefined)` 里同一 target 仍是英文（证明没污染全局）；
4. 三条 target 都不在 6 条内置里（`definitionId` 不在 `BUILTINS` 集合）。

结果字段：`{checked:{ok, reason?}, registered, sample}`。
**无 agent / 服务缺失 / 未注册 → `ok:false` + reason（不伪造成通过）**，与 v0.1 的「无 agent 时不算通过」口径一致。

### 6.3 降级矩阵

| 失败点 | 表现 | 命令可用性 |
| --- | --- | --- |
| `commands` 服务缺失 | 只 warning，功能禁用 | ✅ 完全不受影响（英文） |
| 目标命令不存在（插件未装） | `missing`，不注册 | ✅ |
| LLM 不可用 / 超时 | 词典 + 模板；仍无则保持英文（`engine: none`） | ✅ |
| 影子注册抛错 | 该 agent 记 failed，其它 agent 继续 | ✅ |
| 原 handler 在调用时已消失 | 返回 `{kind:'error', text:'…原始实现已不可用…'}`，`command/done` 记 error | ⚠️ 只有这一条命令报错，且文案说明原因 |
| 翻译结果非法（校验失败） | 重试 1 次 → 词典 → 英文 | ✅ |

---

## 7. 测试与 e2e

### 7.1 单元测试（`test/command-layer.test.mjs`，纯函数 + 假 commands 服务）

| # | 用例 | 断言 |
| --- | --- | --- |
| U1 | `buildShadowDefinition` 透传七个字段 | `definitionId/input/recordInput` 原样；未知字段不带 |
| U2 | 内置命令排除 | `goal` 在 targets 里时 `skipped: 'builtin'` |
| U3 | 捕获失败 → missing | 不调用 `register`，`status.registered === 0` |
| U4 | 委托实时优先 | 全局 handler 被替换后，调用走新 handler |
| U5 | 委托快照兜底 | 全局 `find` 返回 undefined 时走快照 |
| U6 | 委托错误语义 | 原 handler 抛错 → 影子不吞，错误原样抛出 |
| U7 | 原 handler 彻底消失 | 返回 `{kind:'error',…}`，不抛 |
| U8 | fingerprint 稳定性 | 同输入同 hash；hostVersion/en/hint 任一变化即变化 |
| U9 | 漂移策略 | 指纹不匹配 → 先 dispose，再重译，再注册（事件顺序断言） |
| U10 | 幂等 | 连续两次 `ensure` 只注册一次 |
| U11 | restore/apply | dispose 全部 → 再次 apply 注册回 |
| U12 | 模板翻译 | `run a goal with the AgentTeams dev profile` → `以 AgentTeams「dev」配置运行一个团队目标`（engine=template） |
| U13 | 校验 | 三条建议译文过 `validateTranslation` |
| U14 | pruneCache | 命令缓存键不被清掉 |

### 7.2 端到端（`scripts/commands-e2e.mjs`，不启动 DSH、不改磁盘、不联网）

直接复用 §2.7 探针的形状（Electron-as-node + app.asar 真实模块）：

1. 真实 `CommandRuntime` + `createScope`；
2. 全局注册三条命令（**原样复制**真实描述与 `input`）；
3. 用 `lib/command-layer.js` 注册影子；
4. 断言：agent A 视角中文 / global 英文 / **另一个未注册影子的 agent B 仍是英文**（作用域隔离）/ `definitionId` 保留 / `input.hint` 保留 / 不含 handler；
5. `execute(agent,'/acp')` → 原 handler 被调用一次，结果透传；
6. `execute(agent,'/agent-teams --profile dev go')` → 原 handler 收到 `rawInput='--profile dev go'`；
7. `restore()` → agent 视角回英文；`apply()` → 回中文；
8. `dispose()` → 回英文且 `commands/change` 有事件。

### 7.3 真实宿主验收（人工/半自动，见 §10 A2/A3）

在 desktop profile 里新开一个会话：`/` 菜单里 `/acp`、`/acp-cache`、`/agent-teams` 显示中文；
点 `/acp` 仍输出压缩状态报告；`skill_desc_zh({action:"restore"})` 后重新打开菜单回英文。

---

## 8. 风险清单

### 8.1 Top 3

| # | 风险 | 影响 | 缓解 | 验证 |
| --- | --- | --- | --- | --- |
| **R1** | 委托 handler 的「过期快照」：源插件热重载后闭包换了，快照指向旧实现 | 执行结果异常（旧版本行为） | 每次调用 `find(undefined,name)` 实时解析；快照只兜底；源插件卸载后给出明确 error | U4/U5/U7 + e2e 步骤 5 |
| **R2** | `commands/change` 自触发抖动：我们自己的注册也发事件 → 无限重注册 | CPU 抖动、菜单闪烁 | 监听器只比较**全局视角** digest（影子不改全局）；50ms debounce；`runExclusive` 串行；signature 去重 | U10 + 真实会话观察 |
| **R3** | GUI 缓存：菜单已打开时可能短暂显示旧英文 | 观感 | `commands/change` → 客户端 `invalidateAll()`（已确认代码路径）；下次打开必为中文 | 真实会话验收 A2 |

### 8.2 全量风险

| # | 风险 | 影响 | 概率 | 缓解 |
| --- | --- | --- | --- | --- |
| R4 | 同层重名：同一 agent 重复注册 | `command "x" is already registered in this scope` 抛错 | 中 | signature 去重 + 失败隔离（单 agent 失败不扩散） |
| R5 | 全局层误注册 | 宿主启动即抛错，影响所有命令 | 低 | 代码里禁止 `ctx.get('commands')` 全局注册；单测断言调用只发生在 agent ctx |
| R6 | 影子漏掉 `input.attachments` | `/agent-teams` 发图行为变化 | 中 | `input` 原样透传 + U1 断言 |
| R7 | `recordInput:false` 丢失 | `command/run` 记录 args，隐私/回放差异 | 低 | 原样透传 + U1 |
| R8 | 卸载/HMR 后影子残留 | 插件没了但描述还是中文 | 中 | `controller.dispose()` 显式遍历 disposers（v0.1 同款坑） |
| R9 | 内置命令被误影 | 客户端按 `definitionId` 本地化，影子无效且可能显示 `definitionId` 冲突 | 低 | targets 白名单 + `BUILTINS` 排除 + warning |
| R10 | 翻译内容失真（命令语义） | 用户误解命令用途 | 低 | 复用同一套校验（含 CJK/长度/单行）+ 词典 + 模板；`status` 可查 |
| R11 | 多 agent 并发注册竞态 | 重复注册/漏注册 | 中 | `runExclusive` + WeakMap 记录 |
| R12 | 宿主未来给 commands 加 locale | 我们的影子成为兼容层（重复翻译） | 低 | 保留 targets 开关；届时按 `definitionId`/能力检测自动停用（后续版本） |
| R13 | 第三方插件在 agent 层也注册同名命令 | 同层冲突报错 | 极低 | 注册失败被捕获并 warning，不崩溃 |
| R14 | `agent/created` 过早（`agent.ctx` 尚未就绪） | 注册失败 | 低 | 失败重试一次 + startup 用 `agents.list()` 补注册 |
| R15 | 性能：每 agent 3 条注册 | 内存/事件开销极小（实测注册是同步 Map 操作） | 低 | signature 去重；仅 targets 内 |

---

## 9. 实施拆解、版本与工时

### 9.0 `lib/index.js` 现有接入点（实施时按行落位）

| 位置 | 现状 | v0.2 改动 |
| --- | --- | --- |
| `lib/index.js:43-44` | `export const inject = ['skills','tools']` | 追加 `'commands'` |
| `lib/index.js:1682-1688` | `services = {skills, llm, agentDefaultModel, workingDirectory, agents}` | 追加 `commands: () => ctx.get('commands')` |
| `lib/index.js:1693-1702` | `ctx.skills.registerProvider(...)`（L1） | 不变 |
| `lib/index.js:1705` | `ctx.tools.register(createTool(...))` | 不变（工具输出自动带 `commands` 段） |
| `lib/index.js:1713-1731` | `ctx.on('agent/created', …)` → `registerForAgent` + `ensureShadowsForAgent` | 追加 `controller.ensureCommandShadows({agent})` |
| `lib/index.js:1732-1758` | `ctx.effect(() => { setTimeout(startup); return cleanup })` | cleanup 里追加摘除 `commands/change` 监听 + `controller.dispose()` 已覆盖影子 |
| `lib/index.js:1130-1200` | `restore()`：dispose providers + 影子进废纸篓 | 开头追加 `disposeCommandShadows()`（先回英文） |
| `lib/index.js:1203-1300` | `status()` 返回 `{…, agentLayer, …}` | 追加 `commands` 段（§6.1） |
| `lib/index.js:1316-1400` | `doctor()` 的 `agent-layer` 检查 | 追加 `command-layer` 检查（§6.2） |
| `lib/index.js:1511-1560` | `restoreProjectsSync`（restoreOnQuit） | 追加命令影子 dispose（退出前） |
| `lib/index.js:1562-1610` | `startup()`：版本自愈 + 捕获 + 翻译 | 追加命令译文预热 + `agents.list()` 补注册 |
| `lib/index.js:1612-1660` | `controller` 返回对象 | 追加 `ensureCommandShadows`、`disposeCommandShadows`、`commandsStatus` |
| `lib/state.js:13` | `STATE_VERSION = 1` | 改 `2` + `commands` 段 + `pruneCache` |
| `lib/tool.js:10` | `TOOL_ACTIONS` 6 个 action | **不新增 action**；`status`/`doctor` 输出自然包含命令段 |

### 9.1 文件级改动

| 文件 | 改动 | 估算 |
| --- | --- | --- |
| `lib/command-layer.js`（新增） | 捕获、影子构造、委托、注册/注销、fingerprint、模板翻译、`status`/自检（约 220 行） | 3h |
| `lib/index.js` | `services.commands`、`inject` 加 `commands`、`agent/created` 接线、`commands/change` 监听 + debounce、`restore/apply/retranslate/dispose` 集成、`status`/`doctor` 字段、`normalizeConfig.targets.commands` | 2h |
| `lib/state.js` | `STATE_VERSION` 1→2、`commands: {byName, updatedAt, restoredAt}`、`normalizeState` 迁移、`pruneCache` 扩展 | 1h |
| `lib/translate.js` | `systemPrompt` 选项（向后兼容）+ `SYSTEM_PROMPT_COMMANDS` | 0.5h |
| `lib/dictionary.zh.json` | +3 条命令描述 | 0.2h |
| `lib/tool.js` | `status`/`doctor` 输出自动带 `commands`（无新 action） | 0.2h |
| `test/command-layer.test.mjs`（新增） | U1–U14 | 2h |
| `scripts/commands-e2e.mjs`（新增） | §7.2 全流程 | 1h |
| `README.md` / `docs/design.md`（§15 追加）/ 本文档 | 文档 | 1h |
| 回归 | `npm test` 全绿、v0.1 技能链路不回归 | 1h |

合计约 **1 人日**（≈11.6h）。

### 9.2 版本与兼容

- 版本 `0.2.0`（新增功能，向后兼容）。
- `engines.dsh` 不变（`>=0.2.1-rc.2`）。
- state v1 → v2 自动迁移（v1 文件读入后补空 `commands` 段，写回前 `trash.snapshot`）。
- 现有 config 不写 `targets.commands` 时默认启用三条。

### 9.3 提交顺序

1. `lib/state.js`（schema + 迁移）→ 单测；
2. `lib/command-layer.js` + 单测；
3. `lib/index.js` 接线 + `commands/change` + restore/apply/dispose；
4. `lib/translate.js` prompt + 词典；
5. `scripts/commands-e2e.mjs`；
6. 文档 + 版本号；
7. 安装到 desktop profile（预检 → `install_bundle` 本地目录 → 新版会话验收）。

---

## 10. 验收标准

| # | 标准 | 判定方式 |
| --- | --- | --- |
| A1 | 全局视角永远英文 | `commands.list(undefined)` 三条 target 描述 === 英文原文 |
| A2 | 会话内三条命令显示中文 | 新会话 `/` 菜单肉眼确认 + `skill_desc_zh status` 的 `commands.translations` |
| A3 | 执行行为不变 | 点 `/acp` 出压缩报告；`/agent-teams --profile x goal` 仍创建团队 |
| A4 | `definitionId`/`input` 保留 | e2e 断言 + `list(agent)` 快照对比 |
| A5 | 一键还原 | `restore` 后菜单回英文；`apply` 后回中文 |
| A6 | 内置 6 条不受影响 | `list(agent)` 中 6 条仍由 GUI 本地化（描述与我们无关） |
| A7 | 升级自愈 | 改 `hostVersion` 后重启：`stale` 出现 → 重译 → 回中文（日志/状态可见） |
| A8 | 卸载无残留 | 禁用插件后 `list(agent)` 三条回英文 |
| A9 | 测试全绿 | `npm test`（含 U1–U14）+ `npm run e2e:commands` |
| A10 | 降级诚实 | 断网/无模型时 `engine: dictionary|template|none`，`status.warnings` 如实 |

---

## 11. 待决问题

1. **`agent-teams-<profile>` 是否默认中文化？** 本文建议是（模板零成本）。若担心 profile 名被翻译走样，可只翻固定部分。
2. **漂移时是否「先下架再重译」？** 本文建议是（与技能升级语义一致）。替代方案是保留旧中文并标 `stale`，观感更稳但可能展示过期信息。
3. **`restore` 是否要提示「命令描述已恢复英文」？** 建议在工具输出 summary 里加一句，无需新 action。
4. **是否需要在 GUI 里标注「中文由 skill-desc-zh 提供」？** 不建议——需要改客户端，且属于噪声。
5. **state v2 是否顺带把 `cache` 分域（skills/commands）？** 可选。当前用指纹做 key，命名空间已隔离；分域只影响可读性。

---

## 12. 证据索引

| 证据 | 位置 | 支撑的结论 |
| --- | --- | --- |
| `register()` 用 `layers.effect(this.ctx, …)` | `dsh-commands/lib/index.js:267-270` | 注册落点 = 调用方 ctx 的作用域（§3.1） |
| 类注释「…shadow globals for that agent」 | `dsh-commands/lib/index.js:207-209`；宿主 `Service` 在线契约同文 | agent 层影子是官方机制（§0.2） |
| 全局重复注册报错文案 | `dsh-commands/lib/index.js:90`；探针实测 | 全局层不可行（§2.7/§2.8） |
| `normalizeDefinition` 字段白名单 | `dsh-commands/lib/index.js:150-198` | 影子七字段（§3.1） |
| `view(agent)=merge(agent,…)` | `dsh-commands/lib/index.js:424-426` | 最近层胜出（§2.2） |
| `execute` 调 `definition.handler(invocation)` | `dsh-commands/lib/index.js:380-395` | 委托的调用形态与错误语义（§3.2） |
| `merge` 最远→最近覆盖 | `dsh-scope/lib/index.js`（`ScopedLayers.merge`） | 同层/跨层语义（§2.2） |
| agent scope 键 = agent 对象 | `dsh-agent-loop/lib/index.js:777-781` | `list(agent)` 能看到影子（§2.4） |
| GUI 只本地化 6 条内置 | `dsh-client-ui-commands/lib/client.js:781,794,1329,1541` | 非内置原样展示描述（§2.5） |
| `commands/change` → `invalidateAll()` | `dsh-client-ui-commands/lib/client.js:1436-1437,859` | 软刷新链路（§2.5/§8.1 R3） |
| RPC 以 agent 为作用域 | `dsh-commands/lib/typert.remote-client.js`（`scope:{context:'agent',wire:'agentId'}`） | GUI 看到的是 agent 视角（§2.5） |
| billion-context 注册 | `billion-context/dist/agent/dsh-native.js` | 英文硬编码、handler 闭包（§2.6） |
| agent-teams 注册 + gesture boundary | `@nanmicoder/dsh-agent-teams/lib/command.js`、`lib/index.js:157-162` | 动态 profile 命令与执行路径（§2.6） |
| 真实模块探针输出 | `/tmp/verify-command-scope.mjs` 运行记录（§2.7） | 机制、委托、还原、事件、同层报错全部实测 |
| `commands` 在 base bundle | `dsh-base/cordis.patch.yml:319` | 服务必然存在（§5.1） |
| v0.1 agent 层同型写法 | `skill-desc-zh/lib/agent-layer.js`、`scripts/agent-layer-e2e.mjs` | 写法与 e2e 骨架可复用（§3.4/§7.2） |
