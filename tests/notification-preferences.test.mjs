import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';

async function fixture(settings = {}) {
  const { bb, harness } = createFakePluginHost({ pluginId: 'inbox', settings: {
    desktopEnabled: false, telegramBotToken: 'synthetic-token', telegramChatId: '123', ...settings,
  }});
  await plugin(bb);
  return { harness, rpc: input => harness.behavior.callRpc('notify', input), close: () => harness.lifecycle.dispose() };
}

test('generic extension notifications respect the Telegram alert preference', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
  const f = await fixture({ telegramInstant: false });
  try {
    assert.deepEqual(await f.rpc({ title: 'Build finished', channel: 'telegram' }), { desktop: false, telegram: false });
    assert.equal(calls.length, 0, 'turning Telegram alerts off must stop generic plugin sends too');
    await f.harness.behavior.setSettings({ telegramInstant: true });
    assert.equal((await f.rpc({ title: 'Build finished', channel: 'telegram' })).telegram, true);
    assert.equal(calls.length, 1);
  } finally { await f.close(); }
});

test('generic extension notifications stay silent during quiet hours', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(String(url));
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
  const hour = new Date().getHours();
  const hh = n => String(n % 24).padStart(2, '0') + ':00';
  const f = await fixture({ telegramInstant: true, quietStart: hh(hour), quietEnd: hh(hour + 1) });
  try {
    assert.deepEqual(await f.rpc({ title: 'Build finished', channel: 'both' }), { desktop: false, telegram: false });
    assert.equal(calls.length, 0);
    await f.harness.behavior.setSettings({ quietStart: '', quietEnd: '' });
    assert.equal((await f.rpc({ title: 'Build finished', channel: 'telegram' })).telegram, true);
    assert.equal(calls.length, 1);
  } finally { await f.close(); }
});

test('muting extension activity also silences generic extension notifications', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
  const f = await fixture({ notifyExtensions: false, telegramInstant: true });
  try {
    assert.deepEqual(await f.rpc({ title: 'Build finished', channel: 'both' }), { desktop: false, telegram: false });
    assert.equal(calls.length, 0);
    await f.harness.behavior.setSettings({ notifyExtensions: true });
    assert.equal((await f.rpc({ title: 'Build finished', channel: 'telegram' })).telegram, true);
  } finally { await f.close(); }
});
