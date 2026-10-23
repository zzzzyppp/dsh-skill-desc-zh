# 验收报告：技能描述中文化插件（skill-desc-zh）

- 日期：2026-10-21（Asia/Shanghai）
- 验收人：verifier（t5），Lead 代跑宿主侧工具调用
- 插件源码：`~/dsh-plugins/skill-desc-zh`
- 版本：`dsh-skill-desc-zh@0.1.0`（本地 `link:` 安装）
- 宿主：DeepSeek Harness Desktop `0.2.1-rc.2`（profile `desktop`）
- 安装形态：profile `~/.dsh/profiles/desktop`，bundle 热挂载，无需重启 app
- state：`~/.dsh/.skill-desc-zh/state.json`；事件：`~/.dsh/.skill-desc-zh/events.ndjson`
- 删除通道：全程 `lib/trash.js` → `~/.dsh/skills/safe-delete-trash/trash.mjs`；本次验收未执行任何 `rm`/`unlink`/`rmdir`

## 结论摘要

| 编号 | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 预检脚本可运行、退出码正确、如实标注未验证项 | ✅ 通过 | `scripts/preflight.mjs` exit=1（如实转述 audit 2 个 ❌ + 2 条 ⚠️ 未验证），原始输出见 §1 |
| A2 | 应用内安装成功，`fiberPhase=active` | ✅ 通过 | `include:skill-desc-zh` enabled=true / fiberPhase=active；profile dep + bundle 见 §2 |
| A3 | 7 个 office 描述显示中文 | ✅ 机制通过 / ⚠️ 新会话目录终验见 §10 | 状态 11/11 中文；provider 已注册且 `skill("office-render")` 返回内容完整（§4）；verifier 会话在 disable 窗口收到的目录快照为 4 preset 中文 + 7 office 英文（与 Lead 侧证一致），re-enable 后需一次全新会话目录确认 |
| A4 | 4 个 agent-preset 描述显示中文，影子目录含标记 | ✅ 通过 | 4 个影子目录 + `.skill-desc-zh.json`；内容与 asar 原文仅 description 一行不同（§4） |
| A5 | office 正文原样透传（含 LibreOffice Kit 附录） | ✅ 通过 | `skill("office-render")` 返回正文末尾保留 `## Installed LibreOffice Kit` 及绝对路径（§4） |
| A6 | restore 恢复英文原文，影子进废纸篓 | ✅ 通过 | restore 输出 + status 11 条“英文·无影子” + 4 条 trash 记录 + state.enabled=false（§3） |
| A7 | 再次 apply 恢复中文，无重复影子 | ✅ 通过 | apply 输出 11/11、影子 4/4；目录内恰好 4 个影子（§3） |
| A8 | 模拟升级：先还原旧影子，再自动重译中文 | ✅ 通过（附限制说明） | `host-version-heal` + 4 条 trash + startup degraded 7/11 → agent-created active 11/11（§5） |
| A9 | 离线词典引擎可用 | ✅ 通过 | 70/70 单测；词典 11/11 键与宿主 description 逐字一致（§6） |
| A10 | 卸载/回滚路径清晰可执行 | ✅ 文档通过（未实际卸载） | 回滚步骤见 §9；当前安装保持可用 |
| A11 | 代码无永久删除调用 | ✅ 通过 | `scripts/verify.mjs` 扫描 26 文件无命中；trash.js 只调用 trash.mjs（§7） |
| A12 | 全量单测 | ✅ 通过 | `npm test` → 70 pass / 0 fail（Node v24.20.0，§6） |

> 总结论：**功能验收通过，可交付用户使用**。唯一未闭环的是 A3 的“全新会话目录肉眼确认”，原因是验收用的 verifier 会话在插件 disable 窗口收到过目录快照；机制、状态与正文加载均已独立证明 provider 生效，建议交付前由用户新开一个会话确认 7 个 office 为中文（预期如此）。

---

## 1. 预检（A1）

命令：

```sh
node ~/dsh-plugins/skill-desc-zh/scripts/preflight.mjs
```

`scripts/preflight.mjs` 包装官方 `~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs --profile desktop`，并补充本地目录特有的检查（engines.dsh、bundle patch 结构、profile 冲突、依赖、安装脚本、private）。原始输出完整保存在 `/tmp/preflight-audit.log`。

### 1.1 audit.mjs 原始判定（EXIT=1）

```text
=== DSH 插件安装前预检 · profile=desktop ===
目标：dsh-skill-desc-zh@0.1.0  [npm]

❌ 24h 供应链隔离期
    pnpm 11 默认 minimumReleaseAge=24h，以下版本太新会被拒绝，安装会整体失败：
      - @linxin666/dsh-client-ui-git-graph@0.4.8 发布 16.6h（profile 已有依赖（会被重新解析））→ 隔离期解禁 2026-10-21 01:03Z
      - @linxin666/dsh-client-ui-skill-explorer@0.4.8 发布 16.6h（profile 已有依赖（会被重新解析））→ 隔离期解禁 2026-10-21 01:03Z
      - dshmarket@1.66.44 发布 23.3h（profile 已有依赖（会被重新解析））→ 隔离期解禁 2026-10-20 18:24Z
❌ profile lockfile 健康度
    现有 lockfile 已含隔离期内条目——pnpm 会在解析前直接拒绝，**本 profile 所有插件安装都会失败**，直到下个时间点或重建 lockfile：
      - @linxin666/dsh-client-ui-git-graph@0.4.8 发布 16.6h → 解禁 2026-10-21 01:03Z
      - @linxin666/dsh-client-ui-skill-explorer@0.4.8 发布 16.6h → 解禁 2026-10-21 01:03Z
      - dshmarket@1.66.44 发布 23.3h → 解禁 2026-10-20 18:24Z
ℹ️  来源
    npm 发布包 · dsh-skill-desc-zh@0.1.0（解析到 0.1.0）
ℹ️  许可
    MIT
ℹ️  客户端形态
    未声明 dsh.client（多为宿主侧插件，或自行把脚本注入页面，如 webServer.tapIndex）
ℹ️  核心版本兼容
    未声明 @deepseek-ai/* peer 依赖
ℹ️  engines.dsh
    >=0.2.1-rc.2（宿主核心 0.2.1-rc.2）
✅ 是否 DSH bundle
    dsh.bundle.patch = "./cordis.patch.yml"
✅ 安装脚本
    无 preinstall/install/postinstall/prepare，装包不执行构建脚本
✅ 依赖重叠
    与已装插件无共享依赖（候选依赖 0 个）
✅ row id
    插入 1 行（skill-desc-zh），与现有 227 行无撞车

------------------------------------------------------------
判定：❌ 存在 2 个阻塞项 —— 先解决再安装
```

### 1.2 包装脚本的本地检查与如实标注

```text
ℹ️ 目标：dsh-skill-desc-zh@0.1.0（~/dsh-plugins/skill-desc-zh）
ℹ️ 宿主版本：0.2.1-rc.2 ← /Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/runtime.json
✅ engines.dsh：">=0.2.1-rc.2" 满足宿主 0.2.1-rc.2
✅ dsh.bundle.patch：~/dsh-plugins/skill-desc-zh/cordis.patch.yml
✅ dsh.bundle.patch 结构：顶层数组，1 行，insert: skill-desc-zh=dsh-skill-desc-zh
✅ profile 冲突：profile 中无同名依赖 dsh-skill-desc-zh
✅ 依赖：运行时零依赖
✅ 安装脚本：无 install/postinstall/preinstall/prepare 生命周期脚本
ℹ️ private：包声明 private:true；本地路径安装可用，但不会被 npm 发布
⚠️ 供应链来源：未验证：目标不是 npm 仓库包，没有 registry 元数据/发布者签名/发布时间/隔离期信息；来源可信度只能由你确认绝对路径内容
⚠️ audit 对本地包的判定：audit.mjs 对本地目录的“仓库来源/发布者/隔离期”类检查无法判定，输出中的相关 ℹ️/⚠️ 原文需如实转述
❌ 官方预检：audit.mjs 退出码 1（存在阻塞项，禁止安装）
```

**如实声明**：这是本地目录包，audit 输出中的 “来源 npm 发布包 / 隔离期” 等字段**无法判定**，不等于已验证；`scripts/preflight.mjs` 因此固定输出两条 ⚠️ 未验证提示。包装脚本 exit=1，与 audit 一致。

### 1.3 两条 ❌ 的用户批准 override（重要，不可省略）

- 发现时间：2026-10-21 01:39（Asia/Shanghai），audit exit=1，按 AGENTS.md 暂停安装并上报。
- 用户批准时间：2026-10-21 01:40（Asia/Shanghai），用户在 Web 端选择「批准安装（推荐）」，明确 override 两条 ❌。
- override 理由（Lead 转述用户决定）：
  1. 两条 ❌ 指向的都是 profile **已有**的第三方插件版本（`@linxin666/dsh-client-ui-git-graph@0.4.8`、`@linxin666/dsh-client-ui-skill-explorer@0.4.8`、`dshmarket@1.66.44`），不是 `dsh-skill-desc-zh` 自身；
  2. audit 不读取 profile `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`，而这三条版本**恰好都在该豁免列表中**；
  3. 同晚 `dshmarket@1.66.44` 与 `skill-explorer@0.4.8` 已在隔离期内成功安装，实测豁免生效；
  4. `dsh-skill-desc-zh` 零依赖、无安装脚本、row id 无撞车，实际安装不会新增这些版本。
- 安装结果反证：实际 `install_bundle` 的 pnpm 阶段输出 `✓ Lockfile passes supply-chain policies`，未触发隔离期拒绝（见 §2）。
- 残余风险：profile lockfile 里确实存在隔离期条目，未来若 pnpm 策略变化仍可能影响其它安装；建议后续找时间清理/重建 profile lockfile。`pnpm-workspace.yaml` 中“minimumReleaseAgeExclude 保持为空（已两次清理）”的注释与现状矛盾，建议修正。

---

## 2. 安装与挂载（A2）

安装方式：**必须走应用内** `plugin_manager install_bundle`（CLI `dsh plugin --profile desktop add` 会被宿主以 “profile \"desktop\" is managed exclusively by the Electron application” 拒绝；本次未尝试 CLI）。目标传入绝对路径：

```text
plugin_manager install_bundle target="~/dsh-plugins/skill-desc-zh"
```

结果：

```text
stage enable → application applied
packageResult exitCode: 0
✓ Lockfile passes supply-chain policies (verified 3h ago)
Progress: resolved 412, reused 0, downloaded 0, added 0
dependencies:
+ dsh-skill-desc-zh 0.1.0 <- ../../../dsh-plugins/skill-desc-zh
Done in 1.3s using pnpm v11.28.5
```

宿主记录：

- `~/.dsh/profiles/desktop/package.json` → `dependencies["dsh-skill-desc-zh"] = "link:~/dsh-plugins/skill-desc-zh"`
- `dsh.profile.bundles` 含 `dsh-skill-desc-zh`（共 30 条）
- `plugin_manager list_plugins`：`{"entryId":"include:skill-desc-zh","moduleName":"dsh-skill-desc-zh","enabled":true,"fiberPhase":"active","patchId":"skill-desc-zh"}`
- profile `cordis.patch.yml` 中**没有**针对 `skill-desc-zh` 的 disabled/override 行（说明未留下测试性覆盖）

工具注册（`cordis_inspect_query(platform=host, provider=Tool, method=listTools)`）：

- `skill_desc_zh` 出现在工具清单（spill 文件行 1726），schema：`action` 枚举 `status|apply|restore|retranslate|refresh|doctor`（必填），可选 `names[]`、`force`、`projectRoot`、`dryRun`；`additionalProperties:false`。

---

## 3. 端到端：中文 → 英文 → 中文（A6/A7）

以下工具输出由 Lead（captain）在宿主会话中代跑，原始事件可在 `~/.dsh/sessions/--Applications-dsh--/session-9acb1ec3-3681-4772-b5bc-6ded0a611ee9/session.v4.jsonl.zstd`（seq 4499–4555）复核；文件系统结果由 verifier 独立取证。

### 3.1 安装后初始状态

```text
技能描述中文化已生效（phase=active）：中文 11/11；项目 /Applications/dsh；宿主 0.2.1-rc.2

office [global/provider] 中文 · engine=llm · hash=493220ec71be
office-docx [global/provider] 中文 · engine=llm · hash=2d404259ef0e
office-export-pdf [global/provider] 中文 · engine=llm · hash=7d75732ed690
office-pptx [global/provider] 中文 · engine=llm · hash=c729a34112c8
office-recalculate [global/provider] 中文 · engine=llm · hash=496f62140922
office-render [global/provider] 中文 · engine=llm · hash=adfc6cbcee35
office-xlsx [global/provider] 中文 · engine=llm · hash=08d7607449f9
agent-experience [preset/shadow] 中文 · engine=llm · hash=7fd16448d780 · 影子 /Applications/dsh/.dsh/skills/agent-experience
cordis-composition-reference [preset/shadow] 中文 · engine=llm · hash=9bd4323b9b2b · 影子 /Applications/dsh/.dsh/skills/cordis-composition-reference
cordis-plugin-development [preset/shadow] 中文 · engine=llm · hash=08ecdebf4fab · 影子 /Applications/dsh/.dsh/skills/cordis-plugin-development
editing-cordis-compositions [preset/shadow] 中文 · engine=llm · hash=9a83ef1e1665 · 影子 /Applications/dsh/.dsh/skills/editing-cordis-compositions
```

### 3.2 restore（一键恢复英文）

```text
skill_desc_zh(action="restore")
→ 已恢复英文原文：4 个影子目录移入废纸篓；provider 已下架，下一步技能列表为英文
```

随后 status：

```text
已还原英文原文（state.enabled=false）；当前无中文覆盖；发现 11 个目标

office [global/provider] 英文 · engine=llm · hash=493220ec71be
...（7 个 office 同格式）
agent-experience [preset/shadow] 英文 · engine=llm · hash=7fd16448d780 · 无影子
cordis-composition-reference [preset/shadow] 英文 · engine=llm · hash=9bd4323b9b2b · 无影子
cordis-plugin-development [preset/shadow] 英文 · engine=llm · hash=08ecdebf4fab · 无影子
editing-cordis-compositions [preset/shadow] 英文 · engine=llm · hash=9a83ef1e1665 · 无影子
```

verifier 独立取证：

- `/Applications/dsh/.dsh/skills/` 为空目录（`total 0`）；
- `state.json` → `enabled=false`；
- `~/.dsh/.trash-log.jsonl` 新增 4 条 rename（2026-10-20T17:44:13.730/740/742/744Z），目标为 `~/.Trash/<name> 3`；
- 4 个目标路径实际存在（见 §5 的对账）。

### 3.3 apply（重新中文化）

```text
skill_desc_zh(action="apply")
→ apply 完成：中文 11/11（office 7，preset 4），影子 4/4；宿主 0.2.1-rc.2
```

verifier 独立取证：state.enabled=true、11 条 zh、4 个影子目录重建且带标记（无重复目录）。

---

## 4. 两层覆盖机制与内容完整性（A3/A4/A5）

### 4.1 L2 项目影子（4 个 agent-preset，A4）

影子位置：`/Applications/dsh/.dsh/skills/<name>/`（项目 `/Applications/dsh` 不在 `$HOME` 下，已由 `projectAllowlist: ["/Applications/dsh"]` 放行）。

每个影子含 `.skill-desc-zh.json` 标记（`schemaVersion:1`、`plugin:"skill-desc-zh"`、`sourcePath` 指向 app.asar 内原始 SKILL.md、`sourceHash`/`enHash`/`shadowHash`、`resources[]`、`hostVersion`）。4 个影子均重新生成于 `2026-10-20T17:45:07Z`（自愈后），标记 hash 与文件实际 sha256 一致。

**内容逐字对账**：用 `ELECTRON_RUN_AS_NODE` 把 app.asar 内原始技能目录解包到 `/tmp/orig-skills/`，`diff -r` 对比影子：

- 每个 `SKILL.md` 仅第 3 行 `description` 从英文换成中文（带引号），其余正文完全一致；
- `references/`、`templates/` 全部字节一致（`cordis-plugin-development` 的 6 个 references + 10 个模板文件，`cordis-composition-reference` 的 `references/packages.md`）；
- 无资源缺失、无多余文件。

### 4.2 L1 global provider（7 个 office，A3/A5）

`lib/provider.js`：`PROVIDER_NAME="skill-desc-zh"`、`PROVIDER_RANK=50`；未就绪/捕获中/关闭时 `list()` 返回 `{candidates:[],complete:false}`；就绪后仅替换 `description`，`content`/`resourceBase`/`whenToUse`/`path` 从捕获定义原样透传。宿主排序函数为 `compareIndexedCandidates = rank差 || providerOrder差 || localOrder差`（小者胜），office 内置 provider（`dsh-office`，`BUNDLED_SKILL_RANK=600`）同处 global 层，50 < 600，故本插件胜出。

**A5 直接证据**：在宿主会话中调用 `skill("office-render")`，返回正文末尾完整保留：

```text
## Installed LibreOffice Kit

Use these absolute paths for every LibreOffice Kit command. Pass the CLI entry as the first argument to Node.

{
  "libreofficeKit": {
    "node": "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node",
    "cli": "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar.unpacked/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js"
  }
}
```

说明 provider 的 `get()` 透传链路真实生效，没有丢运行时附录。

### 4.3 目录显示（A3）的当前证据与遗留确认

- `status` 报告 `phase=active`、中文 11/11；
- state 中 7 个 office 均有 `zh`、`engine=llm`；
- `skill("office-render")` 能正常加载（provider `get()` 生效）；
- verifier 会话在 **插件被禁用窗口** 收到的 `available_skills` 快照为：4 个 preset 中文、7 个 office 英文——与 Lead 的侧证完全一致（禁用期间 provider 下架、影子仍生效），属于预期现象；
- re-enable 后插件重新 `invalidate()`，但 verifier 会话的目录快照未再刷新。**因此 A3 的“全新会话目录”终验仍需用户/新会话确认一次**；机制与 state 证据均指向中文。

---

## 5. 模拟升级自愈（A8）

### 5.1 重要限制（实测）

**插件运行中直接修改磁盘 `state.json` 无效**：插件内存态会在下一次 refresh/apply 时覆盖磁盘。先改 `state.hostVersion=0.2.0-rc.2` 再 `refresh`，refresh 仍用内存中的 `0.2.1-rc.2`，不会触发自愈（已实测，无任何事件）。

### 5.2 可行测试方法（无需重启 app）

1. `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`（dispose 时 `restoreOnQuit=false`，影子保留）；
2. 直接改磁盘 `~/.dsh/.skill-desc-zh/state.json` 的 `hostVersion` 为 `"0.2.0-rc.2"`（改前已备份 `/tmp/state.backup.json`）；
3. `plugin_manager set_plugin … enabled=true` 重新挂载 → bootstrap 读盘检测到版本变化，执行自愈。

### 5.3 原始事件（events.ndjson，逐字）

```json
{"at":"2026-10-20T17:45:05.151Z","action":"host-version-heal","ok":true,"from":"0.2.0-rc.2","to":"0.2.1-rc.2","restored":4}
{"at":"2026-10-20T17:45:07.815Z","action":"startup","ok":true,"phase":"degraded","phaseReason":"部分技能的中文未能生效（影子冲突或项目未放行），中文 7/11","hostVersion":"0.2.1-rc.2","zhCount":7,"shadows":[],"warnings":["检测到宿主版本变化（0.2.0-rc.2 → 0.2.1-rc.2）：已还原旧影子并清空旧译文缓存，开始重新翻译","没有项目根：跳过 agent-preset 的项目级影子（office 不受影响）"]}
{"at":"2026-10-20T17:45:07.875Z","action":"agent-created","ok":true,"phase":"active","phaseReason":"全部 11 个技能已有中文译文","hostVersion":"0.2.1-rc.2","zhCount":11,"shadows":[{"name":"agent-experience","status":"created"},{"name":"cordis-composition-reference","status":"created"},{"name":"cordis-plugin-development","status":"created"},{"name":"editing-cordis-compositions","status":"created"}]}
```

自愈顺序符合设计：**先还原 4 个旧影子（进废纸篓）→ 清空旧译文缓存 → 重新翻译 → 重建影子**。trash log 对应 4 条（17:45:05.105–112Z，目标 `~/.Trash/<name> 4`）。

### 5.4 最终状态（未被测试污染）

- `state.enabled=true`、`hostVersion=0.2.1-rc.2`、11/11 中文、engine 全 llm；
- 4 个影子重建，标记 `hostVersion=0.2.1-rc.2`；
- `include:skill-desc-zh` 仍 `enabled=true` / `fiberPhase=active`；
- profile `cordis.patch.yml` 无残留 disabled/override 行。

### 5.5 trash 对账（restore 4 条 + 自愈 4 条）

| 时间（UTC） | 源 | 目标 |
| --- | --- | --- |
| 17:44:13.730 | /Applications/dsh/.dsh/skills/agent-experience | ~/.Trash/agent-experience 3 |
| 17:44:13.740 | …/cordis-composition-reference | ~/.Trash/cordis-composition-reference 3 |
| 17:44:13.742 | …/cordis-plugin-development | ~/.Trash/cordis-plugin-development 3 |
| 17:44:13.744 | …/editing-cordis-compositions | ~/.Trash/editing-cordis-compositions 3 |
| 17:45:05.105 | …/agent-experience | ~/.Trash/agent-experience 4 |
| 17:45:05.108 | …/cordis-composition-reference | ~/.Trash/cordis-composition-reference 4 |
| 17:45:05.110 | …/cordis-plugin-development | ~/.Trash/cordis-plugin-development 4 |
| 17:45:05.112 | …/editing-cordis-compositions | ~/.Trash/editing-cordis-compositions 4 |

8 个目标路径均已用 `test -e` 独立确认存在；无永久删除。碰撞后缀（` 3`/` 4`）由 trash.mjs 自动递增，符合预期。

---

## 6. 翻译引擎与单测（A9/A12）

- `npm test` → **70 pass / 0 fail**（Node v24.20.0），含 translate/dictionary/cache/fallback、shadow、state、provider、lifecycle、trash 测试；
- 词典 `lib/dictionary.zh.json` 11 条 = office×7 + agent-preset×4，键与宿主实际 `description` 逐字一致（11/11，独立比对 asar 内与 runtime 下的 SKILL.md）；
- 测试覆盖“无 LLM → 词典 → 仍失败保留英文 + warning”，绝不写半成品；缓存键 = `hostVersion + name + contentHash`，命中零请求；
- 已知限制：`browser-skill` 的 description 硬编码在 runtime rank 250 的插件代码中（`index.mjs`），任何 provider/影子都覆盖不了，本插件明确不处理；它本身也是英文。另有 5 个已知技能（modlens、browser-skill、2 个用户级、Windows 专用）不属于 11 个目标（本身中文或不可覆盖）。

---

## 7. 删除安全与静态检查（A11）

```text
=== 安装后自检 ===
✅ 永久删除痕迹：扫描 26 个文件，未发现 rm/unlink/rmdir/truncate/find -delete/git clean/rimraf
✅ 删除通道：lib/trash.js 调用 safe-delete-trash/trash.mjs（不可用时失败关闭，不降级永久删除）
ℹ️ state.json：~/.dsh/.skill-desc-zh/state.json（hostVersion=0.2.1-rc.2, skills=11, projects=1）
✅ 影子标记：4 个影子全部存在且 schemaVersion=1
✅ 安装记录：dep link:~/dsh-plugins/skill-desc-zh + bundle
✅ 断言：已安装 / 已应用：state.skills=11 / 影子 4 / hostVersion 匹配
ℹ️ 未验证：工具可用性与目录中文需宿主侧确认
结论：✅ 文件级检查通过
```

`scripts/verify.mjs` 退出码 0；`--expect-installed --expect-applied` 全部断言通过。

---

## 8. 独立复核方式（不依赖成员自述）

- 预检：verifier 自己执行 `scripts/preflight.mjs`，保存完整原始输出；
- 安装：verifier 自己执行 `plugin_manager install_bundle`，并读 profile package.json / bundles / list_plugins；
- E2E 工具调用：因 delegated 子会话的模型工具清单在 spawn 时冻结、无法直接调用 `skill_desc_zh`，由 Lead 在宿主会话代跑；verifier 直接解压 Lead 的 session 事件文件（Node 24 `zlib.zstdDecompressSync` 逐帧）核对 call/result 原文（seq 4499–4555），并独立核对 state、文件系统、trash 日志、影子 hash；
- A5：verifier 自己调用 `skill("office-render")` 验证附录；
- 单测：verifier 自己执行 `npm test`，不是引用成员报告；
- 影子内容：verifier 自己从 app.asar 解包原文并 `diff -r`。

---

## 9. 回滚步骤（全程可回滚，删除只走废纸篓）

按破坏性从小到大：

1. **只恢复英文（保留插件）**：`skill_desc_zh({action:"restore"})`。影子进废纸篓，provider 下架，技能目录回英文；state 保留（`enabled=false`），可随时 `apply` 回中文。
2. **临时停用插件**：`plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`。注意 `restoreOnQuit=false`，停用不会自动还原影子；若要彻底回英文，先执行第 1 步。
3. **卸载插件**：先 `restore`，再 `plugin_manager remove_bundle target="dsh-skill-desc-zh"`。会移除 profile 依赖、bundle 行与 node_modules 软链；**源码目录 `~/dsh-plugins/skill-desc-zh` 不受影响**。
4. **清理插件状态**（如需彻底重置）：`node ~/.dsh/skills/safe-delete-trash/trash.mjs ~/.dsh/.skill-desc-zh`（state + events 进废纸篓）。若第 3 步前 restore 失败，项目影子可能残留：对每个 `/Applications/dsh/.dsh/skills/<name>` 先用 `trash.mjs` 移走（带 `.skill-desc-zh.json` 标记的才可删）；`/Applications/dsh/.dsh/skills` 空目录可一并进废纸篓。
5. **源码回退**：在 `~/dsh-plugins/skill-desc-zh` 内 `git revert`/`git checkout`（该目录是独立工作区，不影响 profile）。

> 本次验收**未执行**第 3–5 步；当前安装保持可用，最终态为中文 11/11。

---

## 10. 仍未闭环/确实未验证的项

1. **A3 全新会话目录肉眼确认**：verifier 会话在 disable 窗口收到过旧目录快照（4 中文 + 7 英文），re-enable 后未再刷新；需用户新开一个会话看 7 个 office 是否中文（status/state/provider 均已证明应生效）。这是唯一未闭环的验收项。
2. **GUI 端实际观感**：未截图/未在 Web 技能面板肉眼核对（当前会话目录为旧快照）；建议用户新会话确认。
3. **audit 对本地目录的供应链字段**：无法判定（来源/发布者/签名/发布时间），只能由用户确认绝对路径内容；本报告已如实标注，未说成“没问题”。
4. **profile lockfile 隔离期条目**：真实存在，本次由用户批准 override；未来可能影响其它插件安装，建议单独治理。
5. **`browser-skill`**：描述硬编码在 runtime 插件代码（rank 250），不可覆盖，保持英文；属于设计内限制，不是缺陷。
6. **真实宿主升级**（例如从 0.2.1-rc.2 升到下一版）尚未发生；本次用 hostVersion 模拟验证了自愈路径，真实升级后建议看一次 `events.ndjson` 是否出现 `host-version-heal`。

---

## 11. 复现命令清单

```sh
# 预检
node ~/dsh-plugins/skill-desc-zh/scripts/preflight.mjs

# 单测
cd ~/dsh-plugins/skill-desc-zh && npm test

# 文件级验收
node scripts/verify.mjs --expect-installed --expect-applied

# 宿主侧（应用内工具）
plugin_manager install_bundle target="~/dsh-plugins/skill-desc-zh"
plugin_manager list_plugins
skill_desc_zh({action:"status"})
skill_desc_zh({action:"restore"})
skill_desc_zh({action:"apply"})
skill_desc_zh({action:"retranslate"})   # 可选：强制重译
```

## 追加（v0.1.1，2026-10-21）：runtime 技能（browser-skill）agent 层覆盖

| 验收项 | 结论 | 证据 |
| --- | --- | --- |
| 语法 | ✅ 全部通过 | `for f in lib/*.js scripts/*.mjs; do node --check "$f"; done` 无报错 |
| 单测 | ✅ 79/79 | `npm test` → `tests 79 / pass 79 / fail 0` |
| agent 层覆盖机制 | ✅ 7/7 | `npm run e2e:agent-layer`（真实 cordis 4.0.5 + dsh-skill 类，不启动 DSH、不联网、不改磁盘）：基线英文（runtime 250 近层获胜）→ 注册后 provider=`skill-desc-zh-agent` 且中文 → `skills.get` content 透传 → global 视角不受影响 → `invalidate()` 立即生效 → `dispose()` 回落英文 |
| 预检（AGENTS.md） | ⚠ 已跑但仅剩已知误报 | `node scripts/preflight.mjs` → `audit.mjs` exit 1；2 个阻塞项均为 profile 已有依赖的 24h 隔离期（`@michengai/dsh-skills-manager@1.2.9`、`@smalltailqwq/dsh-client-ui-skin-maid-atelier@0.1.9`、`@xmanrui/dsh-im@5.3.0`），三者精确版本均已在 `profiles/desktop/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 中（第 17/19/20 行），pnpm 不会拒绝；其余检查均 ✅（bundle patch 1 行、零依赖、无安装脚本、row id 无撞车、engines 满足） |
| 本次是否执行安装/升级 | ❌ 未执行（也不需要） | profile 依赖是 `link:~/dsh-plugins/skill-desc-zh`，重启 DSH 即加载新代码；预检仅作兼容性参考 |
| 重启后在线验收（待执行） | ⏳ | `skill_desc_zh status` 应 12/12 且 `agentLayer.checked.ok=true`、browser-skill 的 provider=`skill-desc-zh-agent`；新会话技能目录 14 条应全中文 |

实现位置：`lib/paths.js`（global 目标 8 个）、`lib/discover.js`（识别 runtime provider、记 `isRuntime`）、`lib/provider.js`（参数化 providerName/rank/filter）、`lib/agent-layer.js`（agent 层 provider + 注册）、`lib/index.js`（agent/created 注册、status/doctor 自检、invalidate 级联、dispose）、`lib/dictionary.zh.json`（12 条）、`cordis.patch.yml`（targets.global 含 browser-skill）、`scripts/agent-layer-e2e.mjs`、`test/agent-layer.test.mjs`。

---

## 追加（v0.2.0，2026-10-21）：斜杠命令描述中文化验收（t11）

- 验收人：verifier（独立验收，不采信实现者自述）
- 源码：`~/dsh-plugins/skill-desc-zh`，`dsh-skill-desc-zh@0.2.0`
- 宿主：DeepSeek Harness Desktop `0.2.1-rc.2`，profile `desktop`
- 安装形态：profile 依赖仍是 `link:~/dsh-plugins/skill-desc-zh`；**本次未安装/升级 profile**，用户重启 DSH 即加载 v0.2 源码
- 范围：只验收“斜杠命令描述中文化”（`/acp`、`/acp-cache`、`/agent-teams`，以及动态 `agent-teams-<profile>`）；技能描述中文化沿用 v0.1 验收
- 生产代码：**零修改**；本验收只新增/更新本文档与 `/tmp` 下的独立探针

### T1. 预检（AGENTS.md 要求，原样转述）

命令：

```sh
node ~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs \
  '~/dsh-plugins/skill-desc-zh' --profile desktop
```

原始输出（完整日志 `/tmp/t11-audit.log`，退出码随 ❌/⚠️ 如实记录）：

```text
=== DSH 插件安装前预检 · profile=desktop ===
目标：dsh-skill-desc-zh@0.2.0  [npm]

❌ 24h 供应链隔离期
    pnpm 11 默认 minimumReleaseAge=24h，以下版本太新会被拒绝，安装会整体失败：
      - @michengai/dsh-skills-manager@1.2.9 发布 21.0h（profile 已有依赖（会被重新解析））→ 隔离期解禁 2026-10-21 17:23Z
      - @smalltailqwq/dsh-client-ui-skin-maid-atelier@0.1.9 发布 23.4h（profile 已有依赖（会被重新解析））→ 隔离期解禁 2026-10-21 14:54Z
      - @xmanrui/dsh-im@5.3.0 发布 22.4h（profile 已有依赖（会被重新解析））→ 隔离期解禁 2026-10-21 15:55Z
❌ profile lockfile 健康度
    现有 lockfile 已含隔离期内条目——pnpm 会在解析前直接拒绝，**本 profile 所有插件安装都会失败**，直到下个时间点或重建 lockfile：
      - @michengai/dsh-skills-manager@1.2.9 发布 21.1h → 解禁 2026-10-21 17:23Z
      - @smalltailqwq/dsh-client-ui-skin-maid-atelier@0.1.9 发布 23.6h → 解禁 2026-10-21 14:54Z
      - @xmanrui/dsh-im@5.3.0 发布 22.6h → 解禁 2026-10-21 15:55Z
ℹ️  来源
    npm 发布包 · dsh-skill-desc-zh@0.2.0（解析到 0.2.0）
ℹ️  许可
    MIT
ℹ️  客户端形态
    未声明 dsh.client（多为宿主侧插件，或自行把脚本注入页面，如 webServer.tapIndex）
ℹ️  核心版本兼容
    未声明 @deepseek-ai/* peer 依赖
ℹ️  engines.dsh
    >=0.2.1-rc.2（宿主核心 0.2.1-rc.2）
ℹ️  已安装同包
    row id 已由它自己的当前层占用（升级/重装）：skill-desc-zh
✅ 是否 DSH bundle
    dsh.bundle.patch = "./cordis.patch.yml"
✅ 安装脚本
    无 preinstall/install/postinstall/prepare，装包不执行构建脚本
✅ 依赖重叠
    与已装插件无共享依赖（候选依赖 0 个）
✅ row id
    插入 1 行（skill-desc-zh），与现有 228 行无撞车

------------------------------------------------------------
判定：❌ 存在 2 个阻塞项 —— 先解决再安装
AUDIT_EXIT=1
```

本地补充检查（`scripts/preflight.mjs --no-audit`，exit=2）：

```text
=== preflight 汇总 ===
目标：dsh-skill-desc-zh@0.2.0
profile：desktop   宿主：0.2.1-rc.2
ℹ️ 目标：dsh-skill-desc-zh@0.2.0（~/dsh-plugins/skill-desc-zh）
ℹ️ 宿主版本：0.2.1-rc.2 ← /Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/runtime.json
✅ engines.dsh：">=0.2.1-rc.2" 满足宿主 0.2.1-rc.2
✅ dsh.bundle.patch：~/dsh-plugins/skill-desc-zh/cordis.patch.yml
✅ dsh.bundle.patch 结构：顶层数组，1 行，insert: skill-desc-zh=dsh-skill-desc-zh
⚠️ profile 已有同名依赖：dsh-skill-desc-zh 已在 desktop profile 中（link:~/dsh-plugins/skill-desc-zh）；安装会改写该行，请确认这是你期望的升级/替换
ℹ️ profile bundle：dsh-skill-desc-zh 已在 dsh.profile.bundles 中
✅ 依赖：运行时零依赖
✅ 安装脚本：无 install/postinstall/preinstall/prepare 生命周期脚本
ℹ️ private：包声明 private:true；本地路径安装可用，但不会被 npm 发布
⚠️ 供应链来源：未验证：目标不是 npm 仓库包，没有 registry 元数据/发布者签名/发布时间/隔离期信息；来源可信度只能由你确认绝对路径内容
⚠️ audit 对本地包的判定：audit.mjs 对本地目录的“仓库来源/发布者/隔离期”类检查无法判定，输出中的相关 ℹ️/⚠️ 原文需如实转述
ℹ️ 官方预检：已用 --no-audit 跳过 audit.mjs（本次结论不含官方审计，视为未验证）

结论：⚠️ 有警告/未验证项 —— 必须逐条展示给用户并取得明确同意后才能安装；不得表述为“没问题”。
```

判读（逐条如实）：

1. **audit 退出码 1，2 个 ❌ 都是 profile 自身的 24h 隔离期检查**：`@michengai/dsh-skills-manager@1.2.9`、`@smalltailqwq/dsh-client-ui-skin-maid-atelier@0.1.9`、`@xmanrui/dsh-im@5.3.0`。这三条精确版本都已在 `~/.dsh/profiles/desktop/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 中（第 17/19/20 行），与 v0.1.1 验收时的已知误报同类（audit 不读取该豁免列表）。**本次不安装/升级 profile，因此没有请求 override；** 这不等于说 audit 的 ❌ 是“没问题”，只是它们不构成本次“重启加载 v0.2 源码”的阻塞。
2. **audit 把本地目录标成 `[npm]` 并写“来源 npm 发布包”是不准确的**：实际命令传的是绝对路径 `~/dsh-plugins/skill-desc-zh`；`npm view dsh-skill-desc-zh@0.2.0` 返回 `E404 Not Found`，registry 上没有这个包。审计器源码 `~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs:171-172` 只识别 GitHub，其余一律 `{ kind: 'npm', spec }`；`resolveFromNpm` 对绝对路径执行 `npm pack <路径>`，因此 `[npm]` 只是“npm pack 本地目录”的实现标签，不是 registry 来源。该行“来源 npm 发布包”不能作为供应链证据；本目标的真实来源是本地目录，**来源/发布者/签名/隔离期均无法由 audit 判定（未验证）**。audit 的 `engines.dsh`/许可/依赖等 ℹ️/✅ 是从本地 `package.json` 读出的，不是 registry 元数据。
3. **本地目录供应链来源无法判定**：本报告不把它表述为“没问题”；`scripts/preflight.mjs --no-audit` 也明确标注“供应链来源：未验证”。
4. profile 里已有同名 `link:` 依赖，本次只是用户重启后加载同一路径的新源码，不是新增安装；profile 的 lockfile/依赖行未变。

### T2. 代码独立复核（只读）

| 检查项 | 结论 | 证据（file:line 或命令输出） |
| --- | --- | --- |
| `inject` 含 `commands` | ✅ | `lib/index.js:47` `export const inject = ['skills', 'tools', 'commands']` |
| 不存在 global 层同名注册 | ✅ | `grep -RInE "commands\.register" lib/` 无命中；唯一注册是 `lib/command-layer.js:538` `agentCommands.register(shadow)`，对象来自 `agent.ctx.get('commands')`（`lib/command-layer.js:472-480`） |
| 不永久删除 | ✅ | `scripts/verify.mjs` 扫描 32 个文件无 `rm/unlink/rmdir/truncate/find -delete` 命中；`lib/` 内无 `fs.rm/unlink/rmdir/truncate` |
| 删除只走 `lib/trash.js` | ✅ | `lib/shadow.js:233/235/248/263/309` 全部 `trash.trash(...)`；`lib/state.js:248` 只是原子写 rename；`lib/trash.js` 为唯一删除通道 |
| state v1→v2 迁移 | ✅ | `lib/state.js` `STATE_VERSION = 2`，`normalizeState` 惰性补 `commands.byName`；`save()` 覆盖前 `trash.snapshot`（`lib/state.js:234`）。另跑独立探针：seed v1 → `load()` version=2 / `commands.byName={}` → `save()` `SNAPSHOT_CALLED=true`、落盘 version=2 |
| restore 摘命令影子 | ✅ | `lib/index.js:1418-1432`：`state.enabled=false` → `disposeCommandShadows()` → `invalidate()`；`lib/command-layer.js:573-582` 逐 agent `dispose` |
| restoreOnQuit / dispose 摘影子 | ✅ | `lib/index.js:1981-2011`：先 `commandLayer.dispose()`，再按 `restoreOnQuit` 还原项目影子 |
| 6 个内置命令被排除 | ✅ | `lib/command-layer.js:25-42` 名单与 GUI `BUILTINS` 逐字一致；独立脚本对比 `CLIENT_BUILTINS`/`LAYER_NAMES`/`LAYER_IDS` → `BUILTIN_EXACT_MATCH true`；探针注册 `goal` 后仍为英文 |
| 模板与词典译文一致 | ✅ | `AGENT_TEAMS_PROFILE_PATTERN`（`:48`）与 `templateTranslation`（`:86-96`）；独立探针断言 `agent-teams-dev` → `以 AgentTeams「dev」配置运行一个团队目标`，`agent-teams` → `以多智能体团队运行目标（你将成为队长）` |
| `commands/change` 防自触发 | ✅（机制与设计 §4.3 一致；无数字代次） | 监听器 `lib/index.js:2094-2105` 50ms debounce；`handleCommandsChange`（`:548-581`）先 `globalChanged()` 比较**全局** digest，不变则跳过；`ensure` 以 `signatureFor` 去重（`lib/command-layer.js:482-519`）。`grep generation/代次 lib/` 无命中——设计 §4.3/§R2 实际规定的是 digest，而非数字代次；设计 §0 摘要里“自增代次”是概述性措辞，与实现不冲突 |
| 影子七字段 | ✅ | `lib/command-layer.js:99-113` 只透传 `definitionId/name/description/input/recordInput/handler`；`descriptor` 中不含 handler（e2e 断言） |
| handler 委托 | ✅ | `lib/command-layer.js:120-136` 每次实时 `find(undefined,name)` → 快照兜底 → 明确 error；不 catch |

复核发现的非阻塞说明：

1. **没有数字代次**：实现用全局 digest + 注册签名去重防自触发；真实模块探针/生产 e2e 未出现循环。若未来要严格对齐设计 §0 的“自增代次”措辞，可加，但不是当前阻塞。
2. **`restore()` 后 `commandLayer.translations` 仍留在内存**：`commandsFeatureEnabled()` 已为 false，`agent/created`/`commands/change` 都不会再注册；`apply` 会重新 prepare。行为正确，但“restore 后 status.commands.translations 仍有 zh”属展示层语义，不是影子残留。
3. **仓库无 `.git`**（`git status` → `fatal: not a git repository`）：旧文 §9 的 “git revert” 回滚步骤在本机不可执行；回滚应走 `restore`/禁用插件/用备份覆盖，不能依赖 git。
4. **`definitionId` 变化不参与指纹**：设计指纹只含 `name/en/hint/hostVersion`；若第三方在不改 description/hint 的前提下改 `definitionId`，影子不会自动刷新。极低频，且 `check` 会报 `definitionId` 不匹配，可按 `retranslate`/`apply` 修复。

### T3. 复跑证据（原始尾部）

```text
$ for f in lib/*.js scripts/*.mjs test/*.test.mjs; do node --check "$f"; done
NODE_CHECK files=29 failures=0

$ npm test
ℹ tests 99
ℹ pass 99
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 198.519542
NPM_TEST_EXIT=0

$ npm run e2e:commands
✔ 全局注册后 global 视角为英文原文
✔ prepare 捕获三条命令、排除内置 goal、模板外无告警
✔ agent A 注册三条影子，agent B 与 global 不受影响
✔ 影子保留 definitionId/input.hint，descriptor 不含 handler
✔ execute /acp 透传原 handler，且只执行一次
✔ execute /agent-teams 原 handler 收到 rawInput
✔ restore 后 agent 视角回英文，global 仍英文
✔ apply 后重新变中文，无需重新翻译
✔ dispose 后回英文，commands/change 有事件
✔ agent 视角与 global 视角并存，互不污染
命令描述中文化端到端：10/10 项通过
E2E_EXIT=0

$ node scripts/verify.mjs
✅ 永久删除痕迹：扫描 32 个文件，未发现 rm/unlink/rmdir/truncate/find -delete/git clean/rimraf
✅ 删除通道：lib/trash.js 调用 safe-delete-trash/trash.mjs
ℹ️ state.json：~/.dsh/.skill-desc-zh/state.json（hostVersion=0.2.1-rc.2, skills=12, projects=1）
✅ 影子标记：4 个
✅ 安装记录：dsh-skill-desc-zh 在 profile dependencies（link:...）与 dsh.profile.bundles 中
ℹ️ 未验证：工具可用性（Node 侧无法证明）
VERIFY_EXIT=0
```

独立探针（不 import 仓库 `scripts/commands-e2e.mjs`，直接用真实宿主 `cordis` + `dsh-scope` + `dsh-commands` + 生产 `lib/command-layer.js`，离线词典/模板）：

```text
$ ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" /tmp/t11-command-probe.mjs
T11 INDEPENDENT PROBE: PASS (global English / agent A Chinese / agent B English / builtin goal untouched / definitionId+input preserved / execute delegated once / restore+apply+dispose / dictionary+template)
T11_PROBE_EXIT=0
```

真实宿主模块的 `agent.ctx` 证据：

```text
dsh-agent-loop/lib/index.js:778  this.scope = createScope(loopCtx, this);
dsh-agent-loop/lib/index.js:779  this.ctx = this.scope.ctx;
dsh-agent/lib/index.js:581       await this.ctx.serial(entry.carrier, "agent/created", { agent: entry.agent, ... });
```

说明 `agent/created` 触发时 `agent.ctx` 已是该 agent 的 scope ctx（设计里唯一的“未实测项”在源码层闭环；真实进程仍需重启后看菜单）。

### T4. 按设计 §10 A1–A10 的状态

| # | 标准 | 本次状态 | 证据 |
| --- | --- | --- | --- |
| A1 | 全局视角永远英文 | ✅ 通过 | e2e + 独立探针 `global` 三条均为英文 |
| A2 | 会话内三条命令显示中文 | ⏳ 待重启后验收 | 真实模块 `list(agent)` 中文、`status.commands` 可见；**GUI `/` 菜单**需重启 DSH + 新会话肉眼确认（本次未安装/未重启） |
| A3 | 执行行为不变 | ⏳ 待重启后验收（机制已证） | 真实模块 `execute` 委托原 handler 且只执行一次；真实 `/acp`、`/agent-teams` 需重启后在线点击 |
| A4 | `definitionId`/`input` 保留 | ✅ 通过 | e2e 断言 + 独立探针快照 |
| A5 | 一键还原 / 再启用 | ✅ 通过 | e2e/探针 restore→英文、apply→中文 |
| A6 | 内置 6 条不受影响 | ✅ 通过 | GUI BUILTINS 与代码名单 6/6 逐字一致；`goal` 探针保持英文 |
| A7 | 升级自愈 | ✅ 代码复核 / ⏳ 真实升级待验 | `lib/index.js:793-876` hostVersion 变化时 `resetCommands` + `commandLayer.clear` + 清缓存 + 重新 prepare；v0.1 已有 `host-version-heal` 测试（技能层），命令层无独立单测；真实升级尚未发生 |
| A8 | 卸载无残留 | ✅ 代码复核 / ⏳ 真实禁用待验 | `dispose()` 总是 `commandLayer.dispose()`（`lib/index.js:1981-2011`）；真实禁用插件需重启后确认菜单回英文 |
| A9 | 测试全绿 | ✅ 通过 | `npm test` 107/107 + `npm run e2e:commands` 10/10 |
| A10 | 降级诚实 | ✅ 通过（离线） | 断网/无模型路径由词典/模板兜底；独立探针 engine=dictionary/template；真实 LLM 翻译未联网验证 |

> readiness 结论：**代码与测试层面具备让用户重启验收的条件；没有阻塞项。** A2/A3（GUI 菜单与真实点击）必须在重启后验收，A7/A8 的真实升级/禁用动作也建议在重启后各看一次 `status`/`events.ndjson`。本次未安装、未升级 profile，未改任何 `lib/` 生产代码。

### T5. 未验证项（如实列出）

1. **GUI `/` 菜单**：v0.2 尚未被真实宿主加载；只能证明 `list(agent)` 的 description 是中文，不能证明菜单像素。
2. **真实执行**：`/acp`、`/agent-teams` 在真实会话中的副作用（压缩报告、团队创建）未在线验证；只验证了 handler 委托与 rawInput 透传。
3. **真实 LLM 翻译命令**：本次用离线词典/模板；LLM 路径有单测（fake llm），未做真实模型调用。
4. **真实升级/禁用**：hostVersion 变化与 `plugin_manager set_plugin enabled=false` 均未在真实宿主执行。
5. **自定义 profile 别名**：profile 当前未配置 `profiles`，`agent-teams-<profile>` 用模板合成数据验证；真实动态注册未验证。
6. **远程 `commands.list(sessionId)` 链路**：真实模块探针直接调 `commands.list(agent)`；GUI 的 remote scope→agent 映射未在本进程内验证。
7. **性能**：agent 很多时逐 agent 注册的成本未压测。

### T6. 回滚 / 恢复步骤

1. 用户重启后若命令中文异常：先 `skill_desc_zh(action="restore")` → 命令影子立即注销（agent 作用域 dispose），再执行 `apply` 可重来。
2. 若要停用整个插件：应用内 `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`；插件 `dispose()` 会注销全部命令影子与技能 provider/影子。
3. 彻底移除：先 `restore`，再 `plugin_manager remove_bundle dsh-skill-desc-zh`；profile 依赖是 `link:`，移除不会删除源码。
4. 源码回滚：本仓库**没有 `.git`**，不能 `git revert`；请在改动前备份 `lib/`（或把旧版本目录留档），回滚时用 `trash.mjs --snapshot` 留档后覆盖。任何删除/清理必须走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`，禁止 `rm`。
5. state 回滚：`~/.dsh/.skill-desc-zh/state.json` 在每次覆盖前有 `trash.snapshot` 留档；必要时从 `~/.Trash` 找回上一次 state，再重启。
6. 本次验收没有改 `lib/`、没有安装/升级 profile、没有永久删除任何文件。

## v0.2.0 重启后线上验收（2026-10-21 深夜）

- 重启（主进程 PID 92939，00:16）后：state schema v2、hostVersion 0.2.1-rc.2、enabled=true；12 条技能译文 + 3 条命令译文均已持久化，无重复翻译。
- 新会话技能目录 14 条全中文（含 browser-skill 的 agent 层覆盖）。
- 真实宿主自检（经只读子任务调用插件工具）：
  * `status`：中文 12/12、命令 3/3（`/acp`、`/acp-cache`、`/agent-teams` 均 `[command/agent] 中文 · engine=llm`）、无 warnings。
  * `doctor`：22/22 全通过，含 `agent-layer-wins`（通过，agent 层 provider 注册数 2）与 `command-layer`（命令影子自检通过）。
- 发现并修复一个相位显示缺陷：冷启动发生在任何会话/项目根之前，`phase` 被定格为 degraded（中文 8/12 时计算），之后影子补齐也不会自动重算，导致 `status` 摘要出现“已生效（phase=degraded）”。修复：抽出 `computePhase()` 供 bootstrap 与 status 共用；status 用实时数据重算相位，仅在相位变化时记录 `phase-reconciled` 事件。新增 `test/phase.test.mjs`（7 例）与 status 纠偏集成测试；`npm test` = **107/107 pass**。
- 该修复需下一次重启加载；当前会话已通过 `refresh` 让相位回到 active。

## v0.3.0 设置页（t16 初次重启前验收，2026-10-22 01:00 +08；t18/t19 修复与 t20 复核见文末）

### 结论

- **正常路径：ready-for-restart（可重启验收）。** 源码/包 0.3.0 已通过 `link:` 安装到 desktop profile；client 半、设置页 slot、认证 HTTP 桥在静态检查、单测、独立模拟加载层全部通过。当前运行进程仍是 v0.3.0 之前的旧代码，因此设置页路由 404、slot inspect 超时均属**重启前预期**，必须重启后按 A6–A14 验收。
- **t16 当时发现 2 个 HTTP 错误路径缺陷（P1/P2）**：动作抛异常后单飞锁永久卡住；180s 超时后动作再 reject 会产生未处理 rejection。**已在 t18 修复并加 T11–T13 回归**，证据见文末 t20 节。
- **t16 当时另有 3 处可见文案不准确 + 1 处清单 icon export 不一致**（低风险，不影响页面运行），**已在 t19 修复**，证据见文末 t20 节。
- 本次**未安装、未升级、未重启、未改 `lib/`/`client.js`/`locale`/`package.json`**；只新增本节和 `/tmp` 探针。

### 验收矩阵（对应 `docs/settings-ui-design.md` §10）

| 项 | 内容 | 状态 | 证据 |
| --- | --- | --- | --- |
| A1 | 现有测试全绿 | ✅ 通过 | 当前 `npm test`：126 tests / 126 pass / 0 fail（t16 当时 123；t18 加 T11–T13 后为 126）；`node --check` 37 个 JS 文件 0 失败；`e2e:commands` 10/10、`e2e:agent-layer` 7/7 |
| A2 | 新 API 单测 T1–T13 全绿 | ✅ 通过 | `test/http-api.test.mjs` 12/12：T1–T10 覆盖 404/405+Allow、503/401/403、413/400、no-store、500 不泄漏堆栈；T11–T13 覆盖 throw 后 busy 释放、超时无 unhandled、正常动作结束释放 |
| A3 | client 静态检查 | ✅ 通过 | `npm run check:client`：13/13（manifest、module id、factory、仅 require react、slot order 16、locale 注册、152 keys、icon 819B、语法） |
| A4 | package.json / exports["./client"] | ✅ 通过 | 实际 `version=0.3.0`，`exports["./client"]="./client.js"`、`exports["./locale/*.json"]`，`dsh.client={platform:"web",immediately:true}`，`dsh.bundle.patch` 保留，scripts 保留，deps/devDeps 均为空 |
| A5 | 文档与实现一致 | ✅ 已修复（t19） | ① `package.json` 同时导出 `./icon` 与 `./icon.svg`，均解析到 `icon.svg`；② `confirm.restore` 去掉“4 个项目”；③ `group.global` 改为“global 层 · provider 覆盖（office 系列 + browser-skill）”；④ `group.command` 改为“命令 · agent 作用域影子（3 个斜杠命令）”；`notices.scope` 改为“8 个全局技能（office ×7 + browser-skill）”。其余端点/字段/order 一致 |
| A6 | client Slots 出现 `id=skill-desc-zh` occupant | ⏳ **未验证（inspect 超时）** | `cordis_inspect_query(client, Slots, listSubTree, root="settings.section")` 与 `root="sidebar.settings"` 均 10s 超时；client Service inspect 也超时。按设计 §10 要求，不得把 A7 当 A6 通过；重启后重试或提供截图 |
| A7 | 设置页入口/页面/console | ⏳ 待重启 | 旧进程未加载 v0.3.0 client；页面不可见。模拟加载层只证明注册逻辑，见 A7' |
| A8 | GET `/state` 未认证 401、认证后 200 | ⏳ 待重启（重启前 404 已证实） | `curl` 实测 `GET /plugins/skill-desc-zh/state` = 404，bogus 路径也 404；新路由未注册。重启后再验 401/200 |
| A9 | 页面与工具 status 一致 | ⏳ 待重启 | 需要页面加载后对照 `skill_desc_zh(status)` |
| A10 | 还原→英文、再应用→中文 | ⏳ 待重启 | 需要页面按钮操作；工具层 v0.2.1 已验收，v0.3.0 未改动作实现 |
| A11 | 开关/确认框/取消不发请求 | ⏳ 待重启 | 代码已实现 OFF→restore 确认、ON→apply；真实交互未验 |
| A12 | 中英文切换导航 label | ⏳ 待重启 | locale 文件 152 keys 对齐；真实语言切换未验 |
| A13 | 隐藏窗口停止轮询 | ⏳ 待重启 | 代码有 visibilitychange + 递归 setTimeout；真实 Network 未验 |
| A14 | client 加载失败降级 | ⏳ 待重启 | 需重启后临时改名 client.js 做故障注入；本次不允许改文件，未执行 |
| A15 | 无永久删除 | ✅ 通过（静态） | 代码范围 37 个文件无 rm/unlink/rmdir/truncate/find -delete/git clean/fs.rm；`lib/trash.js` 是唯一删除通道，`lib/paths.js:114-115` 指向 `safe-delete-trash/trash.mjs`；`node scripts/verify.mjs --expect-installed --expect-applied` exit 0 |

补充检查（任务要求的 A7' 模拟加载）：

- 独立 `/tmp/t16-contract.mjs`（真实 client.js，伪造 `window.__ModuleLoader__` + 最小 React stub）：**PASS（0 problem）**。
  - manifest contract 0.3.0 + exports + dsh.client + bundle.patch + scripts + zero deps；
  - require 仅 react；client module id = `dsh-skill-desc-zh`；
  - locale 文件 parity 152；DICT parity 152；DICT 与 `locale/zh.json` 完全一致；
  - 101 个静态 `t()` key 全部存在；动态前缀（phase./action./state.projectSource/engine./layer./current./target.kind./error.）覆盖；
  - slot 注册：`settings.section`、id=`skill-desc-zh`、order=16、label 是 thunk；
  - 初始 `SettingsPage` 渲染不抛异常（只证明初始渲染，不证明真实浏览器挂载）。

### 额外发现：HTTP 错误路径缺陷（P1/P2）（t16 发现，t18 已修复）

以下保留 t16 当时的原始复现输出作历史记录；**修复后验证见文末「t20 修复后复核」节**。这两项不是正常用户流程，但属于可复现的健壮性缺陷。

1. **动作抛异常后单飞锁永久卡住（P1）**
   - 代码：`lib/http-api.js:454` 置 `busy`；`:455` 的 `work` 可能 reject；`:462-469` 只 `await Promise.race` 没有 catch；`:512` 的 `busy=null` 只在 race 正常 resolve 时到达，**reject 时永远到不了**；异常最终由 `dispatch` 的 catch（`:545-558`）返回 500。
   - 复现（真实宿主模块 + 假 server/controller，`/tmp/t16-http-probe.mjs`）：
     ```text
     ["normal",200,200,null]
     ["throw-then-refresh",500,"internal",409,"busy","logs=1"]
     THROW_BUSY_STUCK=true
     ```
   - 影响：controller 任意一次未预期 throw 后，页面后续所有 POST 都 409 busy，直到重启 DSH；GET 仍可用。
   - 修复建议：在 `await Promise.race` 外包 `try/catch/finally`；catch 中 `busy=null`，记录日志并返回通用 500；补 T8 的 busy 释放断言。

2. **超时后动作再 reject 产生未处理 rejection（P2，可能升级为进程级风险）**
   - 代码：`lib/http-api.js:471-476` 超时分支用 `work.finally(...)` 清 busy；`finally` 返回的新 Promise 在该 Promise 被 reject 时没有 catch，形成 unhandledRejection。
   - 复现（`/tmp/t16-timeout-reject.mjs`）：
     ```text
     first 504 timeout
     unhandled 1 Error: late boom
     second 200 ok
     ```
   - 影响：探针进程显式监听并计数，故 exit 0；但 Node 默认对 unhandledRejection 会告警并可能终止进程。Electron 宿主实际行为**未验证**。动作需超过 180s 后才进入此路径（LLM 批量通常 < 60s，属低概率）。
   - 修复建议：`work.finally(...)` 改为 `work.catch(() => {}).finally(...)`，或对 `finally` 返回的 Promise 再加 `.catch(() => {})`；补超时后 reject 的测试。

> 单测为何没发现：T8（`test/http-api.test.mjs:371-399`）确实让 `apply` 抛错并断言 500/不泄漏堆栈，但断言后立刻 `api.dispose()`，没有在 500 后再发一个请求检查 busy。测试全绿不等于错误路径已覆盖。

### 只读安装复核（不安装/不升级）

- `node ~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs --verify dsh-skill-desc-zh --profile desktop` → **exit 2**（不是 0，也不是阻塞安装）：
  ```text
  ⚠️  lockfile
      lockfile 里没有 dsh-skill-desc-zh@0.3.0
  ✅ profile 依赖
      dsh-skill-desc-zh: link:~/dsh-plugins/skill-desc-zh
  ✅ node_modules
      已安装 dsh-skill-desc-zh@0.3.0
  ✅ bundle 栈
      已列入 dsh.profile.bundles（第 27 层）
  ✅ row 已入栈
      skill-desc-zh → dsh-skill-desc-zh
  判定：⚠️  可通过，但有 1 项需你确认
  ```
  该 ⚠️ 是 `link:` 依赖与 lockfile 的差异，**不是隔离期误报**；按 AGENTS.md 如实标注为“需确认/未验证”，不称为干净。
- `plugin_manager list_plugins`（offset 200）：`{"entryId":"include:skill-desc-zh","moduleName":"dsh-skill-desc-zh","enabled":true,"fiberPhase":"active","patchId":"skill-desc-zh"}`，total 236。运行中的 Host 半边 active；client 半边需重启后才由宿主加载。
- profile：`dependencies["dsh-skill-desc-zh"]="link:~/dsh-plugins/skill-desc-zh"`，`dsh.profile.bundles` 包含；`node_modules/dsh-skill-desc-zh` 是指向源码目录的 symlink。
- 当前运行 state：`~/.dsh/.skill-desc-zh/state.json` = `version:2, enabled:true, hostVersion:"0.2.1-rc.2", skills:12, commands:3, projects:["/Applications/dsh"]`，说明旧进程仍在工作；v0.3.0 不需要改 state schema。

### 重启前 live 探针

```text
GET /plugins/skill-desc-zh/state              -> 404, body 0 bytes
GET /plugins/skill-desc-zh/does-not-exist     -> 404, body 0 bytes
GET /__no_such_plugin__/state                 -> 404, body 0 bytes
```

真实路径与 bogus 路径同为宿主默认 404，证明 v0.3.0 路由尚未注册（不是认证拒绝）；**不能**据此判断路由安全性，安全性由 T1–T10 + 静态检查覆盖。重启后应变为未认证 401、认证后 200。

### 工具兼容性（相对 v0.2.1）

- `lib/tool.js:9-10` 仍是单个 `skill_desc_zh`，action 集合 `status/apply/restore/retranslate/refresh/doctor` 未变；参数 schema、`timeoutMs=180000`、并发安全判定未变；`execute` 仍捕获异常并返回 `{ok:false,...}`（`:111-145`）。
- `status` 只增加 additive 字段 `targets`/`api`/`engineCounts`/`projectRootSource`（`lib/index.js:1699-1728`），旧字段保留；没有删除或改名。
- `lib/index.js:2146-2168` 用同一个 `controller` 同时注册 HTTP 桥和 `skill_desc_zh` 工具；HTTP POST 的 `controller[request.action]`（`lib/http-api.js:455`）与工具调用的 `controller[action]`（`lib/tool.js:129`）是同一套方法，未走第二套实现。
- 未发现全局 `commands.register` 或删除调用；命令层仍只注册到 agent scope。

### 未验证项（不得当作通过）

1. A6 slot inspect：两次 10s 超时；重启后重试，失败则用页面截图替代并继续标注“未验证”。
2. A7/A9–A12：真实浏览器/Electron 页面未加载，入口、视觉、导航 label、确认框、语言切换、页面与工具对照均未验。
3. A8：重启后的 401/200、cookie、`cache-control:no-store` 真实链路未验（T5 只测假 server）。
4. A13：真实 DevTools Network 的轮询/隐藏暂停未验。
5. A14：故障注入未做（会改文件，本次禁止）。
6. 真实 LLM 动作（apply/retranslate 走网络）未验；本次只做模块/假服务探针。
7. Electron 对 unhandledRejection 的实际处理未验；上述 P2 仅证明会产生 unhandled rejection 事件。
8. `./icon.svg` 与设计 `./icon` 的清单 icon 元数据是否导致插件列表无图标，未验。
9. 窄窗口（<800px）/深色主题/键盘可达性未验。
10. 多 agent/多 project 的页面 `names` 白名单与 projectRoot 选择未做真实集成。

### 回滚 / 恢复（重启后可用）

1. 页面异常但工具正常：先 `skill_desc_zh(action="restore")`（恢复英文并注销命令影子），再 `apply` 可重来。
2. 停用插件：应用内 `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`；Host 与 client 注册随 dispose 释放，重启后菜单回英文。
3. 彻底移除：先 `restore`，再 `plugin_manager remove_bundle dsh-skill-desc-zh`；依赖是 `link:`，移除不会删除源码。
4. 源码回滚：仓库**没有 `.git`**；改动前应备份 `lib/`/`client.js`/`locale`/`package.json`。任何删除/清理必须走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`，禁止 `rm`；本仓库没有永久删除调用。
5. state：v0.3.0 不需要迁移；插件每次覆盖 state 前由 `lib/state.js` 调 `trash.snapshot` 留档。本次未改 state，未删除任何文件。
6. 若重启后页面导致宿主异常：禁用插件（步骤 2）→ 重启；client 半不会在禁用后加载，工具仍可用（v0.2.1 行为）。

### 重启后人工验收清单

- [ ] 设置里出现「技能描述中文化」入口（order 16，在“插件”之后）；页面无 console error。
- [ ] 页面 state 加载成功：12 技能 + 3 命令，phase/计数与 `skill_desc_zh(status)` 一致。
- [ ] `GET /plugins/skill-desc-zh/state` 未认证 401，认证后 200 且 `cache-control: no-store`。
- [ ] 点“还原英文原文”→ 确认框 → 技能/命令回英文；再“应用”→ 回中文；两次与工具 status 一致。
- [ ] 切换语言：导航 label 与页面文案变英文/中文。
- [ ] 切到别的应用 30s，Network 无持续 `/state` 请求；切回立即恢复。
- [ ] 关闭开关 = restore；取消确认框不产生 POST。
- [ ] 故障注入（可选）：临时把 `client.js` 移入废纸篓 → 重启后无入口但工具正常；恢复后重启回归。
- [ ] 若先修复了两个 HTTP 错误路径：再跑一次 `/tmp/t16-http-probe.mjs`，确认 throw 后下一次 POST 不再 409、timeout 后无 unhandled rejection。

> t16 当时判定：正常路径 ready-for-restart；P1/P2 与 4 处文案问题需在 stable 前修复。**t18/t19 已完成修复，t20 复核后的最终判定见文末。** A6–A14 的真实页面/菜单/执行仍需重启后验收，本文不把它们写成已通过。

## t20 修复后复核（2026-10-22 01:06 +08，attempt db3c34d2-1934-414f-a14a-873523c3d59d）

### 最终结论

**ready-for-restart（可重启验收）**：t18 的 P1/P2 与 t19 的文案/icon 修复均已独立复核通过；全量回归 126/126、e2e 10/10 + 7/7、37 个 JS 文件语法通过、独立契约探针 PASS、删除纪律扫描 0 违规。没有阻塞用户首次重启验收的代码/文档问题。

仍未验证（不写成通过）：A6 真实 client Slots inspect 重试仍 10s 超时；A7–A14 的页面、认证、点击、轮询、降级必须重启 DSH 后人工确认。当前进程仍是旧代码，重启前路由 404 属预期。

本次只读复核；写作用域仅 `docs/verification.md`，并经 Captain 明确授权修正 `README.md`/`docs/final-report.md` 的过时表述。未改 `lib/`、`client.js`、`locale`、`package.json`；未安装/升级/重启；无任何永久删除。

### 1. t18 修复：P1 busy 泄漏 / P2 超时 unhandled

代码复核（`lib/http-api.js`）：

- 单飞锁改为 token + 幂等 `release`（`:414-420`），只有当前 token 能清 busy，迟到 settle 不会误清新请求。
- action handler 外层 `try/finally` 兜底（`:422-424`、`:535-537`），body 解析、projectRoot 解析、status 刷新或 `sendJson` 任一 throw 都会释放。
- 动作 rejection 先折成 `{error}`（`settled`，`:471`），`Promise.race` 后内层 `finally` 清 timer 并 release（`:479-483`）；超时 504 后迟到 settle 只记日志（`:485-500`），不再触碰新请求 busy。
- T11–T13（`test/http-api.test.mjs:470,502,541`）分别覆盖 throw→500→GET/POST 200、超时→504→unhandled=0、慢动作正常结束后释放。

独立探针原始输出（`/tmp/t20-probes.log`，真实宿主模块 + 假 server/controller）：

```text
["normal",200,200,null]
["throw-then-refresh",500,"internal",200,null,"logs=1"]
["timeout",504,"timeout",200,null,200]
THROW_BUSY_STUCK=false
```

```text
first 504 timeout
unhandled 0
second 200 ok
```

结论：P1 已修复（`THROW_BUSY_STUCK=false`，throw 后下一次 POST 为 200，不再 409）；P2 已修复（迟到 reject 计数为 0，下一次请求 200）。`node --test test/http-api.test.mjs` 12/12。

### 2. t19 修复：文案/清单/icon

- `package.json` 同时导出 `./icon` 与 `./icon.svg`；`require.resolve('dsh-skill-desc-zh/icon')` 与 `.../icon.svg` 均解析到 `~/dsh-plugins/skill-desc-zh/icon.svg`（819 B）。
- `locale/zh.json` 与 `locale/en.json` 各 152 keys，0 missing/0 extra；`confirm.restore` 不再含“4 个项目/from 4 projects”。
- `group.global` = “global 层 · provider 覆盖（office 系列 + browser-skill）”；`group.command` = “命令 · agent 作用域影子（3 个斜杠命令）”；`notices.scope` = “覆盖 8 个全局技能（office ×7 + browser-skill）、4 个 agent-preset 影子技能和 3 个斜杠命令。”
- `client.js` 内联 DICT 已同步；独立契约探针 `DICT == locale/zh.json` 且 152 keys 全等。
- `npm run check:client` 13/13；`node --test test/client.test.mjs` 7/7。

### 3. 全量回归（原始结果）

| 命令 | 结果 |
| --- | --- |
| `npm test` | 126 tests / 126 pass / 0 fail（约 296ms） |
| `node --test test/http-api.test.mjs` | 12/12（含 T11–T13） |
| `node --test test/client.test.mjs` | 7/7 |
| `npm run check:client` | 13/13；locale 152 keys；icon 819 B |
| `npm run e2e:commands` | 10/10 |
| `npm run e2e:agent-layer` | 7/7 |
| `node --check` 全 JS/mjs | 37 个文件，0 失败 |
| `/tmp/t16-contract.mjs`（真实 client.js + 伪造 ModuleLoader/React） | PASS，0 problem（152 locale keys、101 个 `t()` 字面量、slot id/order=16/label thunk、初始渲染不抛错） |
| `node scripts/verify.mjs --expect-installed --expect-applied` | exit 0；37 文件无永久删除痕迹；唯一删除通道 `lib/trash.js` → `trash.mjs`；4 个影子标记；profile link + bundle；state 12 技能 |
| `audit.mjs --verify dsh-skill-desc-zh` | exit 2：仅 ⚠️ “lockfile 里没有 dsh-skill-desc-zh@0.3.0”（`link:` 依赖的预期现象）；其余 ✅，未称为干净 |
| `plugin_manager list_plugins` | `include:skill-desc-zh` → `enabled=true`、`fiberPhase=active`；total 236 |
| pre-restart live HTTP | `/plugins/skill-desc-zh/state` 与 bogus 路径均 404、0 字节；旧进程未注册新路由，属预期 |

### 4. 文档一致性修正（本次编辑）

- `README.md:308`、`:331`：覆盖口径改为“8 个全局技能（office ×7 + browser-skill，provider 覆盖）+ 4 个 agent-preset 影子 + 3 条斜杠命令（agent 作用域影子）”。
- `README.md:382`：删除“已知文案问题”，改为 t19 已修正的逐项说明。
- `README.md:536-537`：§10 的 P1/P2 与文案/icon 从“已知缺陷/待修”改为“已修复（t18/t19）”。
- `README.md:564`：小标题改为“待重启确认 / 已修复待复验”；`:571-572` 同步为 t18/t19 已修复。
- `README.md:576`：修正“本次未改 lib/client/locale/package.json”的过时表述（t18/t19 已改），并说明 profile 仍为 link:、重启加载修复。
- `docs/final-report.md:45`、`:62`：HTTP 矩阵改为 T1–T13；`:70-73` 新增“已修复（待重启后真实环境复验）”节；`:75` 的未闭环项删除 P1/P2 与文案问题；`:85` 回滚、`:97` 交付物重新编号。
- `docs/final-report.md:18`：覆盖口径同步为 8 个全局技能 + 4 个影子 + 3 条命令。
- `docs/final-report.md:68` 的“见 §4”改为“见 §5”（未闭环节）。
- 自检：README/final-report/verification 相对链接 0 坏链；无占位符或未替换模板标记；无“P1/P2 待修”“8 个 office”“command provider”等旧结论。

### 5. A6 重试与当前安装状态

- `cordis_inspect_query(client, Slots, listSubTree, root="settings.section")` 重试仍返回：`Error: Slots.listSubTree: Client inspect query Slots.listSubTree timed out after 10000ms. Open or reconnect the Harness page, then retry.` 按任务要求标为**未验证（inspect 超时）**，不阻塞重启；重启后用页面截图或再次 inspect 复核。
- profile：`dependencies["dsh-skill-desc-zh"]="link:~/dsh-plugins/skill-desc-zh"`；`dsh.profile.bundles` 含该包（30 个）；`node_modules/dsh-skill-desc-zh` 为指向源码的 symlink。
- 当前源码 0.3.0；运行进程仍是旧代码（v0.2.1），因此设置页/HTTP 路由必须重启后才加载。

### 6. 重启后验收清单（交给用户）

1. **Cmd+Q 完全退出 DSH**，再重新打开（不是只关窗口）；确认 `plugin_manager list_plugins` 中 `include:skill-desc-zh` 仍为 `fiberPhase=active`。
2. 打开 **设置 → 技能描述中文化**（一级页面，order 16，位于“插件”之后）；页面无 console error。
3. 状态摘要应显示 `phase=active`、**12 个技能 / 3 条命令**中文；与 `skill_desc_zh(action="status")` 对照一致。
4. `GET /plugins/skill-desc-zh/state`：未认证应 401/403，认证后 200 且 `cache-control: no-store`；不再是 404。
5. 点“应用”→“还原”→“应用”：技能/命令中文 ↔ 英文往返正确，页面结果与工具 `status` 一致；`restore` 后影子目录进废纸篓、命令影子注销。
6. 切换语言：左侧设置导航 label 与页面文案跟随中/英切换。
7. 关闭设置页/切到其它应用 30 秒：Network 面板不再持续请求 `/state`；切回后恢复。
8. 故障降级（可选）：临时把 `client.js` 移入废纸篓 → 重启后没有入口但工具仍可用；恢复文件后再重启回归。任何删除必须走 `trash.mjs`。
9. 回滚：先 `skill_desc_zh(action="restore")` 回英文；需要停用则 `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`；彻底移除先 restore 再 `remove_bundle`。源码无 `.git`，回退用事先备份覆盖，覆盖前 `trash.mjs --snapshot`；禁止 `rm`。

### 7. 本次仍未验证（不得当作通过）

1. A6 真实 client slot occupant：inspect 仍超时。
2. A7/A9–A12：真实页面入口、视觉、确认框、语言切换、页面与工具对照。
3. A8：重启后的真实 401/403/503、cookie、`cache-control: no-store` 链路。
4. A13：真实 DevTools Network 的轮询/隐藏暂停。
5. A14：client 加载失败故障注入（本次禁止改文件，未做）。
6. 真实 LLM 动作（apply/retranslate 网络调用）与 Electron 实际 unhandledRejection 行为。
7. 多 agent/多 project、窄窗口、深色主题、键盘可达性。
8. `./icon` 在插件列表中的实际显示；设计清单图标元数据未做真实 UI 确认。

## 追加（v0.4.0，2026-10-22）：插件管理后台独立验收（t21）

> 验收人：verifier（独立于 t14/t15）；attempt `97df3976-5d7f-494f-b48e-31be9d43f2b3`。
> 只读审查；未安装/卸载/启用/禁用插件，未重启、未改 lib/client/locale/package/README。
> 唯一写入：本文件（追加前已 `trash.mjs --snapshot docs/verification.md`，快照 `~/.dsh/.file-backups/2026-10-22T05-15-45-192Z/verification.md`）。

### 0. 结论

**不通过（needs_revision）**。回归测试大部分通过，但发现 1 个可复现的阻塞级工具输出缺陷（B1）和 2 个可复现的并发单飞缺陷（P1/P2），另有验证脚本误报（V1，低）。B1 修复前 `skill_desc_zh(action="plugins")` 对模型侧不可用；P1/P2 修复前“更新/检查更新只执行一次”的承诺不成立。**不得把本次验收写成通过。**

### 1. 环境事实：当前宿主已加载 0.4.0 宿主半边

- 源码 `~/dsh-plugins/skill-desc-zh` 为 `dsh-skill-desc-zh@0.4.0`；profile `dependencies["dsh-skill-desc-zh"]="link:~/dsh-plugins/skill-desc-zh"`，`dsh.profile.bundles` 含该包；未执行任何安装动作。
- Electron PID 679 启动于 `Thu Oct 22 12:28:05 2026 +08`（本任务从 13:11 开始）；`cordis_inspect_query(host, Tool, listTools)` 的 `skill_desc_zh` schema 已包含 `plugins` action，实机 `skill_desc_zh(status)` 可调用。**任务书的“待重启”前提已部分失效**：宿主半边在线；client 半边仍见 A7/A12。
- 当前运行 `phase=degraded`、中文 11/12：`browser-skill [global/provider]` 因 runtime 描述硬编码保持英文（已知限制，不是 0.4.0 回归）；命令 3/3 中文。
- 未认证 HTTP：`/plugins/skill-desc-zh/state` 与 `/plugins/skill-desc-zh/nope` 均 **401**、`cache-control: no-store`、`{"error":"unauthorized"}`；认证围栏先于路由匹配，因此 401 不能证明路由存在，也不能证明 404。认证后的 200/405/413 等仍未验证。

### 2. A1–A12 状态矩阵

| 编号 | 验收点 | 状态 | 证据/说明 |
| --- | --- | --- | --- |
| A1 | 包清单/双半边/零依赖/脚本 | pass | 0.4.0；`./client`、`./icon`、`./icon.svg`、`./locale/*.json`、patch；`dsh.client={platform:'web',immediately:true}`；零依赖；check-client 14/14 |
| A2 | profile 解析、第三方列表、official 过滤、registry 缓存、更新分类 | pass | plugin-admin-e2e 19/19；unit 20/20；16 个第三方、official 1；self link 不可更新；A2 15/15 真实 latest 可达 |
| A3 | 更新单飞 busy | **fail** | P1：两个并发 `update()` 都通过 `lib/plugin-admin.js:510` 守卫并安装；见 §4.2 |
| A4 | HTTP 路由/认证/no-store/body 上限/busy | **partial，fail** | HTTP tests 18/18；401 + no-store 实测；但并发 POST 可同时通过 `lib/http-api.js:595` 守卫（P2） |
| A5 | `skill_desc_zh(action="plugins")` | **fail（阻塞）** | 实机返回 `Error: tool "skill_desc_zh" returned invalid output: value is not lossless JSON`；B1 |
| A6 | index status/doctor/apply/dispose 集成 | pass（静态+实机 status） | status 含 pluginAdmin；doctor 非强制；controller.plugins；apply 创建；dispose 释放 |
| A7 | 客户端第二个 settings.section 页 | static pass / live 未验证 | client tests 7/7；slot id `plugin-admin`、order 17、label `plugins.nav`；client Slots inspect 仍 10s 超时 |
| A8 | locale zh/en 209 键、DICT 一致 | pass | 两文件各 209 键且 key 集相等；client test 133-137 校验 DICT；149 个字面 `t()` 无缺键（8 个动态前缀为拼接） |
| A9 | 回归测试 | pass | npm test 153/153；http 18/18；plugin-admin 20/20；client 7/7；e2e commands 10/10；agent-layer 7/7；38 个 JS `node --check` 0 失败 |
| A10 | 删除纪律 | pass（人工）/ 工具误报 | 全仓无实际 rm/unlink/rmdir/find -delete/git clean；唯一删除通道 lib/trash.js→trash.mjs；verify.mjs 对字符串辅助函数 `truncate()` 误报（V1） |
| A11 | 未安装/未改 profile | pass | 未调用 install/update；profile 仍 link:；e2e A3.5 为假实现 |
| A12 | 在线/重启后验收 | **未完成** | host 半边已在线；client 视觉、认证 HTTP、真实更新仍未验证（§5） |

### 3. 原始命令与证据

```text
$ node --check lib/*.js scripts/*.mjs client.js
exit 0
$ node --check 全 JS 循环（lib/*.js scripts/*.mjs client.js test/*.mjs）
CHECK_FILES=38 FAILURES=0

$ npm test
tests 153 / pass 153 / fail 0 / duration_ms 342.891417  (Node v24.20.0)
$ node --test test/http-api.test.mjs
tests 18 / pass 18 / fail 0
$ node --test test/plugin-admin.test.mjs
tests 20 / pass 20 / fail 0
$ node scripts/check-client.mjs
check:client passed: 14 checks

$ node scripts/plugin-admin-e2e.mjs
✓ A1.1 profile 解析: desktop · desktopProfiles
✓ A1.2 列表成功: profile=desktop
✓ A1.3 插件数量: 16 个第三方插件
✓ A1.4 官方 bundle 过滤: 1 个官方 bundle
✓ A1.5 自身 link 不可更新: 0.4.0 · local
✓ A1.6 npm 插件可检查更新: 15 个可检查
✓ A2.1 registry 查询: 15/15 个查到 latest
✓ A2.2 updateAvailable 与 semver 一致
✓ A3.1 更新成功: 0.4.8 → 99.0.0-e2e
✓ A3.2 restartRequired 映射: host-module
✓ A3.3 inspect 先行: @linxin666/dsh-client-ui-git-graph@99.0.0-e2e
✓ A3.4 installBundle 规格: @linxin666/dsh-client-ui-git-graph@99.0.0-e2e
✓ A3.5 无真实安装（只有假实现）
✓ A4.1 隔离期分类: quarantine
✓ A4.2 构建脚本分类: pending-builds
✓ A4.3 预检拒绝: incompatible-version
✓ A4.4 预检拒绝不安装
✓ A5.1 describe 元数据
✓ A5.2 更新后缓存失效触发重查: cache cleared after update
插件管理后台端到端：19/19 项通过

$ npm run e2e:commands
命令描述中文化端到端：10/10 项通过
$ npm run e2e:agent-layer
agent 层覆盖端到端：7/7 项通过

$ node scripts/verify.mjs --expect-installed --expect-applied
❌ 永久删除痕迹：lib/plugin-admin.js 命中 truncate："truncate("
✅ 删除通道：lib/trash.js 调用 safe-delete-trash/trash.mjs
✅ 安装记录：dsh-skill-desc-zh 在 profile dependencies（link:…）与 dsh.profile.bundles 中
✅ 断言：已安装 / 已应用 state.skills=12 / 影子 4 个 / hostVersion=0.2.1-rc.2
结论：❌ 1 个失败项。  (exit 1；V1 误报)

$ node ~/.dsh/skills/dsh-plugin-preinstall-audit/audit.mjs --verify dsh-skill-desc-zh
AUDIT_EXIT=2
⚠️ lockfile：lockfile 里没有 dsh-skill-desc-zh@0.4.0
✅ profile 依赖: dsh-skill-desc-zh: link:~/dsh-plugins/skill-desc-zh
✅ node_modules: 已安装 dsh-skill-desc-zh@0.4.0
✅ bundle 栈: dsh.profile.bundles（第 27 层）
✅ row 已入栈: skill-desc-zh → dsh-skill-desc-zh
判定：⚠️ 可通过，但有 1 项需你确认

$ plugin_manager list_plugins（offset 200）
{"entryId":"include:skill-desc-zh","moduleName":"dsh-skill-desc-zh","enabled":true,"fiberPhase":"active","patchId":"skill-desc-zh"}  (total 236)

实机工具：
skill_desc_zh(action="status") -> 成功；phase=degraded，中文 11/12，命令 3/3
skill_desc_zh(action="plugins") -> Error: tool "skill_desc_zh" returned invalid output: value is not lossless JSON
```

### 4. 发现

#### B1（blocker）plugins 工具输出不是 lossless JSON

- 复现：当前宿主调用 `skill_desc_zh(action="plugins")` 立即报上述错误，工具对模型不可用。
- 根因（代码级）：`lib/index.js:1936-1946` 逐字段构造插件对象，`version`、`latestVersion`、`latestError` 在 local/无更新/无错误插件上为 `undefined`；宿主工具结果要求可无损序列化，含 `undefined` 的对象被拒绝。该解释与错误文本一致；修复后应以契约测试验证。
- 修法：返回前移除 `undefined` 键或统一转 `null`；补 local、无更新、latestError 三种插件的 lossless 测试。责任：t14。

#### P1（high）plugin-admin `update()` 单飞守卫获取过晚

- 复现 `/tmp/t21-race-probe.mjs`（真实 `lib/plugin-admin.js` + memfs，假 installBundle 等待 gate）同时两次 `update({name:'dshmarket'})`：

```text
INSTALL_CALLS_BEFORE_RELEASE=2
FETCH_CALLS=2
R1={"ok":true,"to":"1.66.45"}
R2={"ok":true,"to":"1.66.45"}
INSTALL_CALLS_TOTAL=2
```

- 代码：`lib/plugin-admin.js:510` 检查 `if (updating) return busy`，但 `updating` 到 `:542` 才赋值；两个请求都在赋值前通过守卫。`test/plugin-admin.test.mjs:502-526` 只覆盖 installBundle 已调用后的第二请求。
- 影响：两个标签页/客户端同时点“更新”可能重复安装同一插件。
- 修法：`update()` 进入时（任何 await 前）同步占用 `updating`，整个函数 try/finally 释放；补安装前并发测试。责任：t14。

#### P2（medium）HTTP 插件路由 busy 守卫也在 body 解析后

- 复现 `/tmp/t21-http-race.mjs`（真实 `lib/http-api.js` + 假 pluginAdmin，`list` 等待 gate）同时两个 `POST /plugins/action {"action":"check"}`：

```text
CHECK_CALLS_BEFORE_RELEASE=2
STATUSES=[200,200]
CHECK_CALLS_TOTAL=2
```

- 代码：`lib/http-api.js:595` 先查 `pluginBusy`，但 `pluginBusy` 在 `:628`（check）/:655（update）才赋值，且发生在 `await readJsonRequest(req)`（:615）之后；普通 action 在 `:431-438` 就占用。第一个请求的 finally 可能清掉第二个的锁。
- 影响：并发 POST 可同时执行 check/update，与 P1 叠加扩大安装窗口。
- 修法：认证/content-type 通过后、读 body 前占用 `pluginBusy`；token/引用计数保证仅占用者释放；补并发 POST 测试。责任：t14。

#### V1（low）verify.mjs 删除扫描误报

- `lib/plugin-admin.js:43` 的 `function truncate(text, limit = MAX_DETAIL_CHARS)` 是字符串截断，`:388/:396/:581` 只用于文案；`scripts/verify.mjs:77` 正则 `/\b(fs\.)?truncate(Sync)?\s*\(/u` 命中它，导致 verify exit 1。人工全仓扫描无实际删除。
- 修法：正则限定 `fs.truncate`/`truncateSync`，或重命名辅助函数。责任：t14/验证脚本；本任务未改。

#### C1（low，一致性）客户端“检查更新”走 GET

- `client.js:1074` 的“检查更新”和“刷新”都调用 `load({refresh:true})`（GET `/plugins?refresh=1`）；`api.checkPlugins`（POST check，`client.js:528`）未被页面使用。HTTP POST check 存在且通过 T16，不是功能缺陷；建议页面改用 POST check 或删除死代码/在文档说明。责任：t15。

### 5. 仍未验证（不得当作通过）

1. 认证后的 HTTP 200/405/413/409/504、cookie、no-store 全链路；未取得 Web token，未绕过认证。
2. 设置页真实渲染/导航/按钮/确认框/语言切换/轮询：client Slots inspect 仍 10s 超时，未启动浏览器，不伪造截图。
3. 客户端 bundle 实际加载与 `/plugins/dsh-skill-desc-zh/client.js?rev=…` 200；未认证 401/404 不能作为证明。
4. 真实 install/update/restart-required/pending-builds/quarantine 在线链路（任务禁止真实更新，仅假实现）。
5. 真实 LLM 翻译、commands/change 刷新、dispose、多 agent/多 project、窄窗口/深色/键盘可达性。
6. `./icon` 的插件列表/设置页实际显示。
7. B1/P1/P2 修复后的回归（本任务只报告、未改生产代码）。

### 6. 回滚

- 本次未改生产代码/package/locale/README；修复/回退时：
  1. `skill_desc_zh(action="restore")` 回英文；
  2. `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false` 停用；
  3. 彻底移除：先 restore，再 `remove_bundle`；
  4. 源码无 `.git`，回退用备份覆盖，覆盖前 `trash.mjs --snapshot <file>`；任何删除只走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`。
- 本文件追加前快照见 §0。

### 7. 终审建议

先修 B1，再修 P1/P2，补 undefined 契约与并发测试；之后在**已重启且认证**的 GUI 复验设置页、更新单次执行、工具 `plugins`、HTTP 200/no-store/401。B1/P1/P2 修复前不得把 A3/A4/A5 标为通过，也不得把 v0.4.0 作为“已完成”交付。

## 复验（v0.4.0，2026-10-22 13:22）：修复后源码级通过（attempt 2）

> 本节**取代上节 §0/§4 的 B1/P1/P2 结论**；上节保留为首次验收历史。
> attempt `68784e5e-827d-4d7b-9424-71befeb2be18`。只读审查，未安装/卸载/启用/禁用、未重启、未改 lib/client/locale/package/README。
> 追加前快照：`~/.dsh/.file-backups/2026-10-22T05-22-56-033Z/verification.md`。

### 0. 结论

**源码级通过，ready-for-restart。** 上节 B1/P1/P2/V1/C1 均已修复并有对应测试/独立探针；回归 157/157、e2e 21/21。**但当前运行进程仍是修复前加载的 0.4.0（PID 679，启动于 12:28:05；源码修复文件 mtime 13:20:15），重启前 live `skill_desc_zh(action="plugins")` 仍会报旧错误，不能宣称线上已通过。** 重启 DSH 后再做认证 GUI 验收。

### 1. 环境与前提

- 源码 `dsh-skill-desc-zh@0.4.0`，profile 依赖 `link:~/dsh-plugins/skill-desc-zh`；未执行任何安装、升级、启用/禁用。profile 依赖与 bundle 未变。
- 宿主 PID 679 启动于 `Thu Oct 22 12:28:05 2026 +08`；`lib/plugin-admin.js`、`lib/http-api.js`、`lib/index.js`、`client.js` 的 mtime 均为 `13:20:15`，即**修复代码晚于进程启动**。因此本次 live 工具结果不能代表当前源码；重启是最后一步。
- 当前 live `skill_desc_zh(status)`：`phase=active`，中文 **12/12**，命令 **3/3**，项目 `/Applications/dsh`；较首次验收的 11/12 已恢复（browser-skill 也已中文）。live `skill_desc_zh(action="plugins")` 仍返回上节同一旧错误（旧进程），见 §3。
- 未跑安装预检：本次没有安装/升级动作，profile 已是 `link:`，无新增包；如后续需要安装/升级，按 AGENTS.md 另跑 `preflight.mjs`/`audit.mjs`。

### 2. A1–A12 复验矩阵

| 编号 | 验收点 | 状态 | 原始证据 |
| --- | --- | --- | --- |
| A1 | 包清单/双半边/零依赖/脚本 | pass | 0.4.0；exports `./client`、`./icon`、`./icon.svg`、`./locale/*.json`、patch；`dsh.client={platform:'web',immediately:true}`；`dependencies/devDependencies` 为空；`check-client` 14/14 |
| A2 | profile 解析、列表、official 过滤、latest 查询、更新分类 | pass | `plugin-admin-e2e` 21/21：16 个第三方、official 1、15/15 latest、self link 不可更新；A1.7/A3.6 lossless 往返通过；profile 解析顺序见 `lib/plugin-admin.js:199-256` |
| A3 | 更新单飞 busy | pass | 修复后 `/tmp/t21-race-probe.mjs`：`INSTALL_CALLS_BEFORE_RELEASE=1`、`INSTALL_CALLS_TOTAL=1`、`R2={"ok":false,"code":"busy"}`；`test/plugin-admin.test.mjs:564` 覆盖首个 await 前占位 |
| A4 | HTTP 路由/认证/no-store/body/busy | pass（源码）；在线待重启 | `node --test test/http-api.test.mjs` 19/19（含 T20 并发 POST）；live 未认证 state 与 bogus 均 **401 + cache-control: no-store**；修复后 `/tmp/t21-http-race.mjs`：`CHECK_CALLS_BEFORE_RELEASE=1`、`STATUSES=[200,409]`；认证后的 200/405/413/409/504 仍待重启 |
| A5 | `skill_desc_zh(action="plugins")` | pass（源码）；live 旧进程待重启 | `lib/index.js:1928` 已用 `toLosslessJson({ ... })` 包裹；独立 `LOSSLESS_OK`（undefined 字段被丢弃、可 JSON 往返）；live 仍为旧错误，因 PID 679 早于修复 |
| A6 | index status/doctor/apply/dispose 集成 | pass | status 含 pluginAdmin（`lib/index.js:1561`）；doctor `plugin-admin` 非强制（`:1840`）；createPluginAdmin（`:2256`）注入 controller/http-api；dispose 调 `pluginAdmin?.dispose?.()`（约 `:2205`）；live status 成功 |
| A7 | 客户端第二个 settings.section 页 | pass（静态）；live 待重启 | `client.js:19-21` NAV 16/ADMIN 17/PAGE_VERSION 0.4.0；`:1631-1637` id `plugin-admin`、order 17、label `plugins.nav`；client tests 7/7；client Slots inspect 仍 10s 超时 |
| A8 | locale zh/en 209 键、DICT 一致 | pass | `locale/zh.json` 与 `en.json` 各 209 keys、key 集相等；`check-client` 14/14；client test 校验 DICT |
| A9 | 回归测试 | pass（实际数高于任务书） | `npm test` **157/157**；任务书期望 153，多出的 4 项是修复新增（B1 lossless、P1/P2 并发等）；`plugin-admin-e2e` **21/21**（期望 19，多 A1.7/A3.6）；commands 10/10；agent-layer 7/7；语法检查 0 失败 |
| A10 | 删除纪律 | pass | `scripts/verify.mjs` exit 0：扫描 40 个文件无 rm/unlink/rmdir/truncate/find -delete/git clean；lib/client 无匹配；唯一通道 `lib/trash.js`→trash.mjs；V1 已通过重命名 `clipText()`（`lib/plugin-admin.js:75`）消除 |
| A11 | 未安装/未改 profile | pass | 未调用 install/update；profile 仍 `link:`；e2e A3.5 明确“无真实安装” |
| A12 | 在线/重启后验收 | **未完成（待重启）** | host 半边已由 0.4.0 进程加载；但修复代码未加载，live `plugins` 旧错误；认证 HTTP、真实设置页视觉、真实一键更新仍未验证 |

### 3. 原始命令与输出要点

```text
$ node --check lib/*.js scripts/*.mjs client.js
exit 0

$ npm test
tests 157 / pass 157 / fail 0 / duration_ms 307.420708  (Node v24.20.0)
（任务书期望 153；多 4 项为修复新增测试）

$ node --test test/plugin-admin.test.mjs test/http-api.test.mjs test/tool.test.mjs
tests 49 / pass 49 / fail 0
  plugin-admin 22、http-api 19、tool 8（含 T20 并发插件 POST、单飞提前占位、lossless 往返）

$ node scripts/check-client.mjs
check:client passed: 14 checks；locale 209 keys；icon 819 B

$ node scripts/plugin-admin-e2e.mjs
✓ A1.7 list 返回值可无损 JSON 往返: round-trip
✓ A2.1 registry 查询: 15/15 个查到 latest
✓ A3.6 更新结果可无损 JSON 往返: round-trip
✓ A3.5 无真实安装（只有假实现）
✓ A4.1 隔离期分类: quarantine
✓ A4.2 构建脚本分类: pending-builds
✓ A4.3 预检拒绝: incompatible-version
✓ A5.2 更新后缓存失效触发重查: cache cleared after update
插件管理后台端到端：21/21 项通过

$ npm run e2e:commands
命令描述中文化端到端：10/10 项通过
$ npm run e2e:agent-layer
agent 层覆盖端到端：7/7 项通过

$ node scripts/verify.mjs --expect-installed --expect-applied
✅ 永久删除痕迹：扫描 40 个文件，未发现 rm/unlink/rmdir/truncate/find -delete/git clean/rimraf
✅ 删除通道：lib/trash.js 调用 safe-delete-trash/trash.mjs
✅ 安装记录 / 断言：profile link、state.skills=12、4 个影子、hostVersion=0.2.1-rc.2
结论：✅ 文件级检查通过（工具可用性仍需宿主侧确认）。  (exit 0)

$ node /tmp/t21-race-probe.mjs
INSTALL_CALLS_BEFORE_RELEASE=1
INSTALL_CALLS_TOTAL=1
R1={"ok":true,"to":"1.66.45"}
R2={"ok":false,"code":"busy"}

$ node /tmp/t21-http-race.mjs
CHECK_CALLS_BEFORE_RELEASE=1
STATUSES=[200,409]
CHECK_CALLS_TOTAL=1

$ node --input-type=module -e 'import {toLosslessJson} from "./lib/plugin-admin.js"; ...'
LOSSLESS_OK {"ok":true,"plugins":[{"name":"local-plugin","version":"0.4.0","updateAvailable":false}],...}

$ curl -D - http://127.0.0.1:49166/plugins/skill-desc-zh/state
HTTP/1.1 401 Unauthorized
cache-control: no-store
{"error":"unauthorized"}
$ curl .../plugins/skill-desc-zh/nope
bogus=401   （认证围栏先于路由匹配；401 不能证明 404/200）

plugin_manager list_plugins（offset 200）:
{"entryId":"include:skill-desc-zh","moduleName":"dsh-skill-desc-zh","enabled":true,"fiberPhase":"active","patchId":"skill-desc-zh"}  (total 236)

live 工具（旧进程 PID 679）:
skill_desc_zh(status) -> phase=active，中文 12/12，命令 3/3
skill_desc_zh(action="plugins") -> Error: tool "skill_desc_zh" returned invalid output: value is not lossless JSON
（源码修复见 §4；重启后此条应消失）

client inspect:
Slots.listSubTree(root="settings.section") -> timed out after 10000ms（未验证客户端真实 slot）
```

### 4. 修复核对（逐项，不照抄 Lead）

- **B1**：`lib/plugin-admin.js:40-60` 新增 `toLosslessJson`（丢弃 undefined 属性、数组 undefined→null、NaN/Infinity→null、BigInt→字符串、Date→ISO、只留普通对象/稠密数组）；`lib/index.js:1928` 用其包裹 plugins 工具结果；`plugin-admin-e2e` A1.7/A3.6 和独立 `LOSSLESS_OK` 均通过。源码层 B1 已关闭；线上旧进程待重启。
- **P1**：`lib/plugin-admin.js:542-545` 在第一个 `await` 之前同步占位 `updating`，`:625-628` 的 `finally` 只释放本次 token；探针由 2 次安装降为 1 次，第二请求 busy；`test/plugin-admin.test.mjs:564` 覆盖。
- **P2**：`lib/http-api.js:567-575` 的 `takePluginBusy` 在任何 await 前占位，`:589`/`:612` 先取 token 再读 body，`:685` 的 finally 幂等释放；`test/http-api.test.mjs:757` 覆盖；探针 `STATUSES=[200,409]`。
- **V1**：`truncate()` 已重命名为 `clipText()`（`lib/plugin-admin.js:75`），`verify.mjs` 扫描 40 文件通过；删除纪律无实际违规。
- **C1**：`client.js:1013` 已改为 `api.checkPlugins({})`（POST check），不再用 GET 刷新冒充检查。

### 5. 未验证 / 范围外

1. **重启后在线**：认证 HTTP 200/405/413/409/504、真实 cookie、设置页可见性/文案/开关/确认框/语言切换/轮询、真实一键更新（本次禁止真实安装）。
2. client Slots inspect 超时（10s），不能用它证明页面已注册；需重启后用页面视觉/再次 inspect。
3. 真实 `pluginManager` 列表在设置页的呈现、真实 registry 检查更新的 UI、更新后重启提示；本次 e2e 使用假 installBundle（A3.5 明确无真实安装）。
4. 真实 LLM 翻译、真实 upgrade self-heal、Electron 实际 unload/dispose、窄窗口/深色/键盘可达性。
5. `./icon` 的插件列表实际显示。
6. README.md / docs/final-report.md 仍停留在 v0.3.0 口径（126/126、v0.3.0、无插件管理章节）；本次任务明确禁止改这两个文件，需由文档任务（t17）在重启验收后同步。**不影响源码验收，但影响 v0.4.0 用户文档完整性。**

### 6. 回滚

- 本次未改生产代码/package/locale/README；源码修复已完成。
- 如需回退：`skill_desc_zh(action="restore")` 回英文 → `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false` 停用 → 需要彻底移除时先 restore 再 `remove_bundle`。
- 源码无 `.git`；用备份覆盖前 `trash.mjs --snapshot <file>`；任何删除只走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`。

### 7. 终审

**源码级 verdict：pass（ready-for-restart）**。B1/P1/P2/V1/C1 均已修复并有独立证据；剩余唯一硬前提是**重启 DSH** 以加载 13:20 的修复，然后按 §5 做认证 GUI 验收。重启前不得宣称 `plugins` 工具或设置页线上可用；README/final-report 的 v0.4.0 同步属于后续文档任务。

---

## 追加（v0.5.0，2026-10-22）：技能管理页独立验收（t26）

### 0. 结论（先看这里）

**verdict：needs_revision（不通过，需修复后复验）**。主链路测试全绿（208/208），但独立代码审查 + 真实 fs/HTTP/宿主语义探针发现 5 个与设计不符的问题；其中 3 个会直接影响用户看到的技能列表或禁用语义：

| id | 严重级别 | 问题 | 位置 |
| --- | --- | --- | --- |
| F1 | medium | `references/*.md` 等资源文档被当成技能行显示；`scan` 递归收集所有 `.md`，而设计只允许 `<name>/SKILL.md` 或根层 `<name>.md` | `lib/skill-files.js:322-359`、`:424-448` |
| F2 | medium | 只读来源被 API 标成 `scope:'user'`；客户端按 scope 分组，导致只读区永远为空、office/preset/runtime 混进“用户”列表和计数 | `lib/skill-admin.js:188-210`、`client.js:1777-1778` |
| F3 | low/medium | 只读行永远 `translation:{engine:'none',zh:false}`，即使 state 里已有中文译文，仍显示英文 description | `lib/index.js:217-234`、`lib/skill-admin.js:207` |
| F4 | medium | 禁用影子的 candidate 正确，但 `createDisabledProvider().get()` 返回的 definition 仍带原始 `description` 和 `invocation:{modelInvocable:true}`；设计 §6.2 要求禁用前缀 + false | `lib/agent-layer.js:185-191`、`:201-215` |
| F5 | low | 按 id 恢复删除项时不重新检查 `deletion.projectRoot` 是否仍在当前 allowlist；已移出白名单的项目仍可被写回 | `lib/skill-admin.js:356-369`、`lib/skill-files.js:743-800` |
| F6 | low | 禁用 provider 的 `get()` 只按 name/可选 metadata.scope 匹配，不校验 projectRoot；同名 user/project 条目可能取错 definition | `lib/agent-layer.js:201-215` |

F4 的一个限定：宿主 `skill` 工具先用 `snapshot().skills.filter(isModelInvocable)`，候选的 `modelInvocable:false` 已能阻止模型调用；但 `skills.get()` 的定义契约仍错误，且直接消费 definition 的代码会看到原始英文和 true。F1/F2/F3 不是“暂时没重启”问题，重启后仍会存在。

### 1. 环境与范围

- 源码 `~/dsh-plugins/skill-desc-zh`，package `dsh-skill-desc-zh@0.5.0`（零依赖）。
- profile：`link:~/dsh-plugins/skill-desc-zh`，`dsh.profile.bundles` 含该行，`plugin_manager` entry `include:skill-desc-zh` `enabled:true` `fiberPhase:"active"`（total 236）。
- 当前运行进程仍是旧版本（PID 679 于 12:28 启动）；新 `skills` 页面/路由需重启后在线验收。**本次没有安装/升级/启用/停用/重启，没有写真实用户技能**。
- 测试 fs/HTTP 探针都在 `/tmp` 或内存中；未触碰 `~/.dsh/skills`、`/Applications/dsh/.dsh/skills`。

### 2. 命令与原始结果

| 命令 | 结果 |
| --- | --- |
| `node --check`（lib/scripts/client/test 共 47 文件） | exit 0，`failures=0` |
| `npm test` | `tests 208` / `pass 208` / `fail 0`（353.6ms，Node v24.20.0） |
| `node scripts/check-client.mjs` | exit 0，17 checks；slots 16/17/18；PAGE_VERSION 0.5.0；locale 297 keys（88 skill keys）；icon 819B |
| `node scripts/skills-e2e.mjs` | exit 0，32/32 assertions |
| `npm run e2e:agent-layer` | exit 0，7/7 |
| `npm run e2e:commands` | exit 0，10/10 |
| `npm run e2e:plugin-admin` | exit 0，21/21 |
| `node scripts/verify.mjs --expect-installed --expect-applied` | exit 0；49 files 无永久删除；trash 通道；4 shadows；profile link+bundle；state 12 |
| `node --test test/skill-files.test.mjs test/skill-admin.test.mjs` | 28/28 |
| `node scripts/spike-disable-shadow.mjs`（Electron as node） | exit 0，A1–A11 11/11 |
| `node scripts/spike-trash-restore.mjs` | exit 0，B1–B9 10/10 |

### 3. A 表（设计 A1–A28）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| A1 list sources | pass | `skills-e2e`、单测 `skill-admin.test.mjs`；`user`/`project` sources 存在 |
| A2 create | pass | real-fs 探针：`demo/SKILL.md` 写入，frontmatter name/description 正确 |
| A3 新行字段 | pass | 单测 + real-fs：`scope:'user'`、`editable/deletable/disableable:true`、fingerprint 存在（只读行例外见 F2） |
| A4 detail | pass | 单测：frontmatter/body/raw/fingerprint/mtimeMs/size |
| A5 save + 额外字段保留 | pass | real-fs 探针：注释、`license`、`tags`、额外键逐字节保留；中文正文可写回 |
| A6 旧 fingerprint → 409 | pass | 单测 `skill-admin.test.mjs` |
| A7 重复 create → 409 | pass | 单测 |
| A8 非法 name → 400 | pass | real-fs/HTTP 探针 |
| A9 description 换行 → 400 | pass | `validateDescription` + 单测 |
| A10 body >256KiB → 413 | pass | `/tmp/t26-http-adversarial-v2.mjs`：`body >256KiB -> 413` |
| A11 disable candidate | pass | `spike-disable-shadow` A1–A11；rank 40、invocation false |
| A12 model filter | pass | spike A5：`snapshot().skills.filter(isModelInvocable)` 排除 |
| A13 enable | pass | `skills-e2e` 32/32 |
| A14 delete → 废纸篓 | pass | `skills-e2e`：目录消失、trash `to` 存在、state 记录 from/to/kind/size |
| A15 restore(id) | pass | `skills-e2e` + real-fs：内容回来、`restoredAt` 写入 |
| A16 目标已存在 → 409 | pass | `skills-e2e` + real-fs：不覆盖 |
| A17 回收站列表 | pass | `skills-e2e`：删除可见、恢复后不可见 |
| A18 项目级 create | 未验证（代码/单测覆盖，本次未在真实项目根创建） | `skill-admin` 项目源逻辑；未写真实项目 |
| A19 项目级 save 隔离 | 未验证（同上） | 代码按 root 分路径；未做双根真实写 |
| A20 非白名单 projectRoot → 400 | pass | 直接 `admin.action(create/save)` 探针 |
| A21 symlink 越界 → 400 | pass | `skill-files.test.mjs` 28/28 |
| A22 未认证 GET /skills → 401 | 待重启（当前进程无新路由；认证包装代码在 fake gate 下验证） | `authenticatedRoutes` 401/403 分支；线上旧进程仅能证明 401 门禁 |
| A23 并发 POST → 409 | pass | `/tmp/t26-http-adversarial-v2.mjs`：`concurrent second POST -> 409` |
| A24 lossless JSON | pass（代码审查） | `skills` tool 行字段全部显式；无 undefined/NaN/BigInt；工具 schema 可序列化（未在宿主旧进程实测新 action） |
| A25 只读来源 delete/disable → 400 | pass | `skill-admin` 探针：`not-writable`/`not-found`；前端按钮也 disabled |
| A26 anchor/alias → 400 | pass | `skill-files.test.mjs`；`renderEdit` 只允许安全单行 description |
| A27 trash 不可用 → 503 | pass | `skills-e2e` 32/32 |
| A28 restore 缺失 → 404 | pass | `skills-e2e` 32/32 |

### 4. 对抗性探测

- **F1 资源文档幻影技能**：`/tmp/t26-real-fs-probe.mjs` 在临时根建 `demo/SKILL.md` + `references/guide.md`；`admin.list()` 返回两行，第二行 `{name:'guide', editable:false, warnings:['缺少合法的 YAML frontmatter…']}`。递归 `walkMarkdown` 收集任意深度 `.md`；`scan` 用 basename 作为技能名。
- **F2 只读分组**：注入 office/preset/runtime 三行后 `normalizeReadOnlyRow` 全部得到 `scope:'user'`；`client.js:1777-1778` 以 scope 分组 → writable 包含它们、readonly 永远空；`counts.user` 也错误。
- **F3 只读翻译**：state 已有 `office.zh='Office 中文'`，`normalizeReadOnlyRow` 仍返回 `description:'Office English'`、`translation:{engine:'none',zh:false}`。
- **F4 禁用定义**：`/tmp/t26-disabled-provider.mjs` 输出：
  `candidate.description="（已禁用）Original demo"`、`candidate.invocation.modelInvocable=false`；
  `definition.description="Original demo"`、`definition.invocation.modelInvocable=true`。
- **F5 恢复白名单**：state 的 deletion `projectRoot` 不在 allowlist；`admin.action({action:'restore',id:'del-1'})` 返回 `ok:true` 并重建目标，绕过当前 allowlist。
- **HTTP**：`/tmp/t26-http-adversarial-v2.mjs` 6/7；auth 401 断言失败是探针把 gate 返回值写成对象（错误写法）。修正为返回 401 数字的 `/tmp/t26-http-adversarial-v3.mjs` 为 **7/7**（auth 503/401、content-type 400、>256KiB 413、非法 name/scope 400、并发第二个 POST 409）；`lib/http-api.js:380-392` 只接受 401/403 数字，live 未认证请求为 401。
- **正常路径**：Chinese create/save/detail 字节一致；save 保留额外 frontmatter；delete→trash→restore 成功；restore 目标已存在 409 不覆盖；parent 缺失可 mkdir；state v2→v3 迁移保留 skills/commands 且新增 `skillAdmin`。

### 5. 未验证 / 待重启

1. 设置页真实渲染、导航项、三个 slot（16/17/18）、新建/编辑/禁用/删除/恢复的 GUI 全链路。
2. 认证 HTTP 的真实 200/401/403/405/413/409/504、cookie、`cache-control`；当前进程旧，新 `/skills` 路由未注册。
3. `skill_desc_zh({"action":"skills"})` 在宿主旧进程的实际输出（源码已审查，但需重启后实测 lossless）。
4. 真实 `~/.dsh/skills` 与项目根的创建/保存/删除（本次按约束未写用户数据）。
5. 真实 LLM 翻译、真实 upgrade self-heal、Electron unload/dispose、窄窗口/深色/键盘可达性。
6. 项目级 A18/A19 的真实双根行为。

### 6. 回滚

- 本次未改生产代码/package/locale/README/state。
- 文档快照：`~/.dsh/.file-backups/2026-10-22T13-18-36-394Z/verification.md`。
- 若需停用：`skill_desc_zh(action="restore")` → `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`；彻底移除先 restore 再 `remove_bundle`。
- 源码无 `.git`；任何覆盖前 `trash.mjs --snapshot`；删除只走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`。

### 7. 终审

**verdict：needs_revision**。主链路与测试基线通过，但 F1/F2/F3/F4 是用户可见或契约级偏差，F5/F6 是安全/匹配边界；修复并补测试（资源 `.md` 过滤、只读分区与翻译、禁用 definition、restore allowlist、同名 scope 匹配）后再复验。不得把本轮写成 pass，也不得把“待重启”当成上述问题的解释。

---

## 追加（v0.5.0 复验，2026-10-22）：t26 findings 修复后独立验收（t29）

### 0. 结论

**verdict：needs_revision**。F1、F3、F4、F5、F6 已修复并通过独立复现；**F2 仍未完全修复**：只读行的 `scope` 已正确变为 `bundled/preset/plugin/runtime`，客户端按 scope 也能把它们放进只读区，但服务端 `admin.list({source:'user'})` 仍把只读行追加进返回列表（`lib/skill-admin.js:271-279`），与 t29 要求“user/project 列表不混入只读行”不符；`statusSummary.readOnlySkills` 也仍硬编码 `0`（`lib/skill-admin.js:486`），只读计数不可用（F2b，low）。因此本轮不能 pass；最小修复后再复验。

### 1. 逐项对照（t26 → t29）

| 项 | t26 证据 | t29 复验（原始输出） | 结论 |
| --- | --- | --- | --- |
| F1 资源 .md | `["demo","guide","root-doc"]` | `F1_NAMES ["demo","office","plug","preset-x","root-doc","rt"]`（只读是显式注入；可写技能只有 demo/root-doc；`references/guide.md`、`a/b/c.md` 均未出现） | **pass** |
| F2 只读 scope/分组 | office/pre/rt 全为 `user`，只读区空 | scopes：`office=bundled`、`preset-x=preset`、`rt=runtime`、`plug=plugin`；client 分组 `readonly` 非空、`user/project` 只含 demo/root-doc | **partial**：scope 与客户端分组已修；`source:'user'` API 仍返回只读行（见 §2） |
| F3 只读中文 | `Office English` / `{none,false}` | `Office 中文` / `{dictionary,true}`；无译文的 plug 仍 `Plugin English` / `{none,false}` | **pass** |
| F4 禁用 definition | definition 原始描述 + `modelInvocable:true` | candidate 与 definition 均 `（已禁用）Project.`、invocation 全 false；`F4_CONTENT_EQ true`（content 逐字节一致） | **pass** |
| F5 restore 白名单 | `ok:true` 且写回 | `{"ok":false,"code":"unsupported-source"}`；`TARGET_EXISTS false`；`STATE_AFTER [{"id":"del-1","restoredAt":null}]` | **pass** |
| F6 同名 scope | 错误 projectRoot 返回 User 定义 | `F6_USER` User 内容、`F6_PROJECT` Project 内容、`F6_WRONG_ROOT` `undefined`（不再 fallback） | **pass** |

### 2. F2 残留（本轮唯一阻塞项）

独立复现（`/tmp/t29-repro.mjs`，真实 `createSkillAdmin` + 4 个只读行 + demo/root-doc）：

```
F2_SCOPES [{"name":"demo","scope":"user","origin":"user"},
 {"name":"office","scope":"bundled","origin":"bundled"},
 {"name":"plug","scope":"plugin","origin":"plugin"},
 {"name":"preset-x","scope":"preset","origin":"preset"},
 {"name":"root-doc","scope":"user","origin":"user"},
 {"name":"rt","scope":"runtime","origin":"runtime"}]
F2_USER_SOURCE ["demo","office","plug","preset-x","root-doc","rt"]
```

- `lib/skill-admin.js:271-279` 对 `source==='user'` 不跳过只读行，只有 `source==='project'` 跳过。
- 客户端 `client.js:1777-1778` 按 `scope` 分组后显示正确：`readonly` 4 行、`user` 2 行、`project` 0；但 API 契约（source 过滤）仍混入。
- `lib/skill-admin.js:484-486` 的 `statusSummary.readOnlySkills` 仍是字面量 `0`，与真实 4 行不符；`userSkills/projectSkills` 已按 scope 排除只读。
- 最小修复：`list` 仅在 `source==='all'` 时追加只读行；`source=user` 只返回可写 user 行，`source=project` 只返回可写 project 行；`statusSummary.readOnlySkills` 从 rows 按 origin/editable 统计（或明确删除该字段）。补一条 `list({source:'user'})` 断言。

### 3. 全量回归（本轮重跑）

| 命令 | 结果 |
| --- | --- |
| `npm test` | `tests 211` / `pass 211` / `fail 0`（329.175ms，Node v24.20.0） |
| `node scripts/check-client.mjs` | exit 0，17 checks（slots 16/17/18、PAGE_VERSION 0.5.0、locale 297、icon 819B） |
| `node scripts/skills-e2e.mjs` | exit 0，32/32（临时目录 `.../skill-desc-zh-skills-e2e-U5aqN6`） |
| `npm run e2e:agent-layer` | exit 0，7/7 |
| `npm run e2e:commands` | exit 0，10/10 |
| `npm run e2e:plugin-admin` | exit 0，21/21 |
| `node --check`（lib/scripts/client/test） | `CHECKED=47 FAILURES=0` |
| `node scripts/verify.mjs --expect-installed --expect-applied` | exit 0；扫描 49 文件无永久删除；trash 通道；4 shadow markers；profile link+bundle |

### 4. 对抗用例

- **恢复目标已存在**：`/tmp/t29-adversarial.mjs` 先删除 `demo`，再同名目录写入 `Sentinel`，`restore` 返回 `{"ok":false,"code":"conflict"}`，`SENTINEL_UNCHANGED true`（未静默覆盖）。
- **description 锚点/别名**：seed `description: &d 原描述` + `other: *d`，save 返回 `{"ok":false,"code":"unsupported-frontmatter","message":"description 使用 YAML 锚点/别名，无法安全改写"}`，`ANCHOR_UNCHANGED true`；文件未被改写。
- **F5 状态**：不存在的 projectRoot 恢复返回 `unsupported-source`，目标不存在，`restoredAt` 仍为 `null`（未写盘/未改状态）。
- **F6**：user/project 同名各自取对；错误 projectRoot 返回 `undefined`。
- **HTTP 回归**（沿用 t26 探针）：`/tmp/t26-http-adversarial-v3.mjs` 7/7（auth 503/401、content-type 400、>256KiB 413、非法 name/scope 400、并发第二 POST 409）。
- **state v2→v3**：`/tmp/t26-state-migration.mjs` 通过（version 3，skillAdmin 初始化，skills/commands 保留）。

### 5. A1–A28 受影响项

| 项 | 状态 | 说明 |
| --- | --- | --- |
| A1 list/sources | **partial** | 可写列表正确；`source:'user'` 仍混只读（F2 残留） |
| A3 新行字段 | pass | 只读行 scope 为 origin，editable=false；可写行字段正确 |
| A10 413 | pass | HTTP 探针 |
| A15/A16 恢复/冲突 | pass | 独立 adversarial + skills-e2e |
| A17 回收站 | pass | skills-e2e |
| A20 非白名单 | pass | F5 探针 |
| A21 symlink | pass | `test/skill-files.test.mjs` 28/28 |
| A22 未认证 401 | 待重启/包装层验证 | live 旧进程 401；新 `/skills` 路由需重启 |
| A23 并发 409 | pass | HTTP 探针 |
| A24 lossless | 代码审查 | skills 行字段显式；宿主旧进程未实测 `skills` action |
| A25 只读删除/禁用 | pass | 探针/adapter 代码 |
| A26 锚点/别名 400 | pass | adversarial：400 且文件不变 |
| A27/A28 trash/缺失 | pass | skills-e2e 32/32 |
| A18/A19 项目级真实写 | 未验证 | 本次不写真实项目 |

### 6. 未验证 / 仍需重启

1. 设置页真实渲染（三 slot 16/17/18）、只读区视觉、筛选/统计、新建/编辑/禁用/删除/恢复的 GUI 全链路。
2. 新 `/skills` 路由的真实认证 200/401/403/405/413/409/504、cookie、no-store；当前进程仍是旧版。
3. `skill_desc_zh({"action":"skills"})` 宿主旧进程实测 lossless（本轮只做源码/API 检查）。
4. 真实 `~/.dsh/skills` / 项目根写操作（按约束未写用户数据）；A18/A19。
5. 真实 LLM 翻译、upgrade self-heal、Electron unload/dispose、窄窗/深色/键盘。
6. F2 修复后的客户端 source 筛选与只读区联动。

### 7. 回滚

- 本轮只追加本文档；未改生产代码/package/locale/state，未安装/重启，未写真实用户技能。
- 文档快照：`~/.dsh/.file-backups/2026-10-22T13-26-27-555Z/verification.md`。
- 停用/移除：`skill_desc_zh(action="restore")` → `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`；彻底移除先 restore 再 `remove_bundle`。
- 无 `.git`；覆盖前 `trash.mjs --snapshot`；删除只走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`。

### 8. 终审

**verdict：needs_revision（1 项阻塞）**。F1/F3/F4/F5/F6 已关闭；F2 的 API `source:'user'` 混入只读行（以及 `readOnlySkills:0`）必须最小修复后再复验。其余主链路与回归全绿，不能把“F2 客户端已正常”当作 API 契约已通过。

---

## 追加（v0.5.0 二次复验，2026-10-22）：F2R/F2b 修复后独立验收（t30）

### 0. 结论

**verdict：pass（源码级）**。F2R（`source=user/project` 混入只读行）与 F2b（`readOnlySkills` 硬编码 0）均已修复并通过独立复现；F1/F3/F4/F5/F6 无回归；全量测试与静态检查全绿。真实 GUI、认证 HTTP、真实用户技能写入仍需重启后人工验收（见 §6）。

### 1. 修复审查（diff 仅两处生产逻辑 + 测试）

对比快照 `~/.dsh/.file-backups/2026-10-22T13-27-43-273Z/skill-admin.js`：

- `list()`：只读行读取/追加整体移到 `if (source === 'all')` 内；`source=user|project` 不再调用 `readOnlyRows()`，只返回 `scanned.skills` 中同 scope 的可写行。同名可写 `seen` 去重仍保留。
- `statusSummary()`：`readOnlySkills` 从 `readOnlyRows()` 统计，先以可写行名初始化 `seen`，同名只读跳过；不再字面量 `0`。
- 测试新增：`source=user|project` 的 scope/editable 断言、`readOnlySkills` 1/3 断言（`test/skill-admin.test.mjs:74-85, 220-223, 274-280`）。

未发现其它生产代码改动；`lib/index.js`/client/locale/package 未变。

### 2. F2R 修复前 → 修复后（原始输出）

t29（修复前）`/tmp/t29-repro.mjs`：

```
F2_USER_SOURCE ["demo","office","plug","preset-x","root-doc","rt"]
```

t30 独立探针 `/tmp/t30-f2.mjs`（真实 `createSkillAdmin`，只读行含 `office/pre/rt/plug` + 同名只读 `mine`；可写 `mine` + 项目 `proj-mine`）：

```
ALL [["mine","user"],["office","bundled"],["plug","plugin"],["pre","preset"],["proj-mine","project"],["rt","runtime"]]
USER_SOURCE [["mine","user"]]
PROJECT_SOURCE [["proj-mine","project"]]
MINE_DESCRIPTION "Writable mine."
STATUS {"user":1,"project":1,"readOnly":4}
CHECK_USER_ONLY_WRITABLE true
CHECK_PROJECT_ONLY_WRITABLE true
CHECK_ALL_HAS_READONLY office,plug,pre,rt
```

重跑 t29 原脚本也变为：

```
F2_USER_SOURCE ["demo","root-doc"]
F2_SCOPES [demo=user, office=bundled, plug=plugin, preset-x=preset, root-doc=user, rt=runtime]
```

结论：`source=all` 仍展示只读来源；`user/project` 仅可写行；同名只读 `mine` 被可写行遮挡。

### 3. F2b 修复前 → 修复后

- 修复前：`statusSummary.readOnlySkills` 恒为 `0`。
- 修复后：`readOnlyRows()` 5 条（`office/pre/rt/plug` + 同名 `mine`），可写 `mine` 占名 → `STATUS {"user":1,"project":1,"readOnly":4}`；`userSkills=1`、`projectSkills=1`。
- 单测新增断言：只读 1 条场景为 `1`；F2 三只读场景为 `3`（同名可写去重）；全部通过。

### 4. 全量回归（本轮独立重跑）

| 命令 | 结果 |
| --- | --- |
| `npm test` | `tests 211` / `pass 211` / `fail 0`（350.3ms，Node v24.20.0） |
| `node scripts/check-client.mjs` | exit 0，17 checks；slots 16/17/18；PAGE_VERSION 0.5.0；locale 297 keys；icon 819B |
| `node scripts/skills-e2e.mjs` | exit 0，32/32（临时目录 `.../skill-desc-zh-skills-e2e-xJOQSg`） |
| `npm run e2e:agent-layer` | exit 0，7/7 |
| `npm run e2e:commands` | exit 0，10/10 |
| `npm run e2e:plugin-admin` | exit 0，21/21 |
| `node --check`（lib/scripts/test/client 共 49 文件） | `CHECKED=49 FAILURES=0` |
| `node scripts/verify.mjs --expect-installed --expect-applied` | exit 0；扫描 49 文件无永久删除；trash 通道；4 shadow markers；profile link+bundle；state 12 |

### 5. F1/F3–F6 无回归（重跑 t29 原始探针）

```
F1_NAMES ["demo","office","plug","preset-x","root-doc","rt"]   # 无 guide / a/b/c.md
F3_OFFICE {"description":"Office 中文","translation":{"engine":"dictionary","zh":true}}
F3_PLUG {"description":"Plugin English","translation":{"engine":"none","zh":false}}
F4_CAND/DEF {"description":"（已禁用）Project.","invocation":{"modelInvocable":false,"userInvocable":false}}
F4_CONTENT_EQ true
F6_USER USER-CONTENT / F6_PROJECT PROJECT-CONTENT / F6_WRONG_ROOT undefined
```

- F5：`/tmp/t29-f5.mjs` → `{"ok":false,"code":"unsupported-source"}`，`TARGET_EXISTS false`，`STATE_AFTER restoredAt:null`。
- 对抗：锚点/别名 save → `unsupported-frontmatter` 且 `ANCHOR_UNCHANGED true`；删除后同名 Sentinel restore → `conflict` 且 `SENTINEL_UNCHANGED true`。
- HTTP 包装层：`/tmp/t26-http-adversarial-v3.mjs` 7/7（auth 503/401、content-type 400、>256KiB 413、非法 name/scope 400、并发第二 POST 409）。
- state v2→v3：`VERSION 3`，`skillAdmin` 初始化，`skills/commands` 保留。

### 6. A1–A28 受影响项

| 项 | 状态 | 说明 |
| --- | --- | --- |
| A1 list/sources | **pass（本轮关闭）** | `source=user/project` 仅可写行；`source=all` 含只读并去重同名可写 |
| A2 create | pass | 未受影响；skills-e2e 32/32 |
| A3 新行字段 | pass | 只读行 `scope=origin`（bundled/preset/plugin/runtime），`editable=false`；可写行不变 |
| A4 detail | pass | 未受影响 |
| A25 只读来源 delete/disable → 400 | pass | 只读行仍 `not-writable/not-found`；前端按钮 disabled |
| A22 未认证 `/skills` → 401 | 待重启 | 当前进程旧；仅 fake gate 与 live 旧路由 401 证据 |
| A24 lossless | 待重启实测 | 源码审查通过；宿主旧进程未实测 `skills` action |
| A18/A19 项目级真实写 | 未验证 | 本次按约束未写真实项目/用户目录 |

其余 A5–A17、A20/A21、A23、A26–A28 未受 F2 修复影响，沿用 t29/t26 证据（全量回归仍绿）。

### 7. 未验证 / 仍需重启

1. 设置页真实渲染、三 slot（16/17/18）、只读区视觉、筛选/统计与完整 GUI CRUD。
2. 新 `/skills` 路由真实认证 200/401/403/405/413/409/504、cookie、`cache-control: no-store`。
3. `skill_desc_zh({"action":"skills"})` 宿主旧进程 lossless 实测。
4. 真实 `~/.dsh/skills` / 项目根写操作（A18/A19）。
5. 真实 LLM 翻译、upgrade self-heal、Electron unload/dispose、窄窗/深色/键盘。

### 8. 回滚

- 本轮只追加本文档；未改生产代码/package/locale/state，未安装/重启，未写真实用户技能。
- 文档快照：`~/.dsh/.file-backups/2026-10-22T13-28-56-019Z/verification.md`。
- 停用/移除：`skill_desc_zh(action="restore")` → `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`；彻底移除先 restore 再 `remove_bundle`。
- 无 `.git`；覆盖前 `trash.mjs --snapshot`；删除只走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`。

### 9. 终审

**verdict：pass（源码级，可进入 t27 文档收尾）**。F2R/F2b 已关闭；F1/F3–F6 无回归；211/211、17/17、32/32、7/7、10/10、21/21、49 文件语法 0 失败、verify 退出 0。线上 GUI/认证 HTTP/真实写操作仍须重启后验收，本结论不把“待重启”写成已验证。

---

## 追加（v0.6.0，2026-10-23）：Better Skill 单入口三 Tab 独立验收（t32）

> 任务：`t32 [verify] v0.6.0 独立验收：Better Skill 单入口三 Tab`，attempt `b3c53efc-c760-4dff-adbe-237dd6af1872`。
> 本轮只追加本文档；未修改 `lib/`、`client.js`、`locale/`、`package.json`、`README.md`、`final-report.md`，未安装/升级/重启，未写真实用户技能，未永久删除任何文件。

### 0. 结论

**verdict：needs_revision（源码级；t33 暂不进入）。**

主链路全部通过：214/214 单测、check-client 17/17、client 12/12、skills-e2e 32/32、plugin-admin 21/21、commands 10/10、agent-layer 7/7、49 个 JS 文件语法 0 失败、verify.mjs exit 0、locale 298/298 同键；单入口、三 Tab、localStorage、默认 translate、键盘帮助函数、旧常量移除也均符合计划。

但独立代码审查发现一个与本轮目标直接相关的 **medium** 缺陷：`Boundary` 的 `failed` 状态不会在切换 Tab 时重置。tabbar 虽在 Boundary 之外，但切换后新 Tab 仍被同一个 Boundary 的错误 fallback 挡住，因此“单 Tab 崩溃不影响切换”实际不成立（F1）。另有一个 **low** 的 ARIA 悬空引用（F2），以及 t31 未按报告要求提供 SHA-256 基线导致的 **未验证** 项（I1，不是代码缺陷）。

### 1. 独立复跑（原始计数）

| 命令 | 结果 |
| --- | --- |
| `npm test` | tests 214 / pass 214 / fail 0 / duration 360.137 ms（Node v24.20.0） |
| `node scripts/check-client.mjs` | 17 checks passed；单 slot、order 16、3 tabs、0.6.0、298 keys、icon 819B、syntax |
| `node --test test/client.test.mjs` | tests 12 / pass 12 / fail 0 |
| `node scripts/skills-e2e.mjs` | 32 项断言全部通过 |
| `npm run e2e:plugin-admin` | 21/21 |
| `npm run e2e:commands` | 10/10 |
| `npm run e2e:agent-layer` | 7/7 |
| `node --check`（lib 18 + scripts 11 + test 17 + client + 2 helpers） | CHECKED=49，FAILURES=0 |
| `node scripts/verify.mjs --expect-installed --expect-applied` | exit 0；49 文件无永久删除痕迹、trash 通道、4 影子、profile link+bundle、state 12 |
| locale 独立比对 | zh 298 / en 298 / missing 0 / extra 0 / duplicate 0；`tabs.label` 功能区/Sections，`nav` Better Skill/Better Skill |

### 2. 静态契约（逐项核对代码）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 唯一 settings.section 注册 | pass | `client.js:2528` 仅一次 `ctx.slots.inject('settings.section')`；`:2530-2537` id `skill-desc-zh`、order `PAGE_ORDER=16`、`label: () => t('nav')`、`locale: NS`；`grep` 无第二处 |
| 旧入口常量/注册移除 | pass | `grep` 无 `ADMIN_ORDER`/`SKILL_ORDER`；无 `id: 'plugin-admin'`/`id: 'skill-admin'`；`scripts/check-client.mjs:86-87` 也做反向断言 |
| TABS | pass | `client.js:23-27`：`translate/title`、`plugins/plugins.nav`、`skills/skills.nav`；`TAB_IDS`/`TAB_LABELS` 同步 |
| 默认 Tab / 持久化 | pass | `PAGE_ORDER=16` :19、`PAGE_VERSION='0.6.0'` :20、`TAB_STORAGE_KEY='dsh-skill-desc-zh.activeTab'` :22；`readStoredTab`/`writeStoredTab`/`selectInitialTab`/`nextTabId` :44-81 均有 try/catch 与非法值回退 |
| ARIA 结构 | pass（含 F2 low） | `BetterSkillPage` :2466-2521：tablist `aria-label=t('tabs.label')`；tab id=`sdzh-tab-<id>`、`role=tab`、`aria-selected`、`tabIndex`；tabpanel id=`sdzh-panel-<active>`、`role=tabpanel`、`aria-labelledby`。F2 见下。 |
| 键盘/聚焦 | pass（静态） | `onTabKeyDown` 处理 ArrowLeft/ArrowRight/Home/End；`activate` 后按 `sdzh-tab-<id>` 聚焦；`nextTabId` 环绕已由 12/12 client 测试覆盖 |
| 只挂载当前页 | pass（静态） | `ActivePage` 仅按 `active` 选择一个组件；旧 panel 由 React 卸载；三个页面均有 `AbortController` + unmount cleanup（SettingsPage:1239-1251、PluginAdminPage:1663-1698、SkillAdminPage:2120-2128） |
| Boundary 位置 | pass | `client.js:2492-2519`：tabbar 是 root 的直接子节点，Boundary 只在 tabpanel 内部、仅包 ActivePage |
| 窄屏 tab 条 | 未验证（源码无 overflow-x/媒体查询） | `.sdzh-page-tabbar` 仅 `display:flex`（:867）；3 个中文短标签可能换行而非横向滚动。没有真实浏览器/窄窗证据，本轮不写成“已验证”。 |

### 3. 对抗与边界

1. **storage 抛错**：`readStoredTab(throwing)` → `translate`，`writeStoredTab('plugins', throwing)` → `false`；client 12/12 通过。
2. **非法值**：`readStoredTab` 返回 `translate`；`writeStoredTab('nope')` 返回 `false` 且不覆盖已有值。
3. **nextTabId**：ArrowLeft/ArrowRight 环绕、Home/End、未知键保持当前；client 测试覆盖。
4. **localStorage 选择初始 Tab**：设为 `plugins` 时只渲染 `PluginAdminPage`；默认无值时渲染 `SettingsPage`；client 测试覆盖。
5. **切换旧请求**：三个页面的 cleanup 都会 `abort()` 当前请求并把 `alive.current=false`；旧请求不会在卸载后写回状态（静态核对）。
6. **单 Tab 崩溃后切换（F1）**：见下，失败。
7. **ARIA 悬空（F2）**：见下，low。

### 4. Findings

#### F1（medium）Boundary 错误状态跨 Tab 不重置，切换被旧 fallback 挡住

- 位置：`client.js:2518`（`h(Boundary, { t: t }, h(ActivePage, ...))`）、`client.js:2442-2465`（Boundary）。
- 机制：`Boundary` 只有 `state.failed`，`componentDidCatch` 置 true 后没有任何 `componentDidUpdate`/`key` 重置；`BetterSkillPage` 切换时只改变 `ActivePage`，同一个位置、同一个 Boundary 实例会保留 `failed:true`，因此新 Tab 仍渲染错误卡片。tabbar 本身可点，但点完面板仍是旧错误，用户只能整页刷新。
- 影响：违反本轮“tabbar 在 Boundary 之外（单 Tab 崩溃不影响切换）”的验收意图；任一 Tab 的渲染异常会永久禁用 Better Skill 的其他两个 Tab。
- 复现（独立探针 `/tmp/t32-boundary-probe.mjs`）：加载生产 `client.js` 的 `Boundary`，初始 `initial_renders_children:true`；置 `state.failed` 后 `failed_renders_fallback:true`；替换 children 为“新 Tab”后 `after_switch_still_fallback:true`、`has_key_reset:false`、`verdict:"STUCK_FALLBACK"`。`Boundary` 无 `key={active}`；`render()` 首先 `if (this.state.failed) return fallback`，没有基于 props 的重置路径。
- 要求修复：给 Boundary 加 `key={active}`（每次切 Tab 重新挂载）或在 `BetterSkillPage`/`Boundary` 中于 active 变化时重置 `failed`；补一个“Tab A 抛错 → 切到 Tab B 能正常渲染”的测试。owner t31/automation-engineer。

#### F2（low）非激活 Tab 的 `aria-controls` 指向不存在的 tabpanel

- 位置：`client.js:2504`（每个 tab 都设置 `aria-controls: 'sdzh-panel-' + item.id`）、`client.js:2512`（只渲染当前 active 的 panel）。
- 机制：只挂载当前页时，非激活 Tab 的 `aria-controls` 目标节点不存在；激活 Tab 的目标存在，因此主要影响读屏器对未选中 Tab 的关联播报。
- 要求修复：要么同时渲染三个 `hidden` panel（与“只挂载当前页/卸载旧请求”冲突，需要设计取舍），要么只给 active tab 设置 `aria-controls` 并同步测试。low，不阻塞首次重启；但应在 t33 前决定。

#### I1（未验证，流程缺口）t31 未提供 SHA-256 基线

- t31 任务要求“完成后报告 lib/*.js 与 scripts/* 的 sha256 基线清单”，但 `team.json` 的 t31 output、acceptanceResults 与 `/tmp` 均无该清单；t31 快照目录只有 6 个被改文件，没有 lib/。
- 因此本轮**无法计算**“与 t31 报告基线逐字节一致”；不伪称通过。
- 替代独立证据（未发现变更，但不等于基线比对）：
  - `lib/*.js` 最新 mtime 为 `2026-10-22T21:27:43`，全部早于 t31 开始的 `2026-10-23T12:52`；`grep lib/` 无 `0.6.0`/`BetterSkill`/`activeTab`/`settings.section`。
  - t31 快照中 `package.json` 与当前 `diff` 仅 `"version": "0.5.0" → "0.6.0"`。
  - `cordis.patch.yml` mtime `2026-10-21T22:14:09`、sha256 `bb65365e…`；其余 scripts 最新 mtime 早于 t31，唯一 t31 修改的脚本是 `check-client.mjs`。
  - 当前关键 hash：`package.json b91ba34a…`、`client.js e5ebee1f…`、`check-client.mjs cd41c301…`、`test/client.test.mjs f4eb751c…`、`locale/zh.json 5e57445d…`、`locale/en.json 1f103cf3…`。
- 要求：t31/Lead 补发 hash 基线，或明确接受上述替代证据为等价证明；在此之前该项保持“未验证”。

### 5. A1–A12 映射

| 项 | 状态 | 说明 |
| --- | --- | --- |
| A1 全量测试/语法 | pass | 214/214；49 文件 0 失败 |
| A2 check-client 单入口/版本/298 | pass | 17/17 |
| A3 client 纯函数/静态渲染 | pass | 12/12 |
| A4 e2e 四套 | pass | 32/32、21/21、10/10、7/7 |
| A5 verify 安装/trash/影子 | pass | exit 0，49 文件 |
| A6 locale zh/en 同键 | pass | 298/298，0 missing/extra/dup |
| A7 唯一 slot/旧常量移除 | pass | 代码 + checker |
| A8 TABS/labels/storage/keyboard 帮助函数 | pass | 代码 + 12 tests |
| A9 ARIA 完整 | pass（F2 low） | tablist/tab/tabpanel 属性存在；非激活 aria-controls 悬空 |
| A10 切换卸载/请求取消 | pass（静态） | 只挂 ActivePage；三页 cleanup abort |
| A11 默认 translate/storage 异常回退 | pass | 12 tests |
| A12 hash 不变性 | 未验证（I1） | t31 基线缺失；替代证据未发现变更 |
| 附加：单 Tab 崩溃后切换 | **fail（F1）** | Boundary 状态跨 Tab 保留 |

### 6. 未验证 / 待重启

1. 真实 GUI：单入口是否显示为“Better Skill”，三个 Tab 的视觉、焦点顺序、窄窗换行/横向滚动。
2. 真实 React 下切换 Tab 时旧页面请求取消、旧 state 不写回（本轮仅静态核对 + 单测）。
3. 真实 client bundle 加载、locale 注入、重启后 `settings.section` 只出现一次。
4. F1 的修复需要在真实/模拟 React 中复测“崩溃 → 切 Tab → 新页面可渲染”。
5. I1 的 SHA 基线比对。

### 7. 回滚

- 本轮只追加本文档；未改生产代码/package/locale/state。
- 文档快照：`~/.dsh/.file-backups/2026-10-23T04-58-05-499Z/verification.md`。
- 停用/移除：`skill_desc_zh(action="restore")` → `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`；彻底移除先 restore 再 `remove_bundle`。
- 无 `.git`；覆盖前 `trash.mjs --snapshot`；删除只走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`。

### 8. 终审

**verdict：needs_revision**。主链路与静态契约均通过，但 F1 使“单 Tab 崩溃不影响切换”不成立，t33 文档应等待 t31 修复并补测后再进入；F2 为 low，可同批处理；I1 需要基线或明确接受替代证据。线上 GUI / 真实 client bundle / 窄窗仍须重启后人工验收，本结论不把“待重启”写成已验证。

---

## 追加（v0.6.0 二次验收，2026-10-23）：F1/F2 关闭确认 + I1 基线裁定（t35）

> 任务：`t35 [verify]`，attempt `2e2f43ab-6ee3-4e49-b999-a9b042324489`；依赖 t34。
> 本轮只追加本文档；未修改生产代码、`package.json`、locale、README、final-report；未安装/升级/重启；未写真实用户技能；未永久删除任何文件。

### 0. 结论

**verdict：pass（源码级；t33 文档可继续）。**

t34 对 F1/F2 的修复独立复现通过；I1 按“无 pre-t31 逐字节基线”的实际情况裁定为**接受替代证据**（未发现变更，非逐字节证明），并把 t34 的 [docs/v0.6.0-sha256.txt](v0.6.0-sha256.txt)（30 条，逐行校验 30/30 OK）记录为后续比对基准。全量回归 215/215、check-client 17/17、client 13/13、四套 e2e 32/32/21/21/10/10/7/7、49 文件语法 0 失败、verify exit 0、locale 298/298。

未改变的边界：真实 GUI 视觉/焦点、真实 client bundle 加载、真实 React 崩溃恢复、窄窗换行仍须重启后人工验收；本轮不把“待重启”写成已验证。

### 1. F1 关闭确认：Boundary 随 active Tab 重新挂载

代码：

- `client.js:2519`：`h(Boundary, { key: active, t: t }, h(ActivePage, ...))`；`active` 是 normalized tab id（`translate`/`plugins`/`skills`）。
- `client.js:2442-2465`：Boundary 仍是 `state.failed` + `getDerivedStateFromError`；没有另加重置代码，依靠 React key 变化强制卸载/重建。

独立探针（`/tmp/t35-probe.mjs`，加载生产 `client.js`，不是复用 t34 的输出）：

```json
{
  "default_tab_controls": ["sdzh-panel-translate", null, null],
  "default_panel": {"id":"sdzh-panel-translate","labelledby":"sdzh-tab-translate","role":"tabpanel"},
  "default_boundary_key": "translate",
  "crashed_boundary_falls_back": true,
  "direct_reuse_still_failed": true,
  "plugin_tab_controls": [null, "sdzh-panel-plugins", null],
  "plugin_panel": {"id":"sdzh-panel-plugins","labelledby":"sdzh-tab-plugins"},
  "plugin_boundary_key": "plugins",
  "remounted_renders_child": true,
  "keys_differ": true,
  "verdict": "PASS"
}
```

解释：

- 同一 key 的旧 Boundary 实例在 `state.failed=true` 后仍渲染 fallback（`direct_reuse_still_failed:true`），这是错误边界的正常行为，也是 t32 F1 的根因。
- 但对外层 Boundary 而言，切 Tab 时 `key` 从 `translate` 变为 `plugins`（`keys_differ:true`），React 会卸载旧实例并新建 `state.failed=false` 的实例；`remounted_renders_child:true` 表明新 Tab 直接渲染子页，不再 STUCK_FALLBACK。
- 结论：F1 关闭。探针只覆盖“key 变化导致重建”的机制；真实 React 下的完整点击/错误边界行为仍列入待重启/人工验收（不伪称浏览器实测）。

### 2. F2 关闭确认：只有 active tab 带 aria-controls

代码：

- `client.js:2504-2508`：先构造 `tabProps`，仅 `if (selected) tabProps['aria-controls'] = 'sdzh-panel-' + active`；非激活 tab 不写该属性。
- `client.js:2512-2517`：仍渲染唯一 active `tabpanel`，`id=sdzh-panel-<active>`、`role=tabpanel`、`aria-labelledby=sdzh-tab-<active>`、`tabIndex=0`。

独立探针输出（同一 `/tmp/t35-probe.mjs`）：

- 默认 translate：tabs 的 `aria-controls` = `["sdzh-panel-translate", null, null]`；panel id/labelledby 分别为 `sdzh-panel-translate` / `sdzh-tab-translate`。
- 切到 plugins：`[null, "sdzh-panel-plugins", null]`；panel id/labelledby 分别为 `sdzh-panel-plugins` / `sdzh-tab-plugins`。
- 非激活 tab 的 `aria-controls` 为 `null`（属性不存在），不再指向未挂载节点；`role=tab`/`aria-selected`/`tabIndex` 未回退。

结论：F2 关闭（low 级悬空引用已消除）。check-client 的 tabs 检查同步为 active-only + `Boundary key=active`，17/17；client 单测新增 key/切换重建断言，13/13。

### 3. I1 裁定：无 pre-t31 逐字节基线，接受替代证据

事实：

- t31 的 `team.json` output、acceptanceResults 与 `/tmp` 均无 pre-t31 的 lib/scripts sha256 清单；t31 快照目录只含 6 个改动文件（client.js、locale×2、package.json、check-client.mjs、test/client.test.mjs），没有 `lib/`。因此**无法**做“t31 报告基线”的逐字节比对，本轮不伪称逐字节 pass。
- t34 新建 [docs/v0.6.0-sha256.txt](v0.6.0-sha256.txt)，共 30 行（lib 19 + scripts 11），格式 `<sha256>  <path>`；独立执行 `sha256sum -c` → exit 0、30 条 `: OK`、0 条 FAILED。该文件是**t34 之后**的基准，不是 t31 前基线，不能倒推证明 t31 未改 lib。

替代证据（独立复核，均未发现变更）：

1. `lib/*.js` 最新 mtime 为 `2026-10-22T21:27:43`，全部早于 t31 开始时间 `2026-10-23T12:52`。
2. `grep -R "0.6.0\|BetterSkill\|activeTab\|settings.section" lib/` 无匹配；lib 仍是 0.5.0 时代代码。
3. `package.json` 与 t31 快照 `2026-10-23T04-51-20-725Z/package.json` 的 diff 仅 `"version": "0.5.0" → "0.6.0"`；exports/dsh/files 未动。
4. `cordis.patch.yml` mtime `2026-10-21T22:14:09`、sha256 `bb65365e…`；`find lib scripts -newermt "2026-10-23 12:00"` 仅输出 `scripts/check-client.mjs`（t31 明确修改项）。
5. t31 `changedPaths` 仅 client.js、locale/zh.json、locale/en.json、package.json、scripts/check-client.mjs、test/client.test.mjs。

**裁定：接受替代证据（未发现变更，非逐字节证明）**。`docs/v0.6.0-sha256.txt` 作为后续 t33/t35 之后的比对基准；若未来需要严格证明 t31 的 lib 不变，只能依赖 t31 当时未留下的基线之外的文件系统快照，当前不具备。

### 4. 全量复跑（独立数字）

| 命令 | 结果 |
| --- | --- |
| `npm test` | tests 215 / pass 215 / fail 0 / duration 378.540 ms（Node v24.20.0） |
| `node scripts/check-client.mjs` | 17 checks passed；tabs 行明确含 active-only aria-controls + `Boundary key=active` |
| `node --test test/client.test.mjs` | 13 tests / 13 pass / 0 fail |
| `node scripts/skills-e2e.mjs` | 32 项断言全部通过 |
| `npm run e2e:plugin-admin` | 21/21 |
| `npm run e2e:commands` | 10/10 |
| `npm run e2e:agent-layer` | 7/7 |
| `node --check`（lib 18 + scripts 11 + test 17 + client + 2 helpers） | CHECKED=49，FAILURES=0 |
| `node scripts/verify.mjs --expect-installed --expect-applied` | exit 0；49 文件无永久删除、trash 通道、4 影子、profile link+bundle、state 12 |
| locale 独立比对 | zh 298 / en 298 / missing 0 / extra 0 / dup 0；tabs.label 功能区/Sections |
| `sha256sum -c docs/v0.6.0-sha256.txt` | 30/30 OK，0 FAILED，exit 0 |
| `/tmp/t35-probe.mjs` | F1/F2 PASS（见 §1/§2） |

### 5. A 表（本轮）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| A1 F1 Boundary 重置 | pass（源码+探针） | key=active；REMOUNTED；真实 React 待重启 |
| A2 F2 active-only aria-controls | pass（源码+探针） | `["translate",null,null]` → `[null,"plugins",null]` |
| A3 全量测试/语法 | pass | 215/215；49 文件 0 失败 |
| A4 check-client/client 单测 | pass | 17/17；13/13 |
| A5 四套 e2e | pass | 32/32、21/21、10/10、7/7 |
| A6 verify 安装/trash/影子 | pass | exit 0，49 文件 |
| A7 locale 298 同键 | pass | 298/298，0 missing/extra/dup |
| A8 t34 基线文件 | pass（作为后续基准） | 30 行，30/30 OK |
| A9 t31 pre-baseline 逐字节比对 | 未验证（I1） | 基线缺失；接受替代证据，非逐字节证明 |
| A10 待重启 GUI 验收 | 待重启 | 视觉/焦点/真实 bundle/窄窗/真实 React 崩溃恢复 |
| A11 只追加文档/无生产改动 | pass | 仅 docs/verification.md |

### 6. 未验证 / 待重启

1. 真实 GUI：单入口“Better Skill”、三 Tab 视觉、焦点顺序、窄窗换行/横向滚动。
2. 真实 React 下点击/键盘切换、Tab A 崩溃后切 Tab B 的实际恢复（本轮为 key 机制探针，不是浏览器实测）。
3. 真实 client bundle 加载、locale 注入、重启后 settings.section 只出现一次。
4. 真实 `/skills`、`/plugins` HTTP 认证与写操作；真实技能编辑/删除/恢复。
5. A9 的 t31 pre-baseline 逐字节证明（不可补）。

### 7. 回滚

- 本轮只追加本文档；未改生产代码/package/locale/state。
- 文档快照：`~/.dsh/.file-backups/2026-10-23T05-02-08-826Z/verification.md`。
- 停用/移除：`skill_desc_zh(action="restore")` → `plugin_manager set_plugin target="include:skill-desc-zh" enabled=false`；彻底移除先 restore 再 `remove_bundle`。
- 无 `.git`；覆盖前 `trash.mjs --snapshot`；删除只走 `node ~/.dsh/skills/safe-delete-trash/trash.mjs`。

### 8. 终审

**verdict：pass（源码级，t33 文档可继续）**。F1/F2 已关闭；I1 以“接受替代证据（未发现变更，非逐字节证明）”结案，并把 t34 的 30 条 SHA 清单作为后续基准；全量回归全绿。线上 GUI/真实 bundle/真实写操作仍须重启后验收，本结论不把“待重启”写成已验证。
