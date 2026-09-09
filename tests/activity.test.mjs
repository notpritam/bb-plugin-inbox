import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';

const activity = { sourceId: 'guided-review', sourceName: 'Guided Review', entityId: 'pr-123',
  eventId: 'generation-1', occurredAt: 100, projectId: 'p1', title: 'Improve sign-in',
  body: 'Your guide is ready to review.', status: 'ready', target: { panel: 'review', segments: ['pr-123'] } };
async function fixture(settings = {}) {
  const { bb, harness } = createFakePluginHost({ pluginId: 'inbox', sdk: { threads: { list: async () => [] } }, settings: { desktopEnabled: false, telegramInstant: false, ...settings } });
  await plugin(bb);
  return { bb, harness, rpc: (method, input = null) => harness.behavior.callRpc(method, input), close: () => harness.lifecycle.dispose() };
}

test('extension completion is retained once across concurrent retries, dismissal, and older events', async () => {
  const f = await fixture();
  try {
    const receipts = await Promise.all([f.rpc('publishActivity', activity), f.rpc('publishActivity', activity)]);
    assert.equal(receipts.filter(r => !r.duplicate).length, 1);
    let list = await f.rpc('list', {});
    assert.equal(list.items.length, 1);
    const item = list.items[0];
    assert.equal(item.href, '/plugins/guided-review/review/pr-123');
    assert.equal(item.sourceName, 'Guided Review');
    assert.equal(item.threadId, undefined, 'activity must not masquerade as a thread');
    await f.rpc('dismissActivity', { id: item.id, attentionAt: item.attentionAt });
    await f.rpc('publishActivity', activity);
    assert.equal((await f.rpc('list', {})).items.length, 0);
    await f.rpc('publishActivity', { ...activity, eventId: 'generation-2', occurredAt: 200 });
    await f.rpc('publishActivity', activity);
    list = await f.rpc('list', {});
    assert.equal(list.items.length, 1);
    assert.ok(list.items[0].attentionAt > item.attentionAt);
    await f.rpc('dismissActivity', { id: item.id, attentionAt: item.attentionAt });
    assert.equal((await f.rpc('list', {})).items.length, 1, 'stale dismissal cannot remove newer work');
    assert.equal((await f.rpc('list', { projectId: 'p2' })).items.length, 0);
  } finally { await f.close(); }
});

test('extension input rejects external destinations, traversal, and oversized data', async () => {
  const f = await fixture();
  try {
    for (const input of [
      { ...activity, target: { panel: 'https://evil.example', segments: [] } },
      { ...activity, target: { panel: 'review', segments: ['..'] } },
      { ...activity, target: { panel: 'review', segments: ['a/b'] } },
      { ...activity, title: 'x'.repeat(241) },
      { ...activity, url: 'https://evil.example' },
    ]) await assert.rejects(f.rpc('publishActivity', input));
    assert.equal((await f.rpc('list', {})).total, 0);
  } finally { await f.close(); }
});

test('extension alerts have a separate preference and remain in the inbox when muted', async () => {
  const f = await fixture({ notifyExtensions: false, notifyFinished: true });
  try {
    const emitted = [];
    const publish = f.bb.realtime.publish;
    f.bb.realtime.publish = (channel, payload) => { emitted.push(channel); return publish(channel, payload); };
    await f.rpc('publishActivity', activity);
    assert.equal(emitted.includes('inbox:toast'), false);
    assert.equal((await f.rpc('list', {})).total, 1);
    await f.harness.behavior.setSettings({ notifyExtensions: true, notifyFinished: false });
    await f.rpc('publishActivity', { ...activity, eventId: 'generation-2', occurredAt: 200 });
    assert.equal(emitted.filter(c => c === 'inbox:toast').length, 1);
    await f.rpc('publishActivity', { ...activity, eventId: 'generation-2', occurredAt: 200 });
    assert.equal(emitted.filter(c => c === 'inbox:toast').length, 1);
  } finally { await f.close(); }
});


test('saved activity and its dismissal survive a plugin reload without another popup', async () => {
  const f = await fixture();
  const receipt = await f.rpc('publishActivity', activity);
  const next = await f.harness.lifecycle.reload(plugin);
  try {
    const rpc = (name, input) => next.harness.behavior.callRpc(name, input);
    assert.equal((await rpc('publishActivity', activity)).duplicate, true);
    const item = (await rpc('list', {})).items[0];
    assert.equal(item.id, receipt.id);
    await rpc('dismissActivity', { id: item.id, attentionAt: item.attentionAt });
    const last = await next.harness.lifecycle.reload(plugin);
    try {
      assert.equal((await last.harness.behavior.callRpc('publishActivity', activity)).duplicate, true);
      assert.equal((await last.harness.behavior.callRpc('list', {})).total, 0);
    } finally { await last.harness.lifecycle.dispose(); }
  } finally { await next.harness.lifecycle.dispose(); }
});

test('extension activity respects quiet hours and Telegram instant-push preferences', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (String(url).includes('/connect/rpc/status')) return Response.json({ ok: true, result: { paired: true, url: 'https://bb.example' } });
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
  const f = await fixture({ telegramBotToken: 'synthetic-token', telegramChatId: '123' });
  try {
    await f.rpc('publishActivity', activity);
    assert.equal(calls.length, 0, 'disabled instant push must stay quiet');
    const hour = new Date().getHours();
    const hh = n => String(n % 24).padStart(2, '0') + ':00';
    await f.harness.behavior.setSettings({ telegramInstant: true, quietStart: hh(hour), quietEnd: hh(hour + 1) });
    await f.rpc('publishActivity', { ...activity, eventId: 'quiet', occurredAt: 200 });
    assert.equal(calls.length, 0, 'quiet hours apply to extension notifications');
    await f.harness.behavior.setSettings({ quietStart: '', quietEnd: '' });
    await f.rpc('publishActivity', { ...activity, eventId: 'audible', occurredAt: 300 });
    assert.equal(calls.length, 2);
    assert.ok(calls[1].body.text.includes('https://bb.example/plugins/guided-review/review/pr-123'));
    assert.equal((await f.rpc('list', {})).total, 1);
  } finally { await f.close(); }
});
