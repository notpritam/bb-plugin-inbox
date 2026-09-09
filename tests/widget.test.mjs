import assert from 'node:assert/strict';
import { before, afterEach, test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const pluginRoot = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://fixture.invalid/', pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle']) {
  globalThis[key] = key === 'getComputedStyle' ? dom.window[key].bind(dom.window) : dom.window[key];
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });

const React = await import('react');
const { act, fireEvent, screen, waitFor, cleanup, within } = await import('@testing-library/react');
const { Toaster, toast } = await import('sonner');
const { loadPluginApp, renderSlot } = await import('@get-bb/plugin-sdk/testing/app');
let app, useBbContext;
let mounted;

before(async () => {
  await build({ entryPoints: [process.env.NY_PLUGIN_ENTRY || pluginRoot + '/app.tsx'], outfile: new URL('./compiled-app.mjs', import.meta.url).pathname,
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    tsconfig: pluginRoot + '/tsconfig.json',
    external: ['react', 'react-dom', 'react/jsx-runtime', '@get-bb/plugin-sdk/app', 'sonner'],
  });
  app = await loadPluginApp(() => import('./compiled-app.mjs'));
  ({ useBbContext } = await import('@get-bb/plugin-sdk/app'));
});

afterEach(async () => {
  await act(async () => { for (const item of toast.getToasts()) toast.dismiss(item.id); });
  if (mounted) mounted.lifecycle.unmount();
  mounted = undefined;
  cleanup();
  window.history.replaceState({}, "", "/");
});

function event(threadId, attentionAt = 100) {
  return { threadId, projectId: 'p1', kind: 'blocked', title: 'Waiting: ' + threadId,
    label: 'Question for you', detail: 'Which option?', attentionAt, at: 1000 };
}
function activeToasts() { return toast.getToasts().filter(t => String(t.id).startsWith('needs-you:')); }

function mount(initialThread = 'active') {
  const Accessory = app.navPanels[0].experimental_sidebarAccessory;
  let context;
  function Shell() {
    context = useBbContext();
    return React.createElement(React.Fragment, null, React.createElement(Accessory), React.createElement(Toaster));
  }
  const slot = renderSlot({ component: Shell }, {}, { context: { projectId: 'p1', threadId: initialThread },
    rpc: { list: () => ({ items: [], total: 0, generatedAt: 0 }) },
  });
  mounted = slot;
  return {
    slot,
    emit: payload => slot.behavior.emitRealtime('inbox:toast', payload),
    async navigate(threadId) {
      // SDK 0.4.21 has no route-change driver. Mutate this harness-only context
      // snapshot and rerender; production still reads the real useBbContext hook.
      context.threadId = threadId;
      await act(async () => { slot.lifecycle.rerender(React.createElement(Shell)); });
    },
  };
}

test('does not show a bottom notification for the thread currently being viewed', async () => {
  const ui = mount('active');
  await ui.emit(event('active'));
  assert.equal(activeToasts().length, 0);
});

test('shows other threads, removes the viewed thread on navigation, and keeps unrelated notifications', async () => {
  const ui = mount('active');
  await ui.emit(event('other'));
  await ui.emit(event('third'));
  assert.equal(activeToasts().length, 2);
  await screen.findByText('Waiting: other');
  await ui.navigate('other');
  assert.equal(activeToasts().length, 1);
  await waitFor(() => assert.equal(screen.queryByText('Waiting: other') === null, true));
  assert.ok(screen.getByText('Waiting: third'));
  await ui.emit(event('other', 101));
  assert.equal(activeToasts().length, 1);
  await ui.navigate('active');
  await ui.emit(event('other', 102));
  assert.equal(activeToasts().length, 2);
});

test('close is accessible, hides only that attention episode, and allows a new question', async () => {
  const ui = mount('active');
  await ui.emit(event('other'));
  const close = await screen.findByRole('button', { name: /close toast/i });
  fireEvent.click(close);
  await waitFor(() => assert.equal(activeToasts().length, 0));
  await ui.emit(event('other'));
  assert.equal(activeToasts().length, 0, 'the dismissed episode must stay closed');
  assert.equal(ui.slot.inspection.rpcCalls.some(call => call.method === 'dismiss'), false,
    'closing a toast must not dismiss the unresolved inbox item');
  await ui.emit(event('other', 101));
  assert.equal(activeToasts().length, 1, 'a new attention episode must be able to notify again');
});

test('repeated finished updates replace the thread popup and keep other threads visible', async () => {
  const ui = mount();
  await ui.emit(event('unrelated'));
  for (const attentionAt of [100, 101, 102]) {
    await ui.emit({ ...event('completed', attentionAt), kind: 'finished',
      title: 'Completed work', label: 'Turn finished', detail: `Result ${attentionAt}` });
  }
  assert.equal(activeToasts().length, 2, 'one popup per thread, regardless of how many turns finish');
  await screen.findByText('Result 102');
  assert.equal(screen.getAllByText('Completed work').length, 1);
  assert.equal(screen.queryByText('Result 100'), null);
  assert.equal(screen.queryByText('Result 101'), null);
  assert.ok(screen.getByText('Waiting: unrelated'));
});

test('a new question stays visible when it arrives while the previous popup is closing', async () => {
  const ui = mount();
  await ui.emit(event('follow-up', 100));
  fireEvent.click(await screen.findByRole('button', { name: /close toast/i }));
  await ui.emit({ ...event('follow-up', 101), detail: 'New follow-up question' });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
  assert.equal(activeToasts().length, 1);
  const popup = screen.getByText('New follow-up question').closest('[data-sonner-toast]');
  assert.notEqual(popup.dataset.removed, 'true');
});

test('a completion replaces the same thread question and an older replay cannot replace it', async () => {
  const ui = mount();
  await ui.emit(event('work', 100));
  await ui.emit({ ...event('work', 101), kind: 'finished', title: 'Completed work',
    label: 'Turn finished', detail: 'Latest result' });
  await screen.findByText('Latest result');
  await ui.emit(event('work', 100));
  assert.equal(activeToasts().length, 1);
  assert.equal(screen.queryByText('Which option?'), null);
  assert.ok(screen.getByText('Latest result'));
  fireEvent.click(screen.getByRole('button', { name: /close toast/i }));
  await waitFor(() => assert.equal(activeToasts().length, 0));
  await ui.emit({ ...event('work', 101), kind: 'finished', title: 'Completed work',
    label: 'Turn finished', detail: 'Latest result' });
  assert.equal(activeToasts().length, 0, 'closing the replacement silences its exact episode');
  await ui.emit(event('work', 102));
  assert.equal(activeToasts().length, 1, 'a later question can still notify');
});

test('a queued popup does not appear after immediately opening its thread', async () => {
  const ui = mount('active');
  await ui.emit(event('other'));
  await ui.navigate('other');
  // Sonner schedules its insertion on the next timer tick. Drain that tick so
  // an empty pre-insertion DOM cannot make this navigation-race check pass.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  const popup = screen.queryByText('Waiting: other')?.closest('[data-sonner-toast]');
  assert.equal(!popup || popup.dataset.removed === 'true', true);
});

test('deactivation removes this widget’s notifications without removing unrelated toasts', async () => {
  const ui = mount('active');
  await ui.emit(event('other'));
  await act(async () => { toast('Other plugin', { id: 'unrelated' }); });
  ui.slot.lifecycle.unmount();
  mounted = undefined;
  assert.equal(activeToasts().length, 0);
  assert.equal(toast.getToasts().some(t => t.id === 'unrelated'), true);
});

const inboxItems = [
  { ...event('failed'), kind: 'error', title: 'Fix checkout', label: 'Failed', detail: undefined },
  { ...event('waiting'), title: 'Design marketplace', detail: 'Grid or list?' },
  { ...event('finished'), kind: 'finished', title: 'Update docs', label: 'Turn finished — reply needed', detail: undefined },
].map(item => JSON.parse(JSON.stringify(item)));
const setupState = {
  pairing: null, completed: true, version: '0.2.0-beta.2', desktopAvailable: false, timezone: 'UTC',
  preferences: { notifyBlocked:true, notifyFailed:true, notifyFinished:false, toastEnabled:true, desktopEnabled:false, telegramInstant:true, cooldownSeconds:45, quietStart:'', quietEnd:'' },
  telegram: { configured:false, chatId:null, name:null, botUsername:null, lastTest:null },
};
const currentUpdate = { outcome:'current', installedVersion:'0.2.0-beta.2', latestVersion:null, candidateVersion:null, detail:'Current', checkedAt:1 };
function mountPanel(rpc = {}) {
  mounted = renderSlot(app.navPanels[0], { subPath: '' }, {
    context: { projectId: 'p1', threadId: null },
    rpc: { list: () => ({ items: inboxItems, total: 3, generatedAt: 0 }), setupStatus: () => structuredClone(setupState), setupCheckUpdates: () => currentUpdate, ...rpc },
  });
  return mounted;
}

test('Calm inbox groups active threads and keeps finished items available without counting them as waiting', async () => {
  mountPanel();
  await screen.findByRole('heading', { name: 'Failed', exact: true });
  assert.ok(screen.getByRole('heading', { name: 'Waiting for you', exact: true }));
  assert.ok(screen.getByText('2 threads'));
  assert.ok(screen.getByText('Grid or list?'));
  assert.ok(screen.getByRole('heading', { name: 'Finished', exact: true }));
  assert.ok(screen.getByRole('button', { name: 'Open Update docs' }));
  assert.equal(screen.queryByRole('button', { name: /^Finished/ }), null);
});

test('an inbox containing only finished threads shows the list without an empty-state placeholder', async () => {
  mountPanel({ list: () => ({ items: [inboxItems[2]], total: 1, generatedAt: 0 }) });
  await screen.findByRole('button', { name: 'Open Update docs' });
  assert.equal(screen.queryByText('Nothing needs you right now.'), null);
});

test('an inbox load failure explains recovery instead of claiming everything is caught up', async () => {
  let fail = true;
  mountPanel({ list: () => { if (fail) throw new Error('offline'); return { items: inboxItems, total: 3, generatedAt: 0 }; } });
  const alert = await screen.findByRole('alert');
  assert.ok(alert.textContent.includes('Couldn’t load your inbox'));
  assert.equal(screen.queryByText('Nothing needs you right now.'), null);
  fail = false;
  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'Open Fix checkout' });
  assert.equal(screen.queryByRole('alert'), null);
});

test('dismiss waits for the exact request to succeed and prevents duplicate submissions', async () => {
  let items = [...inboxItems], release;
  const slot = mountPanel({
    list: () => ({ items, total: items.length, generatedAt: 0 }),
    dismiss: () => new Promise(resolve => { release = () => { items = items.filter(i => i.threadId !== 'failed'); resolve({ ok: true }); }; }),
  });
  const dismiss = await screen.findByRole('button', { name: 'Dismiss Fix checkout' });
  fireEvent.click(dismiss); fireEvent.click(dismiss);
  await waitFor(() => assert.equal(dismiss.disabled, true));
  assert.ok(screen.getByRole('button', { name: 'Open Fix checkout' }));
  const calls = slot.inspection.rpcCalls.filter(call => call.method === 'dismiss');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, { threadId: 'failed', attentionAt: 100 });
  await act(async () => release());
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: 'Open Fix checkout' }), null));
  assert.ok(screen.getByRole('button', { name: 'Open Design marketplace' }));
});

test('Calm toast exposes the reason, thread and context while retaining the native close control', async () => {
  const ui = mount();
  await ui.emit(event('other'));
  const close = await screen.findByRole('button', { name: /close toast/i });
  const popup = close.closest('[data-sonner-toast]');
  assert.ok(within(popup).getByText('Needs You'));
  assert.ok(within(popup).getByText('Question for you'));
  assert.ok(within(popup).getByText('Waiting: other'));
  assert.ok(within(popup).getByText('Which option?'));
  assert.ok(within(popup).getByRole('button', { name: 'Open thread' }));
});


test('first use offers Telegram setup without blocking threads and the welcome can be skipped', async () => {
  let completed=false;
  mountPanel({setupStatus:()=>({...setupState,completed}),setupFinish:()=>{completed=true;return {ok:true}}});
  await screen.findByRole('heading',{name:'Welcome to Needs You'});
  assert.ok(screen.getByRole('button',{name:'Open Fix checkout'}));
  fireEvent.click(screen.getByRole('button',{name:'Use inbox',exact:true}));
  await waitFor(()=>assert.equal(screen.queryByRole('heading',{name:'Welcome to Needs You'}) === null,true));
  fireEvent.click(screen.getByRole('button',{name:'Settings',exact:true}));
  await screen.findByLabelText('Telegram bot token');
  assert.ok(screen.getByRole('button',{name:'Back to inbox'}));
});

test('Telegram setup masks and clears the token, then requires chat confirmation and an explicit test', async () => {
  const pairing={id:'pair-one',botUsername:'fixture_bot',url:'https://t.me/fixture_bot?start=synthetic',expiresAt:Date.now()+600000,candidate:null};
  const connected={...setupState,telegram:{configured:true,chatId:'123',name:'Casey',botUsername:'fixture_bot',lastTest:null}};
  mountPanel({setupTelegramBegin:()=>pairing,setupTelegramCheck:()=>({...pairing,candidate:{chatId:'123',name:'Casey',username:'casey'}}),setupTelegramConfirm:()=>connected,setupTelegramTest:()=>({ok:true})});
  fireEvent.click(await screen.findByRole('button',{name:'Settings',exact:true}));
  const input=await screen.findByLabelText('Telegram bot token');assert.equal(input.type,'password');
  fireEvent.change(input,{target:{value:'synthetic-private-token'}});
  fireEvent.click(screen.getByRole('button',{name:'Connect bot',exact:true}));
  await screen.findByRole('link',{name:'Open bot in Telegram'});
  assert.equal(screen.queryByDisplayValue('synthetic-private-token'),null);
  fireEvent.click(screen.getByRole('button',{name:'I pressed Start',exact:true}));
  await screen.findByText('@casey');
  fireEvent.click(screen.getByRole('button',{name:'Confirm this chat',exact:true}));
  await screen.findByRole('button',{name:'Send test notification',exact:true});
  assert.equal(mounted.inspection.rpcCalls.filter(c=>c.method==='setupTelegramTest').length,0);
  fireEvent.click(screen.getByRole('button',{name:'Send test notification',exact:true}));
  await screen.findByText(/Telegram accepted the test/);
});

test('notification settings save from the plugin and expose an opt-in update action', async () => {
  let saved;
  mountPanel({setupSave:input=>{saved=input;return {...setupState,preferences:input}},setupCheckUpdates:()=>({...currentUpdate,outcome:'update-available',latestVersion:'v0.2.0-beta.3',candidateVersion:'new'})});
  await screen.findByText(/Update available/);
  fireEvent.click(screen.getByRole('button',{name:'Settings',exact:true}));
  fireEvent.click(await screen.findByRole('checkbox',{name:/Completed turns/}));
  fireEvent.click(screen.getByRole('button',{name:'Save notification settings',exact:true}));
  await waitFor(()=>assert.equal(saved.notifyFinished,true));
  assert.ok(screen.getByRole('button',{name:'Update now',exact:true}));
  assert.equal(mounted.inspection.rpcCalls.some(c=>c.method==='setupApplyUpdate'),false);
});

test('an update is applied only on click and a rollback remains recoverable', async () => {
  let attempts=0;
  mountPanel({setupCheckUpdates:()=>({...currentUpdate,outcome:'update-available',latestVersion:'v0.2.0-beta.3',candidateVersion:'new'}),
    setupApplyUpdate:()=>{attempts++;return {outcome:'rolled-back',version:null}}});
  await screen.findByText(/Update available/);
  fireEvent.click(screen.getByRole('button',{name:'Settings',exact:true}));
  assert.equal(attempts,0);
  fireEvent.click(screen.getByRole('button',{name:'Update now',exact:true}));
  await screen.findByRole('alert');
  assert.equal(attempts,1);
  assert.match(screen.getByRole('alert').textContent,/restored the previous version/);
  assert.equal(screen.getByRole('button',{name:'Check for updates',exact:true}).disabled,false);
});

test('failed update checks show retry guidance without claiming the installation is current', async () => {
  mountPanel({setupCheckUpdates:()=>{throw new Error('offline')}});
  fireEvent.click(await screen.findByRole('button',{name:'Settings',exact:true}));
  await screen.findByText(/Couldn’t check for updates/);
  assert.equal(screen.queryByRole('button',{name:'Update now',exact:true}),null);
  assert.equal(screen.getByRole('button',{name:'Check for updates',exact:true}).disabled,false);
});

const reviewEvent = (attentionAt = 100) => ({ id: 'activity:guided-review:pr-123', projectId: 'p1',
  sourceName: 'Guided Review', href: '/plugins/guided-review/review/pr-123',
  kind: 'finished', title: 'Review sign-in', label: 'Guided Review · Ready', detail: 'Your guide is ready.', attentionAt, at: 1000 });

test('extension completion shows one dismissible popup with a review action, and stays quiet on that review', async () => {
  const ui = mount(null);
  await ui.emit(reviewEvent());
  await screen.findByRole('button', { name: 'Open review' });
  await ui.emit(reviewEvent(101));
  assert.equal(activeToasts().length, 1);
  fireEvent.click(screen.getByRole('button', { name: /close toast/i }));
  await waitFor(() => assert.equal(activeToasts().length, 0));
  await ui.emit(reviewEvent(101));
  assert.equal(activeToasts().length, 0);
  window.history.pushState({}, '', '/plugins/guided-review/review/pr-123');
  await ui.emit(reviewEvent(102));
  assert.equal(activeToasts().length, 0);
  window.history.pushState({}, '', '/plugins/guided-review/review/another');
  await ui.emit(reviewEvent(103));
  assert.equal(activeToasts().length, 1);
  window.history.pushState({}, '', '/plugins/guided-review/review/pr-123');
  await waitFor(() => assert.equal(activeToasts().length, 0));
});

test('extension inbox dismissal uses its activity identity and never the thread RPC', async () => {
  const item = { ...reviewEvent(), updatedAt: 100 };
  let items = [item];
  const slot = mountPanel({ list: () => ({ items, total: items.length, generatedAt: 0 }),
    dismissActivity: input => { assert.deepEqual(input, { id: item.id, attentionAt: 100 }); items = []; return { ok: true }; } });
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss Review sign-in' }));
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: 'Open Review sign-in' }) === null, true));
  assert.equal(slot.inspection.rpcCalls.some(c => c.method === 'dismiss'), false);
});

test('unsafe extension toast destinations are ignored', async () => {
  const ui = mount();
  for (const href of ['https://evil.example', '//evil.example', '/plugins/guided-review/review/..', '/plugins/guided-review/review/%2E%2E', '/plugins/guided-review/review/%2f%2fevil.example']) {
    await ui.emit({ ...reviewEvent(), href });
  }
  assert.equal(activeToasts().length, 0);
});
