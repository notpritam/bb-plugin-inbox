import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakePluginHost } from '@get-bb/plugin-sdk/testing';
import plugin from '../server.ts';

function thread(id, extra = {}) {
  return { id, projectId: 'p1', title: `Thread ${id}`, titleFallback: null, status: 'idle',
    runtime: { displayStatus: 'idle' }, visibility: 'visible', archivedAt: null, deletedAt: null,
    pinnedAt: null, parentThreadId: null, sourceThreadId: null, lifecycleOwnerThreadId: null,
    hasPendingInteraction: false, queuedWork: 'none', activity: { activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0, activeGoalCount: 0, activePlanModeCount: 0, activeWorkflowCount: 0 },
    updatedAt: 100, ...extra };
}
async function fixture(threads) {
  const { bb, harness } = createFakePluginHost({ pluginId: 'inbox', sdk: {
    projects: { list: async () => [{ id: 'p1', name: 'Personal' }] },
    threads: {
      list: async ({ archived, offset = 0, limit }) => threads.filter(t => (t.archivedAt !== null) === archived).slice(offset, offset + limit),
      get: async ({ threadId }) => { const t = threads.find(t => t.id === threadId); if (!t) throw new Error('Missing'); return t; },
      archive: async ({ threadId }) => {
        const pending = new Set([threadId]); let changed = true;
        while (changed) { changed = false; for (const t of threads) if (!pending.has(t.id) &&
          (pending.has(t.parentThreadId) || pending.has(t.lifecycleOwnerThreadId) || (t.visibility === 'hidden' && pending.has(t.sourceThreadId)))) {
          pending.add(t.id); changed = true;
        } }
        for (const t of threads) if (pending.has(t.id)) t.archivedAt = 1000;
        return { ok: true, archivedThreadIds: [...pending] };
      },
      unarchive: async ({ threadId }) => { threads.find(t => t.id === threadId).archivedAt = null; return { ok: true }; },
    },
  } });
  await plugin(bb);
  return { harness, call: (method, input) => harness.behavior.callRpc(method, input) };
}

test('cleaner lists read/dismissed threads across pages, filters and keeps archived history separate', async () => {
  const threads = Array.from({ length: 502 }, (_, n) => thread(`t${n}`, { updatedAt: n + 1 }));
  threads.push(thread('archived', { archivedAt: 1000 }), thread('hidden', { visibility: 'hidden' }));
  const f = await fixture(threads);
  try {
    const first = await f.call('cleanerList', {});
    assert.equal(first.total, 502); assert.equal(first.items.length, 100); assert.equal(first.items[0].id, 't0');
    assert.equal((await f.call('cleanerList', { offset: 500 })).items.length, 2);
    assert.equal((await f.call('cleanerList', { query: 't501' })).items[0].id, 't501');
    assert.equal((await f.call('cleanerList', { archived: true })).items[0].id, 'archived');
  } finally { await f.harness.lifecycle.dispose(); }
});

test('preview protects running, pinned, waiting, queued and active background work, including hidden descendants', async () => {
  for (const extra of [{ status: 'active' }, { runtime: { displayStatus: 'starting' } }, { pinnedAt: 10 },
    { hasPendingInteraction: true }, { queuedWork: 'waiting' }, { activity: { activeGoalCount: 1 } }]) {
    const f = await fixture([thread('parent'), thread('child', { parentThreadId: 'parent', visibility: 'hidden', ...extra })]);
    try {
      assert.ok((await f.call('cleanerList', {})).items[0].blocked);
      await assert.rejects(f.call('cleanerPreview', { threadIds: ['parent'], reason: 'done' }));
      assert.equal(f.harness.inspection.sdk.callsTo('threads.archive').length, 0);
    } finally { await f.harness.lifecycle.dispose(); }
  }
});

test('preview includes owned children and hidden forks; archive records completion and restore clears it', async () => {
  const threads = [thread('root'), thread('child', { lifecycleOwnerThreadId: 'root' }),
    thread('fork', { sourceThreadId: 'root', visibility: 'hidden' })];
  const f = await fixture(threads);
  try {
    const preview = await f.call('cleanerPreview', { threadIds: ['root', 'child'], reason: 'done' });
    assert.equal(preview.items.length, 3);
    const result = await f.call('cleanerArchive', { token: preview.token });
    assert.equal(result.archivedIds.length, 3); assert.deepEqual(result.errors, []);
    assert.equal(f.harness.inspection.sdk.callsTo('threads.archive').length, 1);
    await assert.rejects(f.call('cleanerArchive', { token: preview.token }));
    const next = await f.harness.lifecycle.reload(plugin);
    f.harness = next.harness;
    f.call = (method, input) => next.harness.behavior.callRpc(method, input);
    assert.ok((await f.call('cleanerList', { archived: true })).items.every(t => t.reason === 'done'));
    assert.equal((await f.call('cleanerList', {})).total, 0);
    const restore = await f.call('cleanerRestore', { threadIds: ['root'] });
    assert.equal(restore.restoredIds.length, 3);
    assert.ok((await f.call('cleanerList', {})).items.every(t => t.reason === null));
  } finally { await f.harness.lifecycle.dispose(); }
});

test('archive rejects a stale preview when a thread changes, starts running or gains children', async () => {
  for (const mutate of [ts => { ts[0].updatedAt++; }, ts => { ts[0].status = 'active'; }, ts => ts.push(thread('new', { parentThreadId: 'root' }))]) {
    const threads = [thread('root')], f = await fixture(threads);
    try {
      const preview = await f.call('cleanerPreview', { threadIds: ['root'], reason: 'unneeded' });
      mutate(threads);
      await assert.rejects(f.call('cleanerArchive', { token: preview.token }));
      assert.equal(f.harness.inspection.sdk.callsTo('threads.archive').length, 0);
    } finally { await f.harness.lifecycle.dispose(); }
  }
});

test('partial archive failures report only successful changes and do not mark failed work done', async () => {
  const threads = [thread('good'), thread('bad')], f = await fixture(threads);
  try {
    f.harness.sdk.stub('threads.archive', async ({ threadId }) => {
      if (threadId === 'bad') throw new Error('Host unavailable');
      threads[0].archivedAt = 1000;
      return { ok: true, archivedThreadIds: [threadId] };
    });
    const preview = await f.call('cleanerPreview', { threadIds: ['good', 'bad'], reason: 'done' });
    const result = await f.call('cleanerArchive', { token: preview.token });
    assert.deepEqual(result.archivedIds, ['good']); assert.match(result.errors[0], /Host unavailable/);
    assert.equal((await f.call('cleanerList', {})).items[0].reason, null);
  } finally { await f.harness.lifecycle.dispose(); }
});

test('cleaner RPC validates bounded selections and rejects archive without a server preview', async () => {
  const f = await fixture([thread('root')]);
  try {
    await assert.rejects(f.call('cleanerPreview', { threadIds: [], reason: 'done' }));
    await assert.rejects(f.call('cleanerPreview', { threadIds: Array(101).fill('root'), reason: 'done' }));
    await assert.rejects(f.call('cleanerArchive', { token: 'invented' }));
  } finally { await f.harness.lifecycle.dispose(); }
});
