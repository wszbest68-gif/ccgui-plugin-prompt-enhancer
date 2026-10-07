import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Store, endpoint, validateConfig, responseText } from '../main.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(options = {}) {
  const listeners = new Map(), calls = [], writes = [];
  const config = { mode: 'engine', engineWorkspace: '/tmp/prompt-enhancer-test', baseUrl: 'https://api.kimi.com/coding/v1', apiKey: 'TEST_ONLY_KEY', model: 'kimi-for-coding' };
  let startDef;
  const ctx = {
    pluginId: 'prompt-enhancer', host: { isWeb: false },
    storage: { get: async () => config, set: async (k, v) => calls.push(['save', k, v]) },
    events: { on: (topic, fn) => { listeners.set(topic, fn); return () => listeners.delete(topic); } },
    composer: { setDraft: v => writes.push(v) },
    agent: {
      catalog: async () => [{ engine: 'codex', available: true, readOnly: false, models: [{ id: 'available-model' }] }],
      interrupt: async id => { calls.push(['interrupt', id]); return true; },
      start: async def => {
        startDef = def; calls.push(['start', def]);
        if (options.startError) throw Error('SECRET RAW ENGINE ERROR');
        if (options.pendingStart) return new Promise(() => {});
        const emit = (kind, data, runId = `pa-prompt-enhancer-${def.requestId}`) => listeners.get('agent://prompt-enhancer')?.({runId, kind, data});
        if (!options.hold) {
          emit('delta', 'WRONG OTHER RUN', 'pa-other-irrelevant');
          emit('thinking', 'HIDDEN REASONING');
          if (options.tool) emit('message', {role: 'tool', text: 'not a prompt'});
          else { emit('delta', 'Enhanced draft'); emit('done', {}); }
        }
        return { runId: `pa-prompt-enhancer-${def.requestId}`, sessionId: 'fresh-session' };
      }
    },
    bridge: { invoke: async (command, args) => {
      calls.push(['http', args]);
      if (options.httpHold) return new Promise(resolve => { options.httpResolve = resolve; });
      return options.response || {status: 200, body: JSON.stringify({choices:[{message:{content:'Fallback draft'},finish_reason:'stop'}]})};
    } }
  };
  const store = new Store(ctx, { current: '当前引擎', fallback: '兜底模型', changed: '草稿已变化', empty: 'empty', tooLong: 'too long' });
  store.onSession({engine:'codex',sessionId:'conversation-history-id'});
  store.onDraft({text:'请润色这段需求，保留数字123。'});
  return {store, ctx, calls, writes, listeners, options, start: () => startDef};
}

test('primary: available model, default channel, independent session, no fallback key required', async () => {
  const f = fixture(); f.ctx.storage.get = async () => ({apiKey:'',mode:'engine',engineWorkspace:'/tmp/prompt-enhancer-test'});
  await f.store.enhance();
  assert.equal(f.store.state.enhanced, 'Enhanced draft');
  const def = f.start();
  assert.equal(def.model, 'available-model');
  assert.equal(def.engine, 'codex');
  assert.equal('providerId' in def, false);
  assert.equal('sessionId' in def, false);
  assert.equal(def.prompt.includes('conversation-history-id'), false);
  assert.match(def.prompt, /保留数字123/);
  assert.equal(f.calls.some(c => c[0] === 'http'), false);
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.writes, []);
  f.store.useEnhanced(); assert.deepEqual(f.writes, ['Enhanced draft']);
});

test('engine failure falls back to Kimi using real client identity and draft only', async () => {
  const f = fixture({startError:true});
  await f.store.enhance();
  const args = f.calls.find(c => c[0] === 'http')[1];
  assert.equal(args.url, 'https://api.kimi.com/coding/v1/chat/completions');
  assert.equal(args.headers.Authorization, 'Bearer TEST_ONLY_KEY');
  assert.equal(args.headers['User-Agent'], 'CCGUI-Prompt-Enhancer/0.5.1');
  const body = JSON.parse(args.body);
  assert.equal(body.model, 'kimi-for-coding');
  assert.equal(body.stream, false);
  assert.equal(body.messages.length, 2);
  assert.equal(f.store.state.enhanced, 'Fallback draft');
  assert.match(f.store.state.route, /兜底/);
  assert.equal(JSON.stringify(f.store.state).includes('SECRET RAW'), false);
});

test('configured same-engine backup wins; missing backup returns to the first catalog model', async () => {
  for (const [preferred, expected] of [['chosen-backup', 'chosen-backup'], ['removed-model', 'available-model']]) {
    const f = fixture();
    f.ctx.storage.get = async () => ({mode:'engine',engineWorkspace:'/tmp/prompt-enhancer-test',engineModels: {codex: preferred}});
    f.ctx.agent.catalog = async () => [{engine:'codex',available:true,models:[{id:'available-model'},{id:'chosen-backup'}]}];
    await f.store.enhance();
    assert.equal(f.start().model, expected);
    assert.equal(f.calls.some(c => c[0] === 'http'), false);
    assert.equal('sessionId' in f.start(), false);
  }
  const saved = validateConfig({baseUrl:'https://api.deepseek.com/v1',apiKey:'',model:'deepseek-flash',engineModels:{codex:' chosen-backup ',kimi:'',claude:123}});
  assert.deepEqual(saved.engineModels, {codex:'chosen-backup'});
});

test('no engine API falls back; old config key and DeepSeek config survive migration', async () => {
  const f = fixture(); f.ctx.agent = undefined;
  const old = {baseUrl:'https://api.deepseek.com/v1', apiKey:'OLD_PRIVATE_KEY', model:'deepseek-v4-pro'};
  f.ctx.storage.get = async key => { assert.equal(key, 'deepseek-config'); return old; };
  await f.store.enhance();
  assert.deepEqual(f.store.config, { ...old, mode: 'api', protocol: 'auto', engineId: 'active', engineWorkspace: '' });
  assert.match(f.calls.find(c=>c[0]==='http')[1].url, /api.deepseek.com/);
});

test('unavailable engine, missing model catalog, and missing active engine all use fallback', async () => {
  for (const catalog of [[],[{engine:'codex',available:false,models:[]}],[{engine:'codex',available:true,models:[]}]]) {
    const f = fixture(); f.ctx.agent.catalog = async () => catalog;
    await f.store.enhance();
    assert.equal(f.start(), undefined); assert.equal(f.store.state.enhanced,'Fallback draft');
  }
  const f = fixture(); f.store.engine = null; await f.store.enhance();
  assert.equal(f.start(), undefined); assert.equal(f.store.state.enhanced,'Fallback draft');
});

test('HTTP status, malformed JSON, missing content and truncation never produce a usable result or leak raw body', async () => {
  for (const response of [
    {status:401,body:'SECRET SERVER BODY'}, {status:429,body:'SECRET SERVER BODY'},
    {status:200,body:'SECRET SERVER BODY'}, {status:200,body:'{"choices":[]}'},
    {status:200,body:JSON.stringify({choices:[{message:{content:'partial'},finish_reason:'length'}]})}
  ]) {
    const f=fixture({startError:true,response}); await f.store.enhance();
    assert.equal(f.store.state.enhanced,''); assert.ok(f.store.state.error);
    assert.equal(JSON.stringify(f.store.state).includes('SECRET SERVER'),false);
  }
});

test('draft changed during generation or before apply cannot be overwritten', async () => {
  const f=fixture({hold:true}); const running=f.store.enhance(); await tick();
  f.store.onDraft({text:'新的草稿'});
  const def=f.start(); f.listeners.get('agent://prompt-enhancer')({runId:`pa-prompt-enhancer-${def.requestId}`,kind:'delta',data:'old result'});
  f.listeners.get('agent://prompt-enhancer')({runId:`pa-prompt-enhancer-${def.requestId}`,kind:'done',data:{}});
  await running; assert.equal(f.store.state.enhanced,''); assert.match(f.store.state.error,/变化/);
  const g=fixture(); await g.store.enhance(); g.store.onDraft({text:'new draft'}); g.store.useEnhanced(); assert.deepEqual(g.writes,[]);
});

test('session switch cancels engine and discards late events with no fallback', async () => {
  const f=fixture({hold:true}); const running=f.store.enhance(); await tick();
  f.store.onSession({engine:'kimi',sessionId:'another'}); await running;
  assert.equal(f.store.state.open,false); assert.equal(f.store.state.enhanced,'');
  assert.equal(f.calls.some(c=>c[0]==='interrupt'),true);
  assert.equal(f.calls.some(c=>c[0]==='http'),false); assert.equal(f.listeners.size,0);
});

test('host re-announcing the same established session does not cancel its enhancement', async () => {
  const f=fixture({hold:true});const running=f.store.enhance();await tick();
  f.store.onSession({engine:'codex',sessionId:'conversation-history-id'});
  assert.equal(f.store.state.loading,true);
  const id=`pa-prompt-enhancer-${f.start().requestId}`;
  f.listeners.get('agent://prompt-enhancer')({runId:id,kind:'delta',data:'valid result'});
  f.listeners.get('agent://prompt-enhancer')({runId:id,kind:'done',data:{}});
  await running;assert.equal(f.store.state.enhanced,'valid result');
});

test('duplicate clicks issue one request; cancel HTTP discards its eventual response', async () => {
  const options={startError:true,httpHold:true}; const f=fixture(options);
  const running=f.store.enhance(); await tick(); await f.store.enhance();
  assert.equal(f.calls.filter(c=>c[0]==='http').length,1);
  f.store.close(); await running;
  options.httpResolve({status:200,body:JSON.stringify({choices:[{message:{content:'late'}}]})}); await tick();
  assert.equal(f.store.state.enhanced,''); assert.equal(f.store.state.open,false);
});

test('engine timeout requests interruption but failed cleanup does not delay fallback', async () => {
  const f=fixture({hold:true}); f.store.timeoutMs=10; await f.store.enhance();
  assert.equal(f.store.state.enhanced,'Fallback draft');
  assert.ok(f.calls.findIndex(c=>c[0]==='interrupt')<f.calls.findIndex(c=>c[0]==='http'));
  const g=fixture({hold:true});g.store.timeoutMs=10;g.ctx.agent.interrupt=async()=>{throw Error('stop failed');};
  await g.store.enhance(); assert.equal(g.store.state.enhanced,'Fallback draft');
});

test('pending start timeout launches fallback without waiting for start acknowledgement', async () => {
  const f=fixture({pendingStart:true});f.store.timeoutMs=10;await f.store.enhance();
  assert.equal(f.store.state.enhanced,'Fallback draft');
});

test('tool events stop the primary and use fallback', async () => {
  const f=fixture({tool:true});await f.store.enhance();
  assert.equal(f.store.state.enhanced,'Fallback draft');assert.match(f.store.state.reason,/工具/);
});

test('URL validation and structured text responses', () => {
  assert.equal(endpoint('https://api.kimi.com/coding/v1/'),'https://api.kimi.com/coding/v1/chat/completions');
  for(const baseUrl of ['file:///private','https://user:password@example.com','https://example.com?key=private','invalid']) {
    assert.throws(()=>validateConfig({baseUrl,model:'m'}));
  }
  assert.equal(responseText({choices:[{message:{content:[{type:'text',text:'hello'},{type:'text',text:' world'}]}}]}),'hello world');
});

test('save failure preserves the working config; dispose removes event subscriptions', async () => {
  const f=fixture({hold:true}); await f.store.init(); const original=f.store.config;
  f.ctx.storage.set=async()=>{throw Error('disk full');};
  await assert.rejects(f.store.saveConfig({baseUrl:'https://api.deepseek.com/v1',model:'m',apiKey:'new'}));
  assert.equal(f.store.config,original);
  const running=f.store.enhance();await tick();f.store.dispose();await running;assert.equal(f.listeners.size,0);
});

test('stalled interrupt does not block fallback; failed init can retry', async () => {
  const f=fixture({hold:true});f.store.timeoutMs=10;f.store.interruptTimeoutMs=10;
  f.ctx.agent.interrupt=()=>new Promise(()=>{});
  await f.store.enhance(); assert.equal(f.store.state.enhanced,'Fallback draft');
  const g=fixture();const get=g.ctx.storage.get;let failed=false;
  g.ctx.storage.get=async()=>{if(!failed){failed=true;throw Error('storage unavailable');}return get();};
  await assert.rejects(g.store.init());await g.store.init();assert.equal(g.store.config.model,'kimi-for-coding');
});


test('silent primary uses the short response budget and failed engine is skipped until cooldown expires', async () => {
  const f=fixture({hold:true}); f.store.firstResponseMs=20; f.store.cooldownMs=1000;
  const began=Date.now(); await f.store.enhance();
  assert.ok(Date.now()-began<300); assert.equal(f.store.state.enhanced,'Fallback draft');
  await f.store.enhance(); assert.equal(f.calls.filter(c=>c[0]==='start').length,1);
  f.store.failedEngines.set('codex',Date.now()-1);
  f.options.hold=false; await f.store.enhance();
  assert.equal(f.store.state.enhanced,'Enhanced draft');
  assert.equal(f.calls.filter(c=>c[0]==='start').length,2);
});

test('first actual text cancels fast deadline while model and thinking events do not', async () => {
  const f=fixture({hold:true}); f.store.firstResponseMs=20;
  const running=f.store.enhance(); await tick();
  const emit=(kind,data)=>f.listeners.get('agent://prompt-enhancer')?.({runId:`pa-prompt-enhancer-${f.start().requestId}`,kind,data});
  emit('delta','partial'); await new Promise(r=>setTimeout(r,40));
  assert.equal(f.calls.some(c=>c[0]==='http'),false);
  emit('done',{}); await running; assert.equal(f.store.state.enhanced,'partial');
  const g=fixture({hold:true}); g.store.firstResponseMs=10;
  const other=g.store.enhance(); await tick();
  g.listeners.get('agent://prompt-enhancer')?.({runId:`pa-prompt-enhancer-${g.start().requestId}`,kind:'model',data:'m'});
  await other; assert.equal(g.store.state.enhanced,'Fallback draft');
});

test('stalled catalog shares the response budget and saving preferences resets cooldown', async () => {
  const f=fixture();f.store.firstResponseMs=10;
  f.ctx.agent.catalog=()=>new Promise(()=>{});
  await f.store.enhance();assert.equal(f.store.state.enhanced,'Fallback draft');
  assert.equal(f.calls.some(c=>c[0]==='start'),false);
  await f.store.saveConfig(f.store.config);assert.equal(f.store.failedEngines.size,0);
});

test('late start is interrupted again and cannot overwrite fallback result', async () => {
  const f=fixture(); f.store.firstResponseMs=10; let finishStart;
  f.ctx.agent.start=def=>{f.calls.push(['start',def]);return new Promise(r=>{finishStart=()=>r({runId:`pa-prompt-enhancer-${def.requestId}`});});};
  await f.store.enhance(); assert.equal(f.store.state.enhanced,'Fallback draft');
  finishStart();await tick();assert.equal(f.calls.filter(c=>c[0]==='interrupt').length,2);
  assert.equal(f.store.state.enhanced,'Fallback draft');assert.equal(f.listeners.size,0);
});
