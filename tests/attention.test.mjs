import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../attention.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function thread(id, extra = {}) {
  return { id, projectId: 'project', title: `Thread ${id}`, titleFallback: null,
    visibility: 'visible', archivedAt: null, deletedAt: null, status: 'idle',
    runtime: { displayStatus: 'idle' }, hasPendingInteraction: false,
    latestAttentionAt: 100, lastReadAt: 0, updatedAt: 100, ...extra };
}
function host(threads, storage = new Map(), pending = []) {
  return { storage: { kv: {
    get: async key => storage.get(key), set: async (key, value) => storage.set(key, value),
    delete: async key => storage.delete(key), list: async prefix => [...storage.keys()].filter(key => key.startsWith(prefix)),
  } }, log: { warn() {} }, sdk: { threads: {
    list: async ({ offset = 0, limit, projectId }) => threads.filter(t => !projectId || t.projectId === projectId).slice(offset, offset + limit),
    interactions: { list: async () => pending },
  } } };
}

test('reading a finished thread does not remove it or request another reply', async () => {
  const result = await buildSnapshot(host([thread('read', { lastReadAt: 200 })]));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].label, 'Turn finished');
  assert.equal(result.items[0].notificationEligible, false, 'read history must not generate new completion alerts');
});

test('a finished entry survives a new run and a plugin reload until dismissed', async () => {
  const threads = [thread('saved')], storage = new Map();
  await buildSnapshot(host(threads, storage));
  threads[0] = thread('saved', { status: 'active', runtime: { displayStatus: 'active' }, latestAttentionAt: 200, lastReadAt: 200 });
  const result = await buildSnapshot(host(threads, storage));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, 'finished');
  assert.equal(result.items[0].attentionAt, 100);
  assert.equal(result.items[0].notificationEligible, false);
});

test('dismissal hides that completion, including after reading, while a later completion returns', async () => {
  const threads = [thread('done')], bb = host(threads), dismissed = new Map([['done', 100]]);
  assert.equal((await buildSnapshot(bb, { dismissed })).items.length, 0);
  threads[0].lastReadAt = 500;
  assert.equal((await buildSnapshot(bb, { dismissed })).items.length, 0);
  threads[0].latestAttentionAt = 600;
  assert.equal((await buildSnapshot(bb, { dismissed })).items[0].attentionAt, 600);
});

test('active failure or question takes precedence over the retained completion', async () => {
  const threads = [thread('work')], storage = new Map();
  await buildSnapshot(host(threads, storage));
  threads[0] = thread('work', { status: 'active', hasPendingInteraction: true, latestAttentionAt: 200 });
  const pending = [{ status: 'pending', payload: { kind: 'user_question', questions: [{ prompt: 'Which option?' }] } }];
  const result = await buildSnapshot(host(threads, storage, pending));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, 'blocked');
  assert.equal(result.items[0].detail, 'Which option?');
});

test('finished items stay out of the waiting badge and unstarted threads stay out of the inbox', async () => {
  const bb = host([thread('finished'), thread('new', { latestAttentionAt: 0, lastReadAt: null })]);
  assert.equal((await buildSnapshot(bb)).total, 1);
  assert.equal((await buildSnapshot(bb, { includeFinished: false })).total, 0);
});

test('finished entries are not silently limited to the first 25 or first 500 threads', async () => {
  const result = await buildSnapshot(host(Array.from({ length: 501 }, (_, i) => thread(String(i), { latestAttentionAt: i + 1 }))));
  assert.equal(result.total, 501);
  assert.equal(result.items.length, 501);
  assert.equal(result.items[0].threadId, '500');
});

test('archived, deleted, and hidden threads are excluded even when previously retained', async () => {
  const threads = [thread('archived'), thread('deleted'), thread('hidden')], bb = host(threads);
  await buildSnapshot(bb);
  threads[0].archivedAt = 200; threads[1].deletedAt = 200; threads[2].visibility = 'hidden';
  assert.equal((await buildSnapshot(bb)).items.length, 0);
});
