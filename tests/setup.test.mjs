import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';

async function fixture(settings = {}) {
  const { bb, harness } = createFakePluginHost({ pluginId: 'inbox', settings });
  harness.inspection.sdk.stub('plugins.updateSettings', async ({ pluginId, values }) => {
    assert.equal(pluginId, 'inbox');
    await harness.behavior.setSettings(values);
    return {};
  });
  await plugin(bb);
  return { bb, harness, rpc: (method, input = null) => harness.behavior.callRpc(method, input), dispose: () => harness.lifecycle.dispose() };
}
const preferences = { notifyBlocked:true, notifyFailed:true, notifyFinished:false, toastEnabled:true, desktopEnabled:false, telegramInstant:true, cooldownSeconds:45, quietStart:'', quietEnd:'' };

test('new installs show optional setup and skip survives reopening without changing notifications', async () => {
  const f = await fixture();
  try {
    const first = await f.rpc('setupStatus');
    assert.equal(first.completed, false);
    assert.equal(first.telegram.configured, false);
    assert.equal(first.preferences.notifyFinished, false);
    await f.rpc('setupFinish');
    assert.equal((await f.rpc('setupStatus')).completed, true);
    assert.equal((await f.rpc('setupStatus')).preferences.notifyFinished, false);
  } finally { await f.dispose(); }
});

test('in-plugin settings persist notification choices and reject partial quiet hours', async () => {
  const f = await fixture();
  try {
    await f.rpc('setupSave', {...preferences, notifyFinished:true, quietStart:'22:00', quietEnd:'07:30'});
    const state=await f.rpc('setupStatus');
    assert.equal(state.preferences.notifyFinished,true);
    assert.equal(state.preferences.quietStart,'22:00');
    await assert.rejects(f.rpc('setupSave',{...preferences,quietStart:'22:00'}));
    assert.equal((await f.rpc('setupStatus')).preferences.quietEnd,'07:30');
    await assert.rejects(f.rpc('setupSave',{...preferences,telegramBotToken:'must-not-be-accepted'}));
  } finally { await f.dispose(); }
});

test('existing Telegram credentials never leave the settings status and are not overwritten by skip', async () => {
  const f=await fixture({telegramBotToken:'existing-private-value',telegramChatId:'123'});
  try {
    await f.rpc('setupFinish');
    const result=await f.rpc('setupStatus');
    assert.equal(result.telegram.configured,true);
    assert.equal(JSON.stringify(result).includes('existing-private-value'),false);
  } finally { await f.dispose(); }
});

const token = '12345678:' + 'A'.repeat(35);
function telegramMock(t, state = {}) {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const method=String(url).split('/').at(-1);
    state.calls ??= []; state.calls.push({method,body:JSON.parse(init?.body ?? '{}')});
    if(state.fail === method) return Response.json({ok:false,description:'private upstream '+token},{status:state.code ?? 401});
    if(method==='getMe') return Response.json({ok:true,result:{id:12345678,is_bot:true,username:'fixture_needs_you_bot',first_name:'Fixture Bot'}});
    if(method==='getWebhookInfo') return Response.json({ok:true,result:{url:state.webhook ?? ''}});
    if(method==='getUpdates') return Response.json({ok:true,result:state.updates ?? []});
    if(method==='sendMessage') return Response.json({ok:true,result:{message_id:17}});
    throw new Error('Unexpected network call');
  });
  return state;
}
function startUpdate(pairing, overrides={}) {
  const challenge=new URL(pairing.url).searchParams.get('start');
  return {update_id:51,message:{date:Math.floor(Date.now()/1000),text:'/start '+challenge,chat:{id:123,type:'private',first_name:'Casey'},from:{id:123,is_bot:false,first_name:'Casey',username:'casey'},...overrides}};
}

test('pairing validates a dedicated bot, ignores unrelated chats, and requires explicit private-chat confirmation', async t => {
  const state=telegramMock(t);const f=await fixture();
  try {
    const pairing=await f.rpc('setupTelegramBegin',{token});
    assert.equal(pairing.botUsername,'fixture_needs_you_bot');
    assert.equal(JSON.stringify(pairing).includes(token),false);
    state.updates=[startUpdate(pairing,{chat:{id:-1,type:'group'}}),startUpdate(pairing,{from:{id:999,is_bot:false}}),startUpdate(pairing,{text:'/start wrong'})];
    assert.equal((await f.rpc('setupTelegramCheck',{pairingId:pairing.id})).candidate,null);
    await assert.rejects(f.rpc('setupTelegramConfirm',{pairingId:pairing.id}));
    state.updates=[{...startUpdate(pairing),update_id:52}];
    const found=await f.rpc('setupTelegramCheck',{pairingId:pairing.id});
    assert.equal(found.candidate.chatId,'123');
    assert.equal((await f.rpc('setupStatus')).telegram.configured,false);
    const connected=await f.rpc('setupTelegramConfirm',{pairingId:pairing.id});
    assert.equal(connected.telegram.configured,true);
    assert.equal(connected.telegram.chatId,'123');
    assert.equal(state.calls.filter(c=>c.method==='sendMessage').length,0,'Pairing never sends a test automatically');
    assert.equal(JSON.stringify(connected).includes(token),false);
    await assert.rejects(f.rpc('setupTelegramConfirm',{pairingId:pairing.id}),'A consumed pairing cannot be replayed');
  } finally { await f.dispose(); }
});

test('invalid tokens and webhook conflicts give safe errors without replacing an existing connection', async t => {
  const state=telegramMock(t,{fail:'getMe'});const f=await fixture({telegramBotToken:'existing-value',telegramChatId:'456'});
  try {
    await assert.rejects(f.rpc('setupTelegramBegin',{token}),e=>!e.message.includes(token)&&/token/i.test(e.message));
    state.fail=null;state.webhook='https://other-app.invalid/hook';
    await assert.rejects(f.rpc('setupTelegramBegin',{token}),/another app|dedicated bot/i);
    assert.equal((await f.rpc('setupStatus')).telegram.chatId,'456');
    assert.equal(state.calls.some(c=>c.method==='deleteWebhook'),false);
  } finally { await f.dispose(); }
});

test('cancelled, superseded, expired and forwarded pairing messages cannot connect a chat', async t => {
  const state=telegramMock(t);const f=await fixture();
  try {
    const old=await f.rpc('setupTelegramBegin',{token});
    const current=await f.rpc('setupTelegramBegin',{token});
    await assert.rejects(f.rpc('setupTelegramCheck',{pairingId:old.id}));
    state.updates=[startUpdate(current,{forward_origin:{type:'user'}})];
    assert.equal((await f.rpc('setupTelegramCheck',{pairingId:current.id})).candidate,null);
    await f.rpc('setupTelegramCancel',{pairingId:current.id});
    await assert.rejects(f.rpc('setupTelegramConfirm',{pairingId:current.id}));
    const expiring=await f.rpc('setupTelegramBegin',{token});
    t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.timers.tick(11*60*1000);
    await assert.rejects(f.rpc('setupTelegramCheck',{pairingId:expiring.id}),/expired|start again/i);
    assert.equal((await f.rpc('setupStatus')).telegram.configured,false);
  } finally { await f.dispose(); }
});

test('explicit test records acknowledgment, failure is distinct, and disconnect clears both settings', async t => {
  const state=telegramMock(t);const f=await fixture({telegramBotToken:token,telegramChatId:'123'});
  try {
    const delivered=await f.rpc('setupTelegramTest');
    assert.equal(delivered.ok,true);
    assert.equal((await f.rpc('setupStatus')).telegram.lastTest.ok,true);
    state.fail='sendMessage';state.code=403;
    await assert.rejects(f.rpc('setupTelegramTest'),e=>!e.message.includes(token)&&/blocked|start/i.test(e.message));
    assert.equal((await f.rpc('setupStatus')).telegram.lastTest.ok,false);
    await f.rpc('setupTelegramDisconnect');
    assert.equal((await f.rpc('setupStatus')).telegram.configured,false);
    assert.equal((await f.rpc('setupStatus')).telegram.lastTest,null);
    await assert.rejects(f.rpc('setupTelegramTest'),/connect/i);
  } finally { await f.dispose(); }
});

const update = {id:'inbox',outcome:'update-available',installed:{display:'v0.2.0-beta.2',version:'old'},candidate:{display:'v0.2.0-beta.3',version:'new'}};
test('update notices use the host resolver and never apply updates just by checking', async () => {
  const f=await fixture();let checks=0,applied=0;
  f.harness.inspection.sdk.stub('plugins.checkUpdates',async()=>{checks++;return [update];});
  f.harness.inspection.sdk.stub('plugins.applyUpdate',async()=>{applied++;return {applied:true,outcome:'updated',from:update.installed,to:update.candidate};});
  try {
    const available=await f.rpc('setupCheckUpdates',{force:false});
    assert.equal(available.outcome,'update-available');assert.equal(available.candidateVersion,'new');
    await f.rpc('setupCheckUpdates',{force:false});assert.equal(checks,1);assert.equal(applied,0);
    await f.rpc('setupApplyUpdate',{candidateVersion:'new'});assert.equal(applied,1);
  } finally { await f.dispose(); }
});

test('blocked and changed update candidates cannot be applied, and a failed check never claims current', async () => {
  const f=await fixture();let entry={...update,outcome:'incompatible',blocked:{version:'new',reasons:['Requires newer BB']}};
  f.harness.inspection.sdk.stub('plugins.checkUpdates',async()=>[entry]);
  try {
    assert.equal((await f.rpc('setupCheckUpdates',{force:true})).outcome,'incompatible');
    await assert.rejects(f.rpc('setupApplyUpdate',{candidateVersion:'new'}));
    entry={...update,candidate:{display:'v0.2.0-beta.4',version:'different'}};
    await assert.rejects(f.rpc('setupApplyUpdate',{candidateVersion:'new'}),/changed|check again/i);
    f.harness.inspection.sdk.stub('plugins.checkUpdates',async()=>{throw new Error('network unavailable');});
    await assert.rejects(f.rpc('setupCheckUpdates',{force:true}),/check|reach/i);
  } finally { await f.dispose(); }
});

function deferred() { let resolve; const promise=new Promise(r=>{resolve=r}); return {promise,resolve}; }

test('partial credential writes suspend all Telegram delivery across reload until re-pairing succeeds', async t => {
  const state=telegramMock(t); const f=await fixture({telegramBotToken:'previous-token',telegramChatId:'456'});
  try {
    const pairing=await f.rpc('setupTelegramBegin',{token}); state.updates=[startUpdate(pairing)];
    await f.rpc('setupTelegramCheck',{pairingId:pairing.id});
    f.harness.inspection.sdk.stub('plugins.updateSettings',async ({values})=>{
      await f.harness.behavior.setSettings({telegramBotToken:values.telegramBotToken});
      throw new Error('simulated chat database failure');
    });
    await assert.rejects(f.rpc('setupTelegramConfirm',{pairingId:pairing.id}),/paused|reconnect/i);
    const replacement=await f.harness.lifecycle.reload(plugin);
    f.harness=replacement.harness;
    f.rpc=(method,input=null)=>f.harness.behavior.callRpc(method,input);
    f.dispose=()=>f.harness.lifecycle.dispose();
    assert.equal((await f.rpc('setupStatus')).telegram.configured,false);
    assert.equal((await f.rpc('notify',{title:'Private thread',body:'Private context',channel:'telegram'})).telegram,false);
    await assert.rejects(f.rpc('setupTelegramTest'),/connect/i);
    assert.equal(state.calls.filter(c=>c.method==='sendMessage').length,0);
    f.harness.inspection.sdk.stub('plugins.updateSettings',async ({values})=>{await f.harness.behavior.setSettings(values);return {}});
    const recovered=await f.rpc('setupTelegramBegin',{token});state.updates=[startUpdate(recovered)];
    await f.rpc('setupTelegramCheck',{pairingId:recovered.id});
    assert.equal((await f.rpc('setupTelegramConfirm',{pairingId:recovered.id})).telegram.chatId,'123');
  } finally {await f.dispose()}
});

test('disconnect drains in-flight delivery and no later notification uses the disconnected chat', async t => {
  const sending=deferred(), release=deferred();let sends=0;
  t.mock.method(globalThis,'fetch',async()=>{sends++;sending.resolve();await release.promise;return Response.json({ok:true,result:{message_id:1}})});
  const f=await fixture({telegramBotToken:token,telegramChatId:'123'});
  try {
    const notify=f.rpc('notify',{title:'Before disconnect',body:'',channel:'telegram'});await sending.promise;
    let disconnected=false;const disconnect=f.rpc('setupTelegramDisconnect').then(()=>{disconnected=true});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(disconnected,false);
    release.resolve();await notify;await disconnect;
    assert.equal((await f.rpc('notify',{title:'After disconnect',body:'',channel:'telegram'})).telegram,false);
    assert.equal(sends,1);
  } finally {release.resolve();await f.dispose()}
});

test('updates and pairing reserve each other during validation and update rechecks', async t => {
  const started=deferred(), release=deferred();
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).endsWith('/getMe')){started.resolve();await release.promise;return Response.json({ok:true,result:{is_bot:true,username:'fixture_bot'}})}
    return Response.json({ok:true,result:{url:''}});
  });
  const f=await fixture();let applied=0;
  f.harness.inspection.sdk.stub('plugins.checkUpdates',async()=>[update]);
  f.harness.inspection.sdk.stub('plugins.applyUpdate',async()=>{applied++;return {applied:true,outcome:'updated',from:update.installed,to:update.candidate}});
  try {
    const begin=f.rpc('setupTelegramBegin',{token});await started.promise;
    await assert.rejects(f.rpc('setupApplyUpdate',{candidateVersion:'new'}),/pairing/i);
    release.resolve();const pairing=await begin;await f.rpc('setupTelegramCancel',{pairingId:pairing.id});
    const checking=deferred(), checked=deferred();
    f.harness.inspection.sdk.stub('plugins.checkUpdates',async()=>{checking.resolve();await checked.promise;return [update]});
    const applying=f.rpc('setupApplyUpdate',{candidateVersion:'new'});await checking.promise;
    await assert.rejects(f.rpc('setupTelegramBegin',{token}),/update/i);
    checked.resolve();await applying;assert.equal(applied,1);
  } finally {release.resolve();await f.dispose()}
});

test('legacy fractional cooldown is normalized and zero can be saved', async () => {
  const f=await fixture({cooldownSeconds:'0.5'});
  try {
    assert.equal((await f.rpc('setupStatus')).preferences.cooldownSeconds,0);
    assert.equal((await f.rpc('setupSave',{...preferences,cooldownSeconds:0})).preferences.cooldownSeconds,0);
  } finally {await f.dispose()}
});

test('a delayed reconciliation cannot send with credentials read before disconnect', async t => {
  const {makeThreadResponse}=await import('@get-bb/plugin-sdk/testing');
  const state=telegramMock(t);const f=await fixture({telegramBotToken:token,telegramChatId:'123'});
  const entered=deferred(),release=deferred();
  const thread=makeThreadResponse({id:'stale',projectId:'p1',title:'Private title',status:'error',runtime:{displayStatus:'error'},latestAttentionAt:100});
  f.harness.inspection.sdk.stub('threads.list',async()=>{entered.resolve();await release.promise;return [thread]});
  try {
    await f.harness.behavior.emitThreadEvent('thread.failed',{thread});await entered.promise;
    await f.rpc('setupTelegramDisconnect');release.resolve();
    for(let n=0;n<100 && !(await f.bb.storage.kv.get('noti:stale'));n++) await new Promise(r=>setTimeout(r,5));
    assert.ok(await f.bb.storage.kv.get('noti:stale'),'reconciliation reached delivery bookkeeping');
    assert.equal(state.calls?.filter(c=>c.method==='sendMessage').length ?? 0,0);
  } finally {release.resolve();await f.dispose()}
});
