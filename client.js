(function () {
  'use strict';

  window.__ModuleLoader__.load({
    id: 'dsh-skill-desc-zh',
    factory(require) {
      var module = { exports: {} };
      var React = require('react');
      var h = React.createElement;
      var Component = React.Component;
      var useCallback = React.useCallback;
      var useEffect = React.useEffect;
      var useMemo = React.useMemo;
      var useRef = React.useRef;
      var useState = React.useState;

      var NS = 'skill-desc-zh';
      var API_BASE = '/plugins/skill-desc-zh';
      var PAGE_ORDER = 16;
      var PAGE_VERSION = '0.6.0';
      var ACTIONS = ['apply', 'restore', 'refresh', 'retranslate', 'doctor'];
      var TAB_STORAGE_KEY = 'dsh-skill-desc-zh.activeTab';
      var TABS = [
        { id: 'translate', labelKey: 'title' },
        { id: 'plugins', labelKey: 'plugins.nav' },
        { id: 'skills', labelKey: 'skills.nav' }
      ];
      var TAB_IDS = TABS.map(function (item) { return item.id; });
      var TAB_LABELS = {};
      TABS.forEach(function (item) { TAB_LABELS[item.id] = item.labelKey; });

      function normalizeTabId(value) {
        return TAB_IDS.indexOf(value) >= 0 ? value : 'translate';
      }

      function defaultTabStorage() {
        try {
          return typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null;
        } catch (error) {
          return null;
        }
      }

      function readStoredTab(storage) {
        try {
          var target = storage && typeof storage.getItem === 'function' ? storage : defaultTabStorage();
          if (!target) return 'translate';
          return normalizeTabId(target.getItem(TAB_STORAGE_KEY));
        } catch (error) {
          return 'translate';
        }
      }

      function writeStoredTab(a, b) {
        var tab = typeof a === 'string' ? a : b;
        var storage = typeof a === 'string' ? b : a;
        if (TAB_IDS.indexOf(tab) < 0) return false;
        try {
          var target = storage && typeof storage.setItem === 'function' ? storage : defaultTabStorage();
          if (!target) return false;
          target.setItem(TAB_STORAGE_KEY, tab);
          return true;
        } catch (error) {
          return false;
        }
      }

      function selectInitialTab(storage) {
        return readStoredTab(storage);
      }

      function nextTabId(current, key) {
        var code = key && typeof key === 'object' ? key.key : key;
        var index = TAB_IDS.indexOf(normalizeTabId(current));
        if (code === 'Home') return TAB_IDS[0];
        if (code === 'End') return TAB_IDS[TAB_IDS.length - 1];
        if (code === 'ArrowRight') return TAB_IDS[(index + 1) % TAB_IDS.length];
        if (code === 'ArrowLeft') return TAB_IDS[(index - 1 + TAB_IDS.length) % TAB_IDS.length];
        return TAB_IDS[index];
      }

      var DICT = {
        "zh": {
          "nav": "Better Skill",
          "tabs.label": "功能区",
          "title": "技能描述中文化",
          "subtitle": "自动把技能与斜杠命令描述翻译为中文；还原时只删除本插件的影子与缓存，不改动原始技能。",
          "phase.booting": "启动中",
          "phase.active": "已启用",
          "phase.degraded": "降级运行",
          "phase.stale": "待更新",
          "phase.restored": "已还原",
          "phase.failed": "失败",
          "phase.unknown": "未知",
          "summary.skills": "技能",
          "summary.commands": "命令",
          "summary.host": "宿主版本",
          "summary.project": "项目根",
          "summary.warnings": "警告",
          "summary.none": "无",
          "summary.engine": "翻译引擎",
          "summary.lastAction": "最近动作",
          "toggle.label": "启用技能描述中文化",
          "toggle.hint": "关闭会还原项目影子并让 provider 返回英文；再次开启会重新捕获、翻译并建立影子。",
          "toggle.on": "已启用",
          "toggle.off": "已还原",
          "action.apply": "应用",
          "action.restore": "还原",
          "action.refresh": "刷新",
          "action.retranslate": "重译",
          "action.doctor": "自检",
          "action.running": "正在执行",
          "action.done": "{action}完成",
          "action.failed": "{action}失败",
          "confirm.title": "确认操作",
          "confirm.restore": "将把影子技能目录移入废纸篓，并让 provider 恢复英文原文。原始技能与用户文件不会被改动。",
          "confirm.retranslate": "将忽略已有中文缓存，重新调用模型翻译全部技能与命令；失败时回退词典或英文。",
          "confirm.apply": "将重新捕获技能定义，按当前指纹翻译，并按需建立项目影子。",
          "confirm.cancel": "取消",
          "confirm.ok": "确认执行",
          "table.title": "覆盖清单",
          "table.name": "名称",
          "table.layer": "层",
          "table.source": "来源",
          "table.current": "当前",
          "table.engine": "引擎",
          "table.stale": "过期",
          "table.shadow": "影子",
          "table.note": "说明",
          "group.global": "global 层 · provider 覆盖（office 系列 + browser-skill）",
          "group.preset": "preset 层 · 项目影子（4 个 agent-preset）",
          "group.command": "命令 · agent 作用域影子（3 个斜杠命令）",
          "layer.global": "global",
          "layer.preset": "preset",
          "layer.agent": "agent",
          "current.zh": "中文",
          "current.en": "英文",
          "current.pending": "待翻译",
          "current.missing": "缺失",
          "engine.llm": "LLM",
          "engine.dictionary": "词典",
          "engine.source": "原文中文",
          "engine.none": "无",
          "engine.unknown": "未知",
          "state.title": "运行状态",
          "state.enabled": "启用状态",
          "state.enabledOn": "已启用",
          "state.enabledOff": "已还原",
          "state.projectSource": "项目根来源",
          "state.projectSourceArg": "请求指定",
          "state.projectSourceExplicit": "请求指定",
          "state.projectSourceState": "状态记录",
          "state.projectSourceSession": "会话项目",
          "state.projectSourceCwd": "工作目录",
          "state.projectSourceManual": "会话工作目录",
          "state.projectSourceNone": "未确定",
          "state.projectAllowed": "项目在允许范围内",
          "state.projectNotAllowed": "项目不在允许范围，不建立影子",
          "state.ready": "provider 就绪",
          "state.notReady": "provider 未就绪",
          "state.noTargets": "尚未捕获到目标技能",
          "state.checksRequired": "必需检查",
          "state.checksOptional": "可选检查",
          "doctor.title": "自检",
          "doctor.run": "运行自检",
          "doctor.ok": "通过",
          "doctor.failed": "失败",
          "doctor.checks": "检查项",
          "doctor.limitations": "限制",
          "doctor.empty": "尚未运行自检",
          "events.title": "最近事件",
          "events.empty": "暂无事件记录",
          "events.lastAction": "最近动作",
          "events.action": "动作",
          "events.ok": "结果",
          "events.failed": "失败",
          "config.title": "只读配置",
          "config.version": "插件版本",
          "config.api": "Host API",
          "config.targets": "目标配置",
          "config.allowlist": "项目允许列表",
          "config.restoreOnQuit": "退出时还原",
          "config.model": "模型",
          "config.stateFile": "状态文件",
          "config.eventsFile": "事件日志",
          "config.hostOnly": "配置字段",
          "config.hostOnlyHint": "项目允许列表、退出还原与 LLM 路由由 Host 配置提供；当前状态接口未返回这些字段。",
          "config.unavailable": "Host 尚未提供此字段；请确认已重启加载 0.3.0。",
          "notices.title": "提示",
          "notices.none": "没有警告。",
          "notices.restart": "设置页需要重启后才能完全加载",
          "notices.restartHint": "若页面显示“未就绪”，请重启 DSH 并重新打开设置；本页不会影响宿主与工具。",
          "notices.degraded": "部分技能使用词典或英文，翻译质量可能降低。",
          "notices.failed": "本次启动未能提供中文；页面与工具保持可用，修复后可重试。",
          "notices.stale": "检测到技能定义变化，正在或需要重新翻译。",
          "notices.restored": "已还原英文原文；项目影子已移除。",
          "notices.restoredHint": "点击“应用”可重新建立中文覆盖。",
          "notices.busy": "有其它设置操作正在执行，请稍后重试。",
          "notices.readOnly": "只读状态：设置页不会修改宿主配置。",
          "notices.scope": "覆盖 8 个全局技能（office ×7 + browser-skill）、4 个 agent-preset 影子技能和 3 个斜杠命令。",
          "error.title": "无法读取状态",
          "error.unavailable": "设置页后端不可用",
          "error.unauthorized": "认证失败",
          "error.forbidden": "来源被拒绝",
          "error.busy": "有操作正在执行",
          "error.timeout": "请求超时",
          "error.network": "网络或 Host 连接失败",
          "error.unknown": "未知错误",
          "error.retry": "重试",
          "error.details": "详情",
          "meta.title": "技能描述中文化",
          "meta.description": "在设置中管理技能与命令的中文描述。",
          "footer.hint": "设置页只展示状态与触发动作；所有文件改动由 Host 半执行，并记录到事件日志。",
          "footer.version": "设置页版本 {version}",
          "copy": "复制",
          "copied": "已复制",
          "close": "关闭",
          "yes": "是",
          "no": "否",
          "unknown": "未知",
          "plugins.nav": "插件管理",
          "plugins.title": "插件管理",
          "plugins.subtitle": "列出当前 profile 的第三方插件，检查 npm 更新并一键更新。启用/禁用、卸载请到「设置 → 插件」页。",
          "plugins.readonlyHint": "本页只更新已安装的第三方插件；官方 bundle 与本地 link 插件不参与更新，也不会写入 profile 的任何豁免白名单。",
          "plugins.loading": "正在读取插件列表…",
          "plugins.profile": "profile",
          "plugins.profileDir": "profile 目录",
          "plugins.registry": "registry",
          "plugins.hostManager": "宿主 pluginManager",
          "plugins.hostManagerOn": "可用（保留宿主兼容性闸门与构建脚本批准）",
          "plugins.hostManagerOff": "不可用（需要重启 DSH 加载 0.4.0）",
          "plugins.count": "第三方插件",
          "plugins.updates": "可更新",
          "plugins.official": "官方 bundle",
          "plugins.checkedAt": "检查时间",
          "plugins.check": "检查更新",
          "plugins.checking": "检查中…",
          "plugins.refresh": "刷新",
          "plugins.empty": "当前 profile 没有可管理的第三方插件。",
          "plugins.warning": "警告",
          "plugins.busy": "正在更新 {name}…",
          "plugins.update": "更新",
          "plugins.updating": "更新中…",
          "plugins.updateRestart": "更新完成。宿主提示需要重启 DSH 后生效。",
          "plugins.selfLabel": "当前插件（link: 安装，不参与更新）",
          "plugins.localLabel": "本地安装，不参与更新",
          "plugins.colName": "插件",
          "plugins.colVersion": "版本",
          "plugins.colSource": "来源",
          "plugins.colState": "状态",
          "plugins.stateEnabled": "已启用",
          "plugins.stateDisabled": "已禁用",
          "plugins.stateAvailable": "可更新 → v{version}",
          "plugins.stateLatest": "已是最新",
          "plugins.stateNotUpdateable": "不参与更新",
          "plugins.stateCheckFailed": "检查失败",
          "plugins.stateMissing": "缺失",
          "plugins.dialogTitle": "确认更新插件",
          "plugins.dialogBody": "将把 {name} 从 v{from} 更新到 v{to}。更新由宿主 pluginManager 执行（含兼容性与构建脚本闸门）；若新版本仍在供应链隔离期内会被拒绝并提示。更新后可能需要重启 DSH。",
          "plugins.dialogCancel": "取消",
          "plugins.dialogConfirm": "确认更新",
          "plugins.noticeFailure": "更新 {name} 失败：{message}",
          "plugins.noticeSuccess": "{name} 已更新到 v{version}。",
          "plugins.noticeRestart": "请重启 DSH 使新版本完全生效。",
          "plugins.updateUnavailable": "本页需要重启 DSH 后才能加载（0.4.0 未生效）。",
          "plugins.managerRequired": "宿主 pluginManager 不可用，无法执行更新",
          "plugins.updatesAvailable": "有 {count} 个更新",
          "plugins.allUpToDate": "全部为最新",
          "plugins.source.npm": "npm",
          "plugins.source.local": "本地（link/file）",
          "plugins.source.workspace": "workspace",
          "plugins.source.git": "git",
          "plugins.source.tarball": "tarball/URL",
          "plugins.source.unknown": "未知",
          "plugins.noticeCheckFailed": "检查更新失败：{message}",
          "plugins.loadingHint": "正在检查 registry 上的最新版本（只读，不会自动更新）。",
          "plugins.restartNote": "更新动作由宿主 pluginManager 执行；本页不会写 profile 配置文件。",
          "target.kind.skill": "技能",
          "target.kind.command": "命令",
          "target.current": "当前",
          "target.sourcePath": "来源路径",
          "target.shadowPath": "影子路径",
          "target.note": "说明",
          "status.phase": "阶段",
          "status.busy": "忙碌",
          "status.updatedAt": "更新时间",
          "status.stale": "过期",
          "status.missing": "缺失",
          "status.pending": "待处理",
          "status.engineCounts": "引擎统计",
          "status.actions": "可用动作",
          "status.enabled": "已启用",
          "status.disabled": "已停用"
        },
        "en": {
          "nav": "Better Skill",
          "tabs.label": "Sections",
          "title": "Skill descriptions in Chinese",
          "subtitle": "Automatically translates skill and slash-command descriptions into Chinese. Restoring only removes this plugin's shadows and cache; original skills are never modified.",
          "phase.booting": "Starting",
          "phase.active": "Active",
          "phase.degraded": "Degraded",
          "phase.stale": "Needs refresh",
          "phase.restored": "Restored",
          "phase.failed": "Failed",
          "phase.unknown": "Unknown",
          "summary.skills": "Skills",
          "summary.commands": "Commands",
          "summary.host": "Host version",
          "summary.project": "Project root",
          "summary.warnings": "Warnings",
          "summary.none": "None",
          "summary.engine": "Translation engine",
          "summary.lastAction": "Last action",
          "toggle.label": "Enable Chinese skill descriptions",
          "toggle.hint": "Turning this off restores project shadows and makes the provider return English. Turning it on captures, translates, and recreates shadows.",
          "toggle.on": "Enabled",
          "toggle.off": "Restored",
          "action.apply": "Apply",
          "action.restore": "Restore",
          "action.refresh": "Refresh",
          "action.retranslate": "Retranslate",
          "action.doctor": "Doctor",
          "action.running": "Running",
          "action.done": "{action} finished",
          "action.failed": "{action} failed",
          "confirm.title": "Confirm action",
          "confirm.restore": "This moves shadow skill directories to the Trash and makes the provider return English. Original skills and user files are not changed.",
          "confirm.retranslate": "This ignores existing Chinese cache and translates every skill and command again. Failures fall back to the dictionary or English.",
          "confirm.apply": "This captures skill definitions again, translates by current fingerprints, and creates project shadows where needed.",
          "confirm.cancel": "Cancel",
          "confirm.ok": "Run",
          "table.title": "Coverage",
          "table.name": "Name",
          "table.layer": "Layer",
          "table.source": "Source",
          "table.current": "Current",
          "table.engine": "Engine",
          "table.stale": "Stale",
          "table.shadow": "Shadow",
          "table.note": "Note",
          "group.global": "Global layer · provider override (office skills + browser-skill)",
          "group.preset": "preset layer · project shadows (4 agent-preset skills)",
          "group.command": "Commands · agent-scoped shadows (3 slash commands)",
          "layer.global": "global",
          "layer.preset": "preset",
          "layer.agent": "agent",
          "current.zh": "Chinese",
          "current.en": "English",
          "current.pending": "Pending",
          "current.missing": "Missing",
          "engine.llm": "LLM",
          "engine.dictionary": "Dictionary",
          "engine.source": "Source is Chinese",
          "engine.none": "None",
          "engine.unknown": "Unknown",
          "state.title": "Runtime status",
          "state.enabled": "Enabled state",
          "state.enabledOn": "Enabled",
          "state.enabledOff": "Restored",
          "state.projectSource": "Project root source",
          "state.projectSourceArg": "Request value",
          "state.projectSourceExplicit": "Request value",
          "state.projectSourceState": "Recorded state",
          "state.projectSourceSession": "Session project",
          "state.projectSourceCwd": "Working directory",
          "state.projectSourceManual": "Session working directory",
          "state.projectSourceNone": "Unresolved",
          "state.projectAllowed": "Project is allowed",
          "state.projectNotAllowed": "Project is outside the allowlist; no shadow will be created",
          "state.ready": "Provider ready",
          "state.notReady": "Provider not ready",
          "state.noTargets": "No target skills captured yet",
          "state.checksRequired": "Required checks",
          "state.checksOptional": "Optional checks",
          "doctor.title": "Doctor",
          "doctor.run": "Run doctor",
          "doctor.ok": "Pass",
          "doctor.failed": "Fail",
          "doctor.checks": "Checks",
          "doctor.limitations": "Limitations",
          "doctor.empty": "Doctor has not run yet",
          "events.title": "Recent events",
          "events.empty": "No events recorded",
          "events.lastAction": "Last action",
          "events.action": "Action",
          "events.ok": "Result",
          "events.failed": "Failed",
          "config.title": "Read-only configuration",
          "config.version": "Plugin version",
          "config.api": "Host API",
          "config.targets": "Target configuration",
          "config.allowlist": "Project allowlist",
          "config.restoreOnQuit": "Restore on quit",
          "config.model": "Model",
          "config.stateFile": "State file",
          "config.eventsFile": "Event log",
          "config.hostOnly": "Configuration fields",
          "config.hostOnlyHint": "Project allowlist, restore-on-quit, and LLM routing are provided by Host configuration; the current state endpoint does not expose them.",
          "config.unavailable": "The host does not provide this field yet. Make sure 0.3.0 has been loaded after a restart.",
          "notices.title": "Notices",
          "notices.none": "No warnings.",
          "notices.restart": "The settings page needs a restart to load completely",
          "notices.restartHint": "If this page says it is not ready, restart DSH and reopen settings. The page never affects the host or the tools.",
          "notices.degraded": "Some descriptions use the dictionary or English; translation quality may be lower.",
          "notices.failed": "Chinese descriptions could not be served on this start. The page and tools remain usable; retry after fixing the cause.",
          "notices.stale": "Skill definitions changed; a retranslation is running or needed.",
          "notices.restored": "English descriptions have been restored and project shadows removed.",
          "notices.restoredHint": "Choose Apply to create the Chinese overlay again.",
          "notices.busy": "Another settings action is running. Try again shortly.",
          "notices.readOnly": "Read-only status: this page does not modify host configuration.",
          "notices.scope": "Covers 8 global skills (7 office + browser-skill), 4 agent-preset shadow skills, and 3 slash commands.",
          "error.title": "Unable to read status",
          "error.unavailable": "Settings backend unavailable",
          "error.unauthorized": "Authentication failed",
          "error.forbidden": "Origin rejected",
          "error.busy": "An action is already running",
          "error.timeout": "Request timed out",
          "error.network": "Network or host connection failed",
          "error.unknown": "Unknown error",
          "error.retry": "Retry",
          "error.details": "Details",
          "meta.title": "Skill descriptions in Chinese",
          "meta.description": "Manage Chinese descriptions for skills and commands in Settings.",
          "footer.hint": "This page only shows status and triggers actions. The host performs file changes and records them in the event log.",
          "footer.version": "Settings page version {version}",
          "copy": "Copy",
          "copied": "Copied",
          "close": "Close",
          "yes": "Yes",
          "no": "No",
          "unknown": "Unknown",
          "plugins.nav": "Plugins",
          "plugins.title": "Plugin manager",
          "plugins.subtitle": "List third-party plugins in the current profile, check npm updates, and update in one click. Enable/disable and uninstall live in Settings → Plugins.",
          "plugins.readonlyHint": "This page only updates already-installed third-party plugins. Official bundles and local link plugins are never updated, and no release-age exemption is ever written to the profile.",
          "plugins.loading": "Loading plugins…",
          "plugins.profile": "Profile",
          "plugins.profileDir": "Profile directory",
          "plugins.registry": "Registry",
          "plugins.hostManager": "Host pluginManager",
          "plugins.hostManagerOn": "Available (host compatibility gate and build approval stay in force)",
          "plugins.hostManagerOff": "Unavailable (restart DSH to load 0.4.0)",
          "plugins.count": "Third-party plugins",
          "plugins.updates": "Updates",
          "plugins.official": "Official bundles",
          "plugins.checkedAt": "Checked at",
          "plugins.check": "Check for updates",
          "plugins.checking": "Checking…",
          "plugins.refresh": "Refresh",
          "plugins.empty": "No manageable third-party plugins in the current profile.",
          "plugins.warning": "Warnings",
          "plugins.busy": "Updating {name}…",
          "plugins.update": "Update",
          "plugins.updating": "Updating…",
          "plugins.updateRestart": "Updated. DSH prompts that a restart is required.",
          "plugins.selfLabel": "This plugin (link: install, never updated)",
          "plugins.localLabel": "Local install, never updated",
          "plugins.colName": "Plugin",
          "plugins.colVersion": "Version",
          "plugins.colSource": "Source",
          "plugins.colState": "State",
          "plugins.stateEnabled": "Enabled",
          "plugins.stateDisabled": "Disabled",
          "plugins.stateAvailable": "Update available → v{version}",
          "plugins.stateLatest": "Up to date",
          "plugins.stateNotUpdateable": "Not updated here",
          "plugins.stateCheckFailed": "Check failed",
          "plugins.stateMissing": "Missing",
          "plugins.dialogTitle": "Update plugin",
          "plugins.dialogBody": "Update {name} from v{from} to v{to}? The host pluginManager performs the update (compatibility gate and build-script approval included); a version still inside the supply-chain release-age window is refused with a message. DSH may need a restart afterwards.",
          "plugins.dialogCancel": "Cancel",
          "plugins.dialogConfirm": "Update",
          "plugins.noticeFailure": "Failed to update {name}: {message}",
          "plugins.noticeSuccess": "{name} was updated to v{version}.",
          "plugins.noticeRestart": "Restart DSH so the new version takes effect.",
          "plugins.updateUnavailable": "This page needs a DSH restart to load (0.4.0 not active).",
          "plugins.managerRequired": "Host pluginManager is unavailable, cannot update",
          "plugins.updatesAvailable": "{count} update(s) available",
          "plugins.allUpToDate": "Everything is up to date",
          "plugins.source.npm": "npm",
          "plugins.source.local": "Local (link/file)",
          "plugins.source.workspace": "workspace",
          "plugins.source.git": "git",
          "plugins.source.tarball": "tarball/URL",
          "plugins.source.unknown": "Unknown",
          "plugins.noticeCheckFailed": "Update check failed: {message}",
          "plugins.loadingHint": "Checking latest versions on the registry (read-only, never updates automatically).",
          "plugins.restartNote": "Updates are performed by the host pluginManager; this page never writes profile configuration files.",
          "target.kind.skill": "Skill",
          "target.kind.command": "Command",
          "target.current": "Current",
          "target.sourcePath": "Source path",
          "target.shadowPath": "Shadow path",
          "target.note": "Note",
          "status.phase": "Phase",
          "status.busy": "Busy",
          "status.updatedAt": "Updated",
          "status.stale": "Stale",
          "status.missing": "Missing",
          "status.pending": "Pending",
          "status.engineCounts": "Engine counts",
          "status.actions": "Available actions",
          "status.enabled": "Enabled",
          "status.disabled": "Disabled"
        }
      };

      // v0.5.0 技能管理页文案（设计 §8.4；表格实际 87 条，不是注释里写的 78 条）
      var SKILL_I18N = [
        ['skills.nav', '技能管理', 'Skill Admin'],
        ['skills.title', '技能管理', 'Skill Admin'],
        ['skills.subtitle', '管理用户级与项目级技能；插件/预设/内置技能只读', 'Manage user and project skills; plugin/preset/builtin skills are read-only'],
        ['skills.refresh', '刷新', 'Refresh'],
        ['skills.new', '新建技能', 'New skill'],
        ['skills.tab.list', '技能', 'Skills'],
        ['skills.tab.trash', '回收站', 'Trash'],
        ['skills.search', '搜索名称或描述', 'Search name or description'],
        ['skills.filter.source', '来源', 'Source'],
        ['skills.filter.status', '状态', 'Status'],
        ['skills.source.all', '全部', 'All'],
        ['skills.source.user', '用户', 'User'],
        ['skills.source.project', '项目', 'Project'],
        ['skills.status.all', '全部', 'All'],
        ['skills.status.enabled', '已启用', 'Enabled'],
        ['skills.status.disabled', '已禁用', 'Disabled'],
        ['skills.badge.user', '用户', 'User'],
        ['skills.badge.project', '项目', 'Project'],
        ['skills.badge.plugin', '插件', 'Plugin'],
        ['skills.badge.preset', '预设', 'Preset'],
        ['skills.badge.bundled', '内置', 'Builtin'],
        ['skills.badge.runtime', '运行时', 'Runtime'],
        ['skills.badge.disabled', '已禁用', 'Disabled'],
        ['skills.badge.translated', '已中文化', 'Translated'],
        ['skills.badge.readonly', '只读', 'Read-only'],
        ['skills.action.edit', '编辑', 'Edit'],
        ['skills.action.disable', '禁用', 'Disable'],
        ['skills.action.enable', '启用', 'Enable'],
        ['skills.action.delete', '删除', 'Delete'],
        ['skills.action.restore', '恢复', 'Restore'],
        ['skills.action.save', '保存', 'Save'],
        ['skills.action.cancel', '取消', 'Cancel'],
        ['skills.action.reload', '重新载入', 'Reload'],
        ['skills.readonly.title', '只读技能（{count}）', 'Read-only skills ({count})'],
        ['skills.readonly.reason.plugin', '安装在插件包内，不能修改', 'Installed inside a plugin package'],
        ['skills.readonly.reason.preset', '由预设提供，不能修改', 'Provided by a preset'],
        ['skills.readonly.reason.bundled', '应用内置，不能修改', 'Bundled with the app'],
        ['skills.readonly.reason.runtime', '运行时注册，不能修改', 'Registered at runtime'],
        ['skills.empty', '没有匹配的技能', 'No matching skills'],
        ['skills.empty.trash', '回收站是空的', 'Trash is empty'],
        ['skills.empty.hint', '试试清空搜索，或新建一个技能', 'Clear the search, or create a skill'],
        ['skills.editor.create.title', '新建技能', 'New skill'],
        ['skills.editor.edit.title', '编辑技能', 'Edit skill'],
        ['skills.editor.name', '名称', 'Name'],
        ['skills.editor.name.hint', '小写字母、数字与连字符，例如 release-notes', 'Lowercase letters, digits and hyphens, e.g. release-notes'],
        ['skills.editor.description', '描述', 'Description'],
        ['skills.editor.description.hint', '单行，最多 400 字；模型据此决定何时使用', 'One line, up to 400 chars; the model uses it to decide when to use'],
        ['skills.editor.body', '正文', 'Body'],
        ['skills.editor.body.hint', 'Markdown；frontmatter 的其它键会原样保留', 'Markdown; other frontmatter keys are preserved'],
        ['skills.editor.unsupported', '该文件的 description 带 YAML 锚点，暂不支持在此编辑', 'This file uses a YAML anchor on description and cannot be edited here'],
        ['skills.delete.title', '删除技能「{name}」？', 'Delete skill “{name}”?'],
        ['skills.delete.body', '将移入 macOS 废纸篓，可在「回收站」中恢复；不会永久删除。', 'It moves to the macOS Trash and can be restored from Trash. Nothing is permanently deleted.'],
        ['skills.delete.folder', '目录：{dir}', 'Folder: {dir}'],
        ['skills.trash.title', '回收站', 'Trash'],
        ['skills.trash.deletedAt', '删除时间', 'Deleted'],
        ['skills.trash.size', '大小', 'Size'],
        ['skills.trash.restoreBody', '恢复到 {to}', 'Restore to {to}'],
        ['skills.trash.missing', '废纸篓里已找不到该条目（可能被系统清理）', 'The item is no longer in the Trash'],
        ['skills.trash.note', '仅显示本插件删除的记录；恢复依赖删除时记录的路径（系统废纸篓内容不可浏览）', 'Only records deleted by this plugin are shown; restore relies on the path recorded at deletion (the system Trash cannot be browsed)'],
        ['skills.conflict.title', '文件已被外部修改', 'File changed on disk'],
        ['skills.conflict.body', '保存前文件被其它程序改动，请重新载入后重试。', 'The file changed before saving. Reload and try again.'],
        ['skills.conflict.current', '当前指纹：{fingerprint}', 'Current fingerprint: {fingerprint}'],
        ['skills.notice.saved', '已保存', 'Saved'],
        ['skills.notice.created', '已创建', 'Created'],
        ['skills.notice.deleted', '已移入废纸篓', 'Moved to Trash'],
        ['skills.notice.restored', '已恢复', 'Restored'],
        ['skills.notice.disabled', '已禁用（不改源文件）', 'Disabled (source file unchanged)'],
        ['skills.notice.enabled', '已启用', 'Enabled'],
        ['skills.notice.refreshed', '列表已刷新', 'List refreshed'],
        ['skills.stats.user', '用户技能', 'User skills'],
        ['skills.stats.project', '项目技能', 'Project skills'],
        ['skills.stats.readonly', '只读', 'Read-only'],
        ['skills.stats.disabled', '已禁用', 'Disabled'],
        ['skills.stats.trash', '回收站', 'Trash'],
        ['skills.project.none', '当前没有项目（只显示用户技能）', 'No project detected (user skills only)'],
        ['skills.error.title', '技能管理加载失败', 'Failed to load Skill Admin'],
        ['skills.error.bad-request', '请求参数不合法', 'Invalid request'],
        ['skills.error.invalid', '名称或描述不合法', 'Invalid name or description'],
        ['skills.error.too-large', '内容超过 256 KiB', 'Content exceeds 256 KiB'],
        ['skills.error.unsupported-source', '该技能来源只读，不能这样操作', 'This skill is read-only'],
        ['skills.error.unsupported-frontmatter', 'frontmatter 含锚点，无法安全编辑', 'Frontmatter uses anchors and cannot be edited safely'],
        ['skills.error.not-found', '技能不存在或已被删除', 'The skill no longer exists'],
        ['skills.error.conflict', '冲突：文件已被修改或目标已存在', 'Conflict: file changed or target already exists'],
        ['skills.error.busy', '另一个操作正在进行，请稍候', 'Another operation is running'],
        ['skills.error.not-writable', '目录不可写', 'Directory is not writable'],
        ['skills.error.trash-unavailable', '系统废纸篓不可用', 'The system Trash is unavailable'],
        ['skills.error.network', '无法连接到宿主', 'Cannot reach the host'],
        ['skills.error.unknown', '未知错误', 'Unknown error']
      ];
      for (var skillIndex = 0; skillIndex < SKILL_I18N.length; skillIndex += 1) {
        DICT.zh[SKILL_I18N[skillIndex][0]] = SKILL_I18N[skillIndex][1];
        DICT.en[SKILL_I18N[skillIndex][0]] = SKILL_I18N[skillIndex][2];
      }

      function translate(locale, key, params) {
        var dict = DICT[locale] || DICT.zh;
        var template = dict[key];
        if (template === undefined) template = DICT.en[key];
        if (template === undefined) template = key;
        if (!params) return template;
        return template.replace(/\{(\w+)\}/g, function (match, name) {
          return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
        });
      }

      function createApi(fetchImpl, base) {
        var endpoint = base || API_BASE;
        var doFetch = fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

        async function request(path, init) {
          if (!doFetch) {
            var missing = new Error('fetch is unavailable');
            missing.code = 'unavailable';
            throw missing;
          }
          var response;
          try {
            response = await doFetch(endpoint + path, Object.assign({
              credentials: 'same-origin',
              cache: 'no-store'
            }, init || {}));
          } catch (error) {
            if (error && error.name === 'AbortError') throw error;
            var network = new Error(error && error.message ? error.message : 'network error');
            network.code = 'network';
            network.cause = error;
            throw network;
          }
          var body = null;
          try { body = await response.json(); } catch (error) { body = null; }
          if (!response.ok) {
            var nested = body && body.error && typeof body.error === 'object' ? body.error : null;
            var message = (nested && nested.message) || (body && typeof body.error === 'string' ? body.error : '') || (body && body.message) || ('HTTP ' + response.status);
            var failure = new Error(message);
            failure.status = response.status;
            failure.code = (nested && (nested.code || nested.type)) || (body && (typeof body.error === 'string' ? body.error : body.code));
            failure.body = body;
            throw failure;
          }
          return body || {};
        }

        function queryString(projectRoot) {
          return projectRoot ? ('?projectRoot=' + encodeURIComponent(projectRoot)) : '';
        }

        return {
          getState: function (options) {
            var opts = options || {};
            return request('/state' + queryString(opts.projectRoot), opts.signal ? { signal: opts.signal } : undefined);
          },
          getDoctor: function (options) {
            var opts = options || {};
            return request('/doctor' + queryString(opts.projectRoot), opts.signal ? { signal: opts.signal } : undefined);
          },
          postAction: function (action, options) {
            var opts = options || {};
            var payload = { action: action };
            ['names', 'projectRoot', 'dryRun', 'force'].forEach(function (key) {
              if (opts[key] !== undefined) payload[key] = opts[key];
            });
            return request('/action', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
              signal: opts.signal
            });
          },
          listSkills: function (options) {
            var opts = options || {};
            var params = [];
            if (opts.projectRoot) params.push('projectRoot=' + encodeURIComponent(opts.projectRoot));
            if (opts.source && opts.source !== 'all') params.push('source=' + encodeURIComponent(opts.source));
            if (opts.refresh) params.push('refresh=1');
            return request('/skills' + (params.length ? '?' + params.join('&') : ''), opts.signal ? { signal: opts.signal } : undefined);
          },
          getSkillDetail: function (options) {
            var opts = options || {};
            var params = [
              'scope=' + encodeURIComponent(opts.scope || 'user'),
              'name=' + encodeURIComponent(opts.name || '')
            ];
            if (opts.projectRoot) params.push('projectRoot=' + encodeURIComponent(opts.projectRoot));
            return request('/skills/detail?' + params.join('&'), opts.signal ? { signal: opts.signal } : undefined);
          },
          skillAction: function (action, options) {
            var opts = options || {};
            var payload = { action: action };
            ['scope', 'name', 'projectRoot', 'description', 'body', 'expectedFingerprint', 'id', 'dryRun'].forEach(function (key) {
              if (opts[key] !== undefined) payload[key] = opts[key];
            });
            return request('/skills/action', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
              signal: opts.signal
            });
          },
          listPlugins: function (options) {
            var opts = options || {};
            var init = opts.signal ? { signal: opts.signal } : undefined;
            return request('/plugins' + (opts.refresh ? '?refresh=1' : ''), init);
          },
          checkPlugins: function (options) {
            var opts = options || {};
            return request('/plugins/action', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'check' }),
              signal: opts.signal
            });
          },
          updatePlugin: function (name, options) {
            var opts = options || {};
            return request('/plugins/action', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'update', name: name }),
              signal: opts.signal
            });
          }
        };
      }

      function phaseToken(phase) {
        return {
          active: '--dsw-alias-state-success-primary',
          degraded: '--dsw-alias-state-warning-primary',
          stale: '--dsw-alias-state-warning-primary',
          failed: '--dsw-alias-state-danger-primary',
          restored: '--dsw-alias-brand-primary',
          booting: '--dsw-alias-label-secondary'
        }[phase] || '--dsw-alias-label-secondary';
      }

      function phaseLabel(t, phase) {
        return t('phase.' + phase) || phase || t('phase.unknown');
      }

      function currentFromText(text) {
        if (!text) return 'missing';
        if (/stale|过期|待更新/i.test(text)) return 'pending';
        if (/中文/.test(text)) return 'zh';
        if (/英文/.test(text)) return 'en';
        if (/尚未|待翻译|missing|pending/i.test(text)) return 'pending';
        return 'missing';
      }

      function parseDetailLine(line) {
        if (typeof line !== 'string') return null;
        var text = line.trim();
        var command = /^\/([^\s[]+)\s+\[command\/([^\]]+)\]\s+([^·]+?)(?:\s+·\s+engine=([a-z]+))?(?:\s+·\s+(.*))?$/u.exec(text);
        if (command) {
          return {
            id: 'command:' + command[1],
            kind: 'command',
            layer: 'agent',
            name: command[1],
            current: currentFromText(command[3]),
            engine: command[4] || 'none',
            stale: /stale|过期|待更新/i.test(text),
            missing: /missing|尚未/i.test(text),
            note: text
          };
        }
        var skill = /^([^\s[]+)\s+\[([^/\]]+)\/([^\]]+)\]\s+([^·]+?)(?:\s+·\s+engine=([a-z]+))?(?:\s+·\s+(.*))?$/u.exec(text);
        if (skill) {
          return {
            id: 'skill:' + skill[1],
            kind: 'skill',
            layer: skill[2],
            name: skill[1],
            current: currentFromText(skill[4]),
            engine: skill[5] || 'none',
            stale: /stale|过期|待更新/i.test(text),
            missing: /missing|尚未/i.test(text),
            note: text
          };
        }
        return null;
      }

      function normalizeTargets(state) {
        if (state && Array.isArray(state.targets) && state.targets.length) {
          return state.targets.map(function (target, index) {
            return Object.assign({ id: target.id || target.name || ('target-' + index) }, target);
          });
        }
        if (state && Array.isArray(state.details)) {
          return state.details.map(function (detail) {
            if (detail && typeof detail === 'object') return detail;
            return parseDetailLine(String(detail));
          }).filter(Boolean);
        }
        return [];
      }

      function deriveCounts(targets, state) {
        var skills = targets.filter(function (target) { return target.kind !== 'command'; });
        var commands = targets.filter(function (target) { return target.kind === 'command'; });
        var counts = state && state.counts ? state.counts : null;
        var commandCounts = state && state.commands ? state.commands : null;
        return {
          skills: {
            zh: counts && Number.isFinite(counts.zh) ? counts.zh : skills.filter(function (target) { return target.current === 'zh'; }).length,
            total: counts && Number.isFinite(counts.total) ? counts.total : (skills.length || 12)
          },
          commands: {
            zh: commandCounts && Number.isFinite(commandCounts.zh) ? commandCounts.zh : commands.filter(function (target) { return target.current === 'zh'; }).length,
            total: commandCounts && Number.isFinite(commandCounts.total) ? commandCounts.total : (commands.length || 3)
          }
        };
      }

      function deriveEngines(targets, state) {
        if (state && state.engineCounts) return state.engineCounts;
        var result = { llm: 0, dictionary: 0, source: 0, none: 0 };
        targets.forEach(function (target) {
          if (Object.prototype.hasOwnProperty.call(result, target.engine)) result[target.engine] += 1;
        });
        return result;
      }

      function errorInfo(t, error) {
        var status = error && error.status;
        var code = error && error.code;
        if (status === 401) return { title: t('error.unauthorized'), message: error.message, retry: false };
        if (status === 403) return { title: t('error.forbidden'), message: error.message, retry: false };
        if (status === 409 || code === 'busy') return { title: t('error.busy'), message: t('notices.busy'), retry: true };
        if (status === 404 || status === 405 || status === 503 || code === 'unavailable') {
          return { title: t('error.unavailable'), message: t('notices.restartHint'), retry: true };
        }
        if (status === 504 || code === 'timeout') return { title: t('error.timeout'), message: error.message, retry: true };
        if (code === 'network') return { title: t('error.network'), message: error.message, retry: true };
        return { title: t('error.unknown'), message: (error && error.message) || String(error), retry: true };
      }

      function formatTime(value, unknown) {
        if (!value) return unknown;
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        try {
          return date.toLocaleString();
        } catch (error) {
          return date.toISOString();
        }
      }

      function sameValue(left, right) {
        return JSON.stringify(left) === JSON.stringify(right);
      }

      var CSS = [
        '.sdzh-page{display:flex;flex-direction:column;gap:14px;max-width:100%;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
        '.sdzh-page *{box-sizing:border-box}',
        '.sdzh-page-tabs{gap:0}',
        '.sdzh-page-tabbar{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:14px}',
        '.sdzh-page-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:9px 12px;font:inherit;font-size:13px;cursor:pointer}',
        '.sdzh-page-tab:hover{color:var(--dsw-alias-label-primary)}',
        '.sdzh-page-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
        '.sdzh-page-tab.is-active{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
        '.sdzh-page-panel{min-width:0;display:flex;flex-direction:column;gap:14px}',
        '.sdzh-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}',
        '.sdzh-heading{min-width:0}',
        '.sdzh-title{margin:0;font-size:20px;line-height:1.35;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.sdzh-subtitle{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:12.5px;max-width:72ch}',
        '.sdzh-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.sdzh-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);padding:14px 16px;min-width:0}',
        '.sdzh-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}',
        '.sdzh-card-title{margin:0;font-size:14px;font-weight:600}',
        '.sdzh-card-extra{color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.sdzh-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:500;line-height:1.5;white-space:nowrap}',
        '.sdzh-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px}',
        '.sdzh-summary-item{min-width:0;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2)}',
        '.sdzh-summary-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-bottom:2px}',
        '.sdzh-summary-value{font-weight:600;overflow-wrap:anywhere}',
        '.sdzh-summary-value code{font-weight:500;font-size:11.5px}',
        '.sdzh-muted{color:var(--dsw-alias-label-secondary)}',
        '.sdzh-banner{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;border:1px solid;border-radius:var(--dsw-radius-md,8px);padding:9px 11px;font-size:12.5px;flex-wrap:wrap}',
        '.sdzh-banner-warning{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 30%,transparent)}',
        '.sdzh-banner-danger{background:color-mix(in srgb,var(--dsw-alias-state-danger-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-danger-primary) 30%,transparent)}',
        '.sdzh-banner-info{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 25%,transparent)}',
        '.sdzh-banner-success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 28%,transparent)}',
        '.sdzh-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}',
        '.sdzh-toggle-copy{min-width:0;max-width:66ch}',
        '.sdzh-toggle-label{font-weight:600}',
        '.sdzh-switch{width:44px;height:26px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);padding:2px;cursor:pointer;flex:none;transition:background .15s ease}',
        '.sdzh-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
        '.sdzh-switch:disabled{opacity:.55;cursor:not-allowed}',
        '.sdzh-switch-thumb{display:block;width:20px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);transition:transform .15s ease}',
        '.sdzh-switch[aria-checked="true"] .sdzh-switch-thumb{transform:translateX(18px)}',
        '.sdzh-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
        '.sdzh-button{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:6px 12px;font:inherit;font-size:12.5px;line-height:1.5;cursor:pointer;min-height:30px}',
        '.sdzh-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
        '.sdzh-button:focus-visible,.sdzh-switch:focus-visible,.sdzh-confirm-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
        '.sdzh-button:disabled{opacity:.5;cursor:not-allowed}',
        '.sdzh-button-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-on-brand)}',
        '.sdzh-button-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);opacity:.9}',
        '.sdzh-button-danger{color:var(--dsw-alias-state-danger-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-danger-primary) 40%,transparent)}',
        '.sdzh-link-button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;padding:0}',
        '.sdzh-table-wrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px)}',
        '.sdzh-table{width:100%;border-collapse:collapse;font-size:12px;min-width:760px}',
        '.sdzh-table th,.sdzh-table td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}',
        '.sdzh-table thead th{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-weight:600;white-space:nowrap}',
        '.sdzh-table tbody tr:last-child td{border-bottom:0}',
        '.sdzh-table tr.sdzh-group th{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;padding:5px 9px}',
        '.sdzh-table code{font-size:11px;overflow-wrap:anywhere;word-break:break-all}',
        '.sdzh-cell-name{font-weight:500;white-space:nowrap}',
        '.sdzh-cell-note{max-width:30ch;color:var(--dsw-alias-label-secondary)}',
        '.sdzh-check{display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px dashed var(--dsw-alias-border-l2)}',
        '.sdzh-check:last-child{border-bottom:0}',
        '.sdzh-check-icon{flex:none;font-weight:700}',
        '.sdzh-check-ok{color:var(--dsw-alias-state-success-primary)}',
        '.sdzh-check-fail{color:var(--dsw-alias-state-danger-primary)}',
        '.sdzh-dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:5px 12px;margin:0;font-size:12px}',
        '.sdzh-dl dt{color:var(--dsw-alias-label-secondary)}',
        '.sdzh-dl dd{margin:0;overflow-wrap:anywhere}',
        '.sdzh-dialog{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1);padding:14px 16px;display:flex;flex-direction:column;gap:10px}',
        '.sdzh-dialog-title{margin:0;font-size:14px;font-weight:600}',
        '.sdzh-dialog-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}',
        '.sdzh-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3);overflow:auto;max-height:220px;font-size:11px;line-height:1.45}',
        '.sdzh-footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11.5px}',
        '.sdzh-empty{padding:14px;text-align:center;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px)}',
        '.sdzh-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
        '@media(max-width:640px){.sdzh-summary{grid-template-columns:1fr 1fr}.sdzh-card{padding:12px}.sdzh-title{font-size:18px}}',
        '.sdzh-plugin-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px dashed var(--dsw-alias-border-l2);flex-wrap:wrap}',
        '.sdzh-plugin-row:last-child{border-bottom:0}',
        '.sdzh-plugin-main{min-width:0;flex:1 1 320px}',
        '.sdzh-plugin-title{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-weight:600}',
        '.sdzh-plugin-meta{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:3px;overflow-wrap:anywhere}',
        '.sdzh-plugin-action{display:flex;gap:8px;align-items:center;flex:none}',
        '.sdzh-plugin-version{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;font-weight:500}',
        '@media(max-width:420px){.sdzh-summary{grid-template-columns:1fr}}'
      ].join('\n');

      var SKILL_CSS = [
        '.sdx-page{display:flex;flex-direction:column;gap:14px;max-width:100%;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
        '.sdx-page *{box-sizing:border-box}',
        '.sdx-header{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}',
        '.sdx-header-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.sdx-title{margin:0;font-size:20px;line-height:1.35;font-weight:600}',
        '.sdx-subtitle{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:12.5px;max-width:72ch}',
        '.sdx-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}',
        '.sdx-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
        '.sdx-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:7px 10px;font:inherit;font-size:12.5px;cursor:pointer}',
        '.sdx-tab.is-active{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
        '.sdx-toolbar{display:flex;gap:8px;align-items:end;flex-wrap:wrap}',
        '.sdx-filter{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
        '.sdx-input,.sdx-select,.sdx-textarea{font:inherit;font-size:12.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);padding:6px 9px;min-height:30px}',
        '.sdx-input{flex:1 1 220px;min-width:160px}',
        '.sdx-input:focus-visible,.sdx-select:focus-visible,.sdx-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
        '.sdx-textarea{width:100%;resize:vertical}',
        '.sdx-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55}',
        '.sdx-table-wrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px)}',
        '.sdx-table{width:100%;border-collapse:collapse;font-size:12.5px}',
        '.sdx-table th{text-align:left;font-weight:600;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap}',
        '.sdx-table td{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}',
        '.sdx-table tr:last-child td{border-bottom:0}',
        '.sdx-name{min-width:150px}',
        '.sdx-name code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
        '.sdx-description{max-width:320px}',
        '.sdx-description span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.sdx-muted,.sdx-hint{color:var(--dsw-alias-label-secondary);font-size:11.5px}',
        '.sdx-badges,.sdx-row-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
        '.sdx-chip{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 7px;font-size:11px;line-height:1.6;white-space:nowrap}',
        '.sdx-chip-source{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent)}',
        '.sdx-chip-success{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}',
        '.sdx-chip-danger{color:var(--dsw-alias-state-danger-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-danger-primary) 35%,transparent)}',
        '.sdx-chip-neutral{color:var(--dsw-alias-label-secondary)}',
        '.sdx-notice{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);padding:8px 10px;font-size:12.5px}',
        '.sdx-notice-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 28%,transparent)}',
        '.sdx-notice-danger{background:color-mix(in srgb,var(--dsw-alias-state-danger-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-danger-primary) 28%,transparent)}',
        '.sdx-notice-info{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 25%,transparent)}',
        '.sdx-empty{text-align:center;padding:26px 12px;color:var(--dsw-alias-label-secondary)}',
        '.sdx-empty .sdx-hint{margin-top:4px}',
        '.sdx-readonly{margin-top:14px;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}',
        '.sdx-readonly summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;margin-bottom:8px}',
        '.sdx-footer{display:flex;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11.5px;flex-wrap:wrap}',
        '.sdx-backdrop{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 38%,transparent)}',
        '.sdx-dialog{width:min(720px,96vw);max-height:88vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);padding:16px;box-shadow:0 12px 40px color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent)}',
        '.sdx-dialog-title{margin:0 0 12px;font-size:16px}',
        '.sdx-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;font-size:12.5px}',
        '.sdx-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
        '.sdx-error{color:var(--dsw-alias-state-danger-primary);font-size:12.5px;margin-top:6px}',
        '@media(max-width:640px){.sdx-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.sdx-header{flex-direction:column}.sdx-table th:nth-child(2),.sdx-table td:nth-child(2){display:none}}'
      ].join('\n');

      function Badge(props) {
        var token = '--' + phaseToken(props.phase).replace(/^--/, '');
        return h('span', {
          className: 'sdzh-badge',
          style: {
            color: 'var(' + token + ')',
            borderColor: 'color-mix(in srgb,var(' + token + ') 35%,transparent)',
            background: 'color-mix(in srgb,var(' + token + ') 12%,transparent)'
          }
        }, props.children);
      }

      function Spinner(props) {
        return h('span', { className: 'sdzh-muted', role: 'status', 'aria-live': 'polite' }, props.label || '\u2026');
      }

      function Card(props) {
        return h('section', { className: 'sdzh-card' },
          (props.title || props.extra) ? h('div', { className: 'sdzh-card-head' },
            h('h3', { className: 'sdzh-card-title' }, props.title),
            h('div', { className: 'sdzh-card-extra' }, props.extra)
          ) : null,
          props.children
        );
      }

      function SummaryItem(props) {
        return h('div', { className: 'sdzh-summary-item' },
          h('div', { className: 'sdzh-summary-label' }, props.label),
          h('div', { className: 'sdzh-summary-value' }, props.children)
        );
      }

      function Switch(props) {
        return h('button', {
          type: 'button',
          role: 'switch',
          className: 'sdzh-switch',
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          disabled: props.disabled,
          onClick: props.onChange
        }, h('span', { className: 'sdzh-switch-thumb', 'aria-hidden': 'true' }));
      }

      function Button(props) {
        return h('button', {
          type: 'button',
          className: 'sdzh-button' + (props.kind ? ' sdzh-button-' + props.kind : ''),
          disabled: props.disabled,
          onClick: props.onClick,
          title: props.title
        }, props.children);
      }

      function Banner(props) {
        var tone = props.tone || 'info';
        return h('div', { className: 'sdzh-banner sdzh-banner-' + tone, role: props.tone === 'danger' ? 'alert' : 'status' },
          h('div', null, props.children),
          props.action || null
        );
      }

      function Dialog(props) {
        var t = props.t;
        return h('div', {
          className: 'sdzh-dialog',
          role: 'alertdialog',
          'aria-modal': 'true',
          'aria-labelledby': 'sdzh-confirm-title'
        },
          h('h3', { className: 'sdzh-dialog-title', id: 'sdzh-confirm-title' }, t('confirm.title')),
          h('p', { className: 'sdzh-muted', style: { margin: 0 } }, t('confirm.' + props.kind)),
          h('div', { className: 'sdzh-dialog-actions' },
            h('button', { type: 'button', className: 'sdzh-button', onClick: props.onCancel }, t('confirm.cancel')),
            h('button', {
              type: 'button',
              className: 'sdzh-button sdzh-button-primary sdzh-confirm-button',
              onClick: props.onConfirm,
              ref: props.confirmRef
            }, t('confirm.ok'))
          )
        );
      }

      function ErrorPanel(props) {
        var t = props.t;
        return h(Card, { title: t('error.title') },
          h(Banner, { tone: 'danger' },
            h('div', null,
              h('strong', null, props.error.title),
              h('div', { className: 'sdzh-muted' }, props.error.message)
            ),
            h(Button, { onClick: props.onRetry }, t('error.retry'))
          )
        );
      }

      function TargetTable(props) {
        var t = props.t;
        var targets = props.targets;
        var groups = [
          { key: 'global', label: t('group.global') },
          { key: 'preset', label: t('group.preset') },
          { key: 'command', label: t('group.command') }
        ];
        if (!targets.length) return h('div', { className: 'sdzh-empty' }, t('state.noTargets'));
        return h('div', { className: 'sdzh-table-wrap' },
          h('table', { className: 'sdzh-table' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col' }, t('table.name')),
              h('th', { scope: 'col' }, t('table.layer')),
              h('th', { scope: 'col' }, t('table.source')),
              h('th', { scope: 'col' }, t('table.current')),
              h('th', { scope: 'col' }, t('table.engine')),
              h('th', { scope: 'col' }, t('table.stale')),
              h('th', { scope: 'col' }, t('table.shadow')),
              h('th', { scope: 'col' }, t('table.note'))
            )),
            groups.map(function (group) {
              var rows = targets.filter(function (target) {
                if (group.key === 'command') return target.kind === 'command';
                return target.kind !== 'command' && target.layer === group.key;
              });
              if (!rows.length) return null;
              return h('tbody', { key: group.key },
                h('tr', { className: 'sdzh-group' }, h('th', { scope: 'colgroup', colSpan: 8 }, group.label)),
                rows.map(function (target) {
                  var label = target.name || target.id;
                  if (target.kind === 'command' && label.charAt(0) !== '/') label = '/' + label;
                  var current = target.current || (target.missing ? 'missing' : 'en');
                  var currentLabel = t('current.' + current) || current;
                  var engine = target.engine || 'none';
                  var shadow = target.shadowPath || '';
                  var note = target.note || '';
                  return h('tr', { key: target.id || target.name },
                    h('td', { className: 'sdzh-cell-name' },
                      h('span', null, label),
                      h('div', { className: 'sdzh-muted' }, t('target.kind.' + (target.kind === 'command' ? 'command' : 'skill')))
                    ),
                    h('td', null, t('layer.' + (target.layer || 'global')) || target.layer || '\u2014'),
                    h('td', null,
                      target.sourcePath ? h('code', { title: target.sourcePath }, target.sourcePath) : (target.source || '\u2014')
                    ),
                    h('td', null, h('span', {
                      style: {
                        color: current === 'zh' ? 'var(--dsw-alias-state-success-primary)' : current === 'en' ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-state-warning-primary)'
                      }
                    }, currentLabel)),
                    h('td', null, t('engine.' + engine) || engine),
                    h('td', null, target.stale ? t('yes') : t('no')),
                    h('td', null, shadow ? h('code', { title: shadow }, shadow) : '\u2014'),
                    h('td', { className: 'sdzh-cell-note' }, note || '\u2014')
                  );
                })
              );
            })
          )
        );
      }

      function CheckList(props) {
        var t = props.t;
        var checks = props.checks || [];
        if (!checks.length) return h('p', { className: 'sdzh-muted' }, t('doctor.empty'));
        return h('div', null, checks.map(function (check, index) {
          var label = check.label || check.message || check.key || check.id || ('check-' + index);
          var ok = check.ok !== false;
          var optional = check.mandatory === false || check.required === false;
          return h('div', { className: 'sdzh-check', key: check.key || check.id || index },
            h('span', { className: 'sdzh-check-icon ' + (ok ? 'sdzh-check-ok' : 'sdzh-check-fail'), 'aria-hidden': 'true' }, ok ? '\u2713' : '\u2717'),
            h('div', null,
              h('div', null, label),
              check.detail ? h('div', { className: 'sdzh-muted' }, check.detail) : null,
              optional ? h('div', { className: 'sdzh-muted' }, t('state.checksOptional')) : null
            )
          );
        }));
      }


      function pluginState(plugin, t) {
        if (plugin.updateAvailable) return { phase: 'degraded', label: t('plugins.stateAvailable', { version: plugin.latestVersion || '' }) };
        if (plugin.latestError) return { phase: 'failed', label: t('plugins.stateCheckFailed') };
        if (plugin.missing) return { phase: 'failed', label: t('plugins.stateMissing') };
        if (!plugin.updateable) return { phase: 'booting', label: plugin.local ? t('plugins.localLabel') : t('plugins.stateNotUpdateable') };
        return { phase: 'active', label: t('plugins.stateLatest') };
      }

      function PluginAdminPage(props) {
        var t = typeof props.t === 'function'
          ? props.t
          : function (key, params) { return translate('zh', key, params); };
        var api = useMemo(function () { return createApi(); }, []);
        var [data, setData] = useState(null);
        var [page, setPage] = useState('loading');
        var [error, setError] = useState(null);
        var [notice, setNotice] = useState(null);
        var [checking, setChecking] = useState(false);
        var [updating, setUpdating] = useState(null);
        var [confirm, setConfirm] = useState(null);
        var alive = useRef(true);
        var abortRef = useRef(null);
        var confirmRef = useRef(null);
        var updatingRef = useRef(null);
        var mountedRef = useRef(false);

        var load = useCallback(async function (options) {
          var opts = options || {};
          if (opts.refresh) setChecking(true);
          var controller = typeof AbortController === 'function' ? new AbortController() : null;
          abortRef.current = controller;
          try {
            var payload = await api.listPlugins({
              refresh: opts.refresh === true,
              signal: controller ? controller.signal : undefined
            });
            if (!alive.current) return;
            if (payload && payload.ok === false) {
              var detail = payload.error || payload;
              var failure = new Error(detail.message || t('error.unknown'));
              failure.code = detail.code;
              setError(failure);
              if (!mountedRef.current) setPage('error');
              setNotice({ kind: 'error', text: t('plugins.noticeCheckFailed', { message: failure.message }) });
              return;
            }
            mountedRef.current = true;
            setData(payload);
            setPage('ready');
            setError(null);
          } catch (failure) {
            if (!alive.current || (failure && failure.name === 'AbortError')) return;
            setError(failure);
            if (!mountedRef.current) setPage('error');
            setNotice({ kind: 'error', text: t('plugins.noticeCheckFailed', { message: errorInfo(t, failure).message }) });
          } finally {
            if (alive.current) setChecking(false);
          }
        }, [api, t]);

        useEffect(function () {
          alive.current = true;
          mountedRef.current = false;
          void load({});
          return function () {
            alive.current = false;
            if (abortRef.current) abortRef.current.abort();
          };
        }, [load]);

        useEffect(function () {
          if (confirm && confirmRef.current && confirmRef.current.focus) confirmRef.current.focus();
        }, [confirm]);

        async function checkUpdates() {
          if (checking || updating) return;
          setChecking(true);
          setNotice(null);
          try {
            var payload = await api.checkPlugins({});
            if (!alive.current) return;
            if (payload && payload.ok === false) {
              var detail = payload.error || payload;
              setNotice({ kind: 'error', text: t('plugins.noticeCheckFailed', { message: detail.message || t('error.unknown') }) });
              return;
            }
            mountedRef.current = true;
            setData(payload);
            setPage('ready');
            setError(null);
          } catch (failure) {
            if (!alive.current) return;
            var info = errorInfo(t, failure);
            setNotice({ kind: 'error', text: t('plugins.noticeCheckFailed', { message: info.message }) });
          } finally {
            if (alive.current) setChecking(false);
          }
        }

        function askUpdate(plugin) {
          if (updating) return;
          setNotice(null);
          setConfirm(plugin);
        }

        async function acceptUpdate() {
          var plugin = confirm;
          setConfirm(null);
          if (!plugin || updatingRef.current) return;
          updatingRef.current = plugin.name;
          setUpdating(plugin.name);
          setNotice(null);
          try {
            var payload = await api.updatePlugin(plugin.name);
            var result = payload && payload.result ? payload.result : payload;
            if (result && result.ok === false) {
              setNotice({ kind: 'error', text: t('plugins.noticeFailure', { name: plugin.name, message: result.message || t('error.unknown') }) });
            } else {
              var to = result && result.to ? result.to : (plugin.latestVersion || '');
              var text = t('plugins.noticeSuccess', { name: plugin.name, version: to });
              if (result && result.restartRequired) text += ' ' + t('plugins.noticeRestart');
              setNotice({ kind: 'ok', text: text });
            }
            await load({ refresh: true });
          } catch (failure) {
            var info = errorInfo(t, failure);
            setNotice({ kind: 'error', text: info.title + ': ' + info.message });
          } finally {
            if (alive.current) {
              updatingRef.current = null;
              setUpdating(null);
            }
          }
        }

        if (page === 'loading') {
          return h('div', { className: 'sdzh-page' }, h('style', null, CSS),
            h(Card, { title: t('plugins.title') },
              h(Spinner, { label: t('plugins.loading') }),
              h('p', { className: 'sdzh-muted' }, t('plugins.loadingHint'))
            )
          );
        }
        if (page === 'error') {
          return h('div', { className: 'sdzh-page' }, h('style', null, CSS),
            h(ErrorPanel, { t: t, error: errorInfo(t, error), onRetry: function () { void load({ refresh: true }); } })
          );
        }

        var plugins = data && Array.isArray(data.plugins) ? data.plugins : [];
        var updates = plugins.filter(function (plugin) { return plugin.updateAvailable === true; });
        var profile = data && data.profile ? data.profile : null;
        var warnings = data && Array.isArray(data.warnings) ? data.warnings : [];
        var managerOn = Boolean(data && data.pluginManager);
        var busy = Boolean(updating || checking);
        var checkedAt = data && data.checkedAt ? formatTime(data.checkedAt, t('unknown')) : t('unknown');

        return h('div', { className: 'sdzh-page' },
          h('style', null, CSS),
          h('div', { className: 'sdzh-header' },
            h('div', { className: 'sdzh-heading' },
              h('h2', { className: 'sdzh-title' }, t('plugins.title')),
              h('p', { className: 'sdzh-subtitle' }, t('plugins.subtitle'))
            ),
            h('div', { className: 'sdzh-header-actions' },
              h(Button, { kind: 'primary', onClick: function () { void checkUpdates(); }, disabled: busy }, checking ? t('plugins.checking') : t('plugins.check')),
              h(Button, { onClick: function () { void load({}); }, disabled: busy }, t('plugins.refresh'))
            )
          ),
          notice ? h(Banner, { tone: notice.kind === 'ok' ? 'success' : 'danger' }, notice.text) : null,
          warnings.length ? h(Banner, { tone: 'warning' }, h('div', null,
            h('strong', null, t('plugins.warning')),
            h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, warnings.map(function (item, index) {
              return h('li', { key: index }, item);
            }))
          )) : null,
          h(Card, { title: profile ? profile.name : t('plugins.profile'),
            extra: h('span', null, updates.length
              ? t('plugins.updatesAvailable', { count: updates.length })
              : t('plugins.allUpToDate')) },
            h('div', { className: 'sdzh-summary' },
              h(SummaryItem, { label: t('plugins.profile') }, profile ? profile.name + (profile.source ? ' · ' + profile.source : '') : t('unknown')),
              h(SummaryItem, { label: t('plugins.profileDir') }, h('code', { title: profile ? profile.dir : '' }, profile ? profile.dir : t('unknown'))),
              h(SummaryItem, { label: t('plugins.registry') }, h('code', null, data && data.registry ? data.registry : t('unknown'))),
              h(SummaryItem, { label: t('plugins.hostManager') }, managerOn ? t('plugins.hostManagerOn') : t('plugins.hostManagerOff')),
              h(SummaryItem, { label: t('plugins.count') }, String(plugins.length)),
              h(SummaryItem, { label: t('plugins.official') }, String(data && data.officialCount !== undefined ? data.officialCount : 0)),
              h(SummaryItem, { label: t('plugins.updates') }, String(updates.length)),
              h(SummaryItem, { label: t('plugins.checkedAt') }, checkedAt)
            ),
            managerOn ? null : h('div', { style: { marginTop: '10px' } }, h(Banner, { tone: 'warning' }, t('plugins.updateUnavailable')))
          ),
          h(Card, { title: t('plugins.title'), extra: updating ? t('plugins.busy', { name: updating }) : null },
            plugins.length === 0
              ? h('div', { className: 'sdzh-empty' }, t('plugins.empty'))
              : h('div', null, plugins.map(function (plugin) {
                  var state = pluginState(plugin, t);
                  var primary = plugin.title || plugin.name;
                  var version = plugin.version ? 'v' + plugin.version : t('unknown');
                  var badge = state.phase === 'booting' || state.phase === 'failed' || state.phase === 'degraded'
                    ? h(Badge, { phase: state.phase }, state.label)
                    : h('span', { className: 'sdzh-muted' }, state.label);
                  return h('div', { className: 'sdzh-plugin-row', key: plugin.name },
                    h('div', { className: 'sdzh-plugin-main' },
                      h('div', { className: 'sdzh-plugin-title' },
                        h('span', null, primary),
                        h('span', { className: 'sdzh-plugin-version' }, version),
                        h(Badge, { phase: plugin.enabled === false ? 'restored' : 'active' }, plugin.enabled === false ? t('plugins.stateDisabled') : t('plugins.stateEnabled')),
                        plugin.self ? h('span', { className: 'sdzh-muted' }, t('plugins.selfLabel')) : null
                      ),
                      plugin.title && plugin.title !== plugin.name ? h('div', { className: 'sdzh-plugin-meta' }, plugin.name) : null,
                      h('div', { className: 'sdzh-plugin-meta' },
                        t('plugins.colSource') + ': ' + (t('plugins.source.' + (plugin.kind || 'unknown')) || plugin.kind || t('plugins.source.unknown')),
                        ' · ',
                        badge
                      ),
                      plugin.latestError ? h('div', { className: 'sdzh-plugin-meta' }, plugin.latestError) : null,
                      plugin.description ? h('div', { className: 'sdzh-plugin-meta' }, plugin.description) : null
                    ),
                    h('div', { className: 'sdzh-plugin-action' },
                      plugin.updateAvailable
                        ? h(Button, { kind: 'primary', onClick: function () { askUpdate(plugin); }, disabled: busy }, updating === plugin.name ? t('plugins.updating') : t('plugins.update'))
                        : null
                    )
                  );
                }))
          ),
          h('p', { className: 'sdzh-muted', style: { margin: 0 } }, t('plugins.readonlyHint')),
          h('div', { className: 'sdzh-footer' },
            h('span', null, t('plugins.restartNote')),
            h('span', null, t('footer.version', { version: PAGE_VERSION }))
          ),
          confirm ? h('div', { className: 'sdzh-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sdzh-plugin-dialog-title' },
            h('h3', { className: 'sdzh-dialog-title', id: 'sdzh-plugin-dialog-title' }, t('plugins.dialogTitle')),
            h('p', { className: 'sdzh-muted', style: { margin: 0 } }, t('plugins.dialogBody', {
              name: confirm.name,
              from: confirm.version || '?',
              to: confirm.latestVersion || '?'
            })),
            h('div', { className: 'sdzh-dialog-actions' },
              h('button', { type: 'button', className: 'sdzh-button', onClick: function () { setConfirm(null); } }, t('plugins.dialogCancel')),
              h('button', {
                type: 'button',
                className: 'sdzh-button sdzh-button-primary sdzh-confirm-button',
                onClick: function () { void acceptUpdate(); },
                ref: function (node) { confirmRef.current = node; }
              }, t('plugins.dialogConfirm'))
            )
          ) : null
        );
      }

      function skillOrigin(row) {
        if (row && row.origin) return row.origin;
        if (!row) return 'plugin';
        if (row.scope === 'user' || row.scope === 'project') return row.scope;
        return row.readOnlyReason || 'plugin';
      }

      function skillOriginKey(row) {
        var origin = skillOrigin(row);
        return ['user', 'project', 'plugin', 'preset', 'bundled', 'runtime'].indexOf(origin) >= 0 ? origin : 'plugin';
      }

      function skillReadOnlyReason(t, reason) {
        if (!reason) return t('skills.editor.unsupported');
        var key = 'skills.readonly.reason.' + reason;
        var text = t(key);
        return text === key ? t('skills.error.not-writable') : text;
      }

      function skillErrorInfo(t, error) {
        var status = error && error.status;
        var code = error && error.code;
        if (status === 401) return { title: t('error.unauthorized'), message: error.message || t('skills.error.unknown') };
        if (status === 403) return { title: t('skills.error.not-writable'), message: error.message || '' };
        if (code && code !== 'unknown') {
          var key = 'skills.error.' + code;
          var message = t(key);
          if (message !== key) return { title: t('skills.error.title'), message: message };
        }
        if (status === 409) return { title: t('skills.error.conflict'), message: t('skills.error.conflict') };
        return { title: t('skills.error.unknown'), message: (error && error.message) || String(error) };
      }

      function formatBytes(value, t) {
        var size = Number(value);
        if (!Number.isFinite(size) || size < 0) return '—';
        if (size < 1024) return size + ' B';
        if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KiB';
        return (size / (1024 * 1024)).toFixed(1) + ' MiB';
      }

      function skillNameIsValid(name) {
        return typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(name) && !/-$/u.test(name);
      }

      function SkillChip(props) {
        return h('span', { className: 'sdx-chip sdx-chip-' + (props.tone || 'neutral') }, props.children);
      }

      function SkillRow(props) {
        var t = props.t;
        var row = props.row;
        var busy = props.busy;
        var origin = skillOriginKey(row);
        var translated = Boolean(row.translation && row.translation.zh);
        var editDisabled = busy || !row.editable;
        var editReason = !row.editable ? skillReadOnlyReason(t, row.readOnlyReason) : null;
        var editTitle = editReason || undefined;
        return h('tr', null,
          h('td', { className: 'sdx-name' },
            h('code', null, row.name),
            h('div', { className: 'sdx-muted' }, row.dir || row.source || '')
          ),
          h('td', { className: 'sdx-description' },
            h('span', { title: row.description || '' }, row.description || '—')
          ),
          h('td', null, h(SkillChip, { tone: 'source' }, t('skills.badge.' + origin))),
          h('td', null,
            h('div', { className: 'sdx-badges' },
              row.disabled ? h(SkillChip, { tone: 'danger' }, t('skills.badge.disabled')) : null,
              translated ? h(SkillChip, { tone: 'success' }, t('skills.badge.translated')) : null,
              !row.editable && row.scope !== 'user' && row.scope !== 'project' ? h(SkillChip, { tone: 'neutral' }, t('skills.badge.readonly')) : null
            ),
            editReason ? h('div', { className: 'sdx-hint' }, editReason) : null
          ),
          h('td', null,
            h('div', { className: 'sdx-row-actions' },
              h(Button, { onClick: function () { props.onEdit(row); }, disabled: editDisabled, title: editTitle }, t('skills.action.edit')),
              row.disableable ? h(Button, { onClick: function () { props.onToggle(row); }, disabled: busy }, row.disabled ? t('skills.action.enable') : t('skills.action.disable')) : null,
              row.deletable ? h(Button, { kind: 'danger', onClick: function () { props.onDelete(row); }, disabled: busy }, t('skills.action.delete')) : null
            )
          )
        );
      }

      function SkillEditorDialog(props) {
        var t = props.t;
        var row = props.detail;
        var editing = props.mode === 'edit';
        var scopeOptions = props.scopes || ['user'];
        var [scope, setScope] = useState(editing ? row.scope : scopeOptions[0]);
        var [name, setName] = useState(editing ? row.name : '');
        var [description, setDescription] = useState(editing ? (row.description || '') : '');
        var [body, setBody] = useState(editing ? (row.body || '') : '');
        var [localError, setLocalError] = useState(null);
        var descriptionLength = description.trim().length;
        var bodyBytes = (function () {
          try { return new TextEncoder().encode(body).length; } catch (error) { return body.length; }
        })();
        var nameValid = editing || skillNameIsValid(name);
        var descriptionValid = descriptionLength > 0 && descriptionLength <= 400 && description.indexOf('\n') < 0 && description.indexOf('\r') < 0;
        var bodyTooLarge = bodyBytes > 256 * 1024;
        var disabled = props.busy || !nameValid || !descriptionValid || bodyTooLarge || (editing && row.editable === false);
        function submit() {
          if (disabled) return;
          setLocalError(null);
          Promise.resolve(props.onSave({
            mode: props.mode,
            scope: scope,
            name: name.trim(),
            description: description.trim(),
            body: body,
            expectedFingerprint: editing ? row.fingerprint : undefined
          })).catch(function (failure) {
            setLocalError(skillErrorInfo(t, failure).message);
          });
        }
        return h('div', { className: 'sdx-backdrop' },
          h('div', { className: 'sdx-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sdx-editor-title' },
            h('h3', { className: 'sdx-dialog-title', id: 'sdx-editor-title' }, t(editing ? 'skills.editor.edit.title' : 'skills.editor.create.title')),
            editing ? null : h('label', { className: 'sdx-field' },
              h('span', null, t('skills.filter.source')),
              h('select', { className: 'sdx-select', value: scope, onChange: function (event) { setScope(event.target.value); } },
                scopeOptions.map(function (option) { return h('option', { key: option, value: option }, t('skills.source.' + option)); })
              )
            ),
            h('label', { className: 'sdx-field' },
              h('span', null, t('skills.editor.name')),
              h('input', {
                className: 'sdx-input',
                value: name,
                readOnly: editing,
                placeholder: 'release-notes',
                onChange: function (event) { setName(event.target.value); },
                'aria-describedby': 'sdx-name-hint'
              }),
              h('span', { className: 'sdx-hint', id: 'sdx-name-hint' }, t('skills.editor.name.hint'))
            ),
            h('label', { className: 'sdx-field' },
              h('span', null, t('skills.editor.description')),
              h('textarea', {
                className: 'sdx-textarea',
                rows: 2,
                value: description,
                maxLength: 400,
                onChange: function (event) { setDescription(event.target.value); }
              }),
              h('span', { className: 'sdx-hint' }, t('skills.editor.description.hint') + ' · ' + descriptionLength + '/400')
            ),
            h('label', { className: 'sdx-field' },
              h('span', null, t('skills.editor.body')),
              h('textarea', {
                className: 'sdx-textarea sdx-code',
                rows: 12,
                value: body,
                onChange: function (event) { setBody(event.target.value); }
              }),
              h('span', { className: 'sdx-hint' }, t('skills.editor.body.hint') + ' · ' + formatBytes(bodyBytes, t))
            ),
            bodyTooLarge ? h('div', { className: 'sdx-error' }, t('skills.error.too-large')) : null,
            localError ? h('div', { className: 'sdx-error' }, localError) : null,
            h('div', { className: 'sdx-dialog-actions' },
              h(Button, { onClick: props.onCancel, disabled: props.busy }, t('skills.action.cancel')),
              h(Button, { kind: 'primary', onClick: submit, disabled: disabled }, props.busy ? t('action.running') : t('skills.action.save'))
            )
          )
        );
      }

      function SkillConfirmDialog(props) {
        var t = props.t;
        var kind = props.kind;
        var row = props.row || {};
        var title = kind === 'delete' ? t('skills.delete.title', { name: row.name || '' }) : t('skills.conflict.title');
        return h('div', { className: 'sdx-backdrop' },
          h('div', { className: 'sdx-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sdx-confirm-title' },
            h('h3', { className: 'sdx-dialog-title', id: 'sdx-confirm-title' }, title),
            kind === 'delete' ? h(React.Fragment, null,
              h('p', null, t('skills.delete.body')),
              row.dir ? h('p', { className: 'sdx-hint' }, t('skills.delete.folder', { dir: row.dir })) : null
            ) : h(React.Fragment, null,
              h('p', null, t('skills.conflict.body')),
              props.current ? h('p', { className: 'sdx-hint' }, t('skills.conflict.current', { fingerprint: props.current.fingerprint || '—' })) : null
            ),
            h('div', { className: 'sdx-dialog-actions' },
              h(Button, { onClick: props.onCancel, disabled: props.busy }, t('skills.action.cancel')),
              kind === 'delete'
                ? h(Button, { kind: 'danger', onClick: props.onConfirm, disabled: props.busy }, props.busy ? t('action.running') : t('skills.action.delete'))
                : h(Button, { kind: 'primary', onClick: props.onConfirm, disabled: props.busy }, t('skills.action.reload'))
            )
          )
        );
      }

      function SkillTrashDialog(props) {
        var t = props.t;
        var row = props.row || {};
        return h('div', { className: 'sdx-backdrop' },
          h('div', { className: 'sdx-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sdx-restore-title' },
            h('h3', { className: 'sdx-dialog-title', id: 'sdx-restore-title' }, t('skills.action.restore')),
            h('p', null, t('skills.trash.restoreBody', { to: row.from || row.to || '' })),
            h('div', { className: 'sdx-dialog-actions' },
              h(Button, { onClick: props.onCancel, disabled: props.busy }, t('skills.action.cancel')),
              h(Button, { kind: 'primary', onClick: props.onConfirm, disabled: props.busy }, props.busy ? t('action.running') : t('skills.action.restore'))
            )
          )
        );
      }

      function SkillAdminPage(props) {
        var t = typeof props.t === 'function'
          ? props.t
          : function (key, params) { return translate('zh', key, params); };
        var api = useMemo(function () { return createApi(); }, []);
        var [data, setData] = useState(null);
        var [page, setPage] = useState('loading');
        var [error, setError] = useState(null);
        var [view, setView] = useState('list');
        var [notice, setNotice] = useState(null);
        var [busy, setBusy] = useState(null);
        var [dialog, setDialog] = useState(null);
        var [search, setSearch] = useState('');
        var [query, setQuery] = useState('');
        var [source, setSource] = useState('all');
        var [status, setStatus] = useState('all');
        var [readonlyOpen, setReadonlyOpen] = useState(false);
        var alive = useRef(true);
        var busyRef = useRef(null);
        var closeRef = useRef(null);
        var abortRef = useRef(null);
        var dataRef = useRef(null);

        useEffect(function () {
          dataRef.current = data;
        }, [data]);

        var load = useCallback(async function (options) {
          var opts = options || {};
          var controller = typeof AbortController === 'function' ? new AbortController() : null;
          abortRef.current = controller;
          try {
            var payload = await api.listSkills({
              projectRoot: dataRef.current && dataRef.current.projectRoot ? dataRef.current.projectRoot : undefined,
              refresh: opts.refresh === true,
              signal: controller ? controller.signal : undefined
            });
            if (!alive.current) return;
            setData(payload || {});
            setPage('ready');
            setError(null);
          } catch (failure) {
            if (!alive.current || (failure && failure.name === 'AbortError')) return;
            setError(failure);
            if (!dataRef.current) setPage('error');
          }
        }, [api]);

        useEffect(function () {
          alive.current = true;
          void load({});
          return function () {
            alive.current = false;
            if (abortRef.current) abortRef.current.abort();
          };
        }, [load]);

        useEffect(function () {
          var timer = setTimeout(function () { setQuery(search.trim().toLowerCase()); }, 300);
          return function () { clearTimeout(timer); };
        }, [search]);

        useEffect(function () {
          if (!dialog) return;
          if (closeRef.current && closeRef.current.focus) closeRef.current.focus();
          else if (typeof document !== 'undefined') {
            var first = document.querySelector('.sdx-dialog button');
            if (first && first.focus) first.focus();
          }
          function onKey(event) {
            if (event.key === 'Escape' && !busyRef.current) setDialog(null);
          }
          if (typeof document !== 'undefined') document.addEventListener('keydown', onKey);
          return function () {
            if (typeof document !== 'undefined') document.removeEventListener('keydown', onKey);
          };
        }, [dialog]);

        async function run(kind, fn, options) {
          var opts = options || {};
          if (busyRef.current) return undefined;
          busyRef.current = { kind: kind };
          setBusy({ kind: kind });
          if (!opts.keepNotice) setNotice(null);
          try {
            return await fn();
          } catch (failure) {
            if (failure && failure.name === 'AbortError') return undefined;
            if (opts.throwOnError) throw failure;
            var info = skillErrorInfo(t, failure);
            setNotice({ kind: 'danger', text: info.title + ': ' + info.message });
            if (failure && failure.status === 409) await load({ refresh: true });
            return undefined;
          } finally {
            busyRef.current = null;
            if (alive.current) setBusy(null);
          }
        }

        function refresh() {
          return run('refresh', async function () {
            await load({ refresh: true });
            setNotice({ kind: 'ok', text: t('skills.notice.refreshed') });
          });
        }

        function openCreate() {
          if (busyRef.current) return;
          var projectAvailable = Boolean(data && data.projectRoot && data.sources && data.sources.project && data.sources.project.allowed !== false);
          setDialog({ kind: 'editor', mode: 'create', scopes: projectAvailable ? ['user', 'project'] : ['user'] });
        }

        function openEdit(row) {
          if (busyRef.current) return;
          void run('edit', async function () {
            var payload = await api.getSkillDetail({
              scope: row.scope,
              name: row.name,
              projectRoot: dataRef.current && dataRef.current.projectRoot ? dataRef.current.projectRoot : undefined
            });
            var detail = payload && payload.detail ? payload.detail : payload;
            if (!detail || detail.ok === false) throw new Error(t('skills.error.not-found'));
            if (detail.editable === false) {
              setNotice({ kind: 'danger', text: t('skills.editor.unsupported') });
              return;
            }
            setDialog({ kind: 'editor', mode: 'edit', detail: detail });
          });
        }

        async function confirmDelete() {
          var row = dialog && dialog.row;
          if (!row) return;
          await run('delete', async function () {
            await api.skillAction('delete', {
              scope: row.scope,
              name: row.name,
              projectRoot: row.scope === 'project' && data ? data.projectRoot : undefined
            });
            setDialog(null);
            setView('trash');
            setNotice({ kind: 'ok', text: t('skills.notice.deleted') });
            await load({ refresh: true });
          });
        }

        async function confirmRestore() {
          var row = dialog && dialog.row;
          if (!row) return;
          await run('restore', async function () {
            await api.skillAction('restore', { id: row.id, scope: row.scope, name: row.name, projectRoot: row.scope === 'project' && data ? data.projectRoot : undefined });
            setDialog(null);
            setNotice({ kind: 'ok', text: t('skills.notice.restored') });
            await load({ refresh: true });
          });
        }

        async function toggle(row) {
          await run('toggle', async function () {
            var action = row.disabled ? 'enable' : 'disable';
            await api.skillAction(action, {
              scope: row.scope,
              name: row.name,
              projectRoot: row.scope === 'project' && data ? data.projectRoot : undefined
            });
            setNotice({ kind: 'ok', text: t(action === 'disable' ? 'skills.notice.disabled' : 'skills.notice.enabled') });
            await load({ refresh: true });
          });
        }

        function handleConflict(row, failure) {
          var errorBody = failure && failure.body && failure.body.error ? failure.body.error : {};
          var current = errorBody.current || (failure && failure.body && failure.body.current) || {};
          setDialog({ kind: 'conflict', row: row, current: current });
        }

        async function submitWithConflict(draft) {
          var action = draft.mode === 'create' ? 'create' : 'save';
          var payload = {
            scope: draft.scope,
            name: draft.name,
            projectRoot: draft.scope === 'project' && data ? data.projectRoot : undefined,
            description: draft.description,
            body: draft.body,
            expectedFingerprint: draft.expectedFingerprint
          };
          try {
            await run('save', async function () {
              await api.skillAction(action, payload);
              setDialog(null);
              setNotice({ kind: 'ok', text: t(draft.mode === 'create' ? 'skills.notice.created' : 'skills.notice.saved') });
              await load({ refresh: true });
            }, { keepNotice: true, throwOnError: true });
          } catch (failure) {
            if (failure && (failure.code === 'conflict' || failure.status === 409) && draft.mode === 'edit') {
              handleConflict(draft, failure);
              return;
            }
            throw failure;
          }
        }

        var skills = data && Array.isArray(data.skills) ? data.skills : [];
        var writable = skills.filter(function (row) { return row.scope === 'user' || row.scope === 'project'; });
        var readonly = skills.filter(function (row) { return row.scope !== 'user' && row.scope !== 'project'; });
        var filtered = writable.filter(function (row) {
          if (query && String(row.name + ' ' + (row.description || '')).toLowerCase().indexOf(query) < 0) return false;
          if (source !== 'all' && row.scope !== source) return false;
          if (status === 'disabled' && !row.disabled) return false;
          if (status === 'enabled' && row.disabled) return false;
          return true;
        });
        var trash = data && data.trash && Array.isArray(data.trash.items) ? data.trash.items : [];
        var stats = {
          user: writable.filter(function (row) { return row.scope === 'user'; }).length,
          project: writable.filter(function (row) { return row.scope === 'project'; }).length,
          readonly: readonly.length,
          disabled: writable.filter(function (row) { return row.disabled; }).length,
          trash: data && data.trash && Number.isFinite(data.trash.count) ? data.trash.count : trash.length
        };
        var busyNow = Boolean(busy);
        var projectMissing = !data || !data.projectRoot;

        if (page === 'loading' && !data) {
          return h('div', { className: 'sdx-page' }, h('style', null, CSS + '\n' + SKILL_CSS),
            h(Card, { title: t('skills.title') }, h(Spinner, { label: t('skills.refresh') }))
          );
        }
        if (page === 'error' && !data) {
          return h('div', { className: 'sdx-page' }, h('style', null, CSS + '\n' + SKILL_CSS),
            h(ErrorPanel, { t: t, error: skillErrorInfo(t, error), onRetry: function () { void load({ refresh: true }); } })
          );
        }

        return h('div', { className: 'sdx-page' },
          h('style', null, CSS + '\n' + SKILL_CSS),
          h('div', { className: 'sdx-header' },
            h('div', null,
              h('h2', { className: 'sdx-title' }, t('skills.title')),
              h('p', { className: 'sdx-subtitle' }, t('skills.subtitle'))
            ),
            h('div', { className: 'sdx-header-actions' },
              h(Button, { onClick: refresh, disabled: busyNow }, busy && busy.kind === 'refresh' ? t('action.running') : t('skills.refresh')),
              h(Button, { kind: 'primary', onClick: openCreate, disabled: busyNow }, t('skills.new')),
              typeof props.close === 'function' ? h(Button, { onClick: props.close }, t('close')) : null
            )
          ),
          projectMissing ? h(Banner, { tone: 'info' }, t('skills.project.none')) : null,
          notice ? h('div', { className: 'sdx-notice sdx-notice-' + notice.kind, role: 'status', 'aria-live': 'polite' }, notice.text) : null,
          h('div', { className: 'sdx-stats' },
            h(SummaryItem, { label: t('skills.stats.user') }, String(stats.user)),
            h(SummaryItem, { label: t('skills.stats.project') }, String(stats.project)),
            h(SummaryItem, { label: t('skills.stats.readonly') }, String(stats.readonly)),
            h(SummaryItem, { label: t('skills.stats.disabled') }, String(stats.disabled)),
            h(SummaryItem, { label: t('skills.stats.trash') }, String(stats.trash))
          ),
          h('div', { className: 'sdx-tabs', role: 'tablist' },
            h('button', { type: 'button', role: 'tab', 'aria-selected': view === 'list' ? 'true' : 'false', className: 'sdx-tab' + (view === 'list' ? ' is-active' : ''), onClick: function () { setView('list'); } }, t('skills.tab.list')),
            h('button', { type: 'button', role: 'tab', 'aria-selected': view === 'trash' ? 'true' : 'false', className: 'sdx-tab' + (view === 'trash' ? ' is-active' : ''), onClick: function () { setView('trash'); } }, t('skills.tab.trash') + ' (' + stats.trash + ')')
          ),
          view === 'list' ? h(React.Fragment, null,
            h('div', { className: 'sdx-toolbar' },
              h('input', {
                className: 'sdx-input',
                type: 'search',
                value: search,
                placeholder: t('skills.search'),
                'aria-label': t('skills.search'),
                onChange: function (event) { setSearch(event.target.value); }
              }),
              h('label', { className: 'sdx-filter' }, h('span', null, t('skills.filter.source')),
                h('select', { className: 'sdx-select', value: source, onChange: function (event) { setSource(event.target.value); } },
                  ['all', 'user', 'project'].map(function (item) { return h('option', { key: item, value: item }, t('skills.source.' + item)); })
                )
              ),
              h('label', { className: 'sdx-filter' }, h('span', null, t('skills.filter.status')),
                h('select', { className: 'sdx-select', value: status, onChange: function (event) { setStatus(event.target.value); } },
                  ['all', 'enabled', 'disabled'].map(function (item) { return h('option', { key: item, value: item }, t('skills.status.' + item)); })
                )
              )
            ),
            h(Card, null,
              filtered.length ? h('div', { className: 'sdx-table-wrap' },
                h('table', { className: 'sdx-table' },
                  h('thead', null, h('tr', null,
                    h('th', null, t('skills.editor.name')),
                    h('th', null, t('skills.editor.description')),
                    h('th', null, t('skills.filter.source')),
                    h('th', null, t('skills.filter.status')),
                    h('th', null, '')
                  )),
                  h('tbody', null, filtered.map(function (row) {
                    return h(SkillRow, {
                      key: row.scope + ':' + row.name,
                      t: t,
                      row: row,
                      busy: busyNow,
                      onEdit: openEdit,
                      onToggle: toggle,
                      onDelete: function (item) { setDialog({ kind: 'delete', row: item }); }
                    });
                  }))
                )
              ) : h('div', { className: 'sdx-empty' }, h('div', null, t('skills.empty')), h('div', { className: 'sdx-hint' }, t('skills.empty.hint'))),
              readonly.length ? h('details', {
                className: 'sdx-readonly',
                open: readonlyOpen,
                onToggle: function (event) { setReadonlyOpen(event.target.open); }
              },
                h('summary', null, t('skills.readonly.title', { count: readonly.length })),
                h('div', { className: 'sdx-table-wrap' },
                  h('table', { className: 'sdx-table' },
                    h('thead', null, h('tr', null,
                      h('th', null, t('skills.editor.name')),
                      h('th', null, t('skills.editor.description')),
                      h('th', null, t('skills.filter.source')),
                      h('th', null, t('skills.badge.readonly'))
                    )),
                    h('tbody', null, readonly.map(function (row) {
                      var reason = row.readOnlyReason || (row.scope === 'user' || row.scope === 'project' ? 'not-writable' : 'plugin');
                      var reasonText = skillReadOnlyReason(t, reason);
                      return h('tr', { key: 'ro:' + row.scope + ':' + row.name },
                        h('td', { className: 'sdx-name' }, h('code', null, row.name)),
                        h('td', { className: 'sdx-description' }, h('span', { title: row.description || '' }, row.description || '—')),
                        h('td', null, h(SkillChip, { tone: 'source' }, t('skills.badge.' + skillOriginKey(row)))),
                        h('td', { className: 'sdx-hint' }, reasonText)
                      );
                    }))
                  )
                )
              ) : null
            )
          ) : h(Card, null,
            h('p', { className: 'sdx-hint', style: { marginTop: 0 } }, t('skills.trash.note')),
            trash.length ? h('div', { className: 'sdx-table-wrap' },
              h('table', { className: 'sdx-table' },
                h('thead', null, h('tr', null,
                  h('th', null, t('skills.editor.name')),
                  h('th', null, t('skills.filter.source')),
                  h('th', null, t('skills.trash.deletedAt')),
                  h('th', null, t('skills.trash.size')),
                  h('th', null, '')
                )),
                h('tbody', null, trash.map(function (row) {
                  return h('tr', { key: row.id },
                    h('td', { className: 'sdx-name' }, h('code', null, row.name), h('div', { className: 'sdx-hint' }, row.from || '')),
                    h('td', null, t('skills.badge.' + (row.scope === 'project' ? 'project' : 'user'))),
                    h('td', null, formatTime(row.deletedAt, t('unknown'))),
                    h('td', null, formatBytes(row.size, t)),
                    h('td', null,
                      row.restorable === false
                        ? h('span', { className: 'sdx-hint' }, t('skills.trash.missing'))
                        : h(Button, { onClick: function () { setDialog({ kind: 'restore', row: row }); }, disabled: busyNow }, t('skills.action.restore'))
                    )
                  );
                }))
              )
            ) : h('div', { className: 'sdx-empty' }, t('skills.empty.trash'))
          ),
          h('div', { className: 'sdx-footer' },
            h('span', null, data && data.projectRoot ? data.projectRoot : t('skills.project.none')),
            h('span', null, t('footer.version', { version: PAGE_VERSION }))
          ),
          dialog && dialog.kind === 'editor' ? h(SkillEditorDialog, {
            t: t,
            mode: dialog.mode,
            detail: dialog.detail || {},
            scopes: dialog.scopes || ['user'],
            busy: Boolean(busy),
            onCancel: function () { if (!busy) setDialog(null); },
            onSave: submitWithConflict
          }) : null,
          dialog && dialog.kind === 'delete' ? h(SkillConfirmDialog, {
            t: t,
            kind: 'delete',
            row: dialog.row,
            busy: Boolean(busy),
            onCancel: function () { if (!busy) setDialog(null); },
            onConfirm: confirmDelete
          }) : null,
          dialog && dialog.kind === 'restore' ? h(SkillTrashDialog, {
            t: t,
            row: dialog.row,
            busy: Boolean(busy),
            onCancel: function () { if (!busy) setDialog(null); },
            onConfirm: confirmRestore
          }) : null,
          dialog && dialog.kind === 'conflict' ? h(SkillConfirmDialog, {
            t: t,
            kind: 'conflict',
            row: dialog.row,
            current: dialog.current,
            busy: Boolean(busy),
            onCancel: function () { if (!busy) setDialog(null); },
            onConfirm: function () { setDialog(null); if (dialog.row) openEdit(dialog.row); }
          }) : null
        );
      }

      function SettingsPage(props) {
        var t = typeof props.t === 'function'
          ? props.t
          : function (key, params) { return translate('zh', key, params); };
        var api = useMemo(function () { return createApi(); }, []);
        var [data, setData] = useState(null);
        var dataRef = useRef(null);
        var stateRef = useRef(null);
        var alive = useRef(true);
        var failures = useRef(0);
        var abortRef = useRef(null);
        var actionAbortRef = useRef(null);
        var runningRef = useRef(null);
        var [page, setPage] = useState('loading');
        var [error, setError] = useState(null);
        var [running, setRunning] = useState(null);
        var [notice, setNotice] = useState(null);
        var [confirm, setConfirm] = useState(null);
        var [doctor, setDoctor] = useState(null);
        var [doctorLoading, setDoctorLoading] = useState(false);
        var [doctorError, setDoctorError] = useState(null);
        var doctorRequested = useRef(false);
        var confirmRef = useRef(null);
        var pollRef = useRef(null);

        var load = useCallback(async function (options) {
          var opts = options || {};
          var controller = typeof AbortController === 'function' ? new AbortController() : null;
          abortRef.current = controller;
          try {
            var payload = await api.getState({
              projectRoot: stateRef.current ? stateRef.current.projectRoot : undefined,
              signal: controller ? controller.signal : undefined
            });
            if (!alive.current) return;
            var nextState = payload && payload.state ? payload.state : payload;
            stateRef.current = nextState;
            dataRef.current = payload;
            failures.current = 0;
            setData(payload);
            setPage('ready');
            setError(null);
          } catch (failure) {
            if (!alive.current || (failure && failure.name === 'AbortError')) return;
            failures.current += 1;
            if (!stateRef.current) setPage('error');
            setError(failure);
            if (!opts.silent) setNotice(null);
          }
        }, [api]);

        useEffect(function () {
          alive.current = true;
          var doc = typeof document !== 'undefined' ? document : null;
          var timer = null;
          var stopped = false;
          function visible() {
            return !doc || doc.visibilityState !== 'hidden';
          }
          function delay() {
            return Math.min(30000, 5000 * Math.pow(2, Math.min(failures.current, 3)));
          }
          function schedule() {
            if (stopped || !visible()) return;
            timer = setTimeout(tick, delay());
          }
          async function tick() {
            if (stopped) return;
            if (visible()) await load({ silent: true });
            schedule();
          }
          function onVisibility() {
            if (!visible()) {
              clearTimeout(timer);
              return;
            }
            clearTimeout(timer);
            void load({ silent: true }).then(schedule, schedule);
          }
          if (doc) doc.addEventListener('visibilitychange', onVisibility);
          void load().then(function () { schedule(); }, function () { schedule(); });
          return function () {
            stopped = true;
            alive.current = false;
            clearTimeout(timer);
            if (doc) doc.removeEventListener('visibilitychange', onVisibility);
            if (abortRef.current) abortRef.current.abort();
            if (actionAbortRef.current) actionAbortRef.current.abort();
          };
        }, [load]);

        useEffect(function () {
          if (!confirm) return;
          if (confirmRef.current && confirmRef.current.focus) confirmRef.current.focus();
        }, [confirm]);

        var loadDoctor = useCallback(async function (options) {
          var opts = options || {};
          if (!alive.current) return;
          setDoctorLoading(true);
          setDoctorError(null);
          try {
            var payload;
            try {
              payload = await api.getDoctor({
                projectRoot: stateRef.current ? stateRef.current.projectRoot : undefined
              });
            } catch (failure) {
              if (failure && (failure.status === 404 || failure.status === 405)) {
                var actionPayload = await api.postAction('doctor', {
                  projectRoot: stateRef.current ? stateRef.current.projectRoot : undefined
                });
                payload = actionPayload && (actionPayload.doctor || actionPayload.result) ? (actionPayload.doctor || actionPayload.result) : actionPayload;
              } else {
                throw failure;
              }
            }
            if (!alive.current) return;
            setDoctor(payload && payload.doctor ? payload.doctor : payload);
            setDoctorError(null);
          } catch (failure) {
            if (!alive.current) return;
            setDoctorError(failure);
            if (!opts.silent) setNotice({ kind: 'error', text: errorInfo(t, failure).message });
          } finally {
            if (alive.current) setDoctorLoading(false);
          }
        }, [api, t]);

        useEffect(function () {
          if (page !== 'ready' || doctorRequested.current) return;
          doctorRequested.current = true;
          void loadDoctor({ silent: true });
        }, [page, loadDoctor]);

        var run = useCallback(async function (action, options) {
          var opts = options || {};
          if (runningRef.current) return;
          runningRef.current = action;
          setRunning({ action: action, startedAt: Date.now() });
          setNotice(null);
          setError(null);
          var controller = typeof AbortController === 'function' ? new AbortController() : null;
          actionAbortRef.current = controller;
          try {
            var payload;
            if (action === 'doctor') {
              payload = await api.getDoctor({
                projectRoot: stateRef.current ? stateRef.current.projectRoot : undefined,
                signal: controller ? controller.signal : undefined
              });
              if (!alive.current) return;
              setDoctor(payload && payload.doctor ? payload.doctor : payload);
              setDoctorError(null);
            } else {
              payload = await api.postAction(action, {
                names: opts.names,
                projectRoot: stateRef.current ? stateRef.current.projectRoot : undefined,
                dryRun: opts.dryRun,
                force: opts.force,
                signal: controller ? controller.signal : undefined
              });
              if (!alive.current) return;
              if (payload && payload.state) {
                stateRef.current = payload.state;
                setData(function (previous) {
                  var base = previous || {};
                  return Object.assign({}, base, {
                    state: payload.state,
                    busy: payload.busy !== undefined ? payload.busy : null,
                    lastAction: { action: action, ok: true, at: Date.now() }
                  });
                });
              } else {
                await load({ silent: true });
              }
              setNotice({ kind: 'ok', text: t('action.done', { action: t('action.' + action) }) });
              doctorRequested.current = false;
              void loadDoctor({ silent: true });
            }
          } catch (failure) {
            if (!alive.current || (failure && failure.name === 'AbortError')) return;
            var info = errorInfo(t, failure);
            setNotice({ kind: 'error', text: info.title + ': ' + info.message });
            if (failure && failure.status === 409) await load({ silent: true });
          } finally {
            if (alive.current) {
              runningRef.current = null;
              setRunning(null);
            }
          }
        }, [api, load, loadDoctor, t]);

        var state = data && data.state ? data.state : data;
        var targets = useMemo(function () { return normalizeTargets(state); }, [state]);
        var counts = useMemo(function () { return deriveCounts(targets, state); }, [targets, state]);
        var engines = useMemo(function () { return deriveEngines(targets, state); }, [targets, state]);
        var warnings = state && Array.isArray(state.warnings) ? state.warnings : [];
        var limitations = state && Array.isArray(state.limitations) ? state.limitations : [];
        var events = state && Array.isArray(state.events) ? state.events : (data && Array.isArray(data.events) ? data.events : []);
        var lastAction = data && data.lastAction ? data.lastAction : (state && state.lastAction ? state.lastAction : null);
        var phase = state && state.phase ? state.phase : 'booting';
        var enabled = !state || state.enabled !== false;
        var busyAction = running ? running.action : (data && data.busy && data.busy.action);
        var isBusy = Boolean(running || (data && data.busy && data.busy.action));
        var doctorChecks = doctor && Array.isArray(doctor.checks) ? doctor.checks : [];
        var doctorOk = doctor && doctor.ok !== false;
        var projectRoot = state && state.projectRoot ? state.projectRoot : '';
        var sourceSuffix = { explicit: 'Explicit', state: 'State', session: 'Session', cwd: 'Cwd', arg: 'Arg', manual: 'Manual', none: 'None' }[state && state.projectRootSource] || 'None';
        var projectSource = state && state.projectRootSource ? t('state.projectSource' + sourceSuffix) : t('state.projectSourceNone');
        var updatedAt = data && data.serverTime ? formatTime(data.serverTime, t('unknown')) : (state && state.updatedAt ? formatTime(state.updatedAt, t('unknown')) : t('unknown'));
        var actionLabel = function (action) { return t('action.' + action); };
        var confirmFocus = function (node) { confirmRef.current = node; };

        function ask(kind) {
          if (isBusy) return;
          if (kind === 'apply') {
            void run('apply');
            return;
          }
          setConfirm(kind);
        }

        function acceptConfirm() {
          var kind = confirm;
          setConfirm(null);
          if (kind) void run(kind);
        }

        function toggle() {
          if (isBusy) return;
          if (enabled) ask('restore');
          else void run('apply');
        }

        function retry() {
          setError(null);
          setPage(state ? 'ready' : 'loading');
          void load();
        }

        var phaseHint = null;
        if (phase === 'degraded') phaseHint = h(Banner, { tone: 'warning' }, t('notices.degraded'));
        else if (phase === 'failed') phaseHint = h(Banner, { tone: 'danger' }, t('notices.failed'));
        else if (phase === 'stale') phaseHint = h(Banner, { tone: 'warning' }, t('notices.stale'));
        else if (phase === 'restored') {
          phaseHint = h(Banner, {
            tone: 'success'
          }, h('div', null, t('notices.restored'), h('div', { className: 'sdzh-muted' }, t('notices.restoredHint'))),
            h(Button, { onClick: function () { void run('apply'); }, disabled: isBusy }, t('action.apply'))
          );
        } else if (phase === 'booting') {
          phaseHint = h(Banner, { tone: 'info' }, t('phase.booting'));
        }

        var content = null;
        if (page === 'loading' && !state) {
          content = h(Card, null, h(Spinner, { label: t('phase.booting') }));
        } else if (page === 'error' && !state && error) {
          content = h(ErrorPanel, { t: t, error: errorInfo(t, error), onRetry: retry });
        } else {
          var summary = [
            { key: 'skills', label: t('summary.skills'), value: counts.skills.zh + ' / ' + counts.skills.total },
            { key: 'commands', label: t('summary.commands'), value: counts.commands.zh + ' / ' + counts.commands.total },
            { key: 'host', label: t('summary.host'), value: state ? (state.hostVersion || t('unknown')) : t('unknown') },
            { key: 'project', label: t('summary.project'), value: projectRoot ? h('div', null, h('code', null, projectRoot), h('div', { className: 'sdzh-muted' }, projectSource)) : t('state.projectSourceNone') },
            { key: 'warnings', label: t('summary.warnings'), value: String(warnings.length) },
            { key: 'lastAction', label: t('summary.lastAction'), value: data && data.lastAction ? (data.lastAction.action || t('unknown')) : (state && state.lastAction ? state.lastAction.action : t('summary.none')) }
          ];
          var errorBanner = error ? h(Banner, { tone: 'warning' },
            h('div', null, errorInfo(t, error).title, ': ', errorInfo(t, error).message),
            h(Button, { onClick: retry, disabled: isBusy }, t('error.retry'))
          ) : null;
          var noticeBanner = notice ? h(Banner, { tone: notice.kind === 'error' ? 'danger' : 'success' }, notice.text) : null;
          var busyBanner = isBusy ? h(Banner, { tone: 'info' }, h('span', null, t('action.running') + ' ' + actionLabel(busyAction || 'apply')), h(Spinner, null)) : null;
          var restartBanner = state && !state.api ? h(Banner, { tone: 'warning' }, h('div', null, t('notices.restart'), h('div', { className: 'sdzh-muted' }, t('notices.restartHint')))) : null;

          content = h(React.Fragment, null,
            h(Card, { title: t('state.title'), extra: updatedAt },
              h('div', { className: 'sdzh-summary' }, summary.map(function (item) {
                return h(SummaryItem, { key: item.key, label: item.label }, item.value);
              })),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' } },
                phaseHint,
                restartBanner,
                busyBanner,
                errorBanner,
                noticeBanner,
                warnings.length ? h(Banner, { tone: 'warning' },
                  h('div', null,
                    t('summary.warnings') + ' (' + warnings.length + ')',
                    h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, warnings.map(function (warning, index) {
                      return h('li', { key: index }, String(warning));
                    }))
                  )
                ) : null
              )
            ),
            h(Card, null,
              h('div', { className: 'sdzh-toggle-row' },
                h('div', { className: 'sdzh-toggle-copy' },
                  h('div', { className: 'sdzh-toggle-label' }, t('toggle.label')),
                  h('div', { className: 'sdzh-muted' }, t('toggle.hint')),
                  h('div', { className: 'sdzh-muted', style: { marginTop: '4px' } },
                    h('span', null, t('state.enabled') + ': ' + (enabled ? t('state.enabledOn') : t('state.enabledOff'))),
                    h('span', { style: { marginLeft: '10px' } }, h('span', null, t('status.phase') + ': '), phaseLabel(t, phase)),
                    h('span', { style: { marginLeft: '10px' } }, t('summary.engine') + ': '), Object.keys(engines).map(function (key, index) {
                      return h('span', { key: key }, (index ? ' · ' : '') + t('engine.' + key) + ' ' + engines[key]);
                    })
                  )
                ),
                h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' } },
                  h(Switch, { checked: enabled, disabled: isBusy, label: t('toggle.label'), onChange: toggle }),
                  h('span', { className: 'sdzh-muted' }, enabled ? t('toggle.on') : t('toggle.off'))
                )
              ),
              h('div', { className: 'sdzh-actions', style: { marginTop: '13px' }, role: 'group', 'aria-label': t('status.actions') },
                h(Button, { kind: 'primary', onClick: function () { ask('apply'); }, disabled: isBusy }, t('action.apply')),
                h(Button, { kind: 'danger', onClick: function () { ask('restore'); }, disabled: isBusy || !enabled }, t('action.restore')),
                h(Button, { onClick: function () { void run('refresh'); }, disabled: isBusy || !enabled }, t('action.refresh')),
                h(Button, { onClick: function () { ask('retranslate'); }, disabled: isBusy || !enabled }, t('action.retranslate')),
                h(Button, { onClick: function () { void loadDoctor(); }, disabled: isBusy || doctorLoading }, doctorLoading ? t('action.running') : t('action.doctor'))
              )
            ),
            h(Card, { title: t('table.title'), extra: targets.length + ' / 15' },
              h(TargetTable, { t: t, targets: targets })
            ),
            h(Card, { title: t('doctor.title'), extra: h(Button, { onClick: function () { void loadDoctor(); }, disabled: isBusy || doctorLoading }, t('doctor.run')) },
              doctorLoading ? h(Spinner, { label: t('action.running') }) : null,
              doctorError ? h(Banner, { tone: 'warning' }, errorInfo(t, doctorError).title + ': ' + errorInfo(t, doctorError).message) : null,
              doctor && !doctorLoading ? h('div', null,
                h('div', { className: 'sdzh-muted', style: { marginBottom: '8px' } },
                  t('doctor.checks') + ': ' + (doctorOk ? t('doctor.ok') : t('doctor.failed')),
                  doctor.limitations && doctor.limitations.length ? ' · ' + t('doctor.limitations') + ' ' + doctor.limitations.length : ''
                ),
                h(CheckList, { t: t, checks: doctorChecks }),
                doctor.limitations && doctor.limitations.length ? h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px' } }, doctor.limitations.map(function (item, index) {
                  return h('li', { key: index }, String(item));
                })) : null
              ) : (!doctor && !doctorLoading ? h('p', { className: 'sdzh-muted', style: { margin: 0 } }, t('doctor.empty')) : null)
            ),
            h(Card, { title: t('events.title') },
              events.length ? h('details', null,
                h('summary', { className: 'sdzh-link-button' }, t('events.title') + ' (' + events.length + ')'),
                h('pre', { className: 'sdzh-pre' }, JSON.stringify(events.slice(-10), null, 2))
              ) : (lastAction
                ? h('div', null,
                    h('div', { className: 'sdzh-muted' }, t('events.lastAction')),
                    h('div', null,
                      h('code', null, lastAction.action || t('unknown')),
                      lastAction.ok === false ? ' · ' + t('doctor.failed') : '',
                      lastAction.at ? ' · ' + formatTime(lastAction.at, t('unknown')) : ''
                    )
                  )
                : h('p', { className: 'sdzh-muted', style: { margin: 0 } }, t('events.empty'))),
              state && state.eventsFile ? h('p', { className: 'sdzh-muted', style: { margin: '8px 0 0' } }, t('config.eventsFile') + ': ', h('code', null, state.eventsFile)) : null
            ),
            h(Card, { title: t('config.title') },
              state && state.api ? h('div', { className: 'sdzh-dl' },
                h('dt', null, t('config.version')), h('dd', null, state.api.version || PAGE_VERSION),
                h('dt', null, t('config.api')), h('dd', null, h('code', null, state.api.prefix || API_BASE), ' · ', String(Array.isArray(state.api.actions) ? state.api.actions.length : ACTIONS.length) + ' actions'),
                h('dt', null, t('config.targets')), h('dd', null, counts.skills.total + ' skills · ' + counts.commands.total + ' commands'),
                h('dt', null, t('state.enabled')), h('dd', null, enabled ? t('yes') : t('no')),
                h('dt', null, t('summary.project')), h('dd', null, projectRoot ? h('code', null, projectRoot) : t('state.projectSourceNone'), projectRoot ? ' · ' + projectSource : ''),
                h('dt', null, t('summary.host')), h('dd', null, state.hostVersion || t('unknown')),
                h('dt', null, t('config.stateFile')), h('dd', null, h('code', null, state.stateFile || '\u2014')),
                h('dt', null, t('config.eventsFile')), h('dd', null, h('code', null, state.eventsFile || '\u2014'))
              ) : h('p', { className: 'sdzh-muted', style: { margin: 0 } }, t('config.unavailable')),
              state && state.config ? h('div', { className: 'sdzh-dl', style: { marginTop: '10px' } },
                h('dt', null, t('config.allowlist')), h('dd', null, JSON.stringify(state.config.projectAllowlist || [])),
                h('dt', null, t('config.restoreOnQuit')), h('dd', null, state.config.restoreOnQuit ? t('yes') : t('no')),
                h('dt', null, t('config.model')), h('dd', null, state.config.llm && (state.config.llm.provider || state.config.llm.model) ? ((state.config.llm.provider || '') + ' / ' + (state.config.llm.model || '')) : t('summary.none'))
              ) : (state && state.api ? h('p', { className: 'sdzh-muted', style: { margin: '10px 0 0' } }, t('config.hostOnly') + ': ' + t('config.hostOnlyHint')) : null),
              limitations.length ? h('div', { className: 'sdzh-muted', style: { marginTop: '10px' } }, t('doctor.limitations') + ': ' + limitations.join('；')) : null
            ),
            h('div', { className: 'sdzh-footer' },
              h('span', null, t('footer.hint')),
              h('span', null, t('footer.version', { version: PAGE_VERSION }))
            )
          );
        }

        return h('section', { className: 'sdzh-page', 'aria-labelledby': 'sdzh-title' },
          h('style', null, CSS),
          h('header', { className: 'sdzh-header' },
            h('div', { className: 'sdzh-heading' },
              h('h2', { className: 'sdzh-title', id: 'sdzh-title' }, t('title')),
              h('p', { className: 'sdzh-subtitle' }, t('subtitle'))
            ),
            h('div', { className: 'sdzh-header-actions' },
              h(Badge, { phase: phase }, phaseLabel(t, phase)),
              typeof props.close === 'function' ? h(Button, { onClick: props.close, title: t('close') }, t('close')) : null
            )
          ),
          content,
          confirm ? h(Dialog, { t: t, kind: confirm, onCancel: function () { setConfirm(null); }, onConfirm: acceptConfirm, confirmRef: confirmFocus }) : null
        );
      }

      function fallbackT(key, params) {
        return translate('zh', key, params);
      }

      class Boundary extends Component {
        constructor(props) {
          super(props);
          this.state = { failed: false };
        }
        static getDerivedStateFromError() {
          return { failed: true };
        }
        componentDidCatch(error) {
          if (typeof console !== 'undefined' && console.error) console.error('skill-desc-zh settings page failed:', error);
        }
        render() {
          if (this.state.failed) {
            return h('div', { className: 'sdzh-page' },
              h('style', null, CSS),
              h(Card, { title: (this.props.t || fallbackT)('error.title') },
                h(Banner, { tone: 'danger' }, (this.props.t || fallbackT)('error.unknown'))
              )
            );
          }
          return this.props.children;
        }
      }

      function BetterSkillPage(props) {
        var t = typeof props.t === 'function'
          ? props.t
          : function (key, params) { return translate('zh', key, params); };
        var [tab, setTab] = useState(function () { return selectInitialTab(); });
        var active = normalizeTabId(tab);

        function activate(next, focusTab) {
          var id = normalizeTabId(next);
          setTab(id);
          writeStoredTab(id);
          if (focusTab && typeof document !== 'undefined' && document.getElementById) {
            var node = document.getElementById('sdzh-tab-' + id);
            if (node && typeof node.focus === 'function') node.focus();
          }
        }

        function onTabKeyDown(event) {
          if (!event || ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
          if (typeof event.preventDefault === 'function') event.preventDefault();
          activate(nextTabId(active, event.key), true);
        }

        var ActivePage = active === 'plugins'
          ? PluginAdminPage
          : active === 'skills' ? SkillAdminPage : SettingsPage;
        return h('div', { className: 'sdzh-page sdzh-page-tabs' },
          h('style', null, CSS + '\n' + SKILL_CSS),
          h('div', { className: 'sdzh-page-tabbar', role: 'tablist', 'aria-label': t('tabs.label') },
            TABS.map(function (item) {
              var selected = item.id === active;
              var tabProps = {
                key: item.id,
                id: 'sdzh-tab-' + item.id,
                type: 'button',
                role: 'tab',
                className: 'sdzh-page-tab' + (selected ? ' is-active' : ''),
                'aria-selected': selected ? 'true' : 'false',
                tabIndex: selected ? 0 : -1,
                onClick: function () { activate(item.id, false); },
                onKeyDown: onTabKeyDown
              };
              if (selected) tabProps['aria-controls'] = 'sdzh-panel-' + active;
              return h('button', tabProps, t(item.labelKey));
            })
          ),
          h('div', {
            id: 'sdzh-panel-' + active,
            className: 'sdzh-page-panel',
            role: 'tabpanel',
            'aria-labelledby': 'sdzh-tab-' + active,
            tabIndex: 0
          },
            h(Boundary, { key: active, t: t }, h(ActivePage, Object.assign({}, props, { t: t })))
          )
        );
      }

      function apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, DICT);
        }, 'skill-desc-zh: locale');
        var t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'skill-desc-zh',
            order: PAGE_ORDER,
            label: function () { return t('nav'); },
            locale: NS
          }, function BetterSkillPanel(props) {
            return h(BetterSkillPage, Object.assign({}, props, { t: props.t || t }));
          });
        });
      }

      module.exports = {
        inject: ['slots', 'locale'],
        apply: apply,
        __test__: {
          NS: NS,
          API_BASE: API_BASE,
          PAGE_ORDER: PAGE_ORDER,
          PAGE_VERSION: PAGE_VERSION,
          TAB_STORAGE_KEY: TAB_STORAGE_KEY,
          TAB_IDS: TAB_IDS,
          TAB_LABELS: TAB_LABELS,
          ACTIONS: ACTIONS,
          DICT: DICT,
          readStoredTab: readStoredTab,
          writeStoredTab: writeStoredTab,
          selectInitialTab: selectInitialTab,
          nextTabId: nextTabId,
          createApi: createApi,
          normalizeTargets: normalizeTargets,
          parseDetailLine: parseDetailLine,
          deriveCounts: deriveCounts,
          deriveEngines: deriveEngines,
          errorInfo: errorInfo,
          phaseToken: phaseToken,
          translate: translate,
          BetterSkillPage: BetterSkillPage,
          SettingsPage: SettingsPage,
          PluginAdminPage: PluginAdminPage,
          SkillAdminPage: SkillAdminPage,
          Boundary: Boundary
        }
      };
      return module.exports;
    }
  });
})();
