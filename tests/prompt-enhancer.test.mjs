import assert from "node:assert/strict";
import { buildMessages, endpoint, localDraft } from "../main.js";

const source = "请把供应商审核报告整理成一份正式整改方案，控制在800字以内。";
const local = localDraft(source);
assert.equal(local.includes("保持原意和原语言"), true);
assert.equal(local.includes("【目标】"), true);
assert.equal(local.includes("【验收标准】"), true);
assert.equal(endpoint("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
assert.equal(endpoint("https://api.deepseek.com/v1/chat/completions"), "https://api.deepseek.com/v1/chat/completions");
const messages = buildMessages(source);
assert.equal(messages.length, 2);
assert.equal(messages[0].role, "system");
assert.equal(messages[1].content.includes(source), true);
console.log("PROMPT_ENHANCER_V030_TESTS_OK");
