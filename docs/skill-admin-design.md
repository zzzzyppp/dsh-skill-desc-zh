# 设计：dsh-skill-desc-zh v0.5.0 ——「技能管理」设置页（s1）

> 依据：`docs/skill-admin-plan.md`（2026-10-22 获批，唯一需求来源）。
> 本文件是 s1（researcher）交付物：**机制 spike 实证 + 可直接编码的详细设计 + s2/s3 冻结接口**。
> 写作约束：不改 `lib/`、`client.js`、`tests`；spike 脚本只放 `scripts/spike-*.mjs` 与 `/tmp`；删除只走 `trash.mjs`。
> 生成时间：2026-10-22（Asia/Shanghai）。全部证据可由文末命令复跑。

---

## 0. 结论速览

| # | 计划里的高风险假设 | spike 结论 | 风险评级（前 → 后） |
|---|---|---|---|
| A | 在 agent scope 注册 rank 40、`invocation` 全 false 的同名候选，能压过 rank 400 的 `skill-filesystem` 候选，并从模型目录里消失，且可逆 | **成立**，11/11 断言通过（含反证与 dispose 回落） | 高/未验证 → **低/已实测** |
| B | `trash.mjs` 删除后能用日志/结果里的精确 `to` 路径 `rename` 恢复；`~/.Trash` 可访问性 | **成立**，10/10；`~/.Trash` 不可 `readdir`（TCC EPERM），但精确路径 stat/read/rename 可用 | 中 → **低**（恢复只能按记录路径，不能列废纸篓） |
| C | 「只替换 description 与正文、其余字节原样保留」的切片算法可覆盖注释/多行/引号/块标量 | **成立**，11/11；但**锚点+别名必须失败关闭**（见偏差 D1） | 中 → **低**（新增一条失败分支） |
| D | `findProjectRootFS/isProjectAllowed` 在真实 tmp 项目下行为符合预期；无项目时只展示用户来源 | **成立**，9/9；`findProjectRootFS` 不解析 symlink，写盘前须 `realpath` | 低 → **低** |

**建议：继续 s2/s3**。计划主干（§3 改动清单、§4 API、§5 UI、§6 安全）不需要推翻；需要 Lead 批准的偏差共 **7 条**（§10），其中只有 D1（锚点拒绝）与 D2（restore 用 `id`）会影响接口/UI 文案，其余为实现细节补全。

---

## 1. 目标与约束（引自计划，不扩需求）

### 1.1 必须做到

1. 新增独立设置页「技能管理」：`settings.section`，`order: 18`，`id: 'skill-admin'`。
2. 列表 / 搜索 / 详情 / 删除（系统废纸篓 + 可恢复）/ 启用禁用（**不改源文件**）/ 新建 / 编辑（description + 正文）。
3. 可写来源仅两处：`$DSH_HOME/skills/<name>/SKILL.md`（用户级）与 `<projectRoot>/.dsh/skills/<name>/SKILL.md`（项目级）。
4. 写前快照（`trash.mjs --snapshot`）、乐观锁（`mtimeMs + size + sha256`）、frontmatter 校验、`name` 必须等于目录名。
5. 删除只经 `trash.mjs`；恢复 = `rename` 回原路径（父目录存在、目标不存在）。
6. API 与 existing 两页同风格：认证路由、`no-store`、lossless JSON、统一错误体。
7. **不含** GitHub 仓库导入。

### 1.2 明确不做

- 不管理插件包/runtime/预设/asar 内技能的**写入**（只读展示 + 原因）。
- 不扫描、不列出 `~/.Trash`（TCC 禁止；只按本插件删除记录精确路径恢复）。
- 不引入新的 npm 依赖；继续零依赖、可直接 `link:` 的纯 JS。

### 1.3 硬约束（违反即验收失败）

| 约束 | 落地方式 |
|---|---|
| 无永久删除 | 代码里只有 `trash.trash()` / `trash.snapshot()`；禁止 `rm/unlink/rmdir/truncate`；失败临时文件也走 `trash()` |
| 不碰用户真实技能文件 | 单测/e2e 全部用 `mkdtemp` 临时 `DSH_HOME` 与临时项目根 |
| 不改 `lib/`、`client.js`、`tests`（s1） | 本文件与 `scripts/spike-*.mjs` 是唯一新增 |
| 所有响应 lossless JSON | 复用 `lib/plugin-admin.js:40` 已导出的 `toLosslessJson()`（`lib/index.js:36` 已在用）；e2e A24 校验特殊字符/超长数字 |
| 认证 | 复用 `lib/http-api.js` 的 `authenticatedRoutes(server, () => ctx.get('connection'))` |

---

## 2. 机制 spike（A–D）：命令、关键输出、结论

> 统一跑法（spike A/B/C 需要 Electron 的 Node 模式，才能读 asar 内真实模块）：
>
> ```sh
> cd ~/dsh-plugins/skill-desc-zh
> ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" scripts/spike-disable-shadow.mjs
> ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" scripts/spike-trash-restore.mjs
> ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" scripts/spike-frontmatter.mjs
> node scripts/spike-project-root.mjs
> ```
>
> 四个脚本都 `exit 0`，失败即非零并打印断言原因；脚本自建临时目录、跑完保留（不永久删除），
> 需要时由人工 `trash.mjs` 清走。

### 2.1 spike A：禁用影子的语义（最高风险）

**脚本**：`scripts/spike-disable-shadow.mjs`（真实 `@deepseek-ai/cordis` + `dsh-scope` + `dsh-skill`，从 `app.asar` 读入）。

**装配**（复刻宿主两层结构）：

```js
const ctx = new Context()
const skills = new SkillRegistry(ctx)
const agentScope = createScope(ctx, { id: 'agent-spike-a' })
// ① 模拟 skill-filesystem：注册在 agent scope，rank 400
agentScope.ctx.get('skills').registerProvider(() => filesystemProvider)   // 2 个技能：demo-skill / keep-skill
// ② 我们的禁用影子：同一 agent scope，rank 40
agentScope.ctx.get('skills').registerProvider(() => disabledProvider)    // 只列 demo-skill
```

- 影子候选：`{ name: 'demo-skill', description: '（已禁用）English description', invocation: { modelInvocable: false, userInvocable: false }, source: 'user-dsh', provider: 'skill-desc-zh-disabled', rank: 40 }`；`get()` 原样透传 `content`。
- 模拟 filesystem 候选：`rank: 400`，`invocation: { modelInvocable: true, userInvocable: true }`。

**断言与实测输出**（11/11）：

```
✔ A1 基线：agent 视角 list 命中 filesystem（demo-skill/keep-skill），英文、可调用
✔ A2 影子后：agent 视角同名候选来自 skill-desc-zh-disabled，description 带「（已禁用）」前缀
✔ A3 复刻 tool-skill 的过滤：snapshot().skills.filter(isModelInvocable) 只剩 keep-skill（总条目仍 2）
✔ A4 get('demo-skill') 返回影子的定义，content 与原文逐字节一致
✔ A5 isModelInvocable=false 时 skill 工具应抛：skill "demo-skill" is not available for model invocation
✔ A6 isUserInvocable=false：用户显式调用也不注入 skill_content
✔ A7 global 视角 list 为空 —— 禁用不影响 global 层的其它会话
✔ A8 影子的 list() 返回空 + control.invalidate() → 立即回落 filesystem 定义
✔ A9 dispose 影子 provider → 回落 filesystem 定义
✔ A10 反证：global 层 rank 1 的候选在 agent 视角完全不出现（近层整体获胜，不是逐条比 rank）
✔ A11 global 视角能看到 global 层探针（证明它确实注册成功，而非注册失败)
· filesystem provider.list 调用次数：6（缓存按 revision 生效）

spike A（禁用影子）：11/11 项通过
```

**结论**：计划 §2.4 的禁用方案成立，可作为实现依据。

**限制与残余风险**（如实记录，不假设成功）：

1. spike 没有启动真实会话，因此没有拿到「preset 装配 + 真实 agent」的 scoped ctx；用的是 `createScope` 手工构造 agent 层。宿主合并逻辑、`isModelInvocable`、`get` 回落三条关键路径都是真实模块，但**「agent/created 时 `agent.ctx` 已就绪」这一点仍依赖 v0.1/v0.2 的既有实测**（现有 agent 层 provider 已经在真实会话跑通翻译覆盖，同理可证）。
2. 同层重名**不会注册失败**：`collectLayer` 先按 rank 排序再按 name 去重，落后者打 warn `skill "x" from <source> ignored because a higher-priority skill already exists`。所以我们的影子必须 rank 更小，否则只是拿到一条 warn 而目录不变。
3. provider 的 `list()` 结果按 registry revision 缓存（调用次数 6 次是断言期间的实测），禁用/启用后必须 `control.invalidate()`，否则目录要等下一次 revision 变化。
4. 影子只在**同一 agent 层**有作用；global 层注册 rank 1 也压不过 agent 层（A10 反证）。这与计划 §2.1/§2.2 一致。

**评级**：A 从「高风险、未验证」降为「**低风险、核心语义已实测**」；残余风险落在真实 preset 装配（由 s4 在真实会话验收，见 §9.4 第 3 条）。

### 2.2 spike B：trash 删除 → 恢复链路

**脚本**：`scripts/spike-trash-restore.mjs`（真实 `~/.dsh/skills/safe-delete-trash/trash.mjs`，`DSH_TRASH_LOG` 指到 `/tmp` 独立日志，避免污染真实审计日志）。

**关键输出**：

```
✔ B1 trash.mjs --json 输出：{"mode":"trash","results":[{"target":"…","abs":"…","status":"trashed","via":"rename","to":"~/.Trash/demo-skill 2","kind":"dir"}]}
✔ B2 废纸篓里的 to 可 statSync + readFileSync，内容与删除前一致
✔ B3 readdirSync('~/.Trash') → EPERM（macOS TCC）；精确路径的 stat/read/rename 全部可用
✔ B4 renameSync(to, 原路径) 恢复成功，内容一致
✔ B5a rename 到「已存在的文件」= 静默覆盖（POSIX）→ 恢复前必须 stat 目标并报 target-exists
✔ B5b rename 到「已存在的目录」→ ENOTEMPTY/EEXIST
✔ B6 父目录缺失 → ENOENT（恢复前需重建目录或让用户确认）
✔ B7 父目录不可写 → EACCES（chmod 0o500 实测）
✔ B8 废纸篓条目被 Finder 清理 → ENOENT
✔ B9 同名冲突自动改名 demo-skill → "demo-skill 2"（trash.mjs 自身保证唯一）
· log=/var/folders/…/spike-trash-log-7256.jsonl

spike B（trash 恢复链路）：10/10 项通过
```

**日志格式**（`DSH_TRASH_LOG` 或默认 `~/.dsh/.trash-log.jsonl`，每行一条 JSON）：

```json
{"t":"2026-10-22T12:34:56.789Z","action":"trash","via":"rename","from":"~/.dsh/skills/demo-skill","to":"~/.Trash/demo-skill 2","kind":"dir"}
```

**结论与实现约束**：

1. 删除结果以 `trash.mjs --json` 的 `results[]` 为准（`status/abs/to/kind`），日志只作审计；**不解析日志**。
2. `~/.Trash` 不可枚举 ⇒「回收站」页只能展示 `state.skillAdmin.deletions` 里的记录；**禁止**尝试 `readdir(~/.Trash)`（会被 TCC 拒绝，且体验上限就在这）。
3. 恢复顺序（s2 必须照做）：
   1. `stat(to)` 不存在 → `not-found`（提示可能已被 Finder 清理）；
   2. `stat(from)` 存在 → `conflict`（`target-exists`，绝不覆盖）；
   3. 父目录不存在 → 尝试 `mkdir -p`（仅限两处可写根内），失败 → `not-writable`；
   4. `rename(to, from)`；失败按 `ENOENT/ENOTEMPTY/EACCES/EXDEV` 映射错误码；
   5. 成功后 `state.deletions[i].restoredAt = now()`，可选 `trash.snapshot` 不需要（恢复不改内容）。
4. 跨卷（EXDEV）：`trash.mjs` 已用 `<mount>/.Trashes/<uid>` 处理；但恢复跨卷 rename 会 EXDEV ⇒ 报 `trash-unavailable` 并提示手工 Finder 恢复（设计上不做 copy+删除）。

### 2.3 spike C：frontmatter 切片保留

**脚本**：`scripts/spike-frontmatter.mjs`（真实 `lib/host-yaml.js` + 宿主 `yaml`：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/yaml/dist/index.js`）。

脚本里实现了 s2 要落地的 `renderEdit(raw, {description, body})` 原型（失败关闭、写完复核、逐字节比对），11/11：

```
✔ C1 注释 + 额外键 + 行尾注释：除 description 区间外零改动
✔ C2 多行 plain 标量：整段替换，不留残行
✔ C3 单双引号/转义：落盘后 parse 得回原字符串
✔ C4 块标量 |- / > ：整块换单行双引号标量，frontmatter 结构合法
✔ C5 锚点 + 别名：检测到 description 带锚点 → 失败关闭（现有 renderDescription 会连带改 whenToUse，必须挡）
✔ C6 CRLF 文件：换行风格保持
✔ C7 正文含 --- 与 code fence：不受影响
✔ C8 缺 description：失败关闭
✔ C9 无 frontmatter：失败关闭
✔ C10 create() 规范构造往返一致；parser 不校验 kebab-case（name 白名单由 skill-files.js 守）
✔ C11 空正文合法

spike C（frontmatter 切片）：11/11 项通过
```

**关键机制**（s2 直接照抄）：

- `yaml.parseDocument(fmRaw).get('description', true).range` = **仅值区间**：
  - `description: &d "x"` → range 只包住 `"x"`，锚点 `&d` 原位保留；
  - 块标量 `|-`/`>` 与多行 plain → range 覆盖整段文本。
- 替换文本用 `JSON.stringify(desc)`（双引号标量；引号/反斜杠/冒号/中文都安全）。
- 原值末尾有 `\n` 就补一个、没有就不补，保证行数结构不漂移。
- 写完必须 `parse(markdown)` 复核 `name/description/body`，任一不符 → 失败关闭、不落盘。
- 逐字节校验：把新旧文本的 description 区间都替换成占位符后必须完全相等。

### 2.4 spike D：projectRoot 解析

**脚本**：`scripts/spike-project-root.mjs`（普通 `node` 即可，真实 `lib/paths.js`）。

```
✔ D1 .git 目录：从深层子目录向上解析到项目根
✔ D2 .git 文件（worktree）：同样算项目根
✔ D3 没有 .git：返回 undefined（页面只展示用户来源）
✔ D4 最近祖先优先（嵌套项目命中内层 .git）
✔ D5 isProjectAllowed：$HOME 之下 true，$HOME 自身 false，/tmp false
✔ D6 allowlist 前缀放行
✔ D7 空/非法输入 false
✔ D8 projectDshDir(root)=<root>/.dsh/skills；无 root → undefined
✔ D9 findProjectRootFS 不解析 symlink ⇒ 写盘前必须 realpath 并与项目根比对

spike D（projectRoot 解析）：9/9 项通过
```

**结论**：`resolveRequestProjectRoot()` 的 `cwd` 回退可能落在无 `.git` 的目录（如 `/Applications/dsh`），此时 `projectRoot` 仍是该 cwd 但 `projectDshDir` 可用；**是否允许写项目级**取决于 `isProjectAllowed` + 目录可写。UI 上「项目」来源在无项目时显示为不可用（`project: null`）。

---

## 3. API 契约（s2 实现、s3 消费；**冻结**）

### 3.1 路由与通用约定

```js
// lib/http-api.js 新增导出
export const API_SKILL_PATHS = Object.freeze({
  list: `${API_PREFIX}/skills`,            // GET
  detail: `${API_PREFIX}/skills/detail`,   // GET
  action: `${API_PREFIX}/skills/action`,   // POST
})
export const API_SKILL_ACTIONS = Object.freeze(['create', 'save', 'delete', 'restore', 'disable', 'enable'])
export const SKILL_MAX_BODY_BYTES = 256 * 1024
```

| 约定 | 规则 |
|---|---|
| 认证 | 全部走 `authenticatedRoutes(server, () => ctx.get('connection'))`；未认证 401 `{error:'unauthorized'}`/403 `{error:'forbidden'}`（与现有路由一致） |
| 方法 | GET 只读；POST 才动状态；非对应方法 405 + `Allow` 头 |
| Content-Type | POST 必须 `application/json`（带 charset 可），否则 400 `bad-request` |
| 响应头 | `cache-control: no-store`、`content-type: application/json; charset=utf-8` |
| 响应体 | 成功 `{ok:true,...}`；失败 `{ok:false,error:{code,message},…}`；**业务失败 HTTP 200 + `ok:false`**（与 v0.4 两页一致）；协议失败用 4xx/5xx |
| 体积 | 请求体 ≤ 256 KiB（`413 too-large`）；单个 SKILL.md ≤ 256 KiB |
| 单飞 | 与描述动作、插件管理**三者互斥**：任一在跑，其他 POST 返回 409 `{code:'busy', busy:{action,startedAt}}` |
| lossless | 所有响应经 `toLosslessJson()`；`serverTime` 为毫秒整数 |

### 3.2 `GET /plugins/skill-desc-zh/skills`

查询参数：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `projectRoot` | absolute path | 自动解析（state → session → cwd） | 显式指定项目根；非法/不存在 400 |
| `source` | `user` \| `project` \| `all` | `all` | 只列指定来源；`user`/`project` 只返回可写行，只读来源仅 `all` 返回 |
| `refresh` | `1` | 无 | 绕过列表缓存（见 §6.4） |

响应：

```json
{
  "ok": true,
  "projectRoot": "~/dsh",
  "projectSource": "explicit",
  "sources": {
    "user":    { "dir": "~/.dsh/skills", "exists": true,  "writable": true },
    "project": { "dir": "~/dsh/.dsh/skills", "exists": false, "writable": true, "allowed": true }
  },
  "skills": [ /* SkillRow[]，按 name 升序 */ ],
  "trash":  { "count": 2, "items": [ /* TrashRow[]，deletedAt 降序 */ ] },
  "warnings": [],
  "checkedAt": "2026-10-22T12:00:00.000Z",
  "serverTime": 1761115200000
}
```

`project` 为 `null` 当且仅当无项目根（`projectRoot` 同样 `null`）。

`TrashRow`（回收站行；s3 的 `TrashTable` 直接用）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 删除记录 id（`restore` 主键） |
| `scope` | `user` \| `project` | 来源 |
| `projectRoot` | string \| null | 项目级删除时的项目根 |
| `name` | string | 技能名 |
| `from` | string | 原绝对路径 |
| `to` | string \| null | 废纸篓路径（trash.mjs 结果） |
| `kind` | `dir` \| `file` \| null | 条目类型 |
| `size` | number | 删除前字节数 |
| `deletedAt` | ISO string | 删除时间 |
| `restoredAt` | ISO string \| null | 已恢复时间；`null` = 仍在废纸篓可恢复 |
| `restorable` | boolean | `restoredAt==null && to!=null && stat(to)` 成功 |

`SkillRow`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string(kebab) | 目录名 = frontmatter.name |
| `scope` | `user` \| `project` \| `plugin` \| `preset` \| `bundled` \| `runtime` | 来源层；只读行直接使用 `origin` 作为 scope（v0.5 实现） |
| `source` | string | 宿主 source 名（`user-dsh` / `project-dsh` / `custom` / `bundled` / `runtime`） |
| `origin` | `user`\|`project`\|`plugin`\|`preset`\|`bundled`\|`runtime` | UI 徽章用；由 source 与 locator 推断 |
| `description` | string | **展示用**：已翻译则中文，否则原文；只读行在英文匹配 `state.skills[name].en` 时使用中文译文 |
| `dir` | string \| null | 可写技能为所在目录；扁平 `<name>.md` 与只读来源为 `null` |
| `editable` | boolean | `scope` 可写 + name 合法 + 文件 ≤ 上限 + realpath 在根内 |
| `deletable` | boolean | 同 `editable` |
| `disableable` | boolean | 计划 §6：仅用户/项目来源；`origin` 为只读来源时为 `false` |
| `disabled` | boolean | 在 `state.skillAdmin.disabled` 中且 projectRoot 匹配 |
| `readOnlyReason` | `plugin`\|`preset`\|`bundled`\|`runtime`\|`not-writable`\|null | 只读来源原因 |
| `mtimeMs` | number | 文件 mtime |
| `size` | number | 字节数 |
| `fingerprint` | string | `sha256:<hex>`（见 §5.4） |
| `translation` | `{engine:'llm'\|'dictionary'\|'cached'\|'none', zh:boolean}` | 与现有翻译状态对齐 |
| `warnings` | string[] | 单行问题（如 frontmatter 解析失败、同名冲突） |

只读来源（插件/预设/runtime/asar）在 `source=all` 时**也会出现在列表**，`editable/deletable/disableable=false`，`readOnlyReason` 说明原因；`scope` 直接等于 `origin`，`dir` 为 `null`（不暴露 asar 内部路径）。`source=user|project` 只返回对应可写行，不混入只读行；`statusSummary.readOnlySkills` 按来源去重统计。

### 3.3 `GET /plugins/skill-desc-zh/skills/detail`

| 参数 | 必填 | 说明 |
|---|---|---|
| `scope` | 是 | `user` \| `project` |
| `name` | 是 | kebab-case；不在白名单格式 → 400 |
| `projectRoot` | 项目级必填/可省略 | 与列表一致 |

响应：

```json
{
  "ok": true,
  "scope": "user",
  "name": "demo-skill",
  "dir": "~/.dsh/skills/demo-skill",
  "description": "原文描述",
  "frontmatter": { "name": "demo-skill", "description": "原文描述", "metadata": { "owner": "ops" } },
  "body": "# 正文\n…",
  "raw": "---\nname: …\n---\n\n# 正文\n",
  "rawOmitted": null,
  "fingerprint": "sha256:9f2c…",
  "mtimeMs": 1761115000000,
  "size": 812,
  "editable": true,
  "disableable": true,
  "disabled": false,
  "warnings": [],
  "serverTime": 1761115200000
}
```

规则：

- `raw` 仅在 `size ≤ 256 KiB` 时返回；超限 `raw:null, rawOmitted:'too-large'`（详情仍可编辑 description，正文由 `body` 提供）。
- `frontmatter` 是解析后的普通对象（保留未知键，供 UI 展示「其它键原样保留」）；`body` 为去掉 frontmatter 的正文（保留首尾空行语义）。
- 只读来源不提供 detail 编辑（但可返回只读详情：`editable:false`）。
- 不存在/越界 → `404 not-found` / `400 unsupported-source`。

### 3.4 `POST /plugins/skill-desc-zh/skills/action`

请求体公共字段：

| 字段 | 适用 | 说明 |
|---|---|---|
| `action` | 全部 | 六个动作之一 |
| `scope` | create/save/delete/disable/enable；restore 用 `scope+name` 时必填 | `user`\|`project` |
| `name` | create/save/delete/disable/enable；restore 用 `scope+name` 时必填 | kebab-case，≤ 64 字符 |
| `projectRoot` | project 动作 | absolute path |
| `description` | create/save | 非空、≤ 400 字符、单行 |
| `body` | create/save | ≤ 200 KiB（留 frontmatter 余量） |
| `expectedFingerprint` | save | 乐观锁；不匹配 → `conflict`；接受带或不带 `sha256:` 前缀 |
| `id` | restore | `deletions[].id`；与 `scope+name` 二选一；按 id 恢复可省略 `scope` |
| `dryRun` | delete/restore | 只预演，不落盘 |

统一响应：

```json
{ "ok": true, "action": "save", "result": { /* 动作相关 */ }, "warnings": [], "serverTime": 1761115200000 }
```

#### 3.4.1 create

```jsonc
// 请求
{ "action": "create", "scope": "user", "name": "my-skill", "description": "我的技能", "body": "# 步骤\n\n1. …" }
// result
{ "skill": { "name": "my-skill", "description": "我的技能", "scope": "user", "projectRoot": null,
             "path": "~/.dsh/skills/my-skill/SKILL.md", "relativePath": "SKILL.md" } }
```

- 目录/同名扁平文件已存在 → `409 conflict`（`code:'conflict'`）；父根不可写 → `not-writable`。
- 生成模板固定为：

```md
---
name: my-skill
description: "我的技能"
---

# 步骤

1. …
```

- `name` 必须匹配 `^[a-z0-9][a-z0-9-]{0,63}$` 且不以 `-` 结尾；`description` 单行、去首尾空白后非空。

#### 3.4.2 save

```jsonc
{ "action": "save", "scope": "user", "name": "my-skill", "description": "新描述", "body": "# 新正文", "expectedFingerprint": "sha256:…" }
// result
{ "skill": { "name": "my-skill", "description": "新描述", "scope": "user", "projectRoot": null,
             "path": "~/.dsh/skills/my-skill/SKILL.md" }, "changed": true }
```

- 读盘 → 算当前指纹 → 与 `expectedFingerprint` 不等 → `409 conflict`（附 `current:{fingerprint,mtimeMs,size}`）。
- 写前对该文件 `trash.snapshot(file)`；失败 → `not-writable`（不写）。
- 写盘：同目录临时文件 `.<name>.md.tmp-<rand>` → `fs.writeFileSync(tmp, 0o600)` → `fs.renameSync(tmp, file)`；任何异常把临时文件 `trash.trash(tmp)` 后返回错误。
- frontmatter 用 §5 的切片算法；锚点/别名 → `400 unsupported-frontmatter`。
- 写后 `invalidate` 翻译 provider + 禁用 provider；下一次 `agent/pre-step` 目录 digest 变化即刷新。

#### 3.4.3 delete

```jsonc
{ "action": "delete", "scope": "user", "name": "demo-skill" }
// result
{ "deletion": { "id": "del-1761115200000-3f9a", "scope": "user", "name": "demo-skill",
                "from": "~/.dsh/skills/demo-skill", "to": "~/.Trash/demo-skill 2",
                "kind": "dir", "size": 1204, "deletedAt": "2026-10-22T12:00:00.000Z" } }
```

- 先 `stat` 确认存在；`trash.trash([dir])`；`results[0].status !== 'trashed'` → `trash-unavailable`（带 stderr 摘要）。
- 成功后写 `state.skillAdmin.deletions`（保留最近 200 条，包含已恢复）。
- 目录里的内容整体移走，**不逐个文件删**。

#### 3.4.4 restore

```jsonc
{ "action": "restore", "id": "del-1761115200000-3f9a" }
// result（外层是 { ok:true, action:'restore', result:{ restored:{…}, dryRun } }）
{ "restored": { "id": "…", "from": "…/.Trash/demo-skill 2", "to": "~/.dsh/skills/demo-skill", "via": "rename" } }
```

- 分支与错误码见 §2.2 第 3 条；`ENOENT(to)` → `404 not-found`（`reason:'trash-entry-missing'`）；
- `EEXIST/ENOTEMPTY` → `409 conflict`（`reason:'target-exists'`）；`EACCES` → `not-writable`。
- 成功后 `deletion.restoredAt = now()`。
- 按 `id` 恢复可省略 `scope`；若删除记录是 project，会重新校验记录的 `projectRoot` 是否仍在 allowlist，不在则 `unsupported-source`（F5）。
- 缺 `id` 时允许 `scope+name+projectRoot`：取该组合最近一条未恢复记录。

#### 3.4.5 disable / enable

```jsonc
{ "action": "disable", "scope": "user", "name": "demo-skill" }
// result
{ "disabled": { "scope": "user", "name": "demo-skill", "projectRoot": null, "disabledAt": "…" } }

{ "action": "enable", "scope": "user", "name": "demo-skill" }
// result
{ "enabled": { "scope": "user", "name": "demo-skill", "removed": true } }
```

- 仅允许用户/项目来源（计划 §6）；只读来源 → `400 unsupported-source`。
- `disable` 幂等（重复 disable 不重复记录）；`enable` 幂等（不存在也算成功）。
- 变更后 `control.invalidate()` 所有 agent 层 provider + 宿主 provider；无需重启。

### 3.5 错误码表（冻结）

| `error.code` | HTTP | 触发 |
|---|---|---|
| `bad-request` | 400 | JSON 非法 / 字段类型错 / 未知 action / projectRoot 非法 / Content-Type 错 |
| `invalid` | 400 | name 不合法、description 空/多行、body 超长、frontmatter 缺 description |
| `too-large` | 413 | 请求体或 SKILL.md > 256 KiB |
| `unsupported-source` | 400 | 对只读来源执行写动作；scope 与来源不符；symlink 越界 |
| `unsupported-frontmatter` | 400 | description 带 YAML 锚点/别名（§5.3 D1） |
| `not-found` | 404 | 技能目录/SKILL.md/删除记录/废纸篓条目不存在 |
| `conflict` | 409 | 保存指纹不匹配（`reason:'stale-fingerprint'`）、create 目录已存在、restore 目标已存在 |
| `busy` | 409 | 与描述动作/插件管理/其他技能动作并发 |
| `not-writable` | 403 | 根目录不可写 / snapshot 失败 / 父目录不可建 |
| `trash-unavailable` | 503 | `trash.mjs` 不可用、被拒绝、返回 failed、跨卷恢复 |
| `internal` | 500 | 未预期异常（message 脱敏，不含堆栈） |

方法错误：`405` + `Allow: GET` 或 `POST`；认证：`401/403`（沿用现有实现）。

---

## 4. state v3 schema 与 v2 → v3 迁移

### 4.1 v3 结构

```jsonc
{
  "version": 3,
  "enabled": true,
  "hostVersion": "0.2.1-rc.2",
  "updatedAt": "2026-10-22T12:00:00.000Z",
  "skills":    { /* v1/v2 原样保留：翻译缓存 */ },
  "projects":  { /* v1/v2 原样保留：项目影子 */ },
  "commands":  { "byName": {}, "updatedAt": "…", "restoredAt": null },
  "skillAdmin": {
    "disabled": [
      { "scope": "user", "name": "demo-skill", "projectRoot": null,
        "disabledAt": "2026-10-22T12:00:00.000Z", "reason": "user" }
    ],
    "deletions": [
      { "id": "del-1761115200000-3f9a", "scope": "project", "name": "demo-skill",
        "projectRoot": "~/dsh",
        "from": "~/dsh/.dsh/skills/demo-skill",
        "to": "~/.Trash/demo-skill 2", "kind": "dir", "size": 1204,
        "deletedAt": "2026-10-22T12:00:00.000Z", "restoredAt": null }
    ],
    "updatedAt": "2026-10-22T12:00:00.000Z"
  },
  "cache":    { /* 原样 */ },
  "history":  [ /* ≤ 50 */ ]
}
```

**字段规则**：

- `disabled[]`：`scope` ∈ `user|project`；`name` kebab；`project` 条目必须带 `projectRoot`（否则视为无效丢弃）；同一 `(scope,name,projectRoot)` 去重（后写覆盖）；
- `deletions[]`：`id` 唯一；`from/to` 必须绝对路径；保留最近 **200** 条（先按 `deletedAt` 升序丢弃已 `restoredAt` 的，再丢最旧未恢复的；丢弃前不做事——只是不再展示，废纸篓文件不受影响）；
- `restoredAt` 为 `null` 表示「在废纸篓、可恢复」。

### 4.2 迁移函数（s2 落地）

```js
export const STATE_VERSION = 3
export const MAX_DELETIONS = 200

export function defaultSkillAdmin({ now = () => new Date() } = {}) {
  return { disabled: [], deletions: [], updatedAt: now().toISOString() }
}

export function normalizeSkillAdmin(input, { now = () => new Date() } = {}) {
  const state = defaultSkillAdmin({ now })
  if (!isPlainObject(input)) return state
  const seen = new Set()
  for (const item of Array.isArray(input.disabled) ? input.disabled : []) {
    if (!isPlainObject(item)) continue
    const scope = item.scope === 'project' ? 'project' : item.scope === 'user' ? 'user' : null
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!scope || !KEBAB.test(name)) continue
    const projectRoot = scope === 'project' ? absolute(item.projectRoot) : null
    if (scope === 'project' && !projectRoot) continue
    const key = `${scope}\u0000${name}\u0000${projectRoot ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    state.disabled.push({ scope, name, projectRoot, disabledAt: isoOr(item.disabledAt, now), reason: typeof item.reason === 'string' ? item.reason : 'user' })
  }
  const deletions = (Array.isArray(input.deletions) ? input.deletions : [])
    .filter(isPlainObject)
    .map((item) => normalizeDeletion(item, { now }))
    .filter(Boolean)
  state.deletions = pruneDeletions(deletions).slice(-MAX_DELETIONS)
  state.updatedAt = isoOr(input.updatedAt, now)
  return state
}
```

`normalizeState()` 里追加（在 `state.version = STATE_VERSION` 之前）：

```js
state.skillAdmin = normalizeSkillAdmin(input.skillAdmin, { now })
if (Number(input.version) < 3) warnings.push('状态文件版本 2，已迁移到 v3（新增 skillAdmin）')
```

### 4.3 helper（skill-admin.js 调用）

| helper | 签名 | 说明 |
|---|---|---|
| `isDisabled` | `(state, {scope,name,projectRoot}) => boolean` | project 条目要求 `projectRoot` 相等（`null` 不匹配） |
| `addDisabled` | `(state, entry) => boolean` | 幂等；返回是否新增；更新 `updatedAt` |
| `removeDisabled` | `(state, {scope,name,projectRoot}) => boolean` | 幂等 |
| `recordDeletion` | `(state, deletion) => deletion` | 写 `deletions`、裁剪、更新 `updatedAt` |
| `findDeletion` | `(state, {id,scope,name,projectRoot}) => deletion?` | id 优先；否则最近未恢复 |
| `markRestored` | `(state, id) => boolean` | 设 `restoredAt` |
| `listDeletions` | `(state) => deletion[]` | 只返回 `restoredAt == null`，按 `deletedAt` 倒序 |

**兼容性**：v2 文件读入后 `version` 必为 3；`createStateStore.save()` 不变（先 `trash.snapshot` 再 tmp+rename、0o600）。回滚到 v0.4 时，v0.4 的 `normalizeState` 会丢弃 `skillAdmin`（白名单拷贝），不会崩——但禁用/删除记录会丢，因此回滚前应提示用户先 `enable`/`restore`。

---

## 5. frontmatter 编辑算法与边界（s2 实现规格）

### 5.1 数据结构

```js
// lib/skill-files.js
export const SKILL_FILE = 'SKILL.md'
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/u
export const MAX_SKILL_BYTES = 256 * 1024
export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u
```

### 5.2 `renderEdit(raw, { description, body })`（从 spike C 原型原样搬入）

```js
function renderEdit(raw, { description, body }) {
  const parsed = frontmatter.parse(raw)
  if (!parsed.ok) return parsed                                   // 失败关闭
  if (typeof description !== 'string' || description.trim() === '') return { ok: false, code: 'invalid', reason: 'description 不能为空' }
  if (description.includes('\n') || description.includes('\r')) return { ok: false, code: 'invalid', reason: 'description 必须单行' }
  if (typeof body !== 'string') return { ok: false, code: 'invalid', reason: 'body 必须是字符串' }
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) return { ok: false, code: 'invalid', reason: '缺少 frontmatter' }
  const fmRaw = match[1]
  const prefix = raw.slice(0, match[0].indexOf(fmRaw))
  const closing = raw.slice(prefix.length + fmRaw.length, match[0].length)
  const doc = yaml.parseDocument(fmRaw)
  if (doc.errors.length > 0) return { ok: false, code: 'invalid', reason: 'frontmatter YAML 解析失败' }
  const node = doc.get('description', true)
  if (!node || node.constructor?.name === 'Alias') {
    return { ok: false, code: 'unsupported-frontmatter', reason: 'description 是 YAML 别名，无法安全定位' }
  }
  if (!Array.isArray(node.range)) return { ok: false, code: 'unsupported-frontmatter', reason: '找不到 description 的值区间' }
  // D1：锚点会让其它 *alias 一起改值 —— 拒绝写，只读展示
  if (node.anchor !== undefined) {
    return { ok: false, code: 'unsupported-frontmatter', reason: 'description 带 YAML 锚点（&name），修改会连带改变别名字段' }
  }
  const [start, end] = node.range
  const original = fmRaw.slice(start, end)
  const newline = original.endsWith('\r\n') ? '\r\n' : original.endsWith('\n') ? '\n' : ''
  const nextFm = `${fmRaw.slice(0, start)}${JSON.stringify(description)}${newline}${fmRaw.slice(end)}`
  const nextBody = body.length === 0 ? '\n' : `\n${body.replace(/\s+$/u, '')}\n`
  const markdown = `${prefix}${nextFm}${closing}${nextBody}`

  // 写后复核（三层）
  const verify = frontmatter.parse(markdown)
  if (!verify.ok) return { ok: false, code: 'internal', reason: `重写后解析失败：${verify.reason}` }
  if (verify.name !== parsed.name) return { ok: false, code: 'internal', reason: '重写改变了 name' }
  if (verify.description !== description) return { ok: false, code: 'internal', reason: '重写后 description 不一致' }
  if (verify.body !== body.trim()) return { ok: false, code: 'internal', reason: '重写后正文不一致' }
  // 逐字节：把 description 区间换成占位符后，其余必须完全相等
  const stripped = (text) => {
    const m = FRONTMATTER_RE.exec(text)
    const rawFm = m[1]
    const d = yaml.parseDocument(rawFm)
    const n = d.get('description', true)
    return rawFm.slice(0, n.range[0]) + '\u0000DESC\u0000' + rawFm.slice(n.range[1])
  }
  if (stripped(raw) !== stripped(markdown)) return { ok: false, code: 'internal', reason: 'frontmatter 其它字节被改动' }
  return { ok: true, markdown, changed: markdown !== raw }
}
```

### 5.3 边界用例表（实现必须逐条覆盖）

| # | 输入 | 期望 |
|---|---|---|
| E1 | 注释 + 额外键 + 行尾注释 | 成功，除 description 区间外逐字节一致 |
| E2 | 多行 plain 标量 | 成功，整段替换、无残行 |
| E3 | 单/双引号、含 `"` `\` `:` | 成功，`parse` 得回原字符串 |
| E4 | 块标量 `\|-` / `>` | 成功，输出单行双引号标量 |
| E5 | `description: &d "x"` + `whenToUse: *d` | **拒绝**：`unsupported-frontmatter`（D1） |
| E6 | `description: *other` | **拒绝**：`unsupported-frontmatter` |
| E7 | CRLF 文件 | 成功，CRLF 保持 |
| E8 | 正文含 `---` / code fence | 成功，正文原样 |
| E9 | 缺 description | **拒绝**：`invalid` |
| E10 | 无 frontmatter | **拒绝**：`invalid` |
| E11 | description 为空串 | **拒绝**：`invalid` |
| E12 | description 含换行 | **拒绝**：`invalid`（DSH 目录是单行展示） |
| E13 | 文件 > 256 KiB | **拒绝**：`too-large`（读之前先 stat） |
| E14 | name 与目录名不一致 | **拒绝**：`invalid`（写路径不自动改名） |
| E15 | 正文为空 | 成功（保留一个空行） |
| E16 | undefined 空白字符（NBSP 等） | 原样保留，只在首尾 trim |

### 5.4 指纹（乐观锁）

实现不是整文件原始字节哈希，而是**语义指纹**（`lib/skill-files.js:565-583`）：

```js
fingerprint(target) = sha256(
  (target.description ?? '') + '\0' +
  (target.body ?? '') + '\0' +
  (target.relativePath ?? '')
)
```

- `GET /skills` 与 `detail` 返回 `"sha256:" + fileFingerprint(path, relativePath)`；`fileFingerprint` 先解析 frontmatter，再按上述 description/body/relativePath 计算。
- `save` 的 `expectedFingerprint` 在比较前会去掉可选的 `sha256:` 前缀，再与当前文件的语义指纹比较；不匹配返回 `conflict`（附当前指纹）。
- 同时返回 `mtimeMs/size` 供 UI 展示；但不用 `mtimeMs` 做唯一判据（copy/恢复会保留或重置 mtime）。
- 指纹在列表与详情都返回，UI 保存时回传；只读行 `fingerprint:null`。

### 5.5 写盘序列（save / create 共用）

```
1. stat(dir) 存在？否 → not-found
2. realpath(dir) 必须以 realpath(root)+sep 开头 → 否则 unsupported-source
3. name 合法 + dir basename === name → 否则 invalid
4. （save）读 file → 算指纹 → 与 expected 不等 → conflict(current)
5. （save）trash.snapshot(file)；失败 → not-writable
6. （create）mkdir(dir)（已存在 → conflict）
7. renderEdit / renderCreate
8. 写临时文件 <dir>/.SKILL.md.tmp-<rand>（0o600）
9. rename(tmp, file)   // 同目录原子
10. 任何异常：尝试 trash(tmp)；返回错误
11. 返回新指纹与 stat
```

**create 模板**：

```js
function renderCreate({ name, description, body }) {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.replace(/\s+$/u, '')}\n`
}
```

`name` 由调用方先过 `SKILL_NAME_RE`；`body` 允许为空。

---

## 6. 禁用影子：注册 / 刷新 / 释放（s2 实现规格）

### 6.1 模块与 rank

```js
// lib/agent-layer.js 追加
export const AGENT_DISABLED_PROVIDER_NAME = 'skill-desc-zh-disabled'
export const AGENT_DISABLED_RANK = 40          // < AGENT_PROVIDER_RANK(50) < filesystem(400) < runtime(250)
export const DISABLED_PREFIX = '（已禁用）'
```

`rank` 关系（同一层内小者胜）：**agent 层**：`40 禁用影子 < 50 中文覆盖 < 250 runtime`；**global 层**：`300 preset custom < 400 用户 < 600 内置`。跨层时近层整体获胜（spike A10），与 rank 无关。

### 6.2 Provider 形态

```js
export function createDisabledProvider({ state, readTarget, isEnabled, isReady, logger }) {
  return {
    name: AGENT_DISABLED_PROVIDER_NAME,
    list({ scope, cwd } = {}) {
      if (!isEnabled() || !isReady()) return { candidates: [], complete: false }
      const projectRoot = projectRootFor(cwd)               // 与 UI 的 projectRoot 同源
      const candidates = []
      for (const entry of state.skillAdmin.disabled) {
        if (entry.scope === 'project' && entry.projectRoot !== projectRoot) continue
        const target = readTarget(entry)                    // 见 6.3；读不到 → skip + warn
        if (!target) continue
        candidates.push({
          name: entry.name,
          description: `${DISABLED_PREFIX}${clip(target.description, 160)}`,
          invocation: { modelInvocable: false, userInvocable: false },
          source: target.source,                            // 'user-dsh' | 'project-dsh'
          provider: AGENT_DISABLED_PROVIDER_NAME,
          rank: AGENT_DISABLED_RANK,
          resourceBase: target.resourceBase,
          metadata: { disabled: true, disabledAt: entry.disabledAt },
        })
      }
      return { candidates, complete: true }
    },
    async get(candidate) {
      // 与 list 一致：读不到 → undefined（宿主回落，不会崩）
      const entry = state.skillAdmin.disabled.find((item) => item.name === candidate.name)
      const target = entry ? readTarget(entry) : undefined
      if (!target) return undefined
      return {
        name: candidate.name,
        description: `${DISABLED_PREFIX}${clip(target.description, 160)}`,
        invocation: { modelInvocable: false, userInvocable: false },
        source: target.source,
        provider: AGENT_DISABLED_PROVIDER_NAME,
        content: target.content,                            // 原样透传（spike A4）
        ...(target.resourceBase ? { resourceBase: target.resourceBase } : {}),
        ...(target.whenToUse ? { whenToUse: target.whenToUse } : {}),
      }
    },
  }
}
```

**注册时机**（与现有 agent provider 完全一致，`lib/index.js`）：

```js
ctx.on('agent/created', ({ agent }) => {
  controller.registerForAgent({ agent })                 // 现有：中文覆盖（rank 50）
  controller.registerDisabledForAgent({ agent })         // 新增：禁用影子（rank 40）
  controller.ensureShadowsForAgent({ agent })
})
```

`registerDisabledForAgent` 内部：

```js
if (!controller.hasDisabledEntries()) return { ok: true, skipped: true }   // 没有禁用记录就不注册，避免空 provider
return registerAgentLayerProvider({ agent, provider: disabledProvider, onControl: pushControl, logger })
```

> 辅助函数（s2 自行实现，均 3 行内）：`projectRootFor(cwd)` = `findProjectRootFS(cwd, fs)`（§7.1，不解析 symlink）；`clip(text, n)` = 超长截断并补 `…`；`readTarget(entry)` 见 §6.3。
>
> 注意：`registerAgentLayerProvider` 的 `provider` 参数就是 provider 对象；禁用 provider 与翻译 provider 是**两个不同 provider 名**，在同一 agent 层共存不冲突。

### 6.3 `readTarget(entry)`：内容从哪来

禁用影子需要原技能的 `description/content/source/resourceBase`，来源优先级：

1. **磁盘**（用户/项目可写来源，唯一被计划允许禁用的来源）：
   `join(root, '.dsh/skills' | 'skills', name, 'SKILL.md')` → `frontmatter.parse` → `{ description, body, content: markdown, source, resourceBase:{kind:'directory', path: dir} }`。
2. **翻译捕获缓存**（`controller.internals.captured`）：若磁盘读失败但捕获里有同名定义，用捕获的 `definition`（只读兜底，仍不写文件）。
3. 都读不到 → `skip`，`warnings.push('禁用记录找不到源：<name>')`，不注册候选（该技能继续可用——**宁可不禁用，也不静默隐藏**）。

**为什么以磁盘为准**：编辑/删除会改变文件；捕获是启动时快照，会过期。以磁盘为准能让「禁用 + 编辑」组合得到最新正文。

### 6.4 刷新与释放

| 事件 | 动作 |
|---|---|
| `disable` / `enable` | 更新 state → `invalidateAll()`（宿主 provider + 所有 agent 层的翻译/禁用 provider）→ 下一次 `agent/pre-step` 重新 `snapshot()`，目录 digest 变化即替换 `<available_skills>` |
| `save` / `create` / `delete` / `restore` | 同上（内容变了，provider 的 `get` 每次现读磁盘，list 的 description 也需要 invalidate 才刷新） |
| 新 agent | `agent/created` 里注册两个 provider（禁用 provider 仅在 `hasDisabledEntries()` 时注册） |
| agent 销毁 | 宿主自动移除 scoped provider（`dispose` 由 `agent.ctx` 生命周期管理）；我们只清理 `agentLayerDisposers/controls` 的引用 |
| 插件卸载 | `dispose()` 里 dispose 两个 provider 的 registration + `pluginAdmin.dispose()` |
| 列表缓存 | `GET /skills` 默认 2s 内存缓存；`refresh=1` 绕过；任何写动作后清空 |

**与翻译 provider 的互斥**：翻译 provider 的 `filter` 追加 `!isDisabled(record)`，避免同层两个 provider 列同名候选（虽然会按 rank 去重，但会产生 warn 噪音）。

**副作用确认**：禁用只在**当前 agent 的 scope 层**生效（spike A7 反证 global 不受影响）；不同会话看到的目录可能不同（项目级禁用只对同一 `projectRoot` 的会话生效）。

### 6.5 已知限制（写进 README/详情文案）

1. 只读来源（插件/预设/runtime/内置）不可禁用（计划 §6）。
2. 禁用不影响其它 DSH 实例/其它 profile 读到的技能文件（文件没变）。
3. 模型侧生效存在一个 `agent/pre-step` 的延迟（通常下一轮对话）；UI 用「已禁用」徽章即时反馈 + 轮询列表。

---

## 7. 可写根、来源判定与安全边界

### 7.1 根解析（`lib/skill-files.js`）

```js
createSkillFiles({ paths, frontmatter, trash, fs, logger, now, allowlist, getState })
  → {
      roots(projectRoot) → [                       // 数组，不是 {user, project}
        { kind:'user',    root: join(paths.dshHome, 'skills'), projectRoot:null, writable:true,  reason:null },
        { kind:'project', root: join(projectRoot, '.dsh', 'skills'),
          projectRoot, writable: permission.allowed, reason: permission.reason },  // permission=projectAllowed(projectRoot)
      ],
      scan({ projectRoot })    → { skills, warnings },  // 等价旧设计的 list
      readTarget({ scope, name, projectRoot }),
      detail({ scope, name, projectRoot }),
      create({ scope, name, description, body, projectRoot }),
      save({ scope, name, description, body, projectRoot, args:{ fingerprint } }),
      delete({ scope, name, projectRoot, dryRun }),      // 内部只调 trash
      restore({ id, scope, name, projectRoot, intent, dryRun }),
      fingerprint(target), fileFingerprint(file, relativePath),
      // 其余：fileFingerprint/listDeletions/chunkBody/scanResources/targetPath/isInside
    }
```

- `writable` = 目录存在且可写；不存在时看父目录（`paths.dshHome` / `projectRoot`）可写 ⇒ 可创建。
- `createSkillFiles` 接收 `allowlist`，内部用 `isProjectAllowed(projectRoot, { home, allowlist, env: process.env })` 判定；未通过 ⇒ `writable:false` 且写项目级返回 `unsupported-source`。`createSkillAdmin` 的 `configurePermission` 供 HTTP 层/上层再校验。
- **realpath 守卫**：所有写操作前 `realpath(dir)`，必须 `startsWith(realpath(root) + sep)`；`name` 里不允许 `/`、`\`、`.`、`..`。

### 7.2 只读来源的 `origin/readOnlyReason`

| source | origin | readOnlyReason |
|---|---|---|
| `user-dsh` / `project-dsh` | `user` / `project` | `null`（可写） |
| `custom`（`customSkillDirs`，如 agent-preset） | `preset` | `preset` |
| `bundled`（office / runtime） | `bundled` / `runtime` | `bundled` / `runtime` |
| 插件包内（如 browser-skill） | `plugin` | `plugin` |

`editable = origin ∈ {user, project} && writable && size ≤ limit`；`disableable = origin ∈ {user, project}`（与 `editable` 分开：文件不可写时仍可禁用？——按计划 §6「禁用仅对用户/项目可写来源」，`disableable = editable`，避免「能禁用不能编辑」的困惑）。

### 7.3 删除语义

- 只调 `trash.trash([abs])`；`results[0].status` 必须为 `trashed`。
- 记录 `{from: abs, to: results[0].to, kind, size}`。
- `kind` 不是 `dir`（例如有人把技能做成单个 .md）→ 仍允许，但 `from` 为文件路径。
- 失败时把 `stderr` 摘要写入 `warnings`，错误码 `trash-unavailable`，**不留半删状态**。

### 7.4 不接受的输入

- 任意路径参数（`dir`/`path`/`from`/`to`）——API 只收 `scope + name + projectRoot`。
- 非 kebab-case 名称、`..`、绝对路径名。
- 对只读来源的任何写动作（`create` 到只读目录 = `unsupported-source`）。

---

## 8. UI 状态机与文案 key（供 s3 直接照做）

### 8.1 页面注册

```js
const SKILL_ORDER = 18
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'skill-admin',
  order: SKILL_ORDER,
  label: () => t('skills.nav'),
  locale: NS,
}, (props) => h(Boundary, { t: props.t || t }, h(SkillAdminPage, { ...props, t: props.t || t }))))
```

导航顺序：现有 `16 nav`、`17 plugin-admin`、**18 skill-admin**。

### 8.2 状态机

```
page: 'loading' → 'ready' | 'error'
view: 'list' | 'trash'
filters: { q: string, source: 'all'|'user'|'project', status: 'all'|'enabled'|'disabled' }
busy: null | { kind: 'refresh'|'save'|'create'|'delete'|'restore'|'toggle', id?: string }
dialog: null | { kind: 'create' } | { kind: 'edit', row } | { kind: 'delete', row }
        | { kind: 'restore', deletion } | { kind: 'conflict', row, current }
notice: null | { tone:'info'|'success'|'warn'|'danger', text }
```

- `loading`：首次 `GET /skills`；失败 → `error`（显示错误码对应文案 + 重试）。
- `ready`：渲染统计条 + 工具栏 + 列表；列表为空（搜索/筛选后）→ 空态。
- 每个动作：`busy` 置位 → POST → 成功后重新 `GET /skills?refresh=1` → `notice`；失败按错误码映射弹 `notice` 或 `conflict` 弹窗。
- 删除成功：切到 `trash` tab 并高亮新记录（提示「已移入系统废纸篓，可在此恢复」）。
- 冲突（409 `stale-fingerprint`）：弹窗只提供「重新载入」与「取消」，不提供强制覆盖（计划 §5）。
- 禁用开关：乐观更新（先翻 UI 状态），失败回滚 + `notice`。

### 8.3 组件树

```
SkillAdminPage
├─ Header（标题、说明、Refresh、New）
├─ StatsBar（用户/项目/只读/已禁用/回收站）
├─ Tabs（技能列表 | 回收站）
├─ Toolbar（搜索、来源筛选、状态筛选）
├─ SkillTable
│   └─ SkillRow（name、description、source/status badges、actions、toggle）
├─ ReadOnlySection（可折叠：插件/预设/内置技能 + 只读原因）
├─ TrashTable（name、scope、deletedAt、size、Restore）
└─ Dialogs
    ├─ SkillEditorDialog（create/edit：name、description、body、fingerprint、只读提示）
    ├─ DeleteConfirmDialog（「移入系统废纸篓，本页可恢复」）
    └─ ConflictDialog（「文件已被外部修改」→ 重新载入）
```

### 8.4 文案 key（zh/en 各一套，s3 内联 DICT + `locale/{zh,en}.json` 严格同键）

| key | zh | en |
|---|---|---|
| `skills.nav` | 技能管理 | Skill Admin |
| `skills.title` | 技能管理 | Skill Admin |
| `skills.subtitle` | 管理用户级与项目级技能；插件/预设/内置技能只读 | Manage user and project skills; plugin/preset/builtin skills are read-only |
| `skills.refresh` | 刷新 | Refresh |
| `skills.new` | 新建技能 | New skill |
| `skills.tab.list` | 技能 | Skills |
| `skills.tab.trash` | 回收站 | Trash |
| `skills.search` | 搜索名称或描述 | Search name or description |
| `skills.filter.source` | 来源 | Source |
| `skills.filter.status` | 状态 | Status |
| `skills.source.all` | 全部 | All |
| `skills.source.user` | 用户 | User |
| `skills.source.project` | 项目 | Project |
| `skills.status.all` | 全部 | All |
| `skills.status.enabled` | 已启用 | Enabled |
| `skills.status.disabled` | 已禁用 | Disabled |
| `skills.badge.user` | 用户 | User |
| `skills.badge.project` | 项目 | Project |
| `skills.badge.plugin` | 插件 | Plugin |
| `skills.badge.preset` | 预设 | Preset |
| `skills.badge.bundled` | 内置 | Builtin |
| `skills.badge.runtime` | 运行时 | Runtime |
| `skills.badge.disabled` | 已禁用 | Disabled |
| `skills.badge.translated` | 已中文化 | Translated |
| `skills.badge.readonly` | 只读 | Read-only |
| `skills.action.edit` | 编辑 | Edit |
| `skills.action.disable` | 禁用 | Disable |
| `skills.action.enable` | 启用 | Enable |
| `skills.action.delete` | 删除 | Delete |
| `skills.action.restore` | 恢复 | Restore |
| `skills.action.save` | 保存 | Save |
| `skills.action.cancel` | 取消 | Cancel |
| `skills.action.reload` | 重新载入 | Reload |
| `skills.readonly.title` | 只读技能（{count}） | Read-only skills ({count}) |
| `skills.readonly.reason.plugin` | 安装在插件包内，不能修改 | Installed inside a plugin package |
| `skills.readonly.reason.preset` | 由预设提供，不能修改 | Provided by a preset |
| `skills.readonly.reason.bundled` | 应用内置，不能修改 | Bundled with the app |
| `skills.readonly.reason.runtime` | 运行时注册，不能修改 | Registered at runtime |
| `skills.empty` | 没有匹配的技能 | No matching skills |
| `skills.empty.trash` | 回收站是空的 | Trash is empty |
| `skills.empty.hint` | 试试清空搜索，或新建一个技能 | Clear the search, or create a skill |
| `skills.editor.create.title` | 新建技能 | New skill |
| `skills.editor.edit.title` | 编辑技能 | Edit skill |
| `skills.editor.name` | 名称 | Name |
| `skills.editor.name.hint` | 小写字母、数字与连字符，例如 `release-notes` | Lowercase letters, digits and hyphens, e.g. `release-notes` |
| `skills.editor.description` | 描述 | Description |
| `skills.editor.description.hint` | 单行，最多 400 字；模型据此决定何时使用 | One line, up to 400 chars; the model uses it to decide when to use |
| `skills.editor.body` | 正文 | Body |
| `skills.editor.body.hint` | Markdown；frontmatter 的其它键会原样保留 | Markdown; other frontmatter keys are preserved |
| `skills.editor.unsupported` | 该文件的 description 带 YAML 锚点，暂不支持在此编辑 | This file uses a YAML anchor on description and cannot be edited here |
| `skills.delete.title` | 删除技能「{name}」？ | Delete skill “{name}”? |
| `skills.delete.body` | 将移入 macOS 废纸篓，可在「回收站」中恢复；不会永久删除。 | It moves to the macOS Trash and can be restored from Trash. Nothing is permanently deleted. |
| `skills.delete.folder` | 目录：{dir} | Folder: {dir} |
| `skills.trash.title` | 回收站 | Trash |
| `skills.trash.deletedAt` | 删除时间 | Deleted |
| `skills.trash.size` | 大小 | Size |
| `skills.trash.restoreBody` | 恢复到 {to} | Restore to {to} |
| `skills.trash.missing` | 废纸篓里已找不到该条目（可能被系统清理） | The item is no longer in the Trash |
| `skills.conflict.title` | 文件已被外部修改 | File changed on disk |
| `skills.conflict.body` | 保存前文件被其它程序改动，请重新载入后重试。 | The file changed before saving. Reload and try again. |
| `skills.conflict.current` | 当前指纹：{fingerprint} | Current fingerprint: {fingerprint} |
| `skills.notice.saved` | 已保存 | Saved |
| `skills.notice.created` | 已创建 | Created |
| `skills.notice.deleted` | 已移入废纸篓 | Moved to Trash |
| `skills.notice.restored` | 已恢复 | Restored |
| `skills.notice.disabled` | 已禁用（不改源文件） | Disabled (source file unchanged) |
| `skills.notice.enabled` | 已启用 | Enabled |
| `skills.notice.refreshed` | 列表已刷新 | List refreshed |
| `skills.stats.user` | 用户技能 | User skills |
| `skills.stats.project` | 项目技能 | Project skills |
| `skills.stats.readonly` | 只读 | Read-only |
| `skills.stats.disabled` | 已禁用 | Disabled |
| `skills.stats.trash` | 回收站 | Trash |
| `skills.project.none` | 当前没有项目（只显示用户技能） | No project detected (user skills only) |
| `skills.error.title` | 技能管理加载失败 | Failed to load Skill Admin |
| `skills.error.bad-request` | 请求参数不合法 | Invalid request |
| `skills.error.invalid` | 名称或描述不合法 | Invalid name or description |
| `skills.error.too-large` | 内容超过 256 KiB | Content exceeds 256 KiB |
| `skills.error.unsupported-source` | 该技能来源只读，不能这样操作 | This skill is read-only |
| `skills.error.unsupported-frontmatter` | frontmatter 含锚点，无法安全编辑 | Frontmatter uses anchors and cannot be edited safely |
| `skills.error.not-found` | 技能不存在或已被删除 | The skill no longer exists |
| `skills.error.conflict` | 冲突：文件已被修改或目标已存在 | Conflict: file changed or target already exists |
| `skills.error.busy` | 另一个操作正在进行，请稍候 | Another operation is running |
| `skills.error.not-writable` | 目录不可写 | Directory is not writable |
| `skills.error.trash-unavailable` | 系统废纸篓不可用 | The system Trash is unavailable |
| `skills.error.network` | 无法连接到宿主 | Cannot reach the host |
| `skills.error.unknown` | 未知错误 | Unknown error |

> 计数：上表 **78** 个 key（含 12 个错误码文案）。计划估「约 55 键」偏低；现有 `locale/{zh,en}.json` 各 **209** 键，v0.5.0 后应为 **287** 键（209 + 78）。s3 以本表为准，最终 parity 由 `check-client.mjs` 校验（`DICT` 与 locale 文件键集合相等、zh/en 键集合相等、required keys 全在）。

### 8.5 交互细节（s3）

- 搜索 300ms 防抖；筛选纯前端（数据一次拉全）。
- 只读区默认折叠，展开后行不可操作。
- 列表行 `description` 单行省略（`title` 放全文）；`name` 用等宽字体。
- 编辑器 name 在 edit 时只读；create 时实时校验（正则 + 空）。
- 保存按钮在 `description` 空或 `body` 超限时禁用，并显示字数。
- `busy` 时所有动作按钮禁用；`Esc` 关闭对话框（busy 除外）。
- a11y：开关 `role="switch" aria-checked`；对话框 `role="dialog" aria-modal="true"`；`notice` 用 `aria-live="polite"`；焦点在关闭后回到触发按钮。
- 样式只用 `--dsw-alias-*` token；类名前缀 `.sdx-`（避免与现有 `.sdzh-` 冲突）。
- 不做自动轮询（与另两页一致），只提供 Refresh 与动作后自动刷新。

---

## 9. 测试计划

### 9.1 单测（s2 负责 1–6，s3 负责 7）

| # | 文件 | 新增/修改 | 覆盖点（断言数下限） |
|---|---|---|---|
| 1 | `test/skill-files.test.mjs` | 新 | roots 用户/项目、exists/writable；`SKILL_NAME_RE` 边界（大写/下划线/`..`/超长）；scan 排序与跳过非目录；detail 读取；create 模板往返；create 已存在 → conflict；save 追加键原样保留（逐字节）；save 指纹不一致 → conflict 且文件未变；save 锚点 → unsupported-frontmatter；save 缺 description → invalid；delete 调 trash 并返回 from/to；realpath 逃逸 → unsupported-source；超大文件 → too-large；temp 文件失败清理（注入 fs 失败）（≥28） |
| 2 | `test/skill-admin.test.mjs` | 新 | list 合并只读来源与 origin；disable 幂等/记录规范化；enable 幂等；project 条目 projectRoot 过滤；deletion 记录与 200 条裁剪；restore 分支（missing/target-exists/成功）；trash 不可用 → 503 映射；单飞（并发第二请求 busy）；错误码映射表逐项（≥30） |
| 3 | `test/state.test.mjs` | 改 | v2→v3 迁移（默认 skillAdmin/警告）；v3 未知键丢弃；disabled 去重与非法条目丢弃；deletions 裁剪；`createStateStore` 保存/读取往返（≥10） |
| 4 | `test/agent-layer.test.mjs` | 改 | 禁用 provider 候选 rank=40、invocation 全 false、description 前缀、content 透传；无禁用记录不注册；enable 后不再列；与翻译 provider 同名互斥（filter）；invalidate 调用计数（≥10） |
| 5 | `test/http-api.test.mjs` | 改 | 三条新路由注册；GET 列表/详情形状；POST 六动作透传；400/404/405/409/413/503 状态码；busy 与 pluginBusy/描述 busy 互斥；`maxBytes=256KiB`；lossless JSON；`no-store` 与 `Allow` 头（≥16） |
| 6 | `test/tool.test.mjs` | 改 | `TOOL_ACTIONS` 含 `skills`；`isConcurrencySafe` 含 skills；输出 schema 允许 `skills`（≥3） |
| 7 | `test/client.test.mjs` | 改（s3） | `SKILL_ORDER=18`、`id='skill-admin'`、`skills.nav` 存在；DICT 键集与 locale 文件一致；错误码→文案映射；状态机 helper（filter/sort/badges）（≥8） |

**目标**：`npm test` **≥ 205/205**。**实测现基线 = 157 用例**（`node --test test/*.test.mjs`，2026-10-22 实测），故 s2/s3 合计需新增 **≥ 48** 个用例才能满足计划验收。计划里的 205/264 keys/≥16 checks 是估算值，计划自身写明「文档/测试计数以 verifier 实测为准」；本设计的实测值：`npm test` 157、`check-client` **14 checks / 209 keys**、`locale/{zh,en}.json` 209 键。

### 9.2 e2e：`scripts/skills-e2e.mjs`（s2，≥22 断言）

隔离：`mkdtemp` 造 `DSH_HOME`、项目根（含 `.git`）、`DSH_TRASH_LOG`；`trash.mjs` 用真实脚本；结束保留临时目录（不永久删除）。

| # | 断言 |
|---|---|
| A1 | `GET /skills` 返回 `sources.user` 与 `sources.project`，`projectSource` 正确 |
| A2 | `create` 用户技能 → 文件存在、frontmatter 含 name/description、正文正确 |
| A3 | 列表新增行：`scope=user`、`editable/deletable/disableable=true`、指纹存在 |
| A4 | `detail` 返回 `frontmatter/body/raw/fingerprint/mtimeMs/size` |
| A5 | `save` 改 description + 正文 → 文件内容更新，**额外 frontmatter 键（如 `metadata`）与注释逐字节保留** |
| A6 | 用旧 `expectedFingerprint` 再 save → `409 conflict`，文件内容未变 |
| A7 | 重复 `create` 同名 → `409 conflict` |
| A8 | `create` 非法 name（`Bad_Name`）→ `400 invalid` |
| A9 | `create` description 含换行 → `400 invalid` |
| A10 | `body` 超 256 KiB → `413 too-large` |
| A11 | `disable` → 列表 `disabled=true`；`createDisabledProvider().list()` 候选 `invocation` 全 false、rank 40 |
| A12 | 复刻 `snapshot().skills.filter(isModelInvocable)` → 该技能被排除（用真实 `SkillRegistry` + 禁用 provider，复跑 spike A 的简化版） |
| A13 | `enable` → `disabled=false`，候选消失 |
| A14 | `delete` → 目录消失、`trash.mjs --json` 的 `to` 存在、`state.deletions` 记录 `from/to/kind/size` |
| A15 | `restore`（id）→ 目录回来、文件内容与删除前一致、`restoredAt` 写入 |
| A16 | 恢复前手工放同名目录 → `409 conflict`（不覆盖） |
| A17 | 删除记录在 `trash` 列表可见；恢复后不可见 |
| A18 | 项目级 `create` → 文件落在 `<root>/.dsh/skills`，列表 `scope=project` |
| A19 | 项目级 `save` 只改项目文件，不影响用户级同名技能 |
| A20 | `projectRoot` 不在白名单（`/tmp/...` 非 $HOME）→ `400 unsupported-source` |
| A21 | 在可写根内建 symlink 指向根外 → 写操作 `400 unsupported-source`（realpath 守卫） |
| A22 | 未认证请求 `GET /skills` → `401` |
| A23 | 并发两个 POST → 第二个 `409 busy` |
| A24 | lossless JSON：description 含 `"`、`\`、emoji、超长数字字符串 → 原样返回 |
| A25 | 只读来源（模拟 preset 行）`delete` → `400 unsupported-source` |
| A26 | frontmatter `description: &d "x"` + `whenToUse: *d` → `400 unsupported-frontmatter`，文件未被改 |
| A27 | `trash.mjs` 不可用（`DSH_TRASH_SCRIPT` 指向不存在文件）→ `503 trash-unavailable` |
| A28 | `restore` 一个废纸篓条目已不存在 → `404 not-found` |

### 9.3 回归（不得下降）

```sh
node --check lib/*.js client.js scripts/*.mjs
npm test                       # ≥205（实测现基线 157，需新增 ≥48 用例）
node scripts/check-client.mjs  # 通过；s3 后应 16 checks / 287 keys（现 14 checks / 209 keys）
node scripts/skills-e2e.mjs    # ≥22
node scripts/agent-layer-e2e.mjs   # 7/7
node scripts/commands-e2e.mjs      # 10/10
node scripts/plugin-admin-e2e.mjs  # 21/21
node scripts/verify.mjs --expect-installed --expect-applied   # exit 0
```

### 9.4 真实会话验收（s4，重启后）

1. 设置页出现「技能管理」（order 18），列表含用户/项目/只读分组。
2. 新建 → 列表出现 → 模型下一轮目录出现该技能（`skill` 工具 list 可见）。
3. 禁用 → 下一轮模型目录消失（`available_skills` 不含）；启用 → 回来。
4. 删除 → 废纸篓可恢复 → 恢复后技能与内容回来。
5. `skill_desc_zh({"action":"skills"})` 返回无损 JSON。
6. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/plugins/skill-desc-zh/skills` → `401`。
7. 既有「中文化」「插件管理」两页行为不变。

---

## 10. 与计划的偏差（需 Lead 批准）

| # | 计划原文 | 偏差 | 理由 / 替代方案 |
|---|---|---|---|
| D1 | §9.3「覆盖多行/注释/锚点用例」，未规定锚点策略 | **description 带 YAML 锚点/别名时拒绝写入**（`400 unsupported-frontmatter`），详情/列表仍可只读展示 | spike C5 证明切片重写会把 `whenToUse: *d` 一起改值，属于静默数据破坏。替代方案（不采纳）：`doc.set` 整段序列化会丢注释/格式 |
| D2 | §4 的 `POST action` 未定义 restore 的定位方式 | **restore 以 `id` 为主键**，`scope+name`（取最近未恢复）作为兼容回退 | 同名技能可能多次删除/恢复，仅靠 name 会恢复错条目；`id` 在 delete 响应中返回 |
| D3 | §3.3 `deletions:[{id,scope,name,from,to,deletedAt,size}]` | 增 **`projectRoot`**（项目级恢复必需）、`kind`（file/dir）、`restoredAt` | 无 `projectRoot` 时项目级删除无法确定恢复目标；`kind` 用于恢复时校验；`restoredAt` 支持幂等与列表过滤 |
| D4 | §2.4「content 透传」 | 禁用影子的内容**以磁盘读取为主**（`SKILL.md`），捕获定义仅作兜底；两者都读不到则不注册 + warning | 捕获是启动快照，编辑后过期；磁盘读取保证「禁用 + 编辑」组合正确 |
| D5 | §3.2 `trashList()` | **不扫描 `~/.Trash`**，只列 `state.deletions` 中 `restoredAt==null` 的记录（可 `stat(to)` 判断是否还在） | spike B3：`readdir(~/.Trash)` 直接 EPERM（TCC），扫描会 500 |
| D6 | §4 未定请求体上限 | `/skills` 路由 body 上限 **256 KiB**（> 现有 `MAX_BODY_BYTES` 64 KiB），显式传 `maxBytes` | 编辑器要提交正文；64 KiB 对技能文档偏小；单文件同样限制 256 KiB |
| D7 | §3.7 `tool.js` 只写「`TOOL_ACTIONS` += `skills`」 | `skills` 动作返回 **`{ok,action:'skills',projectRoot,sources,skills,trash,serverTime}`**（与 HTTP 列表同形，`lossless`） | 让 agent/脚本无需 HTTP 也能拿到同一份数据；形状复用避免第三套结构 |

> 另有 2 处**对计划的补充解释**（不算偏差，但需 s2 一致）：
> - 「乐观锁 = mtimeMs + size + sha256 指纹」实现为 **以 sha256 为主判据**，mtime/size 仅展示（复制/恢复会改变 mtime，不能当唯一判据）。
> - 「写前快照」只对**已存在的文件**执行（create 无文件可快照）；`trash.snapshot()` 失败即拒绝写。

---

## 11. 风险与降级

| # | 风险 | 概率/影响 | 缓解 | 降级行为 |
|---|---|---|---|---|
| R1 | 真实 preset 装配与 spike 手工 scope 有差异，禁用不生效 | 低/高 | s4 在真实会话验收（§9.4 第 3 条）；e2e A11/A12 用真实 `SkillRegistry` | 若失效：`enable` 全部禁用记录，页面隐藏禁用开关（配置开关 `skillAdmin.disableShadow=false`） |
| R2 | `~/.Trash` TCC 变化导致恢复失败 | 低/中 | 恢复走精确路径 rename；错误码区分 ENOENT/EACCES/EXDEV | 展示「已删除但无法自动恢复」+ 精确路径 + `to`，提示 Finder 操作 |
| R3 | 外部编辑器并发修改 | 中/低 | 指纹乐观锁 409 + 强制重新载入 | 用户重载后重试；不提供强制覆盖 |
| R4 | frontmatter 锚点/别名技能无法编辑 | 低/低 | 检测并明确报错；详情只读展示 | UI 显示「不支持在此编辑」，正文仍可查看 |
| R5 | 项目根缺失（无 `.git`） | 中/低 | `projectRoot=null`，UI 只显示用户来源 | 写项目级返回 `unsupported-source`，提示先打开项目 |
| R6 | 大正文导致 UI 卡顿 | 低/低 | 256 KiB 上限；详情 `raw` 超限不返回 | 编辑器只加载 `body`，保存走完整读盘 |
| R7 | 删除后 state 写入失败（磁盘满/权限） | 低/中 | 先写 state 再返回成功？——**顺序：trash 成功 → 写 state；写失败则仍返回删除成功 + warning**（废纸篓是真源） | 列表可能暂不显示回收站条目；`refresh` + 手动 `restore` 仍可按路径恢复（state 缺失时 restore 需 UI 提供 `from/to`，不作为默认路径） |
| R8 | `trash.mjs` 被策略拒绝（受保护路径） | 极低/高 | 只允许两处可写根；`trash()` 结果 `refused` → `trash-unavailable`，不重试其他手段 | 提示用户手动处理，绝不 `rm` |
| R9 | 禁用记录与翻译缓存互相干扰 | 低/低 | 翻译 provider `filter` 排除 disabled；禁用 provider 独立 provider 名 | 目录可能出现重复候选（会 warn 并去重），不影响功能 |
| R10 | 回滚 v0.4 丢 `skillAdmin` | 中/低 | 回滚前置提示：先 enable/restore；README 写明 | v0.4 白名单丢弃未知键，不崩溃但记录丢失 |

---

## 12. 交接清单（s2 / s3 可直接照做）

### 12.1 s2（Host）

| 文件 | 动作 | 关键点 |
|---|---|---|
| `lib/skill-files.js` | 新 | §5.2 `renderEdit` 原样、§5.5 写盘序列、§7.1 根解析、realpath 守卫、指纹 |
| `lib/skill-admin.js` | 新 | §3.4 六动作、§3.5 错误码、单飞、`trashList` 只读 state、`status()` 汇总 |
| `lib/state.js` | 改 | `STATE_VERSION=3`、§4.2 迁移、§4.3 helper、`MAX_DELETIONS=200` |
| `lib/agent-layer.js` | 改 | §6.1/6.2 常量 + `createDisabledProvider` + `registerDisabledProvider`；`createAgentProvider` 的 filter 接口保持兼容 |
| `lib/http-api.js` | 改 | §3.1–3.4 路由、`skillBusy` 与 `busy`/`pluginBusy` 三者互斥、`maxBytes`、`Allow`、lossless |
| `lib/index.js` | 改 | 装配 `skillAdmin`；`agent/created` 注册禁用 provider；`controller.skills()`；`status.skillAdmin`；`doctor` 三项非强制检查；`dispose` |
| `lib/tool.js` | 改 | `skills` 动作（D7 形状）、`isConcurrencySafe` |
| `package.json` | 改 | version 0.5.0、`scripts.e2e:skills` |
| `test/*.test.mjs` | 改/新 | §9.1 1–6 |
| `scripts/skills-e2e.mjs` | 新 | §9.2 A1–A28 |

### 12.2 s3（Client）

| 文件 | 动作 | 关键点 |
|---|---|---|
| `client.js` | 改 | `SKILL_ORDER=18`、`skill-admin` 注册、`SkillAdminPage`、`createApi` 三个方法、DICT +78 键、`.sdx-*` CSS、`__test__` 导出 |
| `locale/zh.json` / `locale/en.json` | 改 | +78 键，与 DICT 严格一致（287 键） |
| `scripts/check-client.mjs` | 改 | version 0.5.0、order 18 断言、required keys 扩充 |
| `test/client.test.mjs` | 改 | §9.1 第 7 项 |

### 12.3 接口冻结摘要（任何改动需 Lead 批准）

```js
// HTTP
GET  /plugins/skill-desc-zh/skills?projectRoot&source&refresh=1
GET  /plugins/skill-desc-zh/skills/detail?scope&name&projectRoot
POST /plugins/skill-desc-zh/skills/action
     { action:'create'|'save'|'delete'|'restore'|'disable'|'enable', ... }

// 模块
createSkillFiles({ paths, frontmatter, trash, fs, logger, now })
createSkillAdmin({ paths, skillFiles, state, disabledProvider, invalidate, logger, now })
createDisabledProvider({ state, readTarget, isEnabled, isReady, logger })
registerAgentLayerProvider({ agent, provider, onControl, logger })   // 复用现有
```

---

## 13. 附录：证据复跑

```sh
cd ~/dsh-plugins/skill-desc-zh

# A（最高风险）：禁用影子语义，11/11
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" scripts/spike-disable-shadow.mjs

# B：trash 删除→恢复链路，10/10
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" scripts/spike-trash-restore.mjs

# C：frontmatter 切片保留，11/11
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" scripts/spike-frontmatter.mjs

# D：projectRoot 解析，9/9
node scripts/spike-project-root.mjs
```

**关键结论摘录**（原始输出见上列命令）：

- A：`rank 40` 的 agent 层影子在同层压过 `rank 400` 的 filesystem 候选；`snapshot().skills.filter(isModelInvocable)` 排除；`get` 返回影子定义且 `content` 原样；`list()` 空 + `invalidate()` 与 `dispose()` 都能立即回落；global 层 rank 1 无法压过 agent 层（近层整体获胜）。
- B：`to` 为 `~/.Trash/<name>[ 2]`；精确路径 stat/read/rename 可用；`readdir(~/.Trash)` EPERM；rename 到已存在文件=静默覆盖（必须前置检查）。
- C：`node.range` 只覆盖值；锚点+别名会导致别名字段被连带改值 ⇒ 写路径拒绝；正文与其它 frontmatter 字节零改动。
- D：`.git` 文件/目录都算项目根；无 `.git` 时 `undefined`；`$HOME` 下允许、`/tmp` 不允许；symlink 不解析。

**未覆盖/留待实施期验证**：

1. 真实 preset 装配下的 agent 层（s4 §9.4 第 3 条）。
2. Electron 内 `fetch` 对 256 KiB body 的表现（s3 在页面里实测）。
3. macOS 废纸篓在「系统设置 → 隐私」关闭自动化后的行为（理论上 rename 不触发自动化权限；若失败走 R2 降级）。

---

## 14. 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1 | 2026-10-22 | s1 初稿：A–D spike 证据、API 契约、state v3、frontmatter 算法、禁用影子、UI/文案、测试计划、偏差 7 条、风险 10 条、交接清单 |
| v1.1 | 2026-10-22 | 按 v0.5.0 实现校正：SkillRow 只读行 `scope=origin`、扁平文件 `dir=null`、只读行译文与 source 过滤；restore 支持按 id 省略 scope 且重查 allowlist；create/save 返回字段改为 `skill{name,description,scope,projectRoot,path[,relativePath]}`；指纹改为 `sha256(description\0body\0relativePath)`；`lib/skill-files.js` 导出更正为 `roots(projectRoot)/scan/delete/restore/fingerprint/fileFingerprint`；补充只读分组统计与 v2→v3 迁移说明 |


