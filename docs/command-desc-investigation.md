# 指令描述中文化独立复核：`/acp`、`/acp-cache`、`/agent-teams`

> 复核时间：2026-10-21 21:44 +08:00
> 复核对象：desktop profile（`~/.dsh/profiles/desktop`），DSH desktop `0.2.1-rc.2`
> 复核人：verifier（t7，attempt `3200abd2-6648-41a6-a064-051f93333f1e`）
> 复核方式：只读源码 + 真实宿主模块进程内实验；**未改动任何生产代码/插件源码**
> 结论一句话：**这三个不是“技能（skill）”，`skill-desc-zh` 从设计上就管不到；它们的描述由第三方插件在 global scope 硬编码注册，而 Web GUI 只对 6 个内置指令做本地化，其余指令原样显示注册时的英文 `description`。**
> 修复可行，但需要新增“agent 级指令影子”能力，不能靠改词典或改客户端语言包完成。

---

## 0. 结论摘要

1. `/acp`、`/acp-cache` 由 `billion-context@0.1.202` 在 `dist/agent/dsh-native.js` 的 `apply(ctx)` 里注册，描述分别是：
   - `Show bili context-compression status`
   - `Prompt-cache reconciliation (same report as the acp_cache tool)`
2. `/agent-teams` 由 `@nanmicoder/dsh-agent-teams@0.1.25` 在 `lib/command.js` 的 `registerAgentTeamsCommand()` 里注册，描述是：
   - `run a goal with a multi-agent team (you become the captain)`
3. 两个插件都是 **host-plane bundle**（profile `dsh.profile.bundles` 直接挂载），`ctx` 没有 agent scope 标记，因此注册落在 **global 层**。
4. 宿主 `commands` 服务本身支持“agent 作用域影子”：从 `agent.ctx` 里注册同名指令，会覆盖该 agent 看到的 global 定义（宿主源码注释原文见 §3）。但这两个第三方插件没有使用该机制，而是直接注册英文描述。
5. Web 客户端 `@deepseek-ai/dsh-client-ui-commands` 只对 6 个第一方内置指令按 `definitionId` 做中文 `label/description` 映射；其余指令走 `builtinRowFace(...) ?? { description: c.description }`，即**原样显示宿主注册的英文描述**。客户端没有“按指令名覆盖描述”的注入点。
6. `skill-desc-zh` 只注入 `skills`、`tools`，全部代码中没有 `commands` / `agent-teams` / `acp-cache` 引用（grep 0 命中），所以它不可能翻译这三个指令。
7. 独立实验（真实 `dsh-commands` + `dsh-scope` 类）验证：给 agent A 挂一个 `inject:['commands']` 的 scope 影子，注册同名中文描述，`commands.list(agentA)` 变中文，agent B 与 global 仍英文，`commands.execute(agentA, ...)` 仍调用原 handler；dispose 影子后恢复英文。
8. 推荐修复：新增一个独立插件（或给 `skill-desc-zh` 增加一个可选模块），在 `agent.ctx` 下注册 **指令描述影子**；不要改第三方包源码，也不要改客户端语言包。实现要点与坑见 §7。

---

## 1. 复核方法与可复现命令

### 1.1 读取宿主/插件源码

`app.asar` 是单个文件，普通 `node` 不能直接读；使用 Electron 的 Node 模式：

```bash
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  -e "const fs=require('fs'); console.log(fs.readFileSync('<asar 内路径>','utf8'))"
```

本次用到的文件：

| 文件 | 说明 |
| --- | --- |
| `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-commands/lib/index.js` | 宿主指令注册表 |
| `…/@deepseek-ai/dsh-commands/lib/typert.host.js` | 指令服务的远程协议元数据/文档 |
| `…/@deepseek-ai/dsh-scope/lib/index.js` | scope 层合并 |
| `…/@deepseek-ai/dsh-agent-loop/lib/index.js` | Agent 构造时创建 `agent.ctx` |
| `…/@deepseek-ai/dsh-client-ui-commands/lib/client.js` | Web GUI 斜杠菜单 |
| `…/@deepseek-ai/dsh-api-remotes/lib/index.js` | `commands/change` 事件转发 |
| `~/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js` | billion-context 实际入口 |
| `~/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-acp.js` | 另一个入口（未加载，见 §2.4） |
| `~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/index.js` | agent-teams 入口 |
| `…/@nanmicoder/dsh-agent-teams/lib/command.js` | agent-teams 指令注册 |

### 1.2 进程内实验

见 §6；脚本在 `/tmp/command-shadow-verify/experiment.mjs`，输出在 `/tmp/command-shadow-verify/experiment.out`。

### 1.3 实时宿主检查

```text
cordis_inspect_query(platform=host, provider=Config, method=listConfigs,
                     input={name:"billion-context"})
→ {"entries":[{"id":"include:bili-native","patchId":"bili-native",
               "name":"billion-context","status":"absent"}],"total":1}

cordis_inspect_query(platform=host, provider=Config, method=listConfigs,
                     input={name:"@nanmicoder/dsh-agent-teams"})
→ {"entries":[{"id":"include:agent-teams","patchId":"agent-teams",
               "name":"@nanmicoder/dsh-agent-teams","status":"schema"}],"total":1}
```

两条 live entry 证明当前 profile 确实挂载了这两个插件；`status:"absent"`/`"schema"` 表示“没有显式配置 / 使用 schema 默认值”，不是“未启用”。

---

## 2. 三个命令的注册来源（英文硬编码）

### 2.1 billion-context：`/acp` 与 `/acp-cache`

文件：`~/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js`（v0.1.202，2,359,187 B，146 行；第 137 行是压缩后的一整行）。

模块导出：`export { …, apply, inject, name }`（文件末行）。
`inject` 列表在偏移 `2317754`：

```js
inject=["tools","commands","agents"];
```

`apply` 定义在偏移 `2339483`：

```js
function apply(ctx){ … }
```

指令注册在偏移 `2355328` / `2355465`：

```js
ctx.commands.register({
  name:"acp",
  description:"Show bili context-compression status",
  handler:invocation=>statusOutcome(ctx,invocation)
});
ctx.commands.register({
  name:"acp-cache",
  description:"Prompt-cache reconciliation (same report as the acp_cache tool)",
  handler:invocation=>cacheOutcome(ctx,invocation)
});
```

偏移对照：

| 内容 | 文件内偏移 | 所在行 |
| --- | ---: | ---: |
| `ctx.commands.register({name:"acp"` | 2,355,328 | 137 |
| `description:"Show bili context-compression status"` | 2,355,371 | 137 |
| `ctx.commands.register({name:"acp-cache"` | 2,355,465 | 137 |
| `description:"Prompt-cache reconciliation (same report as the acp_cache tool)"` | 2,355,514 | 137 |
| `function apply(ctx){` | 2,339,483 | 137 |

注册代码直接位于 `apply(ctx)` 函数体内，**不在** `ctx.inject(...)` / `agent.ctx` 回调里。宿主把该插件挂在 host 组合层（profile bundle patch）：

`~/.dsh/profiles/desktop/node_modules/billion-context/dsh.bundle.patch.yml:14-16`

```yaml
- insert:
    - id: bili-native
      name: billion-context
```

因此 `ctx` 是 host-plane、无 agent scope 标记的插件上下文，`register()` 落入 **global 层**。

> 版本提示：`dsh-native.js` 是压缩产物，偏移会随版本变化；本复核以 `billion-context@0.1.202` 为准，引用时请同时带版本号。

### 2.2 agent-teams：`/agent-teams`

入口：`~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/index.js`

```js
// line 41
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents'];

// line 118
export function apply(ctx, config) {
  …
  // lines 157-160
  if (config.slashCommand ?? true) {
    ctx.inject(['commands'], (commandCtx) => {
      registerAgentTeamsCommand(commandCtx, () => config.profiles ?? {});
    });
    installAgentTeamsGestureBoundary(ctx, () => config.profiles ?? {});
  }
  …
}
```

`ctx.inject(['commands'], …)` 里的 `ctx` 仍是 host-plane 的 `apply` 上下文；`commandCtx` 只是注入了 `commands` 服务的子上下文，**不是**某个 agent 的 scope 上下文。因此 `commandCtx.commands.register(...)` 仍落 global 层。

`lib/command.js:73-118`：

```js
export function registerAgentTeamsCommand(ctx, getProfiles = () => ({})) {
    ctx.effect(() => {
        const dispose = [];
        dispose.push(ctx.commands.register({
            name: AGENT_TEAMS_COMMAND,                         // line 77
            description: 'run a goal with a multi-agent team (you become the captain)', // line 78
            input: { hint: '[--profile <name>] <goal>' },       // line 79
            handler(invocation) { … },                          // lines 80-94
        }));
        for (const profileName of Object.keys(getProfiles())) {
            …
            dispose.push(ctx.commands.register({
                name: commandName,
                description: `run a goal with the AgentTeams ${profileName} profile`, // line 102
                input: { hint: '<goal>' },
                handler(invocation) { … },
            }));
        }
        return () => { … };
    }, 'agent-teams: slash commands');
}
```

本 profile 的 `cordis.patch.yml:10-21` 只配置了 `stateDir`/`memberProvider`，没有 `profiles`，所以当前只注册 `/agent-teams` 本身，不会出现 `agent-teams-<profile>` 别名；如果以后配置了 profiles，那些别名的英文描述同样需要处理。

入口注释本身也说明了它是给 GUI 斜杠菜单用的（`lib/index.js:147-149`）：

```js
// Deterministic activation surfaces: the closed-namespace `/agent-teams`
// host command (surfaces in the Web GUI slash menu via the Harness
// ui-commands client) and the plain-text gesture boundary …
```

### 2.3 为什么它们一定是 global

- 两个插件都通过 profile 的 `dsh.profile.bundles` 挂载，Loader 在 **host 组合层**执行 `apply`，不是在某个 agent 的 scope 里。
- 宿主 `commands.register()` 的注册层由 `this.ctx` 的 scope tag 决定（§3）。
- 实验里 `root.commands.register(...)`（相当于 host 组合层）得到 global 行；只有 `scopeA.ctx.plugin({inject:['commands'], …})` 注册的才进 agent A 的 scope 层。

### 2.4 `dsh-acp.js` 不是 live 入口

`billion-context` 包内还有 `dist/agent/dsh-acp.js`，其中也有：

```js
var name="bili-acp";
var inject=["commands"];
function apply(ctx){
  ctx.commands.register({name:"acp",description:"Show bili context-compression status",handler:statusOutcome});
  ctx.commands.register({name:"acp-cache",description:"Prompt-cache reconciliation (same report as the acp_cache tool)",handler:cacheOutcome})
}
export{apply,inject,name};
```

但它**不是** DSH 实际加载的入口：

- `package.json:7-14` 的 `exports` 只有 `"."`/`"./dsh"` → `./dist/agent/dsh-native.js`、`"./server"` → `opencode-native.js`、`"./client"` → `dsh-native-client.js`；没有 `dsh-acp.js`。
- `dsh-native.js` 内对 `"bili-acp"` / `"dsh-acp"` 的引用数 = 0。
- 包内 `.js/.mjs/.json` 文件按文件名引用 `dsh-acp` 的搜索结果为空（只有文档/CLI 说明层面提到）。
- 如果它也被加载，两个入口都注册同名 global 指令，宿主会直接抛 `command "acp" is already registered`（§3.2）；实际 GUI 正常，反证只加载了一个入口。

结论：DSH 这条路径是 `dsh-native.js`，`dsh-acp.js` 是 CLI/其它 agent 的备用入口，不是本次问题的来源。

---

## 3. 宿主注册表：agent scope 影子是官方机制

### 3.1 注册层由 `this.ctx` 的 scope 决定

`dsh-commands/lib/index.js:266-269`：

```js
register(definition) {
  const registered = normalizeDefinition(definition);
  return this.layers.effect(this.ctx, (layer) => layer.commands.insert(registered.definition.name, registered), { label: "commands.register()" });
}
```

`dsh-scope/lib/index.js:189-218` 的 `effect(ctx, …)`：

```js
effect(ctx, action, options) {
  const scope = scopeOf(ctx);
  …
  if (scope === void 0) layer = this.global;
  else { … this.scoped.set(scope, layer) … }
  …
}
```

`scopeOf(ctx)` 读取 `ctx[kScope]`（`dsh-scope:312-314`）。host-plane 插件上下文没有这个 tag → global；agent scope 上下文有 tag → 该 agent 的 scope 层。

### 3.2 同名规则

`dsh-commands:88-90`：

```js
this.commands = new NamedEntries((name) => new Error(scope === void 0
  ? `command "${name}" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's \`agent.ctx\`)`
  : `command "${name}" is already registered in this scope`));
```

- global 重复注册同名 → 抛第一条，并明确提示“要做 per-agent 变体，就在该 agent 的 `agent.ctx` 下挂一个注入 `commands` 的插件”。
- 同一 scope 内重复 → 抛第二条。
- 不同 scope（global vs agent A）同名 → **允许**，由合并规则决定谁覆盖谁。

### 3.3 合并规则：最近 scope 覆盖 global

`dsh-commands:283-289`：

```js
/**
* List the effective immutable command descriptors for one agent.
* @param agent - exact receiving agent and scoped-layer key.
* @returns name-sorted descriptors after scoped shadowing.
*/
list(agent) {
  return Object.freeze([...this.view(agent).values()].map((command) => command.descriptor).sort(…));
}
```

`dsh-commands:423-425`：

```js
view(agent) {
  return this.layers.merge(agent, (layer) => layer.commands);
}
```

`dsh-scope:170-181`：

```js
/**
* Materialize global named entries followed by scope-chain shadows,
* farthest ancestor first, so the nearest scope's entry wins a name.
*/
merge(scope, pick) {
  const merged = new Map(pick(this.global).entries());
  for (const layer of this.chainLayers(scope)) for (const [name, value] of pick(layer).entries()) merged.set(name, value);
  return merged;
}
```

### 3.4 执行也走合并视图

`dsh-commands:327-331`：

```js
async execute(agent, line, submittedAttachments, signal) {
  const parsed = parseCommand(line);
  if (parsed === void 0) return void 0;
  const command = this.view(agent).get(parsed.name);
  if (command === void 0) return void 0;
  …
}
```

`dsh-commands:388` 调用的是合并后定义的 handler：

```js
const output = command.definition.handler(invocation);
```

所以 scope 影子不仅改描述，也决定实际执行哪个 handler；影子 handler 必须委托给原 handler，行为才不变。

### 3.5 宿主自己的服务文档就是这么写的

`dsh-commands/lib/typert.host.js:187`（服务 `commands` 的 JSDoc）：

> “Human-command registry. Plain-context definitions are global; definitions registered through a command-injected child of an agent context shadow globals for that agent.”

### 3.6 `agent.ctx` 确实就是 scope 上下文

`dsh-agent-loop/lib/index.js:771-779`：

```js
constructor(loopCtx, id, options, session) {
  …
  this.scope = createScope(loopCtx, this);
  this.ctx = this.scope.ctx;
  …
}
```

`createScope` 的定义在 `dsh-scope:296-306`：

```js
function createScope(ctx, key, options) {
  if (options?.parent !== void 0) bindScopeParent(key, options.parent);
  const fiber = ctx.plugin(scope);
  const scoped = fiber.ctx.extend({ [kScope]: key });
  let disposing;
  return { ctx: scoped, rawDispose: fiber.dispose, dispose: () => disposing ??= quiesceFiber(fiber) };
}
```

即 `agent.ctx` 是“以该 Agent 对象为 scope key”的上下文；在它下面挂 `inject:['commands']` 的插件，注册自然落进该 agent 的 scope 层。

### 3.7 远程协议：GUI 拿到的是“某个 agent”的视图

`dsh-commands/lib/typert.host.js:137-157`：

```ts
'commands/list': {
  service: 'commands',
  description: 'List the effective immutable command descriptors for one agent.',
  invocation: { kind: 'direct' },
  scope: {
    context: 'agent',
    wire: 'agentId',
  },
  parameters: [
    {
      name: 'agent',
      wire: 'agentId',
      description: 'exact receiving agent and scoped-layer key.',
      source: 'lookup',
      lookup: 'agent',
      codec: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId', … },
    },
  ],
  …
}
```

客户端调用 `ctx.remote.commands.list(sessionId)`（`client.js:1416`），远程层按 `scope.context='agent'`、`lookup='agent'` 解析成对应 Agent，再走 `list(agent)` 的合并视图。因此 agent 级影子会直接反映到该会话的 GUI 菜单。

---

## 4. GUI 只本地化 6 个内置命令

文件：`@deepseek-ai/dsh-client-ui-commands/lib/client.js`（2103 行）。

### 4.1 语言包只覆盖内置命令

`client.js:710-714` 的注释（原文）：

```js
/**
* `command` namespace dictionaries: the composer menu's section headings,
* the client face (title, description, claim token) of the built-in Host
* commands whose catalog descriptors carry English text only, and the
* popupSelect shell's copy.
*/
```

中文词典 `client.js:717-746` 只有：

```js
"label.goal" / "description.goal" / "token.goal"
"label.plan" / … / "token.plan"
"label.feedback" / … / "token.feedback"
"label.compact" / … / "token.compact"
"label.permission" / … / "token.permission"
"label.export" / … / "token.export"
```

没有 `acp`、`acp-cache`、`agent-teams`，也没有通用的“按指令名翻译”表。

### 4.2 只有 `definitionId` 命中 BUILTINS 才本地化

`client.js:780-795`：

```js
const BUILTINS = {
  goal: "@deepseek-ai/dsh-command-goal",
  plan: "@deepseek-ai/dsh-plan-mode",
  feedback: "@deepseek-ai/dsh-command-feedback",
  compact: "@deepseek-ai/dsh-command-compact",
  permission: "@deepseek-ai/dsh-permission-presets",
  export: "@deepseek-ai/dsh-session-log-export"
};

function builtinCommandName(descriptor) {
  return Object.keys(BUILTINS).find((name) => descriptor.definitionId === BUILTINS[name]);
}
```

`client.js:1304-1336`：

```js
function hostFace(name, icon) {
  return [name, { label: `label.${name}`, description: `description.${name}`, icon }];
}
const HOST_FACES = new Map([
  hostFace("goal", …), hostFace("plan", …), hostFace("feedback", …),
  hostFace("compact", …), hostFace("permission", …), hostFace("export", …)
]);

function builtinRowFace(descriptor, t) {
  const name = builtinCommandName(descriptor);
  const face = name === void 0 ? void 0 : HOST_FACES.get(name);
  return face === void 0 ? void 0 : {
    label: t(face.label),
    description: t(face.description),
    icon: face.icon
  };
}
```

### 4.3 非内置命令直接回落英文 description

`client.js:1532-1542`：

```js
async candidates(session, req) {
  const list = await this.directory.ensureReady(session.sessionId, req.signal);
  const rows = [];
  const seen = new Set();
  for (const c of list) {
    seen.add(c.name);
    rows.push({
      name: c.name,
      ...builtinRowFace(c, this.t) ?? { description: c.description },
      ...c.input !== void 0 ? { hint: c.input.hint } : {}
    });
  }
  …
}
```

三个命令的来源注册都**没有**传 `definitionId`（实验里 `definitionId:null`），所以 `builtinCommandName()` 返回 `undefined` → `builtinRowFace()` 返回 `undefined` → 回落 `description: c.description`，即英文原文。这就是用户看到英文描述的直接原因。

### 4.4 客户端没有“按名字覆盖描述”的注入点

- `register(contribution)`（`client.js:1451-1463`）可以注册**新的**斜杠指令；但同名会撞车：

  `client.js:1544-1546`：

  ```js
  for (const contribution of this.live.contributions.values()) {
    if (!contribution.available(session)) continue;
    if (seen.has(contribution.name)) throw new Error(`ui-commands: contribution /${contribution.name} collides with a host command`);
    …
  }
  ```

- `decorate(decoration)`（`client.js:1470-1482`）只给“裸调用”挂 popup，不提供 label/description 覆盖；`desc` 仍来自 host 行。

因此：**客户端层没有插件可用的描述覆盖通道**；语言包是客户端内部字典，不是可注入服务。

### 4.5 注册变化会刷新菜单

`client.js:1435-1437`：

```js
ctx.remote.$on("commands/change", () => {
  this.directory.invalidateAll();
});
```

`dsh-commands:427-435` 每次 register/dispose 都 dispatch `commands/change`；`dsh-api-remotes/lib/index.js:56-58` 把它作为无过滤事件转发到客户端。`typert.host.js:920` 的文档原文：

> “A command was registered or unregistered. This is an unfiltered registry notification because a global or scoped change may affect any UI view. Observer failures are contained and cannot veto the registry mutation.”

这意味着：如果后续在 agent scope 里补注册中文影子，**不需要重启 GUI**，下一次 `commands/change` 就会让菜单重新拉取并显示中文。

---

## 5. 为什么 `skill-desc-zh` 管不到

`~/dsh-plugins/skill-desc-zh/lib/index.js`：

```js
// line 44
export const inject = ['skills', 'tools']

// line 1672
export function apply(ctx, rawConfig = {}) {
  …
  // line 1693
  ctx.skills.registerProvider((providerControl) => {
  …
}
```

它只操作 `ctx.skills`（技能目录）与 `ctx.tools`（自己的 `skill_desc_zh` 工具），并通过 `agent.ctx` 注册技能层的 provider/影子（`lib/agent-layer.js:6-13`），但**从不调用 `ctx.commands.register`**。

独立 grep：

```bash
cd ~/dsh-plugins/skill-desc-zh
grep -RIn "commands\|acp-cache\|agent-teams" lib scripts test package.json cordis.patch.yml README.md
# 0 行输出
```

`lib/dictionary.zh.json` 的 11 个键也全部是 SKILL.md 的英文 `description`（office ×7 + agent-preset ×4），没有指令名。

结论：这不是“翻译漏了”，而是**技能描述与斜杠指令描述是两套完全不同的注册表**；现有插件没有指令通道。

---

## 6. 独立实验：agent scope 影子可行

### 6.1 实验设计

脚本：`/tmp/command-shadow-verify/experiment.mjs`（68 行）

- 用 `ELECTRON_RUN_AS_NODE` 加载真实宿主模块：
  - `@deepseek-ai/cordis` 的 `Context`
  - `@deepseek-ai/dsh-commands` 的 `CommandRuntime`
  - `@deepseek-ai/dsh-scope` 的 `createScope`
- 在 root 上挂 `CommandRuntime`，注册三个与生产完全同名的 global 英文指令（描述逐字复制）。
- 用 `createScope(root, agentA)` / `createScope(root, agentB)` 模拟两个 agent 的 scope（与 `dsh-agent-loop` 的 `createScope(loopCtx, this)` 同构）。
- 在 agent A 的 scope 下挂一个 `inject:['commands']` 的插件，注册同名中文描述，handler 委托给原 handler。
- 检查：global/agentA/agentB 的 `list()`、`find()`、`execute()`、lifecycle、duplicate 错误、dispose 后恢复。

### 6.2 原始输出（`experiment.out`，逐字）

```text
### 1.globalRows [{"name":"acp","description":"Show bili context-compression status","definitionId":null},{"name":"acp-cache","description":"Prompt-cache reconciliation (same report as the acp_cache tool)","definitionId":null},{"name":"agent-teams","description":"run a goal with a multi-agent team (you become the captain)","definitionId":null}]
### changes.afterGlobal 3
### 2.list.global [{"name":"acp","description":"Show bili context-compression status"},{"name":"acp-cache","description":"Prompt-cache reconciliation (same report as the acp_cache tool)"},{"name":"agent-teams","description":"run a goal with a multi-agent team (you become the captain)"}]
### 2.list.agentA [{"name":"acp","description":"显示 bili 上下文压缩状态"},{"name":"acp-cache","description":"提示词缓存对账（与 acp_cache 工具相同报告）"},{"name":"agent-teams","description":"用多智能体团队执行目标（你成为队长）"}]
### 2.list.agentB [{"name":"acp","description":"Show bili context-compression status"},{"name":"acp-cache","description":"Prompt-cache reconciliation (same report as the acp_cache tool)"},{"name":"agent-teams","description":"run a goal with a multi-agent team (you become the captain)"}]
### 2.find.agentA.acp "显示 bili 上下文压缩状态"
### changes.afterShadows 6
### 3.execute.agentA {"commandId":"cmd-b1750c20-1","result":{"kind":"success","text":"AGENT-TEAMS-ORIGINAL: ship it"}}
### 3.execute.agentB {"result":{"kind":"success","text":"AGENT-TEAMS-ORIGINAL: ship it"}}
### 3.lifecycle [{"agent":"A","type":"command/run","data":{"commandId":"cmd-b1750c20-1","name":"agent-teams","args":" ship it","source":{"kind":"user"}}},{"agent":"A","type":"command/done","data":{"commandId":"cmd-b1750c20-1","kind":"success","text":"AGENT-TEAMS-ORIGINAL: ship it"}},{"agent":"B","type":"command/run","data":{"commandId":"cmd-b1750c20-2","name":"agent-teams","args":" ship it","source":{"kind":"user"}}},{"agent":"B","type":"command/done","data":{"commandId":"cmd-b1750c20-2","kind":"success","text":"AGENT-TEAMS-ORIGINAL: ship it"}}]
### 4.duplicateErrors {"globalDup":"command \"acp\" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's `agent.ctx`)","scopedDup":"command \"acp\" is already registered in this scope"}
### 5.list.agentA.afterDispose [{"name":"acp","description":"Show bili context-compression status"},{"name":"acp-cache","description":"Prompt-cache reconciliation (same report as the acp_cache tool)"},{"name":"agent-teams","description":"run a goal with a multi-agent team (you become the captain)"}]
### changes.afterDispose 9
### changePayloadArg "9"
```

> 说明：最后一行 `changePayloadArg "9"` 是脚本打印的 `changes.length`（变量名起错了），不是事件参数；监听器实际收到 0 个参数，只用于计数。

### 6.3 解读

| 观察 | 说明 |
| --- | --- |
| `1.globalRows` 三行英文、`definitionId:null` | 生产注册没有 `definitionId`，客户端无法按内置命令本地化 |
| `2.list.global` 英文 / `2.list.agentA` 中文 / `2.list.agentB` 英文 | scope 影子只影响目标 agent |
| `2.find.agentA.acp` 中文 | 合并视图按最近 scope 覆盖 |
| `3.execute.agentA`、`agentB` 都返回 `AGENT-TEAMS-ORIGINAL: ship it` | A 执行的是影子 handler，但影子委托给原 handler，行为未变；B 直接执行原 handler |
| `3.lifecycle` 四条 `command/run`/`command/done` | 影子执行仍走宿主生命周期，A/B 各自记录 |
| `4.duplicateErrors` 两条不同文案 | global 重复与 scope 内重复的语义与宿主源码一致 |
| `5.…afterDispose` 英文 | dispose 影子立即恢复 global 视图 |
| `changes.afterGlobal 3 → afterShadows 6 → afterDispose 9` | 每次注册/释放都触发 `commands/change`；GUI 会 invalidate |

### 6.4 关键细节：不能在 scope 上直接 `ctx.commands.register`

第一次实验直接写：

```js
scopeA.ctx.commands.register({ ... })
```

抛：

```text
Error: cannot get property "commands" without inject
```

原因：`scopeA.ctx` 是一个普通 scope 上下文，服务访问受 Cordis 的 `inject` 约束；必须先挂一个注入 `commands` 的插件：

```js
scopeA.ctx.plugin({
  name: 'command-desc-zh-shadow',
  inject: ['commands'],
  apply(ctx) {
    ctx.commands.register({ ... });
  }
});
```

这也正是宿主错误文案建议的“mount a command-injected plugin under that agent's `agent.ctx`”。

---

## 7. 若要修：推荐方案与坑

### 7.1 方案 A（推荐）：独立插件 `dsh-command-desc-zh`

不要改 `billion-context` / `dsh-agent-teams` 的 `node_modules` 源码（升级即丢、且违反“不改内置源文件”的约束），也不要改客户端语言包（非注入点）。新增一个 host-plane 插件：

- 注入 `agents`（拿 agent 列表/事件）与 `tools`（可选，暴露状态工具）；
- 在启动时遍历 `ctx.agents.list()`，并在 `agent/created` 时为每个 agent 挂一个 `agent.ctx.plugin({ inject:['commands'], apply })`；
- 在该 apply 里注册同名中文描述影子，handler 委托原 handler；
- 监听 `commands/change` 处理“global 指令晚到/重注册”的时序；
- 提供 `status/apply/restore/doctor`，与 `skill-desc-zh` 同样的可逆/废纸篓纪律。

优点：与已验证的 `skill-desc-zh` 解耦，失败不影响技能中文化；可单独安装/卸载。
缺点：多一个插件；用户需要再装一次。

### 7.2 方案 B：把模块并进 `skill-desc-zh`

在现有插件里增加 `commands` 能力，工具仍是 `skill_desc_zh`，但状态里多一段“指令描述”。优点是一个插件搞定；缺点是给已验收插件增加新注入和新失败面，需要重跑 t5 的安装/回滚验收。若用户希望“只装一个”，选 B；否则选 A。

### 7.3 实现步骤（伪代码）

```js
// 只处理已知的三条；也可扩展为字典 + 可选 LLM
const WANTED = new Map([
  ['acp', '显示 bili 上下文压缩状态'],
  ['acp-cache', '提示词缓存对账（与 acp_cache 工具相同报告）'],
  ['agent-teams', '用多智能体团队执行目标（你成为队长）'],
]);
const BUILTIN_NAMES = new Set(['goal', 'plan', 'feedback', 'compact', 'permission', 'export']);

function installForAgent(agent) {
  // 幂等：同一个 agent 只挂一次
  if (installed.has(agent)) return;
  installed.add(agent);

  agent.ctx.plugin({
    name: 'command-desc-zh',
    inject: ['commands'],
    apply(scopeCtx) {
      const shadows = new Map();

      const refresh = () => {
        for (const [name, zh] of WANTED) {
          if (BUILTIN_NAMES.has(name)) continue;
          // 只看 global 视图，避免把影子自己当原文
          const original = scopeCtx.commands.find(undefined, name);
          if (original === undefined) {
            // 原文还没注册（并发启动）；等 commands/change 再来
            continue;
          }
          if (original.description === zh) continue; // 已经是中文（别人装的），跳过
          const current = shadows.get(name);
          if (current && current.description === zh) continue; // 已是最新
          // 先释放旧影子，再注册新影子；避免 scope 内 duplicate
          current?.dispose();
          const dispose = scopeCtx.commands.register({
            name,
            description: zh,
            // 原样保留 input/recordInput/definitionId（如果有）
            ...(original.input === undefined ? {} : { input: original.input }),
            ...(original.recordInput === undefined ? {} : { recordInput: original.recordInput }),
            // 注意：不要复制内置命令的 definitionId，否则客户端会走内置本地化而不是我们的描述
            handler(invocation) {
              // 运行时重新解析 global 原文，避免原插件重注册后 handler 过期
              const latest = scopeCtx.commands.find(undefined, name);
              if (latest === undefined) return { kind: 'error', text: `/${name} is unavailable` };
              return latest.handler(invocation);
            },
          });
          shadows.set(name, { dispose, description: zh });
        }
      };

      refresh();
      // commands/change 是无过滤事件；debounce 一下，避免自触发风暴
      const off = scopeCtx.on('commands/change', () => queueMicrotask(refresh));
      scopeCtx.effect(() => () => {
        off?.();
        for (const { dispose } of shadows.values()) dispose();
        shadows.clear();
      }, 'command-desc-zh: shadows');
    },
  });
}
```

关键点：

1. **只从 global 视图取原文**：`find(undefined, name)`；不要 `find(agent, name)`，否则会拿到自己刚注册的影子，导致“用中文翻译中文”。
2. **不要复制内置命令的 `definitionId`**：客户端按 `definitionId` 命中 `BUILTINS` 后会优先用内置语言包；对这三个没有 `definitionId` 的指令，保持不传。
3. **保留 `input`/`recordInput`**：否则菜单的输入提示和日志记录行为会丢。
4. **handler 运行时重新解析原文**：避免第三方插件重注册/升级后，闭包里捕获的旧 handler 指向已 dispose 的状态。
5. **时序重试**：`agent/created` 可能早于第三方插件的 `apply`（Loader 并发激活）。原文没出现时不要报错、不要注册空壳；监听 `commands/change` 重试。
6. **避免自触发死循环**：自己的 `register` 也会 dispatch `commands/change`；用 `queueMicrotask` + “描述已等于目标就跳过”收敛。
7. **幂等**：同一 agent 只挂一个子插件；子插件随 `agent.ctx` dispose 自动清理。
8. **只处理白名单**：不要翻译任意第三方指令；字典/LLM 失败时保留英文，绝不写半成品。
9. **内置 6 条跳过**：它们已由客户端本地化，重复影子只会增加冲突面。

### 7.4 方案 C：上游改法（长期）

- `billion-context` / `dsh-agent-teams` 增加 `description` 配置或本地化钩子；
- 宿主 `dsh-commands` 增加“按 `definitionId`/name 提供本地化描述”的官方 API；
- 客户端 `ui-commands` 增加一个“host command 描述装饰器”，而不是只认 6 个内置 `definitionId`。

这些都需要改第三方或宿主，不是当前插件能独立完成的；方案 A/B 是不改上游的可行路径。

### 7.5 坑清单（实现前必读）

- **scope 上下文必须通过 `inject:['commands']` 挂插件**，不能直接 `scopeCtx.commands.register`（§6.4）。
- **global 同名会抛错**；只有 agent scope 才能覆盖。
- **同一 agent scope 重复注册同名会抛错**；refresh 前先 dispose 旧影子。
- **`commands/change` 无过滤、无 payload**；要自己判断是否相关，且要防自触发。
- **`commands.list(agent)` 是合并视图**；GUI 只显示当前会话 agent 的视图，不会全局变中文。
- **子 agent/子会话**：客户端对 subagent 地址直接返回空目录（`client.js:1411`），给子 agent 装影子不会显示在菜单里；可以跳过 subagent 以省开销。
- **命令名不变**：只能翻译 description/input hint；`/acp` 等命令名是语法的一部分，不能翻译。
- **升级/重载**：第三方插件重注册后，影子可能指向旧 handler；必须运行时解析 + `commands/change` 刷新。
- **关闭开关**：agent-teams 的 `slashCommand:false` 会让原指令消失；影子发现原文不存在时应自动移除/不注册。
- **多 agent**：每个 agent 的 scope 独立；GUI 当前会话是谁，就显示谁的中文影子。不要试图只改 global（会撞车）。

---

## 8. 与 Lead 线索的对照

| Lead 线索 | 本次独立复核 | 结论 |
| --- | --- | --- |
| billion-context 在 `dsh-native.js` 约 2355328 注册 `acp`，2355465 注册 `acp-cache`，描述英文 | 偏移精确匹配（v0.1.202，行 137）；`apply` 在 2339483；注册在 `apply` 函数体内 | **一致** |
| `dsh-acp.js` 是 `bili-acp`，inject `commands`，但 dsh-native 不引用它 | 确认 `package.json exports` 不含 dsh-acp；`dsh-native` 内引用数 0；包内 JS 无引用 | **一致，且可判定它不是 live path** |
| agent-teams 在 `lib/index.js:157-160` inject commands → `registerAgentTeamsCommand` | 行号/代码一致；`lib/command.js:78` 为英文描述 | **一致** |
| host `dsh-commands` 注册表按 scope 分层 | 确认 `register` 用 `this.ctx`、`list(agent)` 合并、`execute` 走合并视图；宿主文档明确支持 agent scope shadow | **一致，且比线索更明确** |
| client-ui-commands 只本地化 6 个 builtin，其它用注册描述；语言包不可注入 | 确认 BUILTINS 仅 6 个 `definitionId`；`builtinRowFace` 对其它行返回 undefined；`candidates` 回落 `c.description`；`register` 同名撞车、`decorate` 无描述覆盖 | **一致** |
| `skill-desc-zh` 只碰 skills，没有 commands | grep 0 命中；inject 仅 `['skills','tools']` | **一致** |

没有发现与 Lead 结论相反的证据；补充两点：

1. `dsh-acp.js` 的重复注册代码是“死路径”，不是“两个入口同时生效”。
2. agent-teams 的 per-profile 别名（`agent-teams-<profile>`，`command.js:102`）当前 profile 未配置 profiles，所以不会出现；一旦配置，描述同样是英文，需要一并纳入白名单。

---

## 9. 未验证项（如实声明）

1. **没有取得实时 GUI 截图**：本会话的 browser-skill 扩展未连接（`bsk_session start` 报 `no browser is currently connected`）；直接 `curl http://127.0.0.1:53139/` 返回 `401 dsh web authentication required`，没有绕过认证。因此“用户当前屏幕上菜单像素级显示英文”这一步没有实时截图；本报告的英文结论来自**客户端源码的确定性回落路径** + 生产注册源码，不是截图。
2. **没有启动完整的真实 Agent/Session 做集成测试**：§6 用的是真实宿主类（`Context`/`CommandRuntime`/`createScope`），但 agent/session 是模拟对象；`agent.ctx` 的真实构造已由 `dsh-agent-loop:778-779` 的源码确认，未在运行中的 host 里实际注入影子。
3. **没有调用远程 `commands.list(sessionId)` 端到端**：只核对了 typert 元数据（`scope.context='agent'`、`lookup='agent'`）与客户端调用点（`client.js:1416`）；远程层由生成代码实现，未单独跑通。
4. **没有实现修复**：§7 是方案与伪代码，不是已交付代码；如果实施，需要重新做安装/回滚/升级自愈验收。
5. **版本敏感性**：billion-context 的偏移基于 v0.1.202；宿主行号基于 desktop 0.2.1-rc.2。升级后需重新核对。
6. **没有验证 hot reload 后的行为**：如果第三方插件在运行中被禁用/启用，影子的刷新时序需要实测（`commands/change` 应覆盖，但未跑真实 host）。

---

## 10. 复现命令与证据文件

### 10.1 复现实验

```bash
cd /tmp/command-shadow-verify
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" experiment.mjs
# 或读取已保存输出
cat experiment.out
```

### 10.2 复现源码位置

```bash
# billion-context 偏移（Node 可直接读 profile 路径）
node - <<'NODE'
const fs=require('fs');
const p='~/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js';
const s=fs.readFileSync(p,'utf8');
for (const off of [2339483,2355328,2355371,2355465,2355514]) {
  console.log(off, JSON.stringify(s.slice(off, off+120)));
}
NODE

# agent-teams
nl -ba ~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/command.js | sed -n '73,118p'
nl -ba ~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/index.js | sed -n '118,162p'

# 宿主源码（asar 内，需 Electron Node 模式）
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  -e "const fs=require('fs');const p='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-commands/lib/index.js';const s=fs.readFileSync(p,'utf8').split('\n');for(let i=76;i<100;i++)console.log((i+1)+': '+s[i])"
```

### 10.3 关键证据文件

| 证据 | 路径 |
| --- | --- |
| 实验脚本 | `/tmp/command-shadow-verify/experiment.mjs` |
| 实验输出 | `/tmp/command-shadow-verify/experiment.out` |
| 宿主模块副本 | `/tmp/command-shadow-verify/asar/`（dsh-commands / dsh-scope / cordis / client-ui-commands） |
| billion-context 入口 | `~/.dsh/profiles/desktop/node_modules/billion-context/dist/agent/dsh-native.js` |
| agent-teams 入口 | `~/.dsh/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/lib/index.js`、`lib/command.js` |
| 宿主指令注册表 | `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-commands/lib/index.js` |
| GUI 菜单客户端 | `…/@deepseek-ai/dsh-client-ui-commands/lib/client.js` |

### 10.4 清理/回滚

本次复核**没有改动生产代码、profile 配置或已安装插件**；只新增本文件。

- 如需移除本报告：`node ~/.dsh/skills/safe-delete-trash/trash.mjs ~/dsh-plugins/skill-desc-zh/docs/command-desc-investigation.md`
- `/tmp/command-shadow-verify/` 为临时实验目录，可整体移入废纸篓（同一条 `trash.mjs` 命令），不要用 `rm`。
