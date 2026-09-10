// Use only a fresh, isolated BB profile. This saves preferences and demo activities.
// No real Telegram credentials or messages are used.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.NY_TEST_BB_URL;
if (!base) throw new Error('Set NY_TEST_BB_URL to a fresh isolated BB instance, never your normal BB server.');
const shots = '.test-artifacts';
await mkdir(shots, { recursive: true });
async function rpc(method, input = null) {
  const response = await fetch(`${base}/api/v1/plugins/inbox/rpc/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  const body = await response.json();
  assert.equal(body.ok, true, JSON.stringify(body));
  return body.result;
}
const first = await rpc('setupStatus');
assert.equal(first.completed, false, 'Use a fresh profile for onboarding verification.');
assert.equal(first.telegram.configured, false);
assert.equal(first.preferences.notifyFinished, false);
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, colorScheme: 'light' });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/plugins/inbox/inbox`);
  await page.getByRole('heading', { name: 'Welcome to Needs You' }).waitFor();
  await page.screenshot({ path: `${shots}/welcome.png` });
  await page.getByRole('button', { name: 'Use inbox', exact: true }).click();
  await page.getByRole('heading', { name: 'Welcome to Needs You' }).waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal((await rpc('setupStatus')).completed, true);
  const token = page.getByLabel('Telegram bot token');
  await token.waitFor();
  assert.equal(await token.getAttribute('type'), 'password');
  await token.fill('invalid-format');
  await page.getByRole('button', { name: 'Connect bot', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Paste the complete bot token' }).waitFor();
  assert.equal(await token.inputValue(), '');
  const completion = page.getByRole('checkbox', { name: /Completed turns/ });
  await completion.check();
  await page.getByRole('button', { name: 'Save notification settings', exact: true }).click();
  await page.getByText('Notification settings saved.', { exact: true }).waitFor();
  assert.equal((await rpc('setupStatus')).preferences.notifyFinished, true);
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await completion.waitFor(); assert.equal(await completion.isChecked(), true);
  await page.getByRole('button', { name: 'Check for updates', exact: true }).waitFor({ state: 'visible' });
  await page.setViewportSize({ width: 1440, height: 1300 });
  await page.screenshot({ path: `${shots}/settings-light.png` });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1080 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `settings overflow at ${width}`);
  }
  console.log('PASS fresh onboarding, persistent skip/settings, invalid token recovery, responsive settings');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  const ready = { sourceId: 'guided-review', sourceName: 'Guided Review', entityId: 'demo-navigation',
    eventId: 'demo-ready-1', occurredAt: Date.now(), title: 'Demo · Review workspace navigation',
    body: 'Example outcome: your chaptered pull request guide is ready to review.', status: 'ready',
    target: { panel: 'review', segments: ['demo-navigation'] } };
  const failed = { ...ready, entityId: 'demo-settings', eventId: 'demo-error-1', status: 'error',
    title: 'Demo · Generate the account settings guide', body: 'Example outcome: generation stopped. Open the review to check its state.',
    target: { panel: 'review', segments: ['demo-settings'] } };
  await rpc('publishActivity', failed);
  await page.getByRole('button', { name: `Open ${failed.title}`, exact: true }).waitFor();
  await rpc('publishActivity', ready);
  await page.getByRole('button', { name: `Open ${ready.title}`, exact: true }).waitFor();
  assert.equal((await rpc('publishActivity', ready)).duplicate, true);
  assert.equal((await rpc('list', {})).items.length, 2);
  await page.locator('.ny-toast[data-removed="false"]').first().waitFor();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('.ny-toast[data-mounted="true"]').first().waitFor();
  await page.waitForTimeout(500); // Let host theme and toast entrance transitions settle.
  await page.screenshot({ path: `${shots}/inbox-dark.png` });
  const close = page.getByRole('button', { name: /close toast/i });
  while (await close.count()) {
    const before = await close.count(); await close.first().click();
    await page.waitForFunction(n => document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"]) button[aria-label="Close toast"]').length < n, before);
    await page.waitForTimeout(250);
  }
  assert.equal((await rpc('list', {})).items.length, 2, 'popup close must preserve inbox items');
  await page.reload();
  await page.getByRole('button', { name: `Open ${ready.title}`, exact: true }).waitFor();
  await page.getByRole('button', { name: `Dismiss ${ready.title}`, exact: true }).click();
  await page.getByRole('button', { name: `Open ${ready.title}`, exact: true }).waitFor({ state: 'hidden' });
  assert.equal((await rpc('publishActivity', ready)).duplicate, true);
  assert.equal((await rpc('list', {})).items.length, 1);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `inbox overflow at ${width}`);
    if (width === 390) await page.screenshot({ path: `${shots}/inbox-mobile.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS durable activity, duplicate suppression, popup close, dismissal, reload, responsive inbox; zero browser errors');
} finally { await browser.close(); }
