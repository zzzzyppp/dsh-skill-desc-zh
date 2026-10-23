import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DICTIONARY,
  RETRY_HINT,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_COMMANDS,
  contentHash,
  descriptionHash,
  loadDictionary,
  sourceHash,
  translateBatch,
  translateOne,
  validateTranslation,
} from '../lib/translate.js';

/* 12 个已知 SKILL.md 的英文描述原文（与 frontmatter 解析结果逐字一致）。 */
const EN = {
  office: 'Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs. Load to choose the relevant workflow.',
  docx: 'Create, read, edit, and validate Word documents (.docx).',
  exportPdf: 'Convert an Office document to a requested PDF with LibreOffice Kit.',
  pptx: 'Create, read, edit, and validate PowerPoint presentations (.pptx).',
  recalculate: 'Refresh spreadsheet formula caches and verify calculated values with LibreOffice Kit.',
  render: 'Render requested document images or inspect visual layout with LibreOffice Kit.',
  xlsx: 'Read, create, edit, and validate Excel workbooks, data, and formulas (.xlsx).',
  agentExperience: 'Use when writing or changing a model-facing tool definition (name, description, parameter schema, or its system-prompt section), and when designing skills, context loading, or multi-step workflows, to make information discoverable and use context efficiently.',
  cordisCompositionReference: 'Use when writing or reading a Cordis bundle patch or agent preset for this harness and you need the Loader YAML dialect (insert, override by id, group, disabled, isolate, !!js) or the list of installable Harness plugin packages and what each provides.',
  cordisPluginDevelopment: 'Use when designing, reviewing, adding, enabling, disabling, installing, configuring, or debugging a plugin, bundle, feature, page, panel, tool, or MCP connection in the current Harness profile, including a shipped plugin that is disabled by default, and for any visual object, decoration, or widget request that names no other destination, which means an installed UI plugin rendered in the Harness Web UI.',
  editingCordisCompositions: 'Use when creating, changing, or validating an agent preset or other Cordis composition for this harness, including deciding host versus preset placement and checking that an authored preset mounts.',
  browserSkill: "Automate the user's logged-in Chromium through this plugin's injected bsk_* tools. Use to read pages, fill forms, operate tabs, inspect page activity, debug a website, or test a UI.",
};

const CASES = [
  ['office', EN.office],
  ['office-docx', EN.docx],
  ['office-export-pdf', EN.exportPdf],
  ['office-pptx', EN.pptx],
  ['office-recalculate', EN.recalculate],
  ['office-render', EN.render],
  ['office-xlsx', EN.xlsx],
  ['agent-experience', EN.agentExperience],
  ['cordis-composition-reference', EN.cordisCompositionReference],
  ['cordis-plugin-development', EN.cordisPluginDevelopment],
  ['editing-cordis-compositions', EN.editingCordisCompositions],
  ['browser-skill', EN.browserSkill],
];

const ZH_DOCX = DICTIONARY[EN.docx];
const ZH_XLSX = DICTIONARY[EN.xlsx];

/* v0.2 三条斜杠命令描述：键=英文原文，值=中文（command-desc-design §5.2/5.3）。 */
const COMMAND_CASES = [
  ['command:acp', 'Show bili context-compression status', '显示 bili 上下文压缩状态'],
  ['command:acp-cache', 'Prompt-cache reconciliation (same report as the acp_cache tool)', '提示词缓存对账（与 acp_cache 工具同源同报）'],
  ['command:agent-teams', 'run a goal with a multi-agent team (you become the captain)', '以多智能体团队运行目标（你将成为队长）'],
];

function mockLlm({ onPrepare, text } = {}) {
  const calls = [];
  const service = {
    calls,
    providers: [],
    models: {},
    listProviders() {
      return this.providers;
    },
    async listModels(provider) {
      return this.models[provider] ?? [];
    },
    async prepareCall(config, signal) {
      const call = { config, signal, index: calls.length };
      calls.push(call);
      if (onPrepare) return onPrepare(call);
      return {
        config,
        async *stream(options) {
          const value = typeof text === 'function' ? text(call, options) : text;
          yield { type: 'text-delta', index: 0, text: value };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
  return service;
}

function okLlm(mapping, extra = {}) {
  return mockLlm({
    ...extra,
    onPrepare: (call) => ({
      config: call.config,
      async *stream(options) {
        const value = JSON.stringify(mapping);
        yield { type: 'text-delta', index: 0, text: value };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
  });
}

/* ------------------------------------------------------------------ */
/* 词典                                                                */
/* ------------------------------------------------------------------ */

test('内置词典：15 条已知描述（12 技能 + 3 命令），键为英文原文全串，值通过校验', () => {
  assert.equal(Object.keys(DICTIONARY).length, 15);
  const keys = new Set(Object.keys(DICTIONARY));
  for (const [name, en] of CASES) {
    assert.ok(keys.has(en), `${name} 的英文原文应是词典键`);
    const zh = DICTIONARY[en];
    assert.equal(typeof zh, 'string', name);
    const check = validateTranslation({ name, en, zh });
    assert.equal(check.ok, true, `${name}: ${check.reason}`);
    assert.equal(check.zh, zh);
  }
});

test('内置词典：3 条斜杠命令描述逐字正确且通过校验', () => {
  for (const [name, en, expected] of COMMAND_CASES) {
    assert.equal(DICTIONARY[en], expected, `${name} 的词典值必须逐字一致`);
    const check = validateTranslation({ name, en, zh: DICTIONARY[en] });
    assert.equal(check.ok, true, `${name}: ${check.reason}`);
    assert.equal(check.zh, expected);
  }
});

test('loadDictionary：文件缺失时返回空词典并 warning，不抛错', () => {
  const warnings = [];
  const dictionary = loadDictionary({
    file: new URL('./missing-dictionary.json', import.meta.url),
    logger: { warn: (message) => warnings.push(message) },
  });
  assert.deepEqual(Object.keys(dictionary), []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /无法加载内置词典/);
});

/* ------------------------------------------------------------------ */
/* 哈希                                                                */
/* ------------------------------------------------------------------ */

test('sourceHash：稳定、覆盖 hostVersion/name/description/content/resourceBase', () => {
  const base = {
    name: 'office-docx',
    description: EN.docx,
    content: 'body',
    resourceBase: { kind: 'asar' },
    hostVersion: '1.0.0',
  };
  const first = sourceHash(base);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, sourceHash({ ...base }));

  assert.notEqual(first, sourceHash({ ...base, hostVersion: '1.0.1' }));
  assert.notEqual(first, sourceHash({ ...base, name: 'office-xlsx' }));
  assert.notEqual(first, sourceHash({ ...base, description: `${EN.docx} v2` }));
  // description 两端空白会被归一化（frontmatter 解析结果本身不含两端空白）。
  assert.equal(first, sourceHash({ ...base, description: `  ${EN.docx}  ` }));
  assert.notEqual(first, sourceHash({ ...base, content: 'body2' }));
  assert.notEqual(first, sourceHash({ ...base, resourceBase: { kind: 'file' } }));

  // contentHash 不含 name / hostVersion，sourceHash 才含。
  assert.equal(contentHash(base), contentHash({ ...base, name: 'other', hostVersion: '9.9.9' }));
  assert.notEqual(sourceHash(base), sourceHash({ ...base, hostVersion: '' }));
  assert.equal(descriptionHash(EN.docx), descriptionHash(` ${EN.docx} `));
});

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

test('validateTranslation：缺字段、多行、无中文、同文、超长、危险包装均拒绝', () => {
  assert.deepEqual(validateTranslation(), { ok: false, reason: 'not-a-string' });
  assert.deepEqual(validateTranslation({ en: 'Use it.', zh: 42 }), { ok: false, reason: 'not-a-string' });
  assert.deepEqual(validateTranslation({ en: 'Use it.', zh: '   ' }), { ok: false, reason: 'empty' });
  assert.deepEqual(validateTranslation({ en: 'Use it.', zh: '第一行\n第二行' }), { ok: false, reason: 'multiline' });
  assert.deepEqual(validateTranslation({ en: 'Use it.', zh: 'Use it.' }), { ok: false, reason: 'missing-cjk' });
  assert.deepEqual(
    validateTranslation({ en: 'Use it.', zh: 'Use it. 使用它。' }),
    { ok: true, zh: 'Use it. 使用它。' },
  );
  assert.deepEqual(
    validateTranslation({ en: '中文原文', zh: '中文原文' }),
    { ok: false, reason: 'identical' },
  );
  assert.deepEqual(
    validateTranslation({ en: 'Use it.', zh: '使用它。' }).ok,
    true,
  );

  // 绝对长度上限 400（与原文倍数无关时也要拦）。
  const longEn = 'x'.repeat(1000);
  assert.deepEqual(
    validateTranslation({ en: longEn, zh: '中'.repeat(401) }),
    { ok: false, reason: 'too-long' },
  );

  // 相对原文 1.6 倍。
  assert.equal(
    validateTranslation({ en: 'Use it.', zh: '使用它并检查全部内容是否完全正确。' }).reason,
    'too-long-vs-source',
  );

  assert.equal(
    validateTranslation({ en: 'Use it.', zh: '--- 使用它。' }).reason,
    'frontmatter',
  );
  assert.equal(
    validateTranslation({ en: 'Use it.', zh: '```使用它```' }).reason,
    'code-fence',
  );
  assert.equal(
    validateTranslation({ en: 'Create a document.', zh: 'description: 使用它。' }).reason,
    'description-prefix',
  );
  assert.equal(
    validateTranslation({ en: 'Use it.', zh: '"使用它。"' }).reason,
    'quote-wrapped',
  );
});

test('validateTranslation：允许中文引号、括号、&、emoji 等特殊字符', () => {
  const en = 'Create a report for the team and validate it.';
  const zh = '为团队创建报告 ✅（含特殊字符 & 标点）；检查“结果”是否合格。';
  const check = validateTranslation({ name: 'special', en, zh });
  assert.equal(check.ok, true, check.reason);
  assert.equal(check.zh, zh);
});

/* ------------------------------------------------------------------ */
/* 批处理：词典 / 缺字段 / 已中文                                       */
/* ------------------------------------------------------------------ */

test('translateBatch：词典命中、未知技能回退英文并 warning、name 原样保留', async () => {
  const out = await translateBatch({
    items: [
      { name: 'office-docx', description: EN.docx },
      { name: 'brand-new-skill', description: 'A brand new skill description.' },
    ],
    engine: 'dictionary',
  });

  assert.equal(out.engine, 'mixed');
  assert.deepEqual(out.counts, { llm: 0, dictionary: 1, source: 0, none: 1 });

  const docx = out.results['office-docx'];
  assert.equal(docx.name, 'office-docx');
  assert.equal(docx.engine, 'dictionary');
  assert.equal(docx.zh, ZH_DOCX);
  assert.equal(docx.text, ZH_DOCX);
  assert.equal(docx.cached, false);
  assert.match(docx.fingerprint, /^[a-f0-9]{64}$/);

  const unknown = out.results['brand-new-skill'];
  assert.equal(unknown.name, 'brand-new-skill');
  assert.equal(unknown.engine, 'none');
  assert.equal(unknown.zh, null);
  assert.equal(unknown.text, 'A brand new skill description.');
  assert.equal(out.translations['brand-new-skill'], 'A brand new skill description.');
  assert.match(out.warnings.join('\n'), /brand-new-skill: 无可用中文译文，保留英文/);
});

test('translateBatch：缺 description 回退空串并 warning，name 缺失直接拒绝', async () => {
  const out = await translateBatch({ items: [{ name: 'broken-skill' }], engine: 'dictionary' });
  assert.equal(out.results['broken-skill'].engine, 'none');
  assert.equal(out.results['broken-skill'].zh, null);
  assert.equal(out.results['broken-skill'].text, '');
  assert.equal(out.results['broken-skill'].error, 'missing-description');
  assert.match(out.warnings.join('\n'), /缺少 description/);

  await assert.rejects(
    () => translateBatch({ items: [{ description: 'no name' }] }),
    /name/,
  );
  await assert.rejects(() => translateBatch({ items: 'nope' }), /items/);
});

test('translateBatch：输入已是中文时走 source，不调用 LLM', async () => {
  let called = 0;
  const llm = mockLlm({
    onPrepare: () => {
      called += 1;
      throw new Error('不应调用 LLM');
    },
  });
  const out = await translateBatch({
    items: [{ name: 'already-zh', description: '创建、编辑并校验文档。' }],
    llm,
    model: { provider: 'p', model: 'm' },
  });
  assert.equal(out.results['already-zh'].engine, 'source');
  assert.equal(out.results['already-zh'].zh, '创建、编辑并校验文档。');
  assert.equal(out.results['already-zh'].text, '创建、编辑并校验文档。');
  assert.equal(out.engine, 'source');
  assert.equal(called, 0);
});

/* ------------------------------------------------------------------ */
/* LLM 成功 / 校验 / 重试                                              */
/* ------------------------------------------------------------------ */

test('translateBatch：LLM 成功路径（代码块包裹 JSON 也能解析）、只发送 name→英文、缓存落盘', async () => {
  const seen = { payloads: [], systems: [], options: [] };
  const llm = mockLlm({
    onPrepare: (call) => ({
      config: call.config,
      async *stream(options) {
        seen.systems.push(options.system);
        seen.options.push(options);
        seen.payloads.push(JSON.parse(options.messages[0].content[0].text));
        yield { type: 'text-delta', index: 0, text: `\`\`\`json\n${JSON.stringify({ 'office-docx': ZH_DOCX })}\n\`\`\`` };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
  });

  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'deepseek-account', model: 'deepseek-flash' },
    now: () => '2026-10-21T00:00:00.000Z',
  });

  const result = out.results['office-docx'];
  assert.equal(result.engine, 'llm');
  assert.equal(result.zh, ZH_DOCX);
  assert.equal(result.cached, false);
  assert.equal(result.model, 'deepseek-account/deepseek-flash');
  assert.equal(out.engine, 'llm');

  assert.deepEqual(seen.payloads[0], { 'office-docx': EN.docx });
  assert.equal(seen.systems[0], SYSTEM_PROMPT);
  assert.equal(seen.options[0].system, SYSTEM_PROMPT);
  assert.equal(typeof seen.options[0].signal?.aborted, 'boolean');
  assert.equal(seen.options[0].model, 'deepseek-flash');
  assert.equal(seen.options[0].provider, 'deepseek-account');
  assert.equal(seen.options[0].reasoningEffort, 'off');

  assert.equal(llm.calls[0].config.reasoningEffort, 'off');
  assert.equal(llm.calls[0].config.maxTokens, 2048);

  const fingerprint = sourceHash({ name: 'office-docx', description: EN.docx });
  const entry = out.cache[fingerprint];
  assert.ok(entry, '应按 fingerprint 写入缓存');
  assert.equal(entry.zh, ZH_DOCX);
  assert.equal(entry.engine, 'llm');
  assert.equal(entry.model, 'deepseek-account/deepseek-flash');
  assert.equal(entry.enHash, contentHash({ description: EN.docx }));
  assert.equal(entry.translatedAt, '2026-10-21T00:00:00.000Z');
});

test('translateBatch：systemPrompt 透传自定义命令提示词，技能默认提示词不变', async () => {
  const seen = { systems: [], options: [] };
  const llm = mockLlm({
    onPrepare: (call) => ({
      config: call.config,
      async *stream(options) {
        seen.systems.push(options.system);
        seen.options.push(options);
        yield {
          type: 'text-delta',
          index: 0,
          text: JSON.stringify({ 'command:acp': COMMAND_CASES[0][2] }),
        };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
  });

  const out = await translateBatch({
    items: [{ name: 'command:acp', description: COMMAND_CASES[0][1] }],
    llm,
    model: { provider: 'p', model: 'm' },
    systemPrompt: SYSTEM_PROMPT_COMMANDS,
  });

  assert.equal(out.results['command:acp'].engine, 'llm');
  assert.equal(out.results['command:acp'].zh, COMMAND_CASES[0][2]);
  assert.equal(seen.systems[0], SYSTEM_PROMPT_COMMANDS);
  assert.equal(llm.calls[0].config.system, SYSTEM_PROMPT_COMMANDS);
  assert.equal(seen.options[0].system, SYSTEM_PROMPT_COMMANDS);
  assert.notEqual(seen.options[0].system, SYSTEM_PROMPT);
});

test('translateBatch：LLM 返回非法命令译文时回退词典', async () => {
  const llm = okLlm({ 'command:acp': COMMAND_CASES[0][1] }); // 与英文相同：missing-cjk/identical
  const out = await translateBatch({
    items: [{ name: 'command:acp', description: COMMAND_CASES[0][1] }],
    llm,
    model: { provider: 'p', model: 'm' },
    dictionary: DICTIONARY,
  });

  assert.equal(out.results['command:acp'].engine, 'dictionary');
  assert.equal(out.results['command:acp'].zh, COMMAND_CASES[0][2]);
  assert.match(out.warnings.join('\n'), /LLM 翻译失败|LLM 译文不合格/);
});

test('translateBatch：兼容 block-start/text-delta/block-end 流，block-end 文本优先', async () => {
  const llm = mockLlm({
    onPrepare: (call) => ({
      config: call.config,
      async *stream() {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: '{"office-docx":"半截' };
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: JSON.stringify({ 'office-docx': ZH_DOCX }) },
        };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
  });

  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
  });
  assert.equal(out.results['office-docx'].engine, 'llm');
  assert.equal(out.results['office-docx'].zh, ZH_DOCX);
});

test('translateBatch：只有 reasoning、没有 text 时词典兜底', async () => {
  const llm = mockLlm({
    onPrepare: (call) => ({
      config: call.config,
      async *stream() {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' };
        yield { type: 'reasoning-delta', index: 0, text: '先想一想' };
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先想一想' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
  });

  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
  });
  const result = out.results['office-docx'];
  assert.equal(result.engine, 'dictionary');
  assert.equal(result.zh, ZH_DOCX);
  assert.ok(out.warnings.some((line) => line.includes('LLM')));
});

test('translateBatch：忽略 reasoning 增量，仍采用 text 块（思考模型兼容）', async () => {
  const llm = mockLlm({
    onPrepare: (call) => ({
      config: call.config,
      async *stream() {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' };
        yield { type: 'reasoning-delta', index: 0, text: '先分析一下' };
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '先分析一下' } };
        yield { type: 'block-start', index: 1, blockType: 'text' };
        yield { type: 'text-delta', index: 1, text: JSON.stringify({ 'office-docx': ZH_DOCX }) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
  });

  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
  });
  assert.equal(out.results['office-docx'].engine, 'llm');
  assert.equal(out.results['office-docx'].zh, ZH_DOCX);
});

test('translateBatch：LLM 尝试工具调用时词典兜底', async () => {
  const llm = mockLlm({
    onPrepare: (call) => ({
      config: call.config,
      async *stream() {
        yield { type: 'tool-call-delta', index: 0, id: 'c1', name: 'x', argumentsDelta: '{}' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
  });

  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
  });
  assert.equal(out.results['office-docx'].engine, 'dictionary');
  assert.ok(out.warnings.some((line) => line.includes('LLM')));
});

test('translateBatch：首次非 JSON 自动重试 1 次，第二次成功', async () => {
  const systems = [];
  const llm = mockLlm({
    onPrepare: (call) => ({
      config: call.config,
      async *stream(options) {
        systems.push(options.system);
        const value = call.index === 0
          ? '抱歉，我不能只输出 JSON。'
          : JSON.stringify({ 'office-docx': ZH_DOCX });
        yield { type: 'text-delta', index: 0, text: value };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
  });

  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
  });

  assert.equal(llm.calls.length, 2);
  assert.equal(out.results['office-docx'].engine, 'llm');
  assert.equal(systems[0], SYSTEM_PROMPT);
  assert.match(systems[1], new RegExp(RETRY_HINT.slice(0, 8)));
});

test('translateBatch：LLM 部分条目不合法时，合法条目用 LLM、非法条目走词典', async () => {
  const llm = okLlm({
    'office-docx': ZH_DOCX,
    'office-xlsx': 'English only, not translated.', // 无 CJK，应被拒绝
  });

  const out = await translateBatch({
    items: [
      { name: 'office-docx', description: EN.docx },
      { name: 'office-xlsx', description: EN.xlsx },
    ],
    llm,
    model: { provider: 'p', model: 'm' },
    dictionary: DICTIONARY,
  });

  assert.equal(out.results['office-docx'].engine, 'llm');
  assert.equal(out.results['office-xlsx'].engine, 'dictionary');
  assert.equal(out.results['office-xlsx'].zh, ZH_XLSX);
  assert.match(out.warnings.join('\n'), /office-xlsx: LLM 译文不合格（missing-cjk）/);
});

test('translateBatch：LLM 输出的换行会被压成单行后接受', async () => {
  const llm = okLlm({ 'office-docx': '创建、读取、\n编辑并校验 Word 文档（.docx）。' });
  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
  });
  assert.equal(out.results['office-docx'].engine, 'llm');
  assert.equal(out.results['office-docx'].zh, '创建、读取、 编辑并校验 Word 文档（.docx）。');
});

/* ------------------------------------------------------------------ */
/* LLM 失败 / 无模型 / 超时                                            */
/* ------------------------------------------------------------------ */

test('translateBatch：LLM 不可用时词典兜底 + warning', async () => {
  const llm = mockLlm({
    onPrepare: () => {
      throw new Error('model offline');
    },
  });
  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
    dictionary: DICTIONARY,
  });

  assert.equal(out.results['office-docx'].engine, 'dictionary');
  assert.equal(out.results['office-docx'].zh, ZH_DOCX);
  assert.match(out.warnings.join('\n'), /LLM 翻译失败（model offline）/);
  assert.ok(llm.calls.length >= 2, '应尝试 reasoningEffort=off 与默认参数各一次');
});

test('translateBatch：无 llm、词典也无该条时保留英文', async () => {
  const out = await translateBatch({
    items: [{ name: 'new-skill', description: 'A brand new skill description.' }],
    dictionary: {},
  });
  assert.equal(out.results['new-skill'].engine, 'none');
  assert.equal(out.results['new-skill'].zh, null);
  assert.equal(out.results['new-skill'].text, 'A brand new skill description.');
  assert.match(out.warnings.join('\n'), /未提供可用的 LLM 服务/);
  assert.match(out.warnings.join('\n'), /new-skill: 无可用中文译文/);
});

test('translateBatch：无模型时三条命令描述全部回退词典', async () => {
  const out = await translateBatch({
    items: COMMAND_CASES.map(([name, description]) => ({ name, description })),
    dictionary: DICTIONARY,
    engine: 'auto',
  });

  assert.equal(out.counts.dictionary, 3);
  assert.equal(out.counts.none, 0);
  assert.equal(out.engine, 'dictionary');
  for (const [name, en, expected] of COMMAND_CASES) {
    assert.equal(out.results[name].engine, 'dictionary', name);
    assert.equal(out.results[name].zh, expected, name);
    assert.equal(out.results[name].text, expected, name);
    assert.equal(out.results[name].en, en, name);
  }
  assert.match(out.warnings.join('\n'), /未提供可用的 LLM 服务/);
});

test('translateBatch：LLM 超时按失败处理并词典兜底（不无限等待）', async () => {
  const llm = mockLlm({
    onPrepare: (call) => ({
      config: call.config,
      async *stream(options) {
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(options.signal.reason ?? new Error('aborted'));
          if (options.signal.aborted) onAbort();
          else options.signal.addEventListener('abort', onAbort, { once: true });
        });
      },
    }),
  });

  const started = Date.now();
  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
    timeoutMs: 40,
    dictionary: DICTIONARY,
  });
  const elapsed = Date.now() - started;

  assert.equal(out.results['office-docx'].engine, 'dictionary');
  assert.match(out.warnings.join('\n'), /LLM 翻译超时/);
  assert.ok(elapsed < 2000, `超时没有及时返回：${elapsed}ms`);
});

test('translateBatch：模型不接受 reasoningEffort=off 时自动降级为默认参数', async () => {
  let prepares = 0;
  const llm = mockLlm({
    onPrepare: (call) => {
      prepares += 1;
      if (call.config.reasoningEffort === 'off') throw new Error('unsupported reasoning effort');
      return {
        config: call.config,
        async *stream() {
          yield { type: 'text-delta', index: 0, text: JSON.stringify({ 'office-docx': ZH_DOCX }) };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  });
  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
    model: { provider: 'p', model: 'm' },
  });
  assert.equal(prepares, 2);
  assert.equal(llm.calls[1].config.reasoningEffort, undefined);
  assert.equal(out.results['office-docx'].engine, 'llm');
});

/* ------------------------------------------------------------------ */
/* 缓存                                                                */
/* ------------------------------------------------------------------ */

test('translateBatch：缓存命中时零 LLM 请求，engine/cached/model 正确', async () => {
  const en = EN.docx;
  const fingerprint = sourceHash({ name: 'office-docx', description: en });
  const cache = {
    [fingerprint]: {
      zh: ZH_DOCX,
      engine: 'llm',
      model: 'p/m',
      translatedAt: '2026-10-20T00:00:00.000Z',
      enHash: contentHash({ description: en }),
    },
  };
  const llm = mockLlm({
    onPrepare: () => {
      throw new Error('不应调用 LLM');
    },
  });

  const out = await translateBatch({
    items: [{ name: 'office-docx', description: en, fingerprint }],
    llm,
    model: { provider: 'p', model: 'm' },
    cache,
  });

  assert.equal(out.results['office-docx'].engine, 'llm');
  assert.equal(out.results['office-docx'].cached, true);
  assert.equal(out.results['office-docx'].zh, ZH_DOCX);
  assert.equal(out.results['office-docx'].model, 'p/m');
  assert.equal(llm.calls.length, 0);
  assert.equal(out.cache[fingerprint].translatedAt, '2026-10-20T00:00:00.000Z');
  assert.equal(cache[fingerprint].translatedAt, '2026-10-20T00:00:00.000Z', '不应原地修改调用方缓存');
});

test('translateBatch：缓存里的中文对当前英文不合格时视为未命中并重译', async () => {
  const en = 'Use it.';
  const fingerprint = sourceHash({ name: 'short-skill', description: en });
  const cache = {
    [fingerprint]: {
      zh: '这是一条明显超过原文一点六倍的旧中文译文，应当作废。',
      engine: 'llm',
      enHash: 'legacy',
      translatedAt: '2020-01-01T00:00:00.000Z',
    },
  };
  const llm = okLlm({ 'short-skill': '使用它。' });
  const out = await translateBatch({
    items: [{ name: 'short-skill', description: en, fingerprint }],
    llm,
    model: { provider: 'p', model: 'm' },
    cache,
  });
  assert.equal(llm.calls.length, 1);
  assert.equal(out.results['short-skill'].engine, 'llm');
  assert.equal(out.results['short-skill'].cached, false);
  assert.equal(out.results['short-skill'].zh, '使用它。');
});

test('translateBatch：缓存 engine=dictionary 的条目在 LLM 可用时重译', async () => {
  const en = EN.docx;
  const fingerprint = sourceHash({ name: 'office-docx', description: en });
  const cache = {
    [fingerprint]: {
      zh: ZH_DOCX,
      engine: 'dictionary',
      enHash: contentHash({ description: en }),
      translatedAt: '2026-10-20T00:00:00.000Z',
    },
  };

  const llm = okLlm({ 'office-docx': ZH_DOCX });
  const retried = await translateBatch({
    items: [{ name: 'office-docx', description: en, fingerprint }],
    llm,
    model: { provider: 'p', model: 'm' },
    cache,
  });
  assert.equal(llm.calls.length, 1);
  assert.equal(retried.results['office-docx'].engine, 'llm');
  assert.equal(retried.results['office-docx'].cached, false);

  // 无 LLM 时仍可直接使用缓存中的词典译文（离线）。
  const offline = await translateBatch({
    items: [{ name: 'office-docx', description: en, fingerprint }],
    cache,
    engine: 'dictionary',
  });
  assert.equal(offline.results['office-docx'].engine, 'dictionary');
  assert.equal(offline.results['office-docx'].cached, true);
});

/* ------------------------------------------------------------------ */
/* 路由发现 / 单条入口                                                 */
/* ------------------------------------------------------------------ */

test('translateBatch：未显式给 model 时从 llm.listProviders/listModels 发现路由', async () => {
  const llm = okLlm({ 'office-docx': ZH_DOCX });
  llm.providers = [{ id: 'first-provider' }, { id: 'second-provider' }];
  llm.models = {
    'first-provider': [{ provider: 'first-provider', id: 'first-model', name: 'First' }],
    'second-provider': [{ provider: 'second-provider', id: 'second-model', name: 'Second' }],
  };

  const out = await translateBatch({
    items: [{ name: 'office-docx', description: EN.docx }],
    llm,
  });

  assert.equal(out.results['office-docx'].engine, 'llm');
  assert.equal(llm.calls[0].config.provider, 'first-provider');
  assert.equal(llm.calls[0].config.model, 'first-model');
});

test('translateOne：返回单条结果并透出 cache/warnings', async () => {
  const one = await translateOne(
    { name: 'office-docx', description: EN.docx },
    { engine: 'dictionary' },
  );
  assert.equal(one.name, 'office-docx');
  assert.equal(one.engine, 'dictionary');
  assert.equal(one.zh, ZH_DOCX);
  assert.ok(one.cache && typeof one.cache === 'object');
  assert.ok(Array.isArray(one.warnings));
  await assert.rejects(() => translateOne({ description: 'no name' }), /name/);
});
