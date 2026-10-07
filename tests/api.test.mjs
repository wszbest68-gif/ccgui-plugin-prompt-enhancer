import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { Store, validateConfig, apiProtocol, buildApiRequest, parseApiResponse } from '../main.js';

const messages = [{role:'system',content:'Improve the draft only.'},{role:'user',content:'会议通知草稿 123'}];
const config = (baseUrl, model='test-model', protocol='auto') => validateConfig({baseUrl,model,protocol,apiKey:'TEST_ONLY_KEY'});

test('official hosts and explicit endpoints choose the right protocol; proxy model names do not guess protocol', () => {
  for (const [url, expected] of [
    ['https://api.openai.com/v1','responses'], ['https://api.anthropic.com','anthropic'],
    ['https://generativelanguage.googleapis.com/v1beta','gemini'], ['https://api.kimi.com/coding/v1','chat'],
    ['https://api.kimi.com/coding/','anthropic'], ['https://proxy.example/v1','chat'],
    ['https://proxy.example/v1/responses','responses'], ['https://proxy.example/v1/messages','anthropic'],
    ['https://generativelanguage.googleapis.com/v1beta/openai/','chat']
  ]) assert.equal(apiProtocol(config(url)),expected,url);
  assert.equal(apiProtocol(config('https://proxy.example/v1','claude-example')),'chat');
  assert.equal(apiProtocol(config('https://proxy.example/v1','m','anthropic')),'anthropic');
});

test('endpoint construction preserves plan paths and never puts the key in a URL', () => {
  for (const [base, protocol, expected] of [
    ['https://api.deepseek.com','auto','https://api.deepseek.com/v1/chat/completions'],
    ['https://api.kimi.com/coding/v1','auto','https://api.kimi.com/coding/v1/chat/completions'],
    ['https://api.kimi.com/coding/','auto','https://api.kimi.com/coding/v1/messages'],
    ['https://proxy.example/plan/v1','chat','https://proxy.example/plan/v1/chat/completions'],
    ['https://api.anthropic.com/v1','auto','https://api.anthropic.com/v1/messages'],
    ['https://api.openai.com/v1/responses','auto','https://api.openai.com/v1/responses'],
    ['https://generativelanguage.googleapis.com','auto','https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent']
  ]) {
    const req=buildApiRequest(config(base,'test-model',protocol),messages);
    assert.equal(req.url,expected);assert.equal(req.url.includes('TEST_ONLY_KEY'),false);
  }
});

test('API adapters use native authentication, system instructions and provider-specific options', () => {
  const openai=buildApiRequest(config('https://api.openai.com/v1'),messages);
  assert.equal(openai.headers.Authorization,'Bearer TEST_ONLY_KEY');
  const o=JSON.parse(openai.body);assert.equal(o.instructions,messages[0].content);assert.deepEqual(o.input,[messages[1]]);assert.equal(o.store,false);
  const claude=buildApiRequest(config('https://api.anthropic.com'),messages);
  assert.equal(claude.headers['x-api-key'],'TEST_ONLY_KEY');assert.equal(claude.headers['anthropic-version'],'2023-06-01');
  assert.equal('Authorization' in claude.headers,false);assert.equal(JSON.parse(claude.body).system,messages[0].content);
  const gemini=buildApiRequest(config('https://generativelanguage.googleapis.com/v1beta','models/gemini-example'),messages);
  assert.match(gemini.url,/\/models\/gemini-example:generateContent$/);assert.equal(gemini.headers['x-goog-api-key'],'TEST_ONLY_KEY');
  assert.equal(JSON.parse(gemini.body).contents[0].parts[0].text,messages[1].content);
  const kimi=buildApiRequest(config('https://api.kimi.com/coding/v1','k3'),messages);
  assert.equal(JSON.parse(kimi.body).reasoning_effort,'low');assert.match(kimi.headers['User-Agent'],/^CCGUI-/);
  const deepseek=buildApiRequest(config('https://api.deepseek.com/v1'),messages);
  assert.deepEqual(JSON.parse(deepseek.body).thinking,{type:'disabled'});
  const generic=JSON.parse(buildApiRequest(config('https://proxy.example/v1'),messages).body);
  assert.equal('thinking' in generic,false);assert.equal('reasoning_effort' in generic,false);assert.equal('temperature' in generic,false);
});

test('native response parsing returns final text and rejects reasoning-only, refusal and truncated results', () => {
  assert.equal(parseApiResponse({status:'completed',output:[{type:'reasoning'},{type:'message',role:'assistant',content:[{type:'output_text',text:'a'},{type:'output_text',text:'b'}]}]},'responses'),'ab');
  assert.equal(parseApiResponse({content:[{type:'thinking',thinking:'SECRET'},{type:'text',text:'ok'}],stop_reason:'end_turn'},'anthropic'),'ok');
  assert.equal(parseApiResponse({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'SECRET'},{text:'ok'}]}}]},'gemini'),'ok');
  assert.throws(()=>parseApiResponse({status:'incomplete',output:[]},'responses'),/truncated/);
  assert.throws(()=>parseApiResponse({content:[{type:'text',text:'partial'}],stop_reason:'max_tokens'},'anthropic'),/truncated/);
  assert.throws(()=>parseApiResponse({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]},'gemini'),/truncated/);
  assert.throws(()=>parseApiResponse({output:[{type:'reasoning'}]},'responses'),/empty/);
});

function fixture(saved={}, options={}) {
  const calls=[],writes=[];
  const ctx={pluginId:'prompt-enhancer',events:{on:()=>()=>{}},storage:{get:async()=>({baseUrl:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'TEST_ONLY_KEY',...saved}),set:async()=>{}},
    composer:{setDraft:t=>writes.push(t)},agent:{catalog:async()=>{calls.push('catalog');return [{engine:'kimi',available:true,models:[{id:'engine-model'}]}];},start:async()=>{calls.push('engine');throw Error('unavailable');}},
    bridge:{invoke:async(command,args)=>{calls.push(args);if(options.hold)return new Promise(r=>options.resolve=r);return options.response||{status:200,body:JSON.stringify({choices:[{message:{content:'增强结果 123'},finish_reason:'stop'}]})};}}};
  const store=new Store(ctx,{fallback:'专用文本 API',changed:'草稿已变化'});
  store.onSession({engine:'codex',sessionId:'session'});store.onDraft({text:'用户草稿 123'});
  return {store,calls,writes};
}

test('legacy config migrates to default API with no engine lookup, preserving key and preview/apply',async()=>{
  const f=fixture();await f.store.enhance();assert.equal(f.store.state.enhanced,'增强结果 123');
  assert.equal(f.calls.includes('catalog'),false);assert.equal(f.calls.length,1);assert.deepEqual(f.writes,[]);
  assert.equal(f.store.config.apiKey,'TEST_ONLY_KEY');assert.equal(f.store.config.mode,'api');f.store.useEnhanced();assert.deepEqual(f.writes,['增强结果 123']);
});

test('explicit engine choice can override active engine and still falls back to API',async()=>{
  const f=fixture({mode:'engine',engineId:'kimi',engineWorkspace:'/tmp/prompt-enhancer-test'});await f.store.enhance();
  assert.equal(f.calls.includes('catalog'),true);assert.equal(f.calls.includes('engine'),true);assert.equal(f.store.state.enhanced,'增强结果 123');
});

test('connection test uses unsaved form without overwriting config, drafts or model output',async()=>{
  const f=fixture();await f.store.init();const before=f.store.config;
  await f.store.testConnection({baseUrl:'https://api.anthropic.com/v1',apiKey:'OTHER_TEST_KEY',model:'m'});
  assert.equal(f.store.config,before);assert.ok(f.store.state.testError);assert.deepEqual(f.writes,[]);assert.equal(f.store.state.enhanced,'');
  assert.equal(f.calls[0].headers['x-api-key'],'OTHER_TEST_KEY');assert.match(JSON.parse(f.calls[0].body).messages[0].content,/OK/);
});

test('connection success and cancellation do not leak credentials or late results',async()=>{
  const f=fixture();await f.store.testConnection({baseUrl:'https://api.deepseek.com/v1',model:'m',apiKey:'TEST_ONLY_KEY'});
  assert.match(f.store.state.testMessage,/连接成功/);assert.equal(JSON.stringify(f.store.state).includes('TEST_ONLY_KEY'),false);
  const options={hold:true};const g=fixture({},options);
  const running=g.store.testConnection({baseUrl:'https://api.deepseek.com/v1',model:'m',apiKey:'TEST_ONLY_KEY'});
  await new Promise(r=>setTimeout(r,0));g.store.cancelTest();await running;
  options.resolve({status:200,body:'{}'});assert.equal(g.store.state.testing,false);assert.equal(g.store.state.testMessage,'');
});

test('API mode failures expose safe actionable HTTP errors without trying another engine',async()=>{
  for(const status of [400,401,403,404,429,500]){
    const f=fixture({}, {response:{status,body:'SERVER_SECRET TEST_ONLY_KEY'}});await f.store.enhance();
    assert.match(f.store.state.error,new RegExp(String(status)));assert.equal(f.store.state.enhanced,'');
    assert.equal(JSON.stringify(f.store.state).includes('SERVER_SECRET'),false);assert.equal(f.calls.length,1);
  }
});

test('reflected API credentials are redacted before preview and draft writeback', async () => {
  const f=fixture({}, {response:{status:200,body:JSON.stringify({choices:[{message:{content:'Echo TEST_ONLY_KEY TEST_ONLY_KEY'},finish_reason:'stop'}]})}});
  await f.store.enhance();
  assert.equal(f.store.state.enhanced,'Echo [REDACTED] [REDACTED]');
  assert.equal(JSON.stringify(f.store.state).includes('TEST_ONLY_KEY'),false);
  f.store.useEnhanced();assert.deepEqual(f.writes,['Echo [REDACTED] [REDACTED]']);
  assert.equal(f.calls[0].headers.Authorization,'Bearer TEST_ONLY_KEY');
});

test('unconfigured engine workspace falls back immediately without a machine-specific directory', async () => {
  const f=fixture({mode:'engine'});await f.store.enhance();
  assert.equal(f.calls.includes('catalog'),false);assert.equal(f.calls.includes('engine'),false);
  assert.equal(f.store.state.enhanced,'增强结果 123');assert.match(f.store.state.reason,/绝对路径/);
});

test('engine workspace uses the configured absolute directory on each platform', async () => {
  for (const engineWorkspace of ['/tmp/prompt-enhancer-test','E:\\prompt-enhancer-test','\\\\server\\share\\prompt-enhancer-test']) {
    const f=fixture({mode:'engine',engineWorkspace});let received;
    f.store.ctx.agent.catalog=async path=>{received=path;return [];};
    await f.store.enhance();assert.equal(received,engineWorkspace);
  }
  for (const engineWorkspace of ['relative/path','bad\npath','C:relative']) {
    const f=fixture({mode:'engine',engineWorkspace});await f.store.enhance();
    assert.equal(f.calls.includes('catalog'),false);assert.match(f.store.state.reason,/绝对路径/);
  }
});
