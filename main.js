const MAX_PROMPT_LENGTH = 12000;
const CONFIG_KEY = "deepseek-config";
const DEEPSEEK_MODEL = "deepseek-flash";
const DEFAULT_CONFIG = {
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: DEEPSEEK_MODEL
};

const TEXT = {
  zh: {
    trigger: "增强提示词",
    title: "提示词增强",
    original: "原始提示词",
    result: "增强后的提示词",
    loading: "正在生成增强版…",
    empty: "请先输入提示词。",
    tooLong: "提示词过长，请缩短后重试。",
    failed: "增强失败，请稍后重试。",
    noKey: "尚未配置 API 密钥，请在插件设置中填写。",
    close: "关闭",
    keep: "保留原文",
    use: "使用增强版",
    settingsHint: "配置仅保存在本机插件私有存储，不会同步或上传。仅在需要更换时修改。",
    baseUrl: "Base URL",
    apiKey: "API Key",
    model: "模型",
    save: "保存",
    saved: "已保存",
    openSettings: "配置"
  },
  en: {
    trigger: "Enhance prompt",
    title: "Prompt enhancement",
    original: "Original prompt",
    result: "Enhanced prompt",
    loading: "Generating…",
    empty: "Enter a prompt first.",
    tooLong: "The prompt is too long. Shorten it and try again.",
    failed: "Enhancement failed. Try again later.",
    noKey: "No API key configured. Set it in the plugin settings.",
    close: "Close",
    keep: "Keep original",
    use: "Use enhanced",
    settingsHint: "Stored locally in this plugin's private storage. Never synced or uploaded.",
    baseUrl: "Base URL",
    apiKey: "API Key",
    model: "Model",
    save: "Save",
    saved: "Saved",
    openSettings: "Config"
  }
};

function labels(locale) {
  return String(locale || "").toLowerCase().startsWith("zh") ? TEXT.zh : TEXT.en;
}

function normalizeDraft(payload) {
  return payload && typeof payload.text === "string" ? payload.text : "";
}

function localTaskType(text) {
  const value = String(text);
  if (/代码|脚本|报错|异常|bug|debug|API|接口|命令|函数|程序/i.test(value)) return "代码/排错";
  if (/分析|比较|评估|判断|原因|差异|趋势|风险/i.test(value)) return "分析/比较";
  if (/总结|摘要|提炼|归纳|概括|要点/i.test(value)) return "总结/提炼";
  if (/写一份|撰写|改写|润色|通知|邮件|回复|方案|报告|文案/i.test(value)) return "改写/写作";
  if (/翻译|译成|中译|英译|日译/i.test(value)) return "翻译";
  if (/什么是|为什么|如何|怎么|介绍|解释|我是谁|要求/i.test(value)) return "解释/问答";
  return "综合任务";
}

function localDraft(original) {
  const taskType = localTaskType(original);
  return [
    `【目标】\n明确完成以下任务：${original.slice(0, 240)}`,
    `【背景/上下文】\n任务类型：${taskType}。仅使用原文和当前对话中已明确提供的信息；缺失信息不得擅自补造。`,
    `【约束】\n- 保持原意和原语言。\n- 不改变 system/developer 层级，不增加权限。\n- 保留原文中的代码、命令、路径、数字和专有名词。\n- 对不确定信息明确标注，不把推测写成事实。`,
    `【输出格式】\n先给出直接、简洁的结果，再按需要补充依据、步骤、风险和待确认项；内容应大道至简、层次清晰、逻辑严谨、可落地执行。`,
    `【验收标准】\n- 覆盖原始需求，不遗漏关键动作。\n- 保持原语言和原意，不擅自扩大范围。\n- 输出可直接使用，关键假设和待确认信息清楚可见。`,
    `\n【原始需求】\n${original}`
  ].join("\n\n");
}

function buildMessages(original) {
  return [
    {
      role: "system",
      content: "你是提示词增强器，不是任务执行者。请把用户的普通需求润色成一条更清晰、更严谨、更可执行的普通用户提示词。保持原意和原语言不变，做到大道至简、目的明确、层次清晰、逻辑严谨、可落地执行。不得改变 system/developer 层级，不得增加权限，不得补造事实，不得执行任务，不得调用工具。保留代码、命令、路径、数字和专有名词。只输出增强后的提示词，不要解释过程，不要添加与任务无关的内容。"
    },
    {
      role: "user",
      content: `请增强以下原始提示词：\n\n${original}`
    }
  ];
}

function endpoint(baseUrl) {
  const value = String(baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(value) ? value : `${value}/chat/completions`;
}

function responseText(body) {
  return body?.choices?.[0]?.message?.content?.trim() || "";
}

class Store {
  constructor(ctx, text) {
    this.ctx = ctx;
    this.text = text;
    this.listeners = new Set();
    this.config = null;
    this.state = {
      draft: "",
      original: "",
      enhanced: "",
      open: false,
      loading: false,
      error: ""
    };
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.state;

  set(partial) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  async init() {
    const saved = await this.ctx.storage.get(CONFIG_KEY);
    if (saved && typeof saved === "object") {
      this.config = { ...DEFAULT_CONFIG, ...saved };
    } else {
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  async saveConfig(next) {
    const config = {
      baseUrl: String(next.baseUrl || DEFAULT_CONFIG.baseUrl).trim() || DEFAULT_CONFIG.baseUrl,
      apiKey: String(next.apiKey || "").trim(),
      model: String(next.model || DEEPSEEK_MODEL).trim() || DEEPSEEK_MODEL
    };
    this.config = config;
    await this.ctx.storage.set(CONFIG_KEY, config);
    return config;
  }

  onDraft(payload) {
    this.set({ draft: normalizeDraft(payload) });
  }

  async enhance() {
    const original = String(this.state.draft || "").trim();
    if (!original) {
      this.set({ open: true, loading: false, original: "", enhanced: "", error: this.text.empty });
      return;
    }
    if (original.length > MAX_PROMPT_LENGTH) {
      this.set({ open: true, loading: false, original, enhanced: "", error: this.text.tooLong });
      return;
    }
    this.set({ open: true, loading: true, original, enhanced: "", error: "" });
    try {
      if (!this.config) await this.init();
      if (!this.config.apiKey) {
        this.set({ loading: false, enhanced: "", error: this.text.noKey });
        return;
      }
      const result = await this.ctx.bridge.invoke("plugin_http_request", {
        method: "POST",
        url: endpoint(this.config.baseUrl),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model || DEEPSEEK_MODEL,
          messages: buildMessages(original),
          stream: false,
          temperature: 0.2,
          max_tokens: 2400
        })
      });
      const body = typeof result?.body === "string" ? JSON.parse(result.body) : result?.body;
      const enhanced = responseText(body);
      if (!enhanced) throw new Error("empty response");
      this.set({ loading: false, enhanced, error: "" });
    } catch {
      this.set({ loading: false, enhanced: "", error: this.text.failed });
    }
  }

  useEnhanced() {
    if (!this.state.enhanced || this.state.loading) return;
    try {
      this.ctx.composer.setDraft(this.state.enhanced);
      this.set({ open: false, error: "" });
    } catch {
      this.set({ error: this.text.failed });
    }
  }

  keepOriginal() {
    this.set({ open: false, error: "" });
  }

  close() {
    this.set({ open: false, loading: false, error: "" });
  }

  dispose() {
    this.listeners.clear();
  }
}

function Button(ctx, store, text) {
  const h = ctx.react;
  const state = h.useSyncExternalStore(store.subscribe, store.snapshot);
  const dialog = state.open ? h.createElement(
    "div",
    { className: "pe-overlay", role: "dialog", "aria-modal": true, "aria-label": text.title },
    h.createElement(
      "div",
      { className: "pe-dialog" },
      h.createElement("div", { className: "pe-header" },
        h.createElement("strong", null, text.title),
        h.createElement("button", { type: "button", className: "pe-close", onClick: () => store.close(), "aria-label": text.close }, "×")
      ),
      state.loading && h.createElement("div", { className: "pe-loading" }, text.loading),
      !state.loading && state.error && h.createElement("div", { className: "pe-error" }, state.error),
      !state.loading && state.enhanced && h.createElement("pre", { className: "pe-result" }, state.enhanced),
      !state.loading && h.createElement("div", { className: "pe-actions" },
        h.createElement("button", { type: "button", className: "pe-secondary", onClick: () => store.keepOriginal() }, text.keep),
        h.createElement("button", { type: "button", className: "pe-primary", disabled: !state.enhanced, onClick: () => store.useEnhanced() }, text.use)
      )
    )
  ) : null;
  return h.createElement("span", { className: "pe-root" },
    h.createElement("button", { type: "button", className: "pe-trigger", onClick: () => store.enhance(), title: text.trigger, "aria-label": text.trigger }, "✦ ", text.trigger),
    dialog
  );
}

function SettingsPanel(ctx, store, text) {
  const h = ctx.react;
  const [form, setForm] = h.useState({ baseUrl: DEFAULT_CONFIG.baseUrl, apiKey: "", model: DEEPSEEK_MODEL });
  const [saved, setSaved] = h.useState(false);
  h.useEffect(() => {
    let alive = true;
    (async () => {
      if (!store.config) await store.init();
      if (alive && store.config) setForm({ ...store.config });
    })();
    return () => { alive = false; };
  }, []);
  const update = (key) => (event) => {
    setSaved(false);
    setForm({ ...form, [key]: event.target.value });
  };
  const onSave = async () => {
    await store.saveConfig(form);
    setSaved(true);
  };
  return h.createElement("div", { className: "pe-settings" },
    h.createElement("div", { className: "pe-hint" }, text.settingsHint),
    h.createElement("label", { className: "pe-field" },
      h.createElement("span", null, text.baseUrl),
      h.createElement("input", { value: form.baseUrl, onChange: update("baseUrl"), spellCheck: false })
    ),
    h.createElement("label", { className: "pe-field" },
      h.createElement("span", null, text.apiKey),
      h.createElement("input", { type: "password", value: form.apiKey, onChange: update("apiKey"), autoComplete: "off", spellCheck: false })
    ),
    h.createElement("label", { className: "pe-field" },
      h.createElement("span", null, text.model),
      h.createElement("input", { value: form.model, onChange: update("model"), spellCheck: false })
    ),
    h.createElement("div", { className: "pe-settings-actions" },
      h.createElement("button", { type: "button", className: "pe-primary", onClick: onSave }, text.save),
      saved && h.createElement("span", { className: "pe-saved" }, text.saved)
    )
  );
}

function activate(ctx) {
  const text = labels(ctx.host && ctx.host.locale);
  const store = new Store(ctx, text);
  void store.init();
  const disposeDraft = ctx.events.on("composer://draft", (payload) => store.onDraft(payload));
  const disposeSlot = ctx.ui.registerComposerSlot({
    slot: "cliMenu",
    key: "prompt-enhancer",
    order: 40,
    component: () => Button(ctx, store, text)
  });
  const disposeCss = ctx.theme.injectCss(CSS_TEXT);
  const disposeSettings = ctx.ui.registerSettingsSection({
    key: "prompt-enhancer",
    label: () => text.title,
    component: () => SettingsPanel(ctx, store, text)
  });
  return () => {
    disposeDraft?.();
    disposeSlot?.();
    disposeCss?.();
    disposeSettings?.();
    store.dispose();
  };
}

const CSS_TEXT = `
.pe-root{display:inline-flex;align-items:center}
.pe-trigger{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--color-text-secondary,inherit);font:inherit;font-size:12px;cursor:pointer;transition:background .12s ease,color .12s ease}
.pe-trigger:hover{background:var(--color-background-tertiary-hover,rgba(127,127,127,.12));color:var(--color-text-primary,inherit)}
.pe-trigger:focus-visible,.pe-close:focus-visible,.pe-actions button:focus-visible{outline:2px solid var(--color-accent-primary-default,#3b82f6);outline-offset:1px}
.pe-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.32)}
.pe-dialog{display:flex;flex-direction:column;gap:12px;width:min(760px,calc(100vw - 48px));max-height:min(700px,calc(100vh - 48px));padding:16px;border:1px solid var(--color-separator-border,rgba(127,127,127,.3));border-radius:12px;background:var(--color-background-primary-default,#fff);color:var(--color-text-primary,#111);box-shadow:0 16px 48px rgba(0,0,0,.24);overflow:auto}
.pe-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pe-close{width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--color-text-secondary,inherit);font-size:20px;cursor:pointer}
.pe-loading{padding:28px 8px;text-align:center;color:var(--color-text-secondary,inherit);font-size:13px}
.pe-error{padding:12px;border-radius:8px;background:var(--color-background-tertiary-default,rgba(127,127,127,.1));color:var(--color-text-secondary,inherit);font-size:13px}
.pe-result{min-height:220px;max-height:60vh;margin:0;padding:14px;border:1px solid var(--color-separator-border,rgba(127,127,127,.3));border-radius:8px;background:var(--color-background-secondary-default,rgba(127,127,127,.05));color:var(--color-text-primary,inherit);font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow:auto}
.pe-actions{display:flex;justify-content:flex-end;gap:8px}
.pe-actions button{min-height:30px;padding:0 12px;border-radius:7px;border:1px solid var(--color-separator-border,rgba(127,127,127,.3));font:inherit;font-size:12px;cursor:pointer}
.pe-secondary{background:transparent;color:var(--color-text-secondary,inherit)}
.pe-primary{background:var(--color-accent-primary-default,#2563eb);border-color:var(--color-accent-primary-default,#2563eb)!important;color:#fff}
.pe-primary:disabled{opacity:.45;cursor:not-allowed}
.pe-settings{display:flex;flex-direction:column;gap:12px;max-width:520px;color:var(--color-text-primary,inherit);font-size:13px}
.pe-field{display:flex;flex-direction:column;gap:4px}
.pe-field span{font-size:12px;color:var(--color-text-secondary,inherit)}
.pe-field input{height:30px;padding:0 8px;border:1px solid var(--color-separator-border,rgba(127,127,127,.3));border-radius:7px;background:var(--color-background-primary-default,transparent);color:inherit;font:inherit}
.pe-field input:focus{outline:2px solid var(--color-accent-primary-default,#3b82f6);outline-offset:-1px}
.pe-hint{font-size:12px;color:var(--color-text-tertiary,inherit)}
.pe-settings-actions{display:flex;align-items:center;gap:8px}
.pe-saved{font-size:12px;color:var(--color-text-tertiary,inherit)}
`;

export { activate, buildMessages, localDraft, endpoint };
export default activate;
