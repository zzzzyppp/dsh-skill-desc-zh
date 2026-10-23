# skill-desc-zh 设计文档

> 把 DSH 内置技能的**描述**中文化，做成一个可安装、可一键还原、升级安全的本地 bundle 插件。
>
> | 项 | 值 |
> | --- | --- |
> | 文档版本 | v1（2026-10-21） |
> | 状态 | 待实现（t1 design 产出） |
> | 作者 | researcher（skill-desc-zh 团队） |
> | 目标 profile | `desktop`（Electron 应用内管理） |
> | 证据环境 | DSH `0.2.1-rc.2` / macOS / `~/.dsh` = `~/.dsh` |
> | 源码位置 | `~/dsh-plugins/skill-desc-zh`（新建） |
>
> 证据路径约定：`app.asar/…` 指 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/…`；
> `runtime/…` 指 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/…`。

---

## 0. 结论速览

**一句话**：不改任何内置文件，用一个**本地 bundle 插件**在 `skills` 服务里注册一个 rank 更低的 provider（全局层），把 7 个 office 技能替换成「中文描述 + 原始内容」；4 个 agent-preset 技能位于 preset 层、无法跨层覆盖，改用**项目级影子目录**（`<project>/.dsh/skills`，rank 100 < 300）落地。翻译走宿主 LLM，无模型时用随包词典兜底。还原、升级检测、删除全部走可回滚路径（废纸篓）。

| 问题 | 结论 |
| --- | --- |
| ① 16 个 SKILL.md / workspace 根 | 12 个内置（4 个 agent-preset + 7 个 office + 1 个 Windows 专用）+ profile 2 + 用户级 2。workspace 根 = `ctx.get('workingDirectory').get(session)`，项目根 = 向上找第一个含 `.git` 的目录（与宿主 `findProjectRoot` 同算法）。 |
| ② 影子目录与 rank | 用户级 `~/.dsh/skills`=400、项目级 `<proj>/.dsh/skills`=100、preset 自带 customDir=300、bundled=600，**同层 rank 小者胜、近层整体胜**。用户级 400 能覆盖全局层 600 的 office；项目级 100 能覆盖 preset 层 300 的 agent-preset；runtime 250 的 `browser-skill` 内容硬编码在代码里 → **不覆盖，列为限制**。 |
| ③ 升级指纹 | `hostVersion` + 每个技能 `sha256(name \| description \| content \| resourceBase)`（并记录文件 mtime/size 作快路径）。任一变化 ⇒ 旧译文作废、重新翻译。 |
| ④ LLM 与兜底 | `ctx.get('llm')` + `ctx.get('agentDefaultModel').currentSelection()`，`prepareCall` → `stream`，一次调用翻译一批，严格 JSON；无模型/失败/超时 ⇒ 随包 `dictionary.zh.json`（11 条），绝不产出半成品。 |
| ⑤ 安装 | `dsh plugin --profile desktop add …` **被禁止**（“profile desktop is managed exclusively by the Electron application”）；必须用应用内 `plugin_manager install_bundle`，**支持绝对本地目录**（记为 `link:`）。HMR 热挂载，无需重启 app；新工具从下一个模型步可用，**建议新开会话**。 |
| ⑥ AGENTS.md 硬约束 | 预检脚本 `scripts/preflight.mjs`（包装 `audit.mjs` + 本地包专项检查，阻塞项一律停止，未验证如实标注）；所有删除走 `trash.mjs` 语义（同卷 rename 进 `~/.Trash`，跨卷进 `<mount>/.Trashes/<uid>`，写 `~/.dsh/.trash-log.jsonl`），覆盖前 `--snapshot` 留档。 |

---

## 1. 目标与约束

### 1.1 目标（对应团队目标）

1. **自动中文化**：`skills` 目录（system-reminder 里的 `<available_skills>`）中内置技能的描述显示为中文。
2. **一键还原**：用户随时可恢复到英文原文，且不残留、不影响技能可用性。
3. **升级安全**：内置技能随宿主升级而变化时，**先还原英文**（绝不把旧中文贴到新内容上），升级完成后再**自动重新翻译**。
4. **可安装**：以 DSH bundle 形式装进 `desktop` profile，端到端验证。
5. **全程可回滚**：任何删除只进废纸篓；任何覆盖前留档。

### 1.2 硬约束

- 源文件（`app.asar` 内、`runtime/office-skills/`、profile 内插件包）**只读**，永不修改。
- 遵循 `~/.dsh/AGENTS.md` 两条全局约定：安装/升级插件前必须预检；删除只能进废纸篓。
- 插件零运行时依赖（不引 npm 包），避免供应链与隔离期问题，也避免与 profile 现有依赖冲突。
- 只影响 `desktop` profile；不污染 `~/.dsh/skills`（用户自己的技能目录）。

### 1.3 非目标

- 不翻译技能**正文**（`content`）——只换 `description`，正文与资源保持原样。
- 不翻译用户自己写的技能（`~/.dsh/skills/*` 已是中文）。
- 不做 UI 设置卡片（一期用工具/脚本；二期可选，见 §12）。
- 不覆盖 runtime 注册的技能（`browser-skill` 等，见 §2.6）。

---

## 2. 现状调研（含证据）

### 2.1 技能加载链路

```
宿主 profile 根 ctx（global 层）
  ├─ dsh-office（name="desktop-office"）  ── rank 600 ──> 7 个 office 技能
  │     assetRoot = runtime/office-skills
  ├─ 各插件 runtime 注册  ───────────────  ── rank 250 ──> browser-skill
  └─ agent preset（cordis preset，preset 层）
        └─ skill-filesystem（preset 作用域实例，宿主那一行被 disabled）
              roots: 项目 .dsh/skills（100）
                     项目 .agents/skills（200）
                     customSkillDirs = agent-preset/skills（300）
                     ~/.dsh/skills（400）
                     ~/.agents/skills（500）
                     bundled（600，桌面端通常没有）
```

- **层叠规则**（`skills` 服务文档，实测 `cordis_inspect_query Service skills`）：
  > “the nearest layer's entry wins a duplicate name outright, and the rank order decides duplicates only within one layer.”
- **排序实现**（`app.asar/dsh/node_modules/@deepseek-ai/dsh-skill/lib/index.js:521`）：
  `rank - rank || providerOrder - providerOrder || localOrder - localOrder`，**小者胜**。
- rank 常量：`dsh-skill-filesystem/lib/index.js:21-25`（`PROJECT_DSH_RANK=100, PROJECT_AGENTS_RANK=200, CUSTOM_RANK=300, USER_DSH_RANK=400, USER_AGENTS_RANK=500`）、`dsh-skill/lib/index.js` 内 `BUNDLED_SKILL_RANK=600`、`RUNTIME_RANK=250`。
- 宿主那一行 `skill-filesystem` 在 `dsh-web-app/cordis.patch.yml:500-520` 被 `disabled: true`（注释：*“the base host `skill-filesystem` row is disabled here (presets own local discovery)”*），所有文件系统根都由 **preset 作用域的实例**注册（`dsh-web-app/presets/cordis.patch.yml:123-127`）。
- 实测确认：`cordis_inspect_query Config listConfigs name=@deepseek-ai/dsh-skill-filesystem` → 唯一 entry `skill-filesystem`，`status: "inactive"`。

> **关键推论**：preset 层的项目根（100）能压过 preset 层的 customDir（300）；但 preset 层的任何文件都无法压过 global 层的条目——层级优先于 rank。反之，global 层里 rank 更低的 provider 能压过 office（600），因为二者同层。

### 2.2 16 个 SKILL.md 清单（实测，2026-10-21）

| # | kind | name | 路径（缩写） | size | sha256(前16) | 目录内容 | 当前 provider / rank | 只读 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | asar 内置 | agent-experience | `app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/…` | 2093 | `1244928710cb7e39` | SKILL.md | filesystem(custom) / 300 | ✅ |
| 2 | asar 内置 | cordis-composition-reference | 同上 | 2806 | `6583a81d9f4de070` | SKILL.md + references | filesystem / 300 | ✅ |
| 3 | asar 内置 | cordis-plugin-development | 同上 | 8147 | `83561b4d4fed0dd8` | SKILL.md + references + templates | filesystem / 300 | ✅ |
| 4 | asar 内置 | editing-cordis-compositions | 同上 | 5739 | `974cc1e115bf07a8` | SKILL.md | filesystem / 300 | ✅ |
| 5 | runtime 资源 | office | `runtime/office-skills/office/SKILL.md` | 957 | `d5b9c95af707c95c` | SKILL.md + references | dsh-office / 600 | ✅ |
| 6 | runtime 资源 | office-docx | 同上 | 3725 | `5c18a4368834b834` | SKILL.md | dsh-office / 600 | ✅ |
| 7 | runtime 资源 | office-export-pdf | 同上 | 1761 | `f474f6e2daa61875` | SKILL.md | dsh-office / 600 | ✅ |
| 8 | runtime 资源 | office-pptx | 同上 | 4415 | `3d2f09443f4ac82b` | SKILL.md | dsh-office / 600 | ✅ |
| 9 | runtime 资源 | office-recalculate | 同上 | 1723 | `acc3729600af3660` | SKILL.md | dsh-office / 600 | ✅ |
| 10 | runtime 资源 | office-render | 同上 | 4841 | `7ad77f63958bc5e6` | SKILL.md | dsh-office / 600 | ✅ |
| 11 | runtime 资源 | office-xlsx | 同上 | 4579 | `5b16d47b06d0b545` | SKILL.md | dsh-office / 600 | ✅ |
| 12 | asar 内置 | diagnose-windows-sandbox-acl | `…/dsh-sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/SKILL.md` | 6982 | `9c616c78892daeae` | SKILL.md + scripts | 仅 Windows 注册 | ✅ |
| 13 | profile 插件包 | modlens | `~/.dsh/profiles/desktop/node_modules/@liustack/modlens/skills/modlens/SKILL.md` | 5363 | `a410478598d85649` | SKILL.md + references + scripts | **未注册**（其 dsh 插件只注册工具，`grep skills.register` 无命中） | 可写（但不动） |
| 14 | profile 插件包 | browser-skill | `…/browser-skill-dsh-plugin/skill/SKILL.md` | 4377 | `5917696c318b7380` | SKILL.md + references | **runtime / 250**，描述取代码常量（英文） | 可写（但不动） |
| 15 | 用户级 | dsh-plugin-preinstall-audit | `~/.dsh/skills/dsh-plugin-preinstall-audit/SKILL.md` | 5508 | `5d4cb96e4bb97af3` | SKILL.md + audit.mjs + asar-snapshot.cjs | filesystem(user) / 400 | 已中文 |
| 16 | 用户级 | safe-delete-trash | `~/.dsh/skills/safe-delete-trash/SKILL.md` | 3656 | `4be32b9a79b24938` | SKILL.md + trash.mjs | filesystem(user) / 400 | 已中文 |

**本会话实际可见目录 = 14 条**（#1–#11、#14、#15、#16）；#12 仅 Windows 注册，#13 未注册。

**翻译目标 = 11 个**：`office, office-docx, office-export-pdf, office-pptx, office-recalculate, office-render, office-xlsx` + `agent-experience, cordis-composition-reference, cordis-plugin-development, editing-cordis-compositions`。

> 注：office 的 7 个技能在桌面端由 `dsh-desktop-host` 以 `assetRoot = runtime/office-skills` 挂载（`dsh-desktop-host/lib/index.js:73-90`），**不是** asar 里的 `dsh-skill-office/assets/`；两者内容仅相差 asar 打包产生的空行/换行差异（已 diff 验证）。指纹以桌面端实际服务的内容为准。

### 2.3 catalog 何时刷新（无需重启）

`dsh-tool-skill/lib/index.js` 在 `agent/pre-step` 钩子里：
1. `ctx.skills.snapshot({ cwd, signal, scope: agent })`；
2. 过滤 `isModelInvocable`，对 `[name, description]` 计算 digest；
3. digest 与历史不同 ⇒ 注入/替换一条 `<system-reminder>` 用户消息，内容为 `<available_skills>` 列表。

⇒ **描述变化在下一个模型步就会出现在目录里**，前提是 `snapshot.complete === true`。provider 注册/失效会 `invalidateCache()` 使 revision 递增，从而打破 collect 缓存。

### 2.4 office 内容增强（重要）

`dsh-skill-office/lib/index.js:42-58,86-98`：对 `office-render / office-recalculate / office-export-pdf` 三个技能，`get()` 会在正文末尾追加一段 `## Installed LibreOffice Kit`，包含**绝对路径**的 `{node, cli}`（node = `runtime/dependencies/node/bin/node`，cli = 解包后的 `@deepseek-ai/libreoffice-kit/lib/cli.js`）。

⇒ 任何替换 office 条目的方案都必须**保留这段内容**，否则这三个技能会失去 LibreOffice 调用方式。**本设计通过“捕获原始定义”天然保留**（见 §4.2）。

### 2.5 其它已确认的宿主能力

| 能力 | 契约 |
| --- | --- |
| `ctx.skills.registerProvider(create)` | `create(control:{signal,invalidate}) → {name, list(opts), get(candidate,opts)}`；**同步**注册；unscoped ctx 注册到 global 层；同层重名抛错；返回 disposer。 |
| `SkillCandidate` | `{name, description, whenToUse?, invocation?, source, provider===providerName, rank, resourceBase?, locator?, path?}` |
| `SkillDefinition` | 同上 + `content`（必填字符串，非空 description 必填）。 |
| `ctx.tools.register(def)` | 必填 `{name, description, parameters(JSON Schema), output:{schema, render(args,value)}, execute(args, exec)}`；`run_code` 为保留名；`tools/change` 在变更时发出，工具按请求解析。 |
| `ctx.get('workingDirectory')` | `.get(session)` 读已提交 cwd；`.ensure(agent, signal)`；`.set(agent, path, signal)`。 |
| `ctx.get('llm')` | `listProviders/listModels/prepareCall(config,signal) → {config, stream(options)}`。 |
| `ctx.get('agentDefaultModel')` | `.currentSelection() → {provider, model, reasoningEffort}`（本机：`deepseek-account / deepseek-flash / max`）。 |
| 事件 | `agent/created {agent}`、`agent/pre-step`、`skills/change`、`tools/change`、`system-prompt/assemble`。 |
| 更新 | **没有**“应用即将升级/升级完成”事件（`dsh-desktop-host` 只提供 `installDesktopUpdateTaskControl/control.updateTasks`）⇒ 升级安全必须靠**启动自愈**。 |

### 2.6 为什么 runtime 技能不可覆盖

`browser-skill` 通过 `skills.register({ name, description: BSK_SKILL_DESCRIPTION, content: BSK_SKILL_MARKDOWN, … })` 注册（`~/.dsh/profiles/desktop/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/lib/index.mjs:5275-5276, 5979-5996`），`RUNTIME_RANK=250`，**描述与正文都硬编码在代码里**（其磁盘上的 `SKILL.md` 已是中文，与注册值不一致——这正说明“文件不是权威源”）。

- 理论上我们的 provider（global 层 rank 50）能压过 250；
- 但 `SkillDefinition` 要求同时给 `content`，我们拿不到权威正文，只能复制代码里的常量或磁盘文件 ⇒ 必然漂移；
- **决策：不覆盖 runtime 技能，列为已知限制**（`skill_desc_zh status` 会明确列出“不可覆盖：browser-skill（runtime 250）”）。
- `modlens` 未注册技能，不涉及。

### 2.7 安装机制（⑤ 的前半部分）

| 方式 | 结论 | 证据 |
| --- | --- | --- |
| `dsh plugin --profile desktop add <dir>` | ❌ **被主动拒绝**：桌面 profile 只能由 Electron 应用管理 | `app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:117-122`；`rejectElectronProfile()` 在 `bin.js:36`，只有桌面应用自带 carrier 传 `manageDesktopProfile` |
| `plugin_manager install_bundle`（应用内工具） | ✅ 支持**绝对本地路径**，转成 `{kind:'path'}`，落库为 `link:<abs dir>` | `dsh-plugin-manager/lib/types/install-spec.js` `parseInstallSpec()`；README.zh.md |
| 无 bundle patch 的包 | 安装后会被回滚（package.json / pnpm-lock 还原） | dsh-plugin-manager README.zh.md |
| 生效方式 | 有 HMR 时 `hmr.reconcileProfile(requiredIds)` 热挂载；无 HMR 才需要重启 | 同上；`restartReason: no-hmr / package-moved / pending-module` |
| 本地 `link:` 包改代码 | 需要重新构建并重启（模块已加载） | 同上 |

**bundle 包契约**（以已装的 `@liustack/modlens` 为例）：`"type":"module"`、`"exports": {".":"./dsh/index.js", "./cordis.patch.yml":"./cordis.patch.yml"}`、`"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}`；patch 文件是顶层 YAML 数组，形如 `- insert: [{id, name, config}]`。

### 2.8 AGENTS.md 两个工具的真实现状（⑥ 的依据）

- `node ~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs <包名|包名@范围|github:owner/repo|github-url> [--profile desktop] [--deep] [--catalog] [--json]`
  - **不接受本地路径**（`audit.mjs:22-35` 只收集位置参数并当作包 spec）；
  - 退出码 0 干净 / 2 仅警告 / 1 阻塞；`--verify <包名>` 做安装后复核。
- `node ~/.dsh/skills/safe-delete-trash/trash.mjs <路径>… [--dry-run|--finder|--snapshot|--json]`
  - 同卷 `rename` 进 `~/.Trash`（原子）；跨卷进 `<mount>/.Trashes/<uid>`；写 `~/.dsh/.trash-log.jsonl`；`--snapshot` 备份到 `~/.dsh/.file-backups/<ts>/`；拒绝 `/`、`$HOME`、`$DSH_HOME` 等根路径本身；退出码 0/1/2；**永不退化成 `rm`**。

---

## 3. 六问逐条回答

### ① 枚举 16 个 SKILL.md，并说明“workspace 根”如何取

**枚举**：见 §2.2 表（12 内置 = 4 agent-preset + 7 office + 1 Windows；2 profile 插件包；2 用户级）。只读判定：asar 与 `runtime/` 在 `/Applications` 下，普通用户不可写；profile 包可写但我们不改。

**workspace 根**（插件运行时如何拿到路径）：
1. 会话 cwd：`ctx.get('workingDirectory').get(session)`（纯读，无 IO）；工具里 `exec.agent` → `agent.session`。
2. 项目根：与宿主完全相同的算法——向上遍历，返回第一个含 `.git` 的目录，找不到则退回 cwd：
   ```js
   // 对应 dsh-skill-filesystem/lib/index.js:811-816
   async function findProjectRoot(cwd) {
     let cur = cwd;
     for (;;) {
       if (existsSync(join(cur, '.git'))) return cur;   // .git 可以是文件（worktree）
       const parent = dirname(cur);
       if (parent === cur) return cwd;
       cur = parent;
     }
   }
   ```
3. 其他工作区：`ctx.get('workspaceRegistry').list()`（给 `status`/`doctor` 用，非必需）。
4. 本机示例：当前 cwd `/Applications/dsh` 含 `.git` ⇒ 项目根即 `/Applications/dsh`；用户实际项目以会话 cwd 为准。

### ② 影子目录放置与 rank 覆盖

| 目标集 | 所在层 | 对手段 | 我们的手段 | 结果 |
| --- | --- | --- | --- | --- |
| office ×7 | global | rank 600 | **自有 provider，global 层 rank 50**（首选，零文件写入）；备用：用户级影子目录 | ✅ 覆盖 |
| agent-preset ×4 | preset | rank 300 | **项目级影子目录** `<project>/.dsh/skills/<name>/`（rank 100 < 300，同层） | ✅ 覆盖（限 git 项目内） |
| browser-skill | global | runtime rank 250 | 不覆盖 | ❌ 限制（§2.6） |
| 用户级 ×2 | — | 已中文 | 不动 | 不适用 |

**为什么 office 不用用户级影子目录**：把 7 个 office 技能写进 `~/.dsh/skills` 会（a）污染用户的技能目录，（b）影响其它 profile（tui/web 也会看到这些技能，即使没装 office 包），（c）每次还原都要动废纸篓。自注册 provider 在同样效果下**零写入、零残留**，且能原样保留 `resourceBase` 与 LibreOffice 附录。

**为什么 agent-preset 只能用项目级影子**：它们由 preset 作用域的实例注册（rank 300），层级比 global 更近，任何 global provider 都压不过；同层里唯一比 300 更小的兄弟根是项目 `.dsh/skills`（100）。

**冲突保护**：影子目录内必带标记文件 `.skill-desc-zh.json`（记源指纹与版本）。若目标目录已存在且**没有**该标记 ⇒ 视为用户技能，跳过并告警，绝不覆盖。

### ③ 升级检测 fingerprint

```text
hostVersion = app.asar/package.json 的 version（本机 0.2.1-rc.2）
               失败时退回 process.versions.electron / 读 runtime/versions.json

对每个目标技能：
  served      = 捕获到的 SkillDefinition（provider 实际返回的 description + content + resourceBase）
  contentHash = sha256(served.description + "\0" + served.content + "\0" + JSON.stringify(served.resourceBase ?? null))
  fileProbe   = { path, size, mtimeMs, sha256(fileBytes) }        // 可读时记录；asar 内文件也读得到
  fingerprint = sha256(hostVersion + "\0" + name + "\0" + contentHash)
```

判定：

| 观察 | 动作 |
| --- | --- |
| `state.hostVersion !== hostVersion` | 视为**宿主升级**：先把所有影子目录移入废纸篓（还原英文），再全量重译 |
| 单技能 `contentHash` 变化 | 该技能旧译文作废（影子先删后建；provider 用新内容 + 新译文） |
| `size/mtime` 未变且 `contentHash` 相同 | 快路径：不重算、不调 LLM |
| `sha256` 计算失败 | 标记 `degraded`，保留英文，不写任何影子 |

**为什么用“provider 实际返回的内容”而不是文件哈希**：office 的 `get()` 会追加 LibreOffice 附录，asar 与 runtime 的两份文件也非逐字节一致；以“服务面”为准才能保证“内容变了就重译”。文件探针只作快速判断与诊断。

### ④ 宿主 LLM 服务键与无模型时的词典兜底

**服务键**（全部为可选用法，缺一即降级）：
```js
const llm = ctx.get('llm');                                   // 必须
const sel = ctx.get('agentDefaultModel')?.currentSelection(); // {provider, model, reasoningEffort}
```
**调用**（对齐宿主翻译器的既有用法）：
```js
const prepared = await llm.prepareCall(
  { provider, model, reasoningEffort: 'off', maxTokens: 1200 }, signal);
let text = '';
for await (const chunk of prepared.stream({ ...prepared.config, system, messages, signal })) {
  if (chunk.type === 'text-delta') text += chunk.text;       // 具体字段以 BlockAssembler 为准
  if (chunk.type === 'finish') break;
}
```
- `provider/model` 优先级：配置 → `agentDefaultModel.currentSelection()` → `llm.listProviders()` 中第一个可用且 `listModels()` 非空者。
- `reasoningEffort: 'off'`：翻译是机械任务，省钱省时。

**兜底链**：`LLM` → 失败重试 1 次（要求纯 JSON）→ `dictionary.zh.json`（随包 11 条，键为**英文原文全串**）→ **保持英文**（绝不产出残缺中文）。
落盘时记录 `engine: "llm" | "dictionary" | "none"`，`status` 一目了然。

**质量校验**（任一不满足即回退）：
1. 输出是合法 JSON 对象，键集合 == 目标集合；
2. 每个值非空、含 CJK 字符、长度 ≤ 原文 × 1.6（且 ≤ 400 字符）；
3. 不含 frontmatter、代码块、引号包裹、`description:` 前缀；
4. 与原文不是同一字符串（未翻译）。

### ⑤ `dsh plugin --profile desktop add <本地目录>` 与生效时机

- **不支持**：该 CLI 分支存在，但对 desktop profile 会直接报错
  `profile "desktop" is managed exclusively by the Electron application`
  （`bin.js:117-122` + `rejectElectronProfile` 于 `bin.js:36`）。**必须**用应用内 `plugin_manager install_bundle`。
- **本地 bundle**：`install_bundle` 支持绝对路径（`parseInstallSpec` → `{kind:'path'}`），安装后 profile 的 `package.json` 记为 `link:<abs dir>`；包必须带 `dsh.bundle.patch` 否则会被回滚。
- **是否要重启/新会话**：
  - 有 HMR 时安装/启用走后端 `hmr.reconcileProfile()`，**无需重启 app**；
  - 新工具经 `ctx.tools.register` 注册、按请求解析（`tools/change`），**下一个模型步即可调用**（当前步的 schema 已发送）；
  - 但系统提示里的工具清单/技能目录在步间刷新，**建议新开一个会话**做端到端确认（最稳、可复现）；
  - 若 profile 无 HMR（如命令行安装的 tui profile）则必须重启。
- **验证**：`plugin_manager list_plugins` 中该条目 `fiberPhase === "active"`。

### ⑥ AGENTS.md 两条硬约束如何内建

| 约束 | 内建方式 | 落地位置 |
| --- | --- | --- |
| 安装/升级前必须预检 | `scripts/preflight.mjs`：① 跑 `audit.mjs <包名> --profile desktop`（本地包没有 npm 元数据时如实输出“未验证”，**不谎报干净**）；② 本地包专项：`engines.dsh` 是否满足、`dsh.bundle.patch` 是否存在且为顶层数组、profile 现有依赖是否冲突、是否引入任何依赖；③ 退出码与 audit 对齐（0/2/1），**1 直接中止**，2 打印逐条警告等人工确认 | `scripts/preflight.mjs`，`scripts/install.mjs` 第一步调用 |
| 删除只走废纸篓 | 运行时统一走 `lib/trash.js`：优先 `spawn` 系统 node 执行 `~/.dsh/skills/safe-delete-trash/trash.mjs`（找不到才用等价内置实现：同卷 rename 进 `~/.Trash`、跨卷进 `<mount>/.Trashes/<uid>`、写同一份 `.trash-log.jsonl`）；**代码库中不出现 `rm`/`unlink`/`rmdir`/`truncate`**；覆盖前 `--snapshot` 留档 | `lib/trash.js`；所有还原/升级/卸载路径 |
| 附加 | `scripts/verify.mjs` 检查“无 `rm` 痕迹”和“所有消失的目录都能在 `~/.Trash` 找到对应项” | CI/验收 |

---

## 4. 架构设计

### 4.1 机制对比

| 维度 | A. 影子目录（全量） | B. 自有 provider（global） | **C. 混合（推荐）** |
| --- | --- | --- | --- |
| 文件写入 | 7+4 个目录（用户级/项目级） | 0 | 4 个（仅项目级） |
| 覆盖 office（global 600） | 用户级 400 可覆盖（写入 `~/.dsh/skills`） | rank 50 覆盖 | ✅ provider |
| 覆盖 preset（300） | 项目级 100 可覆盖 | ❌ 层级 | ✅ 影子 |
| 保留 resourceBase / LibreOffice 附录 | 需重建（易漏） | 天然保留（捕获原定义） | provider 侧天然保留 |
| 还原 | 删目录（废纸篓）+ state | 置 `enabled=false` + `invalidate()`（瞬时） | 两者 |
| 跨 profile 影响 | 用户级会外溢 | 无 | 仅项目目录 |
| 升级安全 | 靠指纹重建 | 靠指纹换译文 | 组合 |
| 复杂度 | 中 | 低-中 | 中 |

### 4.2 推荐架构：双通道

```
                 ┌──────────────────────── skill-desc-zh (local bundle, desktop profile) ───────────────────────┐
                 │                                                                                                │
  app boot ──────► apply(ctx, config)                                                                              │
                 │   ├─ 读 state（~/.dsh/.skill-desc-zh/state.json）                                               │
                 │   ├─ L2 升级自愈：state.hostVersion != 当前 → trash 所有影子 → 清标记                            │
                 │   ├─ 注册 provider（L1）：create(control) => ({name:'skill-desc-zh', list, get})                 │
                 │   │     list() = ready ? zhCandidates : []        // 未就绪时让 office 自己上场                 │
                 │   ├─ 后台激活：capture → fingerprint → translate → ready=true → control.invalidate()             │
                 │   └─ 事件：agent/created → 确保该会话的项目影子（L2）                                            │
                 └────────────────────────────────────────────────────────────────────────────────────────────────┘

  capture（关键技巧，避免自噬）
     our list() 返回 [] 时 → ctx.skills.get(name, {cwd}) 命中的就是 dsh-office 的原始定义
     拿到 { description, content(含 LibreOffice 附录), resourceBase, invocation, source, path }
     → 之后 list() 返回 rank 50 的候选，description 换成中文，content/resourceBase 原样透传
```

**L1（office ×7）**：
- 候选：`{ name, description: zh, invocation, source: 'bundled', provider: 'skill-desc-zh', rank: 50, resourceBase: <原样>, locator: {kind:'skill-desc-zh', name} }`
- `get()` 返回缓存的原始 `content` + 中文 `description`（**内容零改动**）。
- 未翻译成功的技能：原样透传英文（**绝不丢技能**）。
- `ready=false` 期间返回 `[]`，office 原条目照常服务 ⇒ 启动无空窗。

**L2（agent-preset ×4）**：
- 在项目根创建 `<project>/.dsh/skills/<name>/SKILL.md`：`---\nname: <name>\ndescription: <中文>\n---\n\n<原正文>`。
- 资源：把 asar 内的 `references/`、`templates/` **复制**进影子目录（4 个技能合计 ~78KB，20 个文件），不用软链（避免 asar 路径对 `run_code` 里的普通 node 不可读）。
- 标记：影子目录内 `.skill-desc-zh.json` 记 `{sourceHash, shadowHash, version, createdAt}`；目标目录已存在且无标记 ⇒ 跳过 + 告警。
- 触发时机：`agent/created`（拿到 `workingDirectory`）→ 计算项目根 → 仅当项目根在 `$HOME` 下（默认）或命中 `projectAllowlist` 时创建。

**为什么 provider 用 rank 50**：global 层里目前只有 office 的 600 与 runtime 的 250；50 稳定低于两者且留出余量；若未来宿主在 global 层加入更低 rank 的 provider，`status` 会显示实际生效的 provider（`summary.provider !== 'skill-desc-zh'` 即告警）。

### 4.3 职责划分（组件）

| 组件 | 职责 | 依赖 |
| --- | --- | --- |
| `lib/index.js` | `apply(ctx, config)`：注册 provider、事件、工具、状态机 | cordis ctx |
| `lib/capture.js` | 捕获原始定义（含重试/降级到文件读取） | `ctx.skills` |
| `lib/translate.js` | LLM 批量翻译 + 校验 + 词典兜底 + 缓存 | `ctx.get('llm')` |
| `lib/provider.js` | `list/get`，rank 50，`invalidate` 控制 | — |
| `lib/shadows.js` | 项目影子：创建/校验/还原/升级自愈 | `lib/trash.js`、`ctx.get('workingDirectory')` |
| `lib/state.js` | 原子读写 JSON（tmp + rename），版本迁移 | `node:fs` |
| `lib/trash.js` | 唯一删除入口（优先调用 `trash.mjs`） | `node:child_process` |
| `lib/paths.js` | 解析 app / asar / runtime 路径，`doctor` 探测 | `node:fs` |
| `lib/tool.js` | `skill_desc_zh` 工具定义 | `ctx.tools` |

### 4.4 数据流

```
apply
 ├─ loadState() ──► enabled? ──否──► 仅注册工具（供诊断），return
 ├─ if (state.hostVersion !== hostVersion) → shadows.restoreAll()（trash）+ 清 state.zh
 ├─ registerProvider(control => provider)          // list() 初始返回 []
 ├─ activate().catch(log)                          // 不阻塞启动
 │    ├─ for name of targets:
 │    │     def = await skills.get(name, {cwd})     // 我们还没就绪 ⇒ 命中原始 provider
 │    │     fp  = fingerprint(def, hostVersion)
 │    │     zh  = state.cached(fp) ?? translate(def.description) ?? dictionary
 │    ├─ ready = true; control.invalidate()         // 下一次 pre-step 目录变中文
 │    └─ scheduleShadowsForKnownSessions()          // 已存在的会话补建 L2
 └─ ctx.on('agent/created', ({agent}) => shadows.ensureFor(agent))

工具 skill_desc_zh(action):
  status   → 每个目标：机制 / rank / 生效 provider / 源 hash / 译文 / engine / 影子路径
  apply    → 重新启用（enabled=true）；L1 invalidate；L2 补齐
  restore  → enabled=false；L1 invalidate（瞬时英文）；L2 全部 trash
  refresh  → 重新捕获 + 重算指纹 + 重译（不改变 enabled）
  doctor   → 路径探测、LLM 可用性、trash 工具可用性、层级覆盖自检、限制清单
```

### 4.5 状态机

```
        ┌──────────┐  enabled=false   ┌──────────┐
  ─────►│  booting │─────────────────►│ restored │
        └────┬─────┘                  └────┬─────┘
             │ 捕获成功                     │ apply
             ▼                             │
        ┌──────────┐   LLM 失败但词典命中   ▼
        │  active  │◄─── degraded(dict) ──┐
        └────┬─────┘                      │
             │ 指纹变化（升级/宿主更新）     │
             ▼                             │
        ┌──────────┐  重译成功             │
        │  stale   │──────────────────────┘
        └────┬─────┘
             │ 捕获失败/路径缺失
             ▼
        ┌──────────┐
        │  failed  │  （保留英文，doctor 报告原因）
        └──────────┘
```

### 4.6 源码目录结构

```
~/dsh-plugins/skill-desc-zh/
├── package.json                 # name: dsh-skill-desc-zh, type: module, zero deps
├── cordis.patch.yml             # - insert: [{id: skill-desc-zh, name: dsh-skill-desc-zh, config: {...}}]
├── README.md                    # 安装 / 使用 / 还原 / 限制
├── lib/
│   ├── index.js                 # apply + state machine + events
│   ├── provider.js
│   ├── capture.js
│   ├── translate.js
│   ├── dictionary.zh.json       # 11 条英文原文 → 中文（离线兜底）
│   ├── shadows.js
│   ├── state.js
│   ├── trash.js
│   ├── paths.js
│   └── tool.js
├── scripts/
│   ├── preflight.mjs            # AGENTS.md 预检包装（0/2/1）
│   ├── install.mjs              # preflight → 打印 install_bundle 指令 → 提示验证
│   ├── verify.mjs               # 安装后 e2e 自检（含“无 rm”“废纸篓可查”）
│   └── restore.mjs              # 一键还原（含影子与 state 清理）
├── test/                        # node:test，零依赖
│   ├── provider.test.mjs        # 捕获-自噬防护、透传、rank
│   ├── translate.test.mjs       # JSON 校验、失败回退、词典命中
│   ├── shadows.test.mjs         # 标记保护、还原进废纸篓
│   └── state.test.mjs           # 原子写、迁移
└── docs/design.md               # 本文
```

### 4.7 bundle 元数据与配置

```jsonc
// package.json
{
  "name": "dsh-skill-desc-zh",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "engines": { "dsh": ">=0.2.1-rc.2" }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: skill-desc-zh
      name: dsh-skill-desc-zh
      config:
        enabled: true
        engine: auto              # auto | llm | dictionary
        translatePreset: true     # L2 开关
        projectAllowlist: []      # 额外允许写影子的项目根（默认仅 $HOME 下）
        restoreOnQuit: false      # true 则退出时自动 trash 影子
        llm:
          provider: null          # null → agentDefaultModel.currentSelection()
          model: null
          timeoutMs: 30000
        targets:
          global: [office, office-docx, office-export-pdf, office-pptx,
                   office-recalculate, office-render, office-xlsx]
          preset: [agent-experience, cordis-composition-reference,
                   cordis-plugin-development, editing-cordis-compositions]
```

---

## 5. state schema

写入 `~/.dsh/.skill-desc-zh/state.json`（原子写：`state.json.tmp` → rename；旧版本按 `version` 迁移）。**不放进 `~/.dsh/storages`**：那里由宿主 storageDomain 管理，覆盖会互相干扰。

```jsonc
{
  "version": 1,
  "enabled": true,
  "hostVersion": "0.2.1-rc.2",
  "updatedAt": "2026-10-21T00:40:00.000Z",
  "skills": {
    "office-docx": {
      "layer": "global",                 // global | preset
      "mechanism": "provider",           // provider | shadow
      "sourcePath": "…/runtime/office-skills/office-docx/SKILL.md",
      "sourceSize": 3725,
      "sourceMtimeMs": 0,
      "enHash": "sha256:…",              // description+content+resourceBase
      "fingerprint": "sha256:…",         // 含 hostVersion
      "en": "Create, read, edit, and validate Word documents (.docx).",
      "zh": "创建、读取、编辑并校验 Word 文档（.docx）。",
      "engine": "llm",                   // llm | dictionary | none
      "model": "deepseek-flash",
      "translatedAt": "2026-10-21T00:40:00.000Z"
    },
    "agent-experience": {
      "layer": "preset",
      "mechanism": "shadow",
      "fingerprint": "sha256:…",
      "enHash": "sha256:…",
      "zh": "…",
      "engine": "dictionary",
      "shadow": {
        "projectRoot": "~/code/demo",
        "dir": "~/code/demo/.dsh/skills/agent-experience",
        "resources": ["references"],
        "createdAt": "…",
        "shadowHash": "sha256:…"
      }
    }
  },
  "projects": {                          // 还原时按此清单清理，避免满盘扫
    "~/code/demo": { "skills": ["agent-experience"], "updatedAt": "…" }
  },
  "history": [                           // 最多保留 50 条
    { "at": "…", "action": "translate", "detail": "7 provider + 4 shadow, engine=llm" },
    { "at": "…", "action": "restore",   "detail": "user requested; trashed 4 shadows" }
  ]
}
```

写保护：`chmod 600`；写入前若已存在则先 `trash.mjs --snapshot state.json`（留档到 `~/.dsh/.file-backups/`）。

---

## 6. 翻译服务细节

### 6.1 Prompt 约定

```
system: 你是 DSH 的界面文案本地化助手。把给定的英文“技能描述”翻译成简体中文。
        规则：只输出 JSON 对象（键=技能名，值=中文描述）；不要解释、不要代码块、不要 frontmatter；
        每条 1–2 句，以动词开头；保留专有名词与技术名词原文（SKILL.md、Cordis、Loader YAML、LibreOffice Kit、
        MCP、plugin、bundle、preset、workspace）；不得增删事实；长度不超过原文 1.6 倍。
user:   {"office-docx":"Create, read, edit, and validate Word documents (.docx).", …}
```

- 一次调用处理全部未命中缓存的目标（11 条 ≈ 1.9k 字符输入）。
- 超时 30s（可配），失败重试 1 次并附加“上次输出不是合法 JSON，请只输出 JSON”。
- 成功后逐条校验（§3④），不合格的条目单独走词典；仍无则标 `none` 并保留英文。

### 6.2 词典兜底（随包 `lib/dictionary.zh.json`）

键 = 英文原文全串（含标点），值 = 中文。命中即用，`engine: "dictionary"`。当前 11 条草案：

| name | 中文草案 |
| --- | --- |
| office | 创建、编辑、检查或转换 Office 文档、电子表格、演示文稿与 PDF。加载本技能以选择合适的工作流。 |
| office-docx | 创建、读取、编辑并校验 Word 文档（.docx）。 |
| office-export-pdf | 用 LibreOffice Kit 把 Office 文档转换为指定 PDF。 |
| office-pptx | 创建、读取、编辑并校验 PowerPoint 演示文稿（.pptx）。 |
| office-recalculate | 用 LibreOffice Kit 刷新电子表格公式缓存并校验计算值。 |
| office-render | 用 LibreOffice Kit 渲染所需的文档图片，或检查版面视觉效果。 |
| office-xlsx | 读取、创建、编辑并校验 Excel 工作簿、数据与公式（.xlsx）。 |
| agent-experience | 编写或修改面向模型的工具定义（名称、描述、参数 schema 或其系统提示词片段）时使用；设计技能、上下文加载或多步工作流时也使用，目的是让信息可被发现并高效利用上下文。 |
| cordis-composition-reference | 编写或阅读本 harness 的 Cordis bundle patch、agent preset 时使用；需要 Loader YAML 方言（insert、按 id override、group、disabled、isolate、!!js）或可安装 Harness 插件包清单及其功能说明时使用。 |
| cordis-plugin-development | 在当前 Harness profile 中设计、审查、添加、启用、禁用、安装、配置或调试插件、bundle、功能、页面、面板、工具或 MCP 连接时使用，包括默认禁用的随附插件；当视觉对象、装饰或小组件请求未指定其他落点时也使用（即渲染在 Harness Web UI 里的已安装 UI 插件）。 |
| editing-cordis-compositions | 创建、修改或验证本 harness 的 agent preset 或其他 Cordis 组合时使用，包括判断放在 host 还是 preset，以及确认自建 preset 能否成功挂载。 |

> 词典同时是**回归基线**：即使 LLM 可用，若译文与词典差异过大也会在 `status` 中提示（可选策略）。

### 6.3 成本与幂等

- 指纹未变 ⇒ 不发请求；一次升级最多 1 次调用。
- 缓存键 = `fingerprint`；缓存值会随 state 落盘，重启不重复花钱。
- 隐私：只发送 DSH 内置的英文文档描述，不含用户数据；`engine: dictionary` 可完全离线。

---

## 7. 升级 / 还原语义

| 场景 | 行为 |
| --- | --- |
| **用户点“还原”** | `enabled=false` → L1 `invalidate()`（下一步目录即英文）→ L2 全部影子 `trash` → state 记 `history` |
| **用户点“启用”** | `enabled=true` → 重新捕获（若指纹变化则重译）→ L1 `invalidate()` → L2 按需重建 |
| **宿主升级后首次启动** | `state.hostVersion ≠ 当前` ⇒ **先** trash 所有影子（英文生效）→ 清缓存 → 重新捕获/翻译（自动中文） |
| **宿主升级但版本号未变（热替换）** | 指纹（`enHash`）变化同样触发重建 |
| **翻译失败** | 该技能保持英文（影子删掉；provider 透传英文），`status` 标 `failed/degraded`，下个启动重试 |
| **插件被禁用/卸载** | provider 随 fiber dispose 注销（瞬时英文）；影子可能残留 ⇒ `scripts/restore.mjs`/`verify.mjs` 按 `state.projects` 清理（废纸篓） |
| **退出应用** | 默认不动文件；`restoreOnQuit: true` 时退出前 trash 影子（下次启动重建） |
| **真实“升级前”钩子** | 宿主**没有**更新生命周期事件，无法在更新安装瞬间执行；用“启动自愈”达成等价语义（升级后第一眼就是英文，随后自动中文），并在 README 说明 |

---

## 8. 风险清单

| # | 风险 | 影响 | 概率 | 缓解 / 检测 |
| --- | --- | --- | --- | --- |
| R1 | 捕获顺序竞态：我们的 provider 先于 `dsh-office` 挂载 | 拿不到原始定义，L1 失效 | 中 | `list()` 在 `ready` 前返回 `[]` + 后台重试（指数退避 10×，最长 5s）+ 失败后读 `runtime/office-skills` 文件重建（附录按 `paths.js` 探测的 node/cli 拼装）+ `doctor` 报告 |
| R2 | LibreOffice 附录丢失 | 3 个 office 技能不可用 | 低（用捕获原定义） | 单测断言 3 个技能的 content 以 `## Installed LibreOffice Kit` 结尾 |
| R3 | 宿主未来在 global 层加入 rank < 50 的 provider | 我们的条目被顶掉 | 低 | `status` 显示实际生效 provider；不一致时告警 |
| R4 | asar 内路径随版本变化（L2 源） | 影子无法创建/更新 | 中 | `paths.js` 多候选探测 + 失败降级为英文 + `doctor` 明确指出 |
| R5 | 影子覆盖用户同名技能 | 用户资产受损 | 低 | 必须存在 `.skill-desc-zh.json` 标记才接管；否则跳过告警 |
| R6 | 项目目录被写入（git 噪音、他人 clone 缺 `.dsh`） | 观感/协作问题 | 中 | 仅写标准根 `<root>/.dsh/skills`（很多项目已忽略 `.dsh`）；`restore` 一键清；README 明示 |
| R7 | 跨卷删除失败（项目在外部卷） | 还原不彻底 | 低 | 使用 `trash.mjs`（跨卷进 `<mount>/.Trashes`）；失败则保留并明确报错，绝不 `rm` |
| R8 | LLM 不可用/限流/输出不合规 | 无中文 | 中 | 词典兜底 + 保留英文 + `engine` 标注 + 下次启动重试 |
| R9 | 中文描述导致模型路由偏差 | 选错技能 | 低-中 | 保留关键技术名词英文；`status` 可对比原文；可一键还原 |
| R10 | HMR 重复挂载导致 provider 重名抛错 | 插件加载失败 | 低 | `registerProvider` 用 try/catch 包裹并记录；fiber dispose 会先注销 |
| R11 | 用户把 `~/.dsh/skills` 当成仓库提交 | 无（本设计不写该目录） | — | 设计保证零写入 |
| R12 | 预检对本地包“无法验证” | 供应链风险 | 中 | 如实标注“未验证”，并要求人工确认后才装；零依赖降低风险面 |

---

## 9. 回滚方案（分级，全部可逆）

| 级别 | 动作 | 命令 | 结果 |
| --- | --- | --- | --- |
| L0 功能级 | 一键还原英文 | `skill_desc_zh(action:"restore")` 或 `node scripts/restore.mjs` | L1 瞬时英文；L2 影子进废纸篓；state 保留可再启用 |
| L1 插件级（禁用） | 关闭插件 | `plugin_manager set_plugin { target: "dsh-skill-desc-zh", enabled: false }` | fiber 卸载 → provider 注销 → 英文；影子需再跑一次 restore |
| L2 插件级（卸载） | 先还原再卸载 | `node scripts/restore.mjs` → `plugin_manager remove_bundle { target: "dsh-skill-desc-zh" }` | profile 依赖移除；源码仍在 `~/dsh-plugins/skill-desc-zh` |
| L3 源码级 | git 回退 | `git -C ~/dsh-plugins/skill-desc-zh revert <sha>` | 恢复旧实现，重新安装 |
| L4 状态级 | 清除插件状态 | `trash.mjs ~/.dsh/.skill-desc-zh` | 下次启动按默认重建 |

**约束**：以上所有“删除”均由 `trash.mjs`/`lib/trash.js` 完成；任何覆盖前先 `--snapshot`。`scripts/restore.mjs` 会打印废纸篓路径，便于 Finder “放回原处”。

---

## 10. 验收标准（可执行）

| # | 验收项 | 判定命令 / 观察点 | 通过条件 |
| --- | --- | --- | --- |
| A1 | 预检 | `node scripts/preflight.mjs` | 输出包含结论行与本地包“未验证”声明；退出码 0 或 2；有阻塞则 1 且不安装 |
| A2 | 安装 | `plugin_manager install_bundle target=~/dsh-plugins/skill-desc-zh` + `list_plugins` | 条目存在、`enabled`、`fiberPhase=active` |
| A3 | L1 生效 | 新会话首步的 `<available_skills>` | 7 个 office 描述为中文；技能数量不变（14） |
| A4 | L2 生效 | 在 git 项目 cwd 开新会话 | 4 个 agent-preset 描述为中文；`<root>/.dsh/skills/*` 存在且带标记文件 |
| A5 | 内容零改动 | 加载 `office-render` 技能 | 正文与原文逐字相同（仅 frontmatter 描述不同）；末尾含 `## Installed LibreOffice Kit` |
| A6 | 一键还原 | `skill_desc_zh(action:"restore")` 后下一步 | 目录 100% 英文；`~/.Trash` 中出现 4 个影子目录（或 `state` 记录 trash 路径） |
| A7 | 再启用 | `skill_desc_zh(action:"apply")` | 回到中文；无重复条目、无报错 |
| A8 | 升级检测 | 临时改动一个源的指纹（或升 `hostVersion`）→ 重启 | 先英文（影子被 trash）→ 随后自动中文；`history` 有 `upgrade-refresh` 记录 |
| A9 | 离线兜底 | 断网 / `engine: dictionary` | 仍为中文，`engine=dictionary` |
| A10 | 卸载干净 | `remove_bundle` + `restore` | 目录回英文；无 `skill-desc-zh` 残留；`git status` 干净 |
| A11 | 无永久删除 | `grep -rn "\brm -rf\|\bunlink\|rmdir(" lib scripts test` | 无命中（测试里允许断言字符串存在） |
| A12 | 单测 | `node --test test/` | 全绿 |

---

## 11. 已知限制

1. **runtime 注册的技能不可覆盖**（`browser-skill`，rank 250，描述/正文硬编码在插件代码中）——设计中明确排除，`status` 列出。
2. **agent-preset 4 个只能在“带 `.git` 的项目工作区”内中文化**：根因是层级（preset 层压制 global 层）与 rank（仅项目根 100 < 300）；非项目目录（如 `/tmp`）保持英文。
3. **无“升级前”钩子**：宿主未暴露更新事件，等价语义由启动自愈实现（升级后首次读取即为英文，随后自动中文）。
4. **`dsh plugin --profile desktop` 不可用**：桌面 profile 必须通过应用内 `plugin_manager` 管理。
5. **预检无法完整验证本地包**：`audit.mjs` 只接受 npm/GitHub spec；本地包按 §3⑥ 做专项检查并**如实标注未验证**。
6. L2 影子会在项目里产生 `<root>/.dsh/skills/` 内容（约 20 个文件、<100KB）；默认只对 `$HOME` 下的项目生效，可用 `projectAllowlist` 与 `translatePreset:false` 关闭。

---

## 12. 后续可选（不在本期）

- 设置卡片（client 插件）里放“立即还原/重新翻译”按钮，把工具调用变成真正的“一键”。
- 把译文经 `@deepseek-ai/dsh-experimental-translator` 复用（若其 API 稳定）以统一术语。
- 支持 `whenToUse` 字段翻译（当前宿主目录只用 description）。

---

## 13. 证据索引

| 结论 | 证据位置 |
| --- | --- |
| 层级与 rank 语义 | `cordis_inspect_query Service skills`（运行中服务的契约文本）；`app.asar/dsh/node_modules/@deepseek-ai/dsh-scope/lib/index.js`（ScopedLayers） |
| 排序（小 rank 胜） | `app.asar/dsh/node_modules/@deepseek-ai/dsh-skill/lib/index.js:521` |
| rank 常量 | `…/dsh-skill-filesystem/lib/index.js:21-25`；`…/dsh-skill/lib/index.js`（600 / 250） |
| 宿主 `skill-filesystem` 被禁用 | `…/dsh-web-app/cordis.patch.yml:500-520`；`Config listConfigs` 实测 `status: inactive` |
| preset 自带技能目录 | `…/dsh-web-app/presets/cordis.patch.yml:123-127` |
| office 挂载与资源根 | `…/dsh-desktop-host/lib/index.js:73-90`；`…/dsh-skill-office/lib/index.js:42-58,86-98` |
| 目录注入时机 | `…/dsh-tool-skill/lib/index.js`（`agent/pre-step` + digest + `renderCatalogMessage`） |
| provider 契约 | `…/dsh-skill/lib/index.js:140-175,420-478` |
| 工具注册契约 | `…/dsh-tools/lib/index.js`（`tools/change` 于 2785；工具按请求解析） |
| cwd / 项目根 | `…/dsh-working-directory/lib/index.js:26,70`；`…/dsh-skill-filesystem/lib/index.js:811-816` |
| 安装 spec | `…/dsh-plugin-manager/lib/types/install-spec.js`；README.zh.md |
| desktop profile 禁止 CLI | `…/dsh/lib/bin.js:36,113-122` |
| browser-skill runtime 注册 | `~/.dsh/profiles/desktop/node_modules/@wxg-prc-cpg/browser-skill-dsh-plugin/lib/index.mjs:5275-5276,5979-5996` |
| bundle patch 示例 | `~/.dsh/profiles/desktop/node_modules/@liustack/modlens/{package.json,cordis.patch.yml}` |
| 版本 | `app.asar/package.json` → `0.2.1-rc.2`；`app.asar/dsh/package.json` → `0.2.1-rc.2` |

## 14. 追加（v0.1.1，2026-10-21）：runtime 技能覆盖已实现

> 本节覆盖 §2.6、§4.6、§6、§12 中“runtime 250 的 browser-skill 不可覆盖”的旧结论；旧文保留作 v0.1.0 历史记录。

- 机制：cordis 的 traceable 代理把服务方法内的 `this.ctx` 重绑为**调用方 ctx**（`@deepseek-ai/cordis/lib/index.js` 的 createTraceable / createShadowMethod），因此插件在 `agent/created` 里调用 `agent.ctx.get('skills').registerProvider(...)` 时，条目落在**该 agent 的 scope 层**（而不是 global 层）。
- 合并规则不变（`@deepseek-ai/dsh-skill/lib/index.js` collectFresh / collectLayer / listLayerCandidates）：global 层先合入，最近 scope 层后合入整体覆盖；**同层内** rank 小者胜。agent 层内 runtime rank 250，本插件 agent 层 provider rank 50 → 覆盖成功。
- provider 名 `skill-desc-zh-agent`（`lib/agent-layer.js`），候选只含发现阶段通过 `skills.get` 捕获到的 runtime 记录（`record.isRuntime === true`）；`get()` 原样透传 `content`/`resourceBase`/`whenToUse`，只替换 `description` 与 `provider`。
- 端到端证据：`scripts/agent-layer-e2e.mjs`（用宿主真实 cordis/dsh-skill 模块，不启动 DSH）7/7 通过：基线英文 → 注册后中文（provider=`skill-desc-zh-agent`）→ `content` 透传 → global 视角不受影响 → `invalidate()` 立即生效 → `dispose()` 回落。
- 因此当前口径是 README 的“覆盖 12 个（office 7、preset 4、runtime 1）”；本文件其它小节里“browser-skill 不可覆盖”属于 v0.1.0 的历史结论。

---

## 15. 追加（v0.2.0，2026-10-21）：斜杠命令描述中文化

> 本节扩展本文件原先只覆盖“技能描述”的范围：§1.1 的目标与 §1.3 的非目标写作时只涉及技能，未列斜杠命令。自本节起“命令描述中文化”纳入 v0.2.0 范围；此前任何“斜杠命令不在范围内”的表述一并作废，旧文保留作 v0.1.0/v0.1.1 历史记录。机制设计与调查证据分别见 [`command-desc-design.md`](command-desc-design.md)、[`command-desc-investigation.md`](command-desc-investigation.md)，独立验收见 [`verification.md`](verification.md) 的 v0.2.0 章节。

### 15.1 目标与范围

- 目标：让 `/acp`、`/acp-cache`、`/agent-teams` 在**会话命令菜单**中显示中文描述；执行行为、参数、返回值与原命令完全一致。
- 范围：仅 agent scope 的命令描述影子；global 视角永远英文。
- 不覆盖：GUI 自带的 6 个内置命令（`goal`/`plan`/`feedback`/`compact`/`permission`/`export`，由客户端按 `definitionId` 本地化）；未列入 `targets.commands` 的命令。
- 动态范围：agent-teams 配置了 `profiles` 时，额外覆盖 `agent-teams-<profile>`；当前 desktop profile 未配置 `profiles`。

### 15.2 机制（已实现，源码级验收）

1. **作用域**：全局同名 `commands.register()` 会被宿主拒绝（错误信息提示挂到该 agent 的 `agent.ctx`）。插件在 `agent/created` 时通过 `agent.ctx.get('commands').register()` 注册同名影子；cordis traceable 代理把 `this.ctx` 重绑为调用方 ctx，条目落在该 agent 的 scope 层，`list(agent)` 最近层胜出。
2. **只换描述**：影子保留 `definitionId`、`input`（含 `hint`/`attachments`）、`recordInput`；只替换 `description`。
3. **handler 委托**：每次执行实时 `commands.find(undefined, name)` 解析原实现并调用；原实现暂时缺失时用注册期快照兜底，彻底失效返回明确错误，不 catch、不重写返回值。
4. **生命周期**：`agent/created` 同步注册（不阻塞 agent 创建）；`startup` 为已知会话补注册；`commands/change` 50ms debounce，只比较 global digest，并用 per-agent 签名去重，避免自己触发自己；`restore`/`restoreOnQuit`/插件 `dispose` 均注销全部影子。
5. **零文件写入**：命令影子只在内存；不写 profile、不写 `.dsh`、不改命令实现。
6. **译文**：三条命令使用 `lib/dictionary.zh.json`；agent-teams 动态别名用模板 `以 AgentTeams「<profile>」配置运行一个团队目标`；LLM 路径使用 `SYSTEM_PROMPT_COMMANDS`，失败回落词典，不写半成品。

> 与 `command-desc-design.md` 的偏差：该设计提到“自增代次校验”；实现采用 **global digest + per-agent 签名去重**（与 §4.3 的 digest 语义一致），没有数字代次。真实模块探针与 e2e 未出现自触发循环；这是措辞差异，不是行为缺口。

### 15.3 state v1→v2

- `STATE_VERSION = 2`；新增 `commands.byName`（`en`/`zh`/`engine`/`fingerprint`/`hint`/`definitionId` 等）与 `restoredAt`。
- 读取 v1 时 `normalizeState` 惰性补字段并归一化为 v2；技能、项目影子、缓存、历史保留。
- 首次以 v2 保存前用 `trash.snapshot` 给旧文件留档，再原子写（`0600`）；损坏文件只告警并使用空状态，覆盖前同样留档；`restore` 写 `restoredAt` 但不删除 state。

### 15.4 验收与未验证项

- 已通过：`npm test` 107/107；`npm run e2e:commands` 10/10（真实 `CommandRuntime`/`createScope`/`execute`）；独立真实宿主探针 PASS（agent 中文 / global 英文 / 其它 agent 英文 / `definitionId`+`input` 保留 / 执行委托一次 / restore+apply+dispose / 词典+模板）；静态扫描无永久删除调用。
- 未在线验证：真实 GUI `/` 菜单像素、真实 `/acp`/`/agent-teams` 点击副作用、真实 LLM 翻译、真实宿主升级/禁用；这些必须在用户重启 DSH 后确认。
- 当前安装形态：profile 依赖为 `link:`，源码包版本 0.2.0；本次未安装/升级 profile，运行中进程仍是重启前的 v0.1.1。
- 历史样例：§4.7 的 `"version": "0.1.0"` 与不含 `targets.commands` 的配置片段是 v0.1 记录；当前包版本、配置项与默认值以 README §2.3 和本节为准。
