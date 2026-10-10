// Production browser QA only. No application test hooks or live wallet access.
// Install Playwright separately and set PLAYWRIGHT_MODULE to its index.mjs.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as btc from '@scure/btc-signer';
import { base64, hex } from '@scure/base';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:33217';
assert.equal(new URL(origin).hostname, '127.0.0.1');
const output = process.env.QA_OUTPUT || '/tmp/sat-reclaimer-m10-browser';
await mkdir(output, { recursive: true });
// Existing deterministic offline fixture key; never use a funded wallet here.
const key = hex.decode('1'.padStart(64, '0'));
const pub = btc.utils.pubSchnorr(key);
const address = btc.p2tr(pub, undefined, btc.TEST_NETWORK).address;
const destination = btc.p2tr(btc.utils.pubSchnorr(hex.decode('9'.padStart(64, '0'))), undefined, btc.TEST_NETWORK).address;
const calls = [];
const errors = [];
const evidence = { origin, address, destination, layouts: [], checks: [], errors, calls };
const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
evidence.browser = browser.version();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
// Deny all external transport. Node fixtures are served inside interception.
let nodeStatus = 'unknown';
let posts = 0;
await context.route('**/*', async (route) => {
  const req = route.request();
  if (new URL(req.url()).origin === origin) return route.continue();
  calls.push({ transport: req.method(), url: req.url() });
  if (req.method() === 'POST') { posts++; return route.fulfill({ status: 503, body: 'Fixture ambiguous submission' }); }
  if (nodeStatus === 'offline') return route.abort();
  if (nodeStatus === 'unknown') return route.fulfill({ status: 404, body: 'Not found' });
  return route.fulfill({ json: { confirmed: nodeStatus === 'confirmed', block_height: nodeStatus === 'confirmed' ? 123456 : undefined } });
});
await context.exposeBinding('fixtureWallet', async (_source, method, params, mode) => {
  calls.push({ method, params: method === 'signPsbt' ? { broadcast: params.broadcast, inputs: Object.values(params.signInputs)[0].length } : params });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: 'qa', error: { code, message } });
  const ok = (result) => ({ jsonrpc: '2.0', id: 'qa', result });
  if (method === 'getInfo') return fail(-32601, 'Fixture has no getInfo');
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (mode.cancel && method === 'wallet_connect') return fail(-32000, 'Fixture cancellation');
  if (mode.disconnectError && method === 'wallet_disconnect') return fail(-32603, 'Fixture disconnect refused');
  if (method === 'wallet_connect') return ok({ walletType: 'Fixture Xverse', network: { bitcoin: { name: mode.mismatch ? 'Mainnet' : params.network } }, addresses: [{ address, publicKey: hex.encode(pub), purpose: 'ordinals', addressType: 'p2tr', walletType: 'software' }] });
  if (method === 'wallet_disconnect') return ok({});
  if (method === 'ord_getInscriptions') {
    if (mode.scanError) return fail(-32603, 'Fixture scan unavailable');
    const count = mode.count || 205;
    const rows = Array.from({ length: Math.min(params.limit, count - params.offset) }, (_, i) => {
      const txid = (params.offset + i + 1).toString(16).padStart(64, '0');
      return { inscriptionId: `${txid}i0`, inscriptionNumber: String(i), output: `${txid}:0`, postage: String(mode.postage || 10000), address, contentType: 'image/png' };
    });
    return ok({ total: mode.incomplete ? count + 1 : count, offset: params.offset, limit: params.limit, inscriptions: rows });
  }
  if (method === 'signPsbt') {
    assert.equal(params.broadcast, false);
    if (mode.signCancel) return fail(-32000, 'Fixture signing cancelled');
    if (mode.sizeError) return fail(-32603, 'Fixture PSBT too large');
    const tx = btc.Transaction.fromPSBT(base64.decode(params.psbt));
    tx.sign(key);
    return ok({ psbt: base64.encode(tx.toPSBT(0)) });
  }
  return fail(-32601, 'Unexpected fixture method');
});
await context.addInitScript(() => {
  window.qaMode = {};
  window.BitcoinProvider = { request: (method, params) => window.fixtureWallet(method, params, window.qaMode) };
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
evidence.console = [];
evidence.localFailures = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) evidence.console.push({ type: m.type(), text: m.text() }); });
page.on('response', r => { if (new URL(r.url()).origin === origin && r.status() >= 400) evidence.localFailures.push({ url: r.url(), status: r.status() }); });
const button = (name) => page.getByRole('button', { name, exact: true });
const text = async () => page.locator('body').innerText();
const checkText = async (s, timeout = 15000) => { await page.getByText(s, { exact: false }).first().waitFor({ timeout }); };
async function layout(name, width) {
  await page.setViewportSize({ width, height: 1000 });
  // Bound image height: a long verification report can exceed the browser's
  // full-page raster limit on a narrow display. Capture actual viewports and
  // the decision panels separately instead of hanging on one giant bitmap.
  await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: name !== 'console-verified', timeout: 15000 });
  if (name === 'console-verified') {
    // Capture actual viewports above/below the long review, leaving room for
    // the app bar instead of aligning an element screenshot beneath it.
    await page.locator('.cx-final').evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 74));
    await page.screenshot({ path: `${output}/${name}-start-${width}.png`, timeout: 15000 });
    await page.locator('.cx-final').evaluate(e => window.scrollTo(0, e.getBoundingClientRect().bottom + scrollY - innerHeight + 24));
    await page.screenshot({ path: `${output}/${name}-end-${width}.png`, timeout: 15000 });
  }
  const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).slice(0, 12).map(e => ({ tag: e.tagName, cls: e.className, text: e.textContent.slice(0, 80) })),
    textOverflow: [...document.querySelectorAll('main *')].filter(e => e.children.length === 0 && e.textContent).filter(e => {
      const range = document.createRange(); range.selectNodeContents(e); const r = range.getBoundingClientRect(); return r.width && r.right > innerWidth + 1;
    }).slice(0,12).map(e => ({ tag: e.tagName, cls: e.className, text: e.textContent.slice(0,80) })) }));
  evidence.layouts.push({ name, ...result });
  assert.equal(result.scrollWidth, width, `${name} must fit ${width}px`);
  assert.deepEqual(result.overflowing, [], `${name} content must stay inside ${width}px`);
  if (name.startsWith('console')) assert.equal(await page.locator('.console-wrap > .cx-log').evaluate(e => getComputedStyle(e).position), 'static', 'Status must not cover transaction review or approval');
  return result;
}
async function connectScan(mode = {}) {
  await page.evaluate(mode => { window.qaMode = mode; }, mode);
  await button('Connect Xverse').click();
  await checkText('Address and public key agree');
  await button('Scan all inscriptions').click();
  if ((mode.count || 205) > 100) {
    await checkText('Scanning: 100 of');
    evidence.scanProgress = await page.getByText('Scanning: 100 of', { exact: false }).first().innerText();
    assert.equal(await button('Scan all inscriptions').isDisabled(), true);
    assert.equal(await page.getByRole('combobox').isDisabled(), true);
  }
  await checkText('Scan complete:', 60000);
  await page.getByLabel('I understand', { exact: false }).check();
  await page.getByLabel('Destination Bitcoin address', { exact: false }).fill(destination);
}
try {
  if (process.env.QA_SCALE === 'true') {
    await page.goto(`${origin}/app`);
    await connectScan({ count: 10000 });
    await page.getByText('Choose individual UTXOs (10,000 selected)', { exact: true }).click();
    assert.equal(await page.locator('details[open] .cx-check').count(), 100);
    const pageStarted = Date.now();
    await button('Next outputs').click(); await checkText('Page 2 of 100');
    evidence.paginationMs = Date.now() - pageStarted;
    await page.evaluate(() => {
      window.qaTiming = { gaps: [], longTasks: [], last: performance.now() };
      window.qaTimer = setInterval(() => {
        const now = performance.now(); window.qaTiming.gaps.push(now - window.qaTiming.last); window.qaTiming.last = now;
      }, 50);
      window.qaObserver = new PerformanceObserver(list => window.qaTiming.longTasks.push(...list.getEntries().map(e => e.duration)));
      window.qaObserver.observe({ type: 'longtask', buffered: true });
    });
    const started = Date.now();
    await button('Review sweep (10,000 UTXOs)').click({ timeout: 300000 });
    await page.getByText('Pre-sign review', { exact: true }).waitFor({ timeout: 300000 });
    await page.waitForTimeout(100);
    evidence.planningMs = Date.now() - started;
    evidence.timing = await page.evaluate(() => { clearInterval(window.qaTimer); window.qaObserver.disconnect(); return window.qaTiming; });
    assert.equal(await page.locator('.cx-batch').count(), 6);
    evidence.summary = await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Pre-sign review' }) }).innerText();
    assert.ok(evidence.summary.includes('395,822 WU largest, 2,301,332 WU total'));
    assert.ok(evidence.summary.includes('98,956 vB largest, 575,336 vB total'));
    await page.screenshot({ path: `${output}/scale-review.png`, fullPage: true });
    assert.equal(calls.filter(c => c.method === 'signPsbt').length, 0);
    assert.equal(posts, 0);
    evidence.checks.push('10,000 fixture inputs, 100-output selection pages, six measured batches; browser event-loop timing recorded; no signing or POST');
  } else if (process.env.QA_BROADCAST === 'true') {
    await page.goto(`${origin}/app`);
    await connectScan({ count: 3 });
    await button('Review sweep (3 UTXOs)').click();
    await page.getByLabel('Signing acknowledgement phrase').fill('SPEND AS BTC');
    await button('Sign + verify').click(); await checkText('Verified locally:');
    assert.equal(await button('Broadcast transaction').isDisabled(), true);
    const downloadPromise = page.waitForEvent('download');
    await button('Download verified .hex').click();
    await (await downloadPromise).saveAs(`${output}/fixture.hex`);
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(`${output}/fixture.hex`, 'utf8');
    await page.getByLabel('I authorize broadcasting this exact transaction', { exact: false }).check();
    await button('Broadcast transaction').evaluate(e => { e.click(); e.click(); e.click(); });
    await checkText('The submission outcome is unknown');
    assert.equal(posts, 1);
    assert.equal(await button('Broadcast transaction').isDisabled(), true);
    assert.equal(await button('Submission attempted').isDisabled(), true);
    await page.getByLabel('Raw transaction hex').fill(raw);
    await button('Inspect transaction').click();
    const recovery = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recover a saved transaction' }) });
    assert.equal(await recovery.getByRole('button', { name: 'Broadcast imported transaction' }).isDisabled(), true);
    await recovery.getByText('What this inspection could not verify').click();
    await recovery.evaluate(e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 74));
    await page.screenshot({ path: `${output}/recovery-attempted.png` });
    nodeStatus = 'confirmed';
    await recovery.getByRole('button', { name: 'Check confirmation' }).click(); await checkText('123456');
    assert.equal(posts, 1);
    evidence.checks.push('Rapid normal broadcast: exactly one intercepted POST, HTTP503 then independent GETs, ambiguous result locks resubmission/re-sign; recovery shares attempt ledger');
    await page.reload();
    await page.getByLabel('Choose a saved raw transaction file').setInputFiles(`${output}/fixture.hex`);
    await checkText('cannot be verified from these bytes');
    assert.equal(await button('Broadcast imported transaction').isDisabled(), true);
    await page.getByLabel('I authorize broadcasting this exact transaction', { exact: false }).check();
    await page.getByLabel('Type SPEND AS BTC to confirm').fill('SPEND AS BTC');
    assert.equal(await button('Broadcast imported transaction').isDisabled(), false);
    await page.getByRole('combobox').selectOption('Testnet');
    assert.equal((await text()).includes('Broadcast imported transaction'), false);
    await page.getByLabel('Raw transaction hex').fill(raw);
    await button('Inspect transaction').click();
    assert.equal(await button('Broadcast imported transaction').isDisabled(), true);
    await page.getByLabel('I authorize broadcasting this exact transaction', { exact: false }).check();
    await page.getByLabel('Type SPEND AS BTC to confirm').fill('SPEND AS BTC');
    await page.getByLabel('Raw transaction hex').fill(raw.trim() + '\n');
    assert.equal((await text()).includes('Broadcast imported transaction'), false);
    await button('Inspect transaction').click();
    await page.getByLabel('I authorize broadcasting this exact transaction', { exact: false }).check();
    await page.getByLabel('Type SPEND AS BTC to confirm').fill('SPEND AS BTC');
    nodeStatus = 'offline';
    await button('Broadcast imported transaction').evaluate(e => { e.click(); e.click(); e.click(); });
    await checkText('Its outcome is unknown and nothing was retried');
    assert.equal(posts, 2);
    assert.equal(await button('Broadcast imported transaction').isDisabled(), true);
    await page.screenshot({ path: `${output}/recovery-ambiguous.png`, fullPage: true });
    evidence.checks.push('File recovery after refresh requires fresh checkbox/phrase; network and byte edits clear approval; rapid recovery submits once, offline lookup never retries');
  } else {
  for (const path of ['/', '/app']) {
    await page.goto(`${origin}${path}`);
    await page.waitForTimeout(400);
    for (const width of [1440, 1280, 834, 390, 320]) await layout(path === '/' ? 'landing' : 'console-idle', width);
    if (path === '/') {
      evidence.landingMotion = await page.locator('.reveal').evaluateAll(elements => elements.map(e => ({ opacity: getComputedStyle(e).opacity, delay: getComputedStyle(e).transitionDelay })));
      assert.ok(evidence.landingMotion.length > 0);
      assert.ok(evidence.landingMotion.every(e => e.opacity === '1' && e.delay === '0s'));
      await button('Open menu').focus(); await page.keyboard.press('Enter');
      assert.equal(await button('Close menu').getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await button('Open menu').getAttribute('aria-expanded'), 'false');
      evidence.checks.push('Landing reduced-motion reveals visible; mobile menu Enter/Escape interaction');
    }
  }
  // Traverse the real browser tab order and inspect the native focus ring.
  await page.reload();
  const focus = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    focus.push(await page.evaluate(() => {
      const e = document.activeElement, s = getComputedStyle(e);
      return { tag: e.tagName, label: e.textContent?.trim().slice(0, 50) || e.getAttribute('aria-label'), outline: s.outlineStyle, width: s.outlineWidth, visible: e.matches(':focus-visible') };
    }));
  }
  evidence.focus = focus;
  assert.ok(focus.some(e => e.tag === 'SELECT'));
  assert.ok(focus.some(e => e.label === 'Connect Xverse'));
  // Chromium returns focus to BODY once it leaves the page for browser chrome.
  assert.ok(focus.filter(e => e.tag !== 'BODY').every(e => e.visible && e.outline !== 'none' && e.width !== '0px'));
  await page.screenshot({ path: `${output}/keyboard-focus-320.png` });
  evidence.motion = await page.evaluate(() => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    running: document.getAnimations().filter(a => a.playState === 'running').length }));
  assert.equal(evidence.motion.reduced, true);
  assert.equal(evidence.motion.scroll, 'auto');
  assert.equal(evidence.motion.running, 0);
  evidence.checks.push('Keyboard tab order reaches network/wallet/recovery controls, visible focus rings; reduced motion stops animations');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { window.qaMode = { cancel: true }; });
  await button('Connect Xverse').click(); await checkText('WALLET_USER_REJECTED');
  await page.evaluate(() => { window.qaMode = { mismatch: true }; });
  await button('Connect Xverse').click(); await checkText('WALLET_NETWORK_MISMATCH');
  await page.evaluate(() => { window.qaMode = {}; });
  const beforeConnect = calls.filter(c => c.method === 'wallet_connect').length;
  await button('Connect Xverse').evaluate(e => { e.click(); e.click(); e.click(); });
  await checkText('Address and public key agree');
  assert.equal(calls.filter(c => c.method === 'wallet_connect').length, beforeConnect + 1);
  await page.evaluate(() => { window.qaMode = { disconnectError: true }; });
  await button('Disconnect').click(); await checkText('Fixture disconnect refused');
  assert.equal(await button('Scan all inscriptions').isDisabled(), true);
  await page.getByRole('combobox').selectOption('Testnet');
  assert.equal((await text()).includes(address), false);
  await page.getByRole('combobox').selectOption('Signet');
  evidence.checks.push('Cancelled connect, network mismatch, rapid connect only once, failed disconnect clears wallet, network switch clears state');
  await connectScan();
  await page.getByText('Choose individual UTXOs (205 selected)', { exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('details[open] .cx-check').count(), 100);
  await button('Next outputs').click();
  await checkText('Page 2 of 3');
  await page.locator('details[open] input[type=checkbox]').first().focus();
  await page.keyboard.press('Space');
  await button('Next outputs').click();
  assert.equal(await page.locator('details[open] .cx-check').count(), 5);
  assert.equal(await button('Next outputs').isDisabled(), true);
  await button('Previous outputs').click();
  assert.equal(await page.locator('details[open] input[type=checkbox]').first().isChecked(), false);
  for (const width of [1440, 1280, 834, 390, 320]) await layout('console-selection', width);
  evidence.checks.push('205 outputs: pages 100/100/5, individual selection retained across pages');
  await button('Review sweep (204 UTXOs)').click();
  await checkText('Pre-sign review');
  for (const width of [1440, 1280, 834, 390, 320]) await layout('console-review', width);
  await page.getByLabel('Fee rate (sat/vB)', { exact: true }).fill('3');
  assert.equal((await text()).includes('Pre-sign review'), false);
  await button('Review sweep (204 UTXOs)').click();
  await page.getByLabel('Destination Bitcoin address', { exact: false }).fill(address);
  assert.equal((await text()).includes('Pre-sign review'), false);
  await page.getByLabel('Destination Bitcoin address', { exact: false }).fill(destination);
  await page.getByLabel('Fee rate (sat/vB)', { exact: true }).fill('1.5');
  await button('Review sweep (204 UTXOs)').click();
  await checkText('whole-number fee rate');
  evidence.checks.push('Unsigned destination/fee changes invalidate review; fractional fee refused');
  await page.getByLabel('Fee rate (sat/vB)', { exact: true }).fill('2');
  await button('Review sweep (204 UTXOs)').click();
  await page.getByLabel('Signing acknowledgement phrase').fill('SPEND AS BTC');
  const beforeSign = calls.filter(c => c.method === 'signPsbt').length;
  await button('Sign + verify').evaluate(e => { e.click(); e.click(); e.click(); });
  await checkText('Verified locally:');
  assert.equal(calls.filter(c => c.method === 'signPsbt').length, beforeSign + 1);
  for (const label of ['Fee rate (sat/vB)', 'Destination Bitcoin address']) assert.equal(await page.getByLabel(label, { exact: false }).isDisabled(), true);
  assert.equal(await button('Clear selection').isDisabled(), true);
  assert.equal(await button('Broadcast transaction').isDisabled(), true);
  const downloadPromise = page.waitForEvent('download');
  await button('Download verified .hex').click();
  const download = await downloadPromise;
  await download.saveAs(`${output}/fixture.hex`);
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(`${output}/fixture.hex`, 'utf8');
  nodeStatus = 'confirmed';
  await button('Check confirmation').click();
  await checkText('123456');
  for (const width of [1440, 1280, 834, 390, 320]) await layout('console-verified', width);
  evidence.checks.push('Fixture signing broadcast:false; independent verification, signed edit locks, export, confirmed status');
  await page.reload();
  await button('Connect Xverse').waitFor();
  assert.equal((await text()).includes('Verified locally:'), false);
  await page.getByLabel('Raw transaction hex').fill(raw);
  await button('Inspect transaction').click();
  await checkText('cannot be verified from these bytes');
  await button('Check confirmation').click();
  await checkText('123456');
  nodeStatus = 'mempool'; await button('Check confirmation').click(); await checkText('mempool');
  nodeStatus = 'unknown'; await button('Check confirmation').click(); await checkText('No endpoint knows');
  nodeStatus = 'offline'; await button('Check confirmation').click(); await checkText('could not');
  await page.getByLabel('Raw transaction hex').fill('00');
  assert.equal((await text()).includes('cannot be verified from these bytes'), false);
  await button('Inspect transaction').click();
  await checkText('Refused');
  assert.equal(posts, 0);
  evidence.checks.push('Refresh discards signed state; manual raw import, unknown fee disclosure, read-only confirmation/mempool/unknown/offline; edit invalidation, malformed import refused; zero POSTs');
  await page.reload();
  await connectScan({ postage: 400, count: 3 });
  await button('Review sweep (3 UTXOs)').click();
  await checkText('The Bitcoin network fee is');
  await page.locator('.cx-banner[role="alert"]').screenshot({ path: `${output}/fee-warning.png` });
  await page.getByLabel('Signing acknowledgement phrase').fill('SPEND AS BTC');
  await page.evaluate(() => { window.qaMode.signCancel = true; });
  await button('Sign + verify').click(); await checkText('WALLET_USER_REJECTED');
  assert.equal((await text()).includes('Verified locally:'), false);
  await page.evaluate(() => { window.qaMode.scanError = true; });
  await button('Scan all inscriptions').click(); await checkText('Fixture scan unavailable');
  assert.equal((await text()).includes('Pre-sign review'), false);
  assert.equal(await page.getByRole('button', { name: /^Review sweep/ }).isDisabled(), true);
  evidence.checks.push('High-fee warning above 25%, signing cancellation produces no verified transaction, failed rescan discards stale review');
  await page.evaluate(() => { window.qaMode = { incomplete: true }; });
  await button('Scan all inscriptions').click(); await checkText('Scan INCOMPLETE:');
  await page.getByLabel('I understand', { exact: false }).check();
  await page.getByLabel('Destination Bitcoin address', { exact: false }).fill(destination);
  assert.equal(await page.getByRole('button', { name: /^Review sweep/ }).isDisabled(), true);
  evidence.checks.push('Incomplete provider scan blocks review');
  await page.reload();
  await page.evaluate(() => { delete window.BitcoinProvider; });
  await button('Connect Xverse').click(); await checkText('WALLET_NOT_INSTALLED');
  evidence.checks.push('Missing provider reports install/reconnect guidance');
  await page.reload();
  await connectScan({ count: 5 });
  await button('Review sweep (5 UTXOs)').click();
  await page.getByLabel('Signing acknowledgement phrase').fill('SPEND AS BTC');
  await page.evaluate(() => { window.qaMode.sizeError = true; });
  await button('Sign + verify').click(); await checkText('Re-planned 5 UTXOs into 3 transactions');
  assert.equal(await page.getByLabel('Signing acknowledgement phrase').inputValue(), '');
  assert.equal(await page.locator('.cx-batch').count(), 3);
  const summary = await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Pre-sign review' }) }).innerText();
  assert.ok(summary.includes('largest,'));
  assert.equal(summary.includes('vB each,'), false);
  assert.equal(summary.includes('WU each,'), false);
  await page.evaluate(() => { window.qaMode.sizeError = false; });
  await page.getByLabel('Signing acknowledgement phrase').fill('SPEND AS BTC');
  await button('Sign + verify').first().click(); await checkText('Verified locally:');
  await page.evaluate(() => { window.qaMode.sizeError = true; });
  await page.getByRole('button', { name: 'Sign + verify', exact: true }).first().click();
  await checkText('Earlier signed batches have been preserved');
  assert.equal(await page.locator('.cx-batch').count(), 3);
  assert.equal(await button('Download verified .hex').count(), 1);
  evidence.checks.push('Fixture size rejection replans 5 into 2/2/1, resets phrase, labels largest batch accurately; later rejection preserves signed recovery bytes and partition');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(evidence.localFailures, []);
  assert.deepEqual(evidence.console.filter(m => !m.text.startsWith('Failed to load resource:')), [], 'Unexpected console/CSP messages');
  console.log(JSON.stringify({ checks: evidence.checks, layouts: evidence.layouts.length, posts, errors }));
} catch (error) {
  evidence.failure = error.message;
  evidence.failureText = await page.locator('body').innerText().catch(() => 'Page unavailable');
  await page.screenshot({ path: `${output}/failure.png`, fullPage: false, timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  evidence.posts = posts;
  await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
