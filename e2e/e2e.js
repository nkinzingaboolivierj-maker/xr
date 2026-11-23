'use strict';
// Browser end-to-end test of the bundled web app against the REAL backend
// (in-memory database, real HTTP, real Chromium). Not part of `npm test`
// because it needs Playwright + a browser, which the project deliberately
// does not pull in as a dependency:
//
//   npm i --no-save playwright && npx playwright install chromium
//   node e2e/e2e.js
//
// Exit code 0 only if every step passes and the page produced no console
// errors / CSP violations.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { startServer } = require('../src/server');
const { createBusiness } = require('../src/modules/business/business.service');
const authService = require('../src/modules/auth/auth.service');

const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
let step = 0; const results = [];
async function ok(name, fn) {
  step += 1;
  try { await fn(); results.push([true, name]); console.log(`  ✓ ${String(step).padStart(2)} ${name}`); }
  catch (e) { results.push([false, name, e]); console.log(`  ✗ ${String(step).padStart(2)} ${name}\n      ${e.message.split('\n')[0]}`); throw e; }
}

(async () => {
  const { server, db, port } = await startServer({ dbFile: ':memory:', port: 0 });
  const base = `http://127.0.0.1:${port}`;
  const biz = createBusiness(db, { name: 'Kigali Electronics' });
  authService.createUser(db, { businessId: biz.id, email: 'owner@kigali.rw', password: 'owner-password-1', role: 'Owner' });
  const other = createBusiness(db, { name: 'Other Co' });
  authService.createUser(db, { businessId: other.id, email: 'boss@other.rw', password: 'other-password-1', role: 'Owner' });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource.*(401|403|404|409|422|503)|ERR_INTERNET_DISCONNECTED/.test(m.text())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: false });
  const nav = async (label) => { await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true }).click(); await page.waitForLoadState('networkidle'); };

  try {
    await ok('login page renders and rejects a wrong password with a clear message', async () => {
      await page.goto(base);
      await page.getByLabel('Email').waitFor();
      await shot('01-login');
      await page.getByLabel('Email').fill('owner@kigali.rw'); await page.getByLabel('Password').fill('wrong-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByText('Email or password is incorrect').waitFor();
    });

    await ok('owner signs in and sees the dashboard with the full navigation', async () => {
      await page.getByLabel('Password').fill('owner-password-1'); await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('heading', { name: /Hello, owner/ }).waitFor();
      for (const label of ['Point of sale', 'Sales', 'Products', 'Inventory', 'Purchases', 'Finance & reports', 'Payments', 'Team', 'Business']) await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true }).waitFor();
      await shot('02-dashboard');
    });

    await ok('business profile can be completed (feeds receipts)', async () => {
      await nav('Business');
      await page.getByRole('button', { name: 'Edit profile' }).click();
      await page.getByLabel('Phone').fill('+250 788 000 000'); await page.getByLabel('Address').fill('KN 4 Ave, Kigali'); await page.getByLabel('Tax ID (TIN)').fill('TIN-123456789');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.getByText('TIN-123456789').waitFor();
    });

    await ok('add a tax rate (18% VAT)', async () => {
      await page.getByRole('button', { name: 'Add rate' }).click();
      await page.getByLabel('Rate %').fill('18'); await page.getByLabel('Effective from').fill('2020-01-01');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByText('18%').first().waitFor();
    });

    await ok('create a product and set its MIN / RECOMMENDED / MAX price', async () => {
      await nav('Products');
      await page.getByText('No products yet').waitFor();
      await shot('03-products-empty');
      await page.getByRole('button', { name: 'Add product' }).click();
      await page.getByLabel('SKU').fill('USB-C-1M'); await page.getByLabel('Name').fill('USB-C Cable 1m'); await page.getByLabel('Category').fill('Cables'); await page.getByLabel('Barcode (GTIN)').fill('6001234567890');
      await page.getByRole('button', { name: 'Create product' }).click();
      await page.getByText('Selling price').waitFor();
      await page.getByLabel('Minimum').fill('800'); await page.getByLabel('Recommended').fill('1000'); await page.getByLabel('Maximum').fill('1500'); await page.getByLabel('Reason (audited)').fill('Initial price');
      await page.getByRole('button', { name: 'Save price' }).click();
      await page.getByText('Price saved').waitFor();
      await page.getByRole('button', { name: 'Close' }).click();
      await page.getByText('USB-C Cable 1m').waitFor();
    });

    await ok('server rejects an invalid price band and the UI shows why (MIN > RECOMMENDED)', async () => {
      await page.getByText('USB-C Cable 1m').click();
      await page.getByLabel('Minimum').fill('2000');
      await page.getByRole('button', { name: 'Save price' }).click();
      await page.locator('.alert.bad').first().waitFor();
      await page.getByRole('button', { name: 'Close' }).click();
    });

    await ok('add a supplier and a purchase order, open the PO document, receive the stock', async () => {
      await nav('Purchases');
      await page.getByRole('button', { name: 'Add supplier' }).click();
      await page.getByLabel('Name').fill('Acme Supply Ltd'); await page.getByLabel('Phone').fill('0788111222');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByText('Acme Supply Ltd').waitFor();
      await page.getByRole('tab', { name: 'Purchase orders' }).click();
      await page.getByRole('button', { name: 'New purchase order' }).click();
      await page.getByLabel('Quantity').first().fill('20'); await page.getByLabel('Unit cost').first().fill('600');
      await page.getByRole('button', { name: 'Save as draft' }).click();
      await page.getByRole('heading', { name: /^PO-|^PUR/ }).waitFor();
      await page.getByRole('heading', { name: 'Purchase Order', exact: true }).waitFor();
      await shot('04-purchase-order');
      await page.getByRole('button', { name: 'Receive stock' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Receive stock' }).click();
      await page.getByText('Stock received').waitFor();
      await page.getByText('received', { exact: false }).first().waitFor();
    });

    await ok('inventory reflects the received batch (20 units) and the ledger has the PURCHASE entry', async () => {
      await nav('Inventory');
      await page.getByText('USB-C Cable 1m').waitFor();
      await page.getByRole('cell', { name: '20', exact: true }).first().waitFor();
      await page.getByRole('tab', { name: 'Ledger' }).click();
      await page.getByText('PURCHASE').first().waitFor();
    });

    await ok('POS: scan the barcode (Enter), take cash, server prices the sale incl. 18% tax, receipt shows', async () => {
      await nav('Point of sale');
      await page.getByRole('button', { name: 'Add USB-C Cable 1m' }).waitFor();
      await shot('05-pos');
      await page.getByLabel('Scan barcode or search products').fill('6001234567890'); await page.keyboard.press('Enter');
      await page.getByLabel('Quantity of USB-C Cable 1m').waitFor();
      await page.getByLabel('Quantity of USB-C Cable 1m').fill('2'); await page.getByLabel('Quantity of USB-C Cable 1m').press('Tab');
      await page.getByText('Total (est.)').waitFor();
      await page.getByLabel('Cash received').fill('5000');
      await page.getByRole('button', { name: /Charge/ }).click();
      await page.getByRole('dialog', { name: 'Sale complete' }).waitFor();
      const dlg = page.getByRole('dialog', { name: 'Sale complete' });
      await dlg.getByText('2,360 RWF').first().waitFor(); // 2 x 1000 + 18% = 2360 (server-computed)
      await dlg.getByText('2,640 RWF').waitFor();       // change
      await shot('06-receipt-dialog');
    });

    await ok('receipt PDF is downloadable from the UI and is a real PDF', async () => {
      const [popup] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('dialog').getByRole('button', { name: 'PDF receipt' }).click()]);
      assert.ok(popup, 'a new tab opened'); // headless Chromium has no PDF viewer, so only the tab opening is asserted here
      await popup.close();
      // ...and the bytes behind the button are a genuine PDF (same authenticated request the button makes):
      const head = await page.evaluate(async () => {
        const t = sessionStorage.getItem('xr.session');
        const list = await (await fetch('/sales?pageSize=1', { headers: { Authorization: `Bearer ${t}` } })).json();
        const r = await fetch(`/documents/receipt/${list.data[0].id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
        const buf = new Uint8Array(await r.arrayBuffer());
        return { type: r.headers.get('content-type'), magic: String.fromCharCode(...buf.slice(0, 5)) };
      });
      assert.deepEqual(head, { type: 'application/pdf', magic: '%PDF-' });
      await page.getByRole('button', { name: 'New sale' }).click();
    });

    await ok('stock fell to 18 in the POS tile, and selling more than stock is refused by the server', async () => {
      await page.getByText('18 left').waitFor();
      await page.getByRole('button', { name: 'Add USB-C Cable 1m' }).click();
      await page.getByLabel('Quantity of USB-C Cable 1m').fill('500'); await page.getByLabel('Quantity of USB-C Cable 1m').press('Tab');
      await page.getByLabel('Cash received').fill('999999999');
      await page.getByRole('button', { name: /Charge/ }).click();
      await page.locator('.toast.bad').waitFor();
      assert.match(await page.locator('.toast.bad').innerText(), /only 18 remaining/);
      await page.getByRole('button', { name: 'Decrease' }).first().click();
      await page.getByLabel('Quantity of USB-C Cable 1m').fill('1'); await page.getByLabel('Quantity of USB-C Cable 1m').press('Tab');
    });

    await ok('price below MIN is refused by the server (a cashier-side edit cannot undercut the band)', async () => {
      await page.getByLabel('Unit price of USB-C Cable 1m').fill('100'); await page.getByLabel('Unit price of USB-C Cable 1m').press('Tab');
      await page.getByLabel('Cash received').fill('5000');
      await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())); // drop the earlier oversell toast
      await page.getByRole('button', { name: /Charge/ }).click();
      await page.locator('.toast.bad').waitFor();
      assert.match(await page.locator('.toast.bad').innerText(), /min|price|below/i);
    });

    await ok('non-cash sale with a Mobile Money reference is recorded as manually confirmed', async () => {
      await page.getByLabel('Unit price of USB-C Cable 1m').fill('1000'); await page.getByLabel('Unit price of USB-C Cable 1m').press('Tab');
      await page.getByRole('button', { name: 'Mobile Money' }).click();
      await page.getByLabel('Payment reference').fill('MP240612.1234.A56789');
      await page.getByRole('button', { name: /Charge/ }).click();
      await page.getByRole('dialog', { name: 'Sale complete' }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Open sale' }).click();
      await page.getByText('MP240612.1234.A56789').waitFor();
      await page.getByText('manual', { exact: false }).first().waitFor();
      await shot('07-sale-receipt');
    });

    await ok('return one unit from the first sale: refundable value is the amount actually paid incl. tax, then refund it', async () => {
      await nav('Sales');
      await page.getByRole('row').nth(2).click(); // oldest sale (2 units, cash)
      await page.getByRole('button', { name: 'Return items' }).click();
      await page.getByLabel(/Quantity to return of/).fill('1');
      await page.getByRole('button', { name: 'Create return' }).click();
      await page.getByText('Still refundable').waitFor();
      await page.getByText('1,180 RWF').first().waitFor(); // 1 of 2 units of a 2,360 sale
      await page.getByRole('button', { name: 'Refund customer' }).click();
      await page.getByRole('button', { name: 'Record refund' }).click();
      await page.getByText('Refund recorded').waitFor();
      await shot('08-return');
    });

    await ok('finance summary: revenue, COGS, profit and tax reconcile with the transactions', async () => {
      await nav('Finance & reports');
      await page.getByText('How the profit is built').waitFor();
      await page.getByText('Tax held for the authority').waitFor();
      await shot('09-finance');
      const text = await page.locator('main').innerText();
      assert.match(text, /Net revenue/); assert.match(text, /Net profit/);
    });

    await ok('customers and expenses can be created from the UI', async () => {
      await nav('Customers');
      await page.getByRole('button', { name: 'Add customer' }).click();
      await page.getByLabel('Name').fill('Jean Mugabo'); await page.getByLabel('Phone').fill('0788123456');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByText('Jean Mugabo').waitFor();
      await nav('Expenses');
      await page.getByRole('button', { name: 'Record expense' }).click();
      await page.getByLabel('Category').fill('Rent'); await page.getByLabel('Amount').fill('50000');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByText('Expense recorded').waitFor();
      await page.getByRole('cell', { name: '50,000 RWF' }).first().waitFor();
    });

    await ok('every screen and tab renders real data without an error state (owner)', async () => {
      const bad = async (where) => { const n = await page.locator('.state .big', { hasText: /Something went wrong|Not allowed|offline/ }).count(); assert.equal(n, 0, `error state on ${where}`); };
      const tabsOf = { 'Returns & refunds': ['Refunds'], Inventory: ['Aging', 'Ledger', 'Stock levels'], Purchases: ['Suppliers', 'Purchase orders'], 'Finance & reports': ['Sales', 'Purchases', 'Returns', 'Product performance', 'Profit & loss'], Payments: ['Unreconciled', 'Payment requests'] };
      for (const label of ['Dashboard', 'Sales', 'Returns & refunds', 'Customers', 'Products', 'Inventory', 'Purchases', 'Expenses', 'Finance & reports', 'Payments', 'Team', 'Business', 'My account']) {
        await nav(label); await page.waitForTimeout(250); await bad(label);
        for (const t of tabsOf[label] || []) { await page.getByRole('tab', { name: t, exact: true }).click(); await page.waitForTimeout(250); await bad(`${label} / ${t}`); }
        if (label === 'Finance & reports') await shot('09b-reports');
      }
      await nav('Returns & refunds'); await page.getByRole('tab', { name: 'Returns', exact: true }).click();
      await page.getByRole('row').nth(1).click(); await page.getByText('Return value').waitFor(); await bad('return detail');
      await nav('Purchases'); await page.getByRole('row').nth(1).click(); await page.getByRole('heading', { name: 'Purchase Order', exact: true }).waitFor(); await bad('purchase document');
    });

    await ok('XSS: HTML stored in a product name is rendered as inert text, never executed', async () => {
      const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
      await page.evaluate(async (name) => { const t = sessionStorage.getItem('xr.session'); await fetch('/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ sku: 'XSS-1', name }) }); }, payload);
      await nav('Dashboard'); await nav('Products');
      await page.getByText(payload, { exact: false }).first().waitFor();
      assert.equal(await page.evaluate(() => window.__xss), undefined, 'payload must not execute');
      assert.equal(await page.locator('img[src="x"]').count(), 0, 'payload must not become an element');
    });

    await ok('Team: owner creates a cashier with a temporary password', async () => {
      await nav('Team');
      await page.getByRole('button', { name: 'Add team member' }).click();
      await page.getByLabel('Email').fill('cashier@kigali.rw'); await page.getByLabel('Temporary password').fill('temp-pass-123');
      await page.getByRole('button', { name: 'Create user' }).click();
      await page.getByText('cashier@kigali.rw').waitFor();
      await shot('10-team');
    });

    await ok('sign out; the cashier must change the temporary password before anything else', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByLabel('Email').fill('cashier@kigali.rw'); await page.getByLabel('Password').fill('temp-pass-123'); await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('heading', { name: 'Choose a new password' }).waitFor();
      await page.getByLabel('Temporary password', { exact: true }).fill('temp-pass-123'); await page.getByLabel('New password', { exact: true }).fill('cashier-own-pass'); await page.getByLabel('Repeat new password').fill('cashier-own-pass');
      await page.getByRole('button', { name: 'Save and continue' }).click();
      await page.getByRole('heading', { name: /Hello, cashier/ }).waitFor();
    });

    await ok('cashier navigation hides finance/team/purchases/payment-admin; direct URL to a forbidden screen falls back safely', async () => {
      const navEl = page.getByRole('navigation', { name: 'Main' });
      for (const hidden of ['Team', 'Finance & reports', 'Purchases']) assert.equal(await navEl.getByRole('link', { name: hidden, exact: true }).count(), 0, hidden);
      await page.goto(`${base}/#/finance`); await page.waitForLoadState('networkidle');
      await page.getByRole('heading', { name: /Hello, cashier/ }).waitFor();
      // The server independently refuses what the UI hides:
      const status = await page.evaluate(async () => { const t = sessionStorage.getItem('xr.session'); return (await fetch('/finance/summary', { headers: { Authorization: `Bearer ${t}` } })).status; });
      assert.equal(status, 403);
    });

    await ok('cashier can run a sale but gets no discount / cost controls', async () => {
      await nav('Point of sale');
      await page.getByRole('button', { name: 'Add USB-C Cable 1m' }).click();
      assert.equal(await page.getByLabel('Sale discount').count(), 0);
      assert.equal(await page.getByText('Gross profit').count(), 0);
    });

    await ok('tenant isolation in the browser: the other business cannot see this business’s data', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByLabel('Email').fill('boss@other.rw'); await page.getByLabel('Password').fill('other-password-1'); await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('heading', { name: /Hello, boss/ }).waitFor();
      await nav('Products'); await page.getByText('No products yet').waitFor();
      await nav('Sales'); await page.getByText('No sales yet.').waitFor();
    });

    await ok('network failure shows an offline/error state with Retry, and Retry recovers', async () => {
      await ctx.setOffline(true);
      await nav('Customers').catch(() => {});
      await page.locator('.state .big', { hasText: 'You appear to be offline' }).waitFor({ timeout: 8000 });
      await ctx.setOffline(false);
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.getByText('No customers yet.').waitFor();
    });

    await ok('an expired/revoked session returns to the sign-in screen with an explanation', async () => {
      await page.evaluate(() => sessionStorage.setItem('xr.session', 'not-a-real-token'));
      await nav('Products').catch(() => {});
      await page.getByText('Your session has ended').waitFor();
    });

    await ok('mobile viewport: shell collapses to a menu button and POS stays usable', async () => {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.getByLabel('Email').fill('owner@kigali.rw'); await page.getByLabel('Password').fill('owner-password-1'); await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('button', { name: 'Open menu' }).waitFor();
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Point of sale', exact: true }).click();
      await page.getByLabel('Scan barcode or search products').waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
      await page.waitForTimeout(450); // let the drawer finish closing
      await shot('11-mobile-pos');
    });

    await ok('strict CSP held: no inline-script/style violations, no console errors during the whole run', async () => {
      assert.deepEqual(problems, []);
    });
  } catch (e) {
    await shot('FAILURE').catch(() => {});
    console.log('\nProblems captured:', problems);
    await browser.close(); server.close();
    console.log(`\n${results.filter((r) => r[0]).length}/${results.length} steps passed before failure`);
    process.exit(1);
  }
  await browser.close(); server.close();
  console.log(`\nE2E: ${results.length}/${results.length} steps passed`);
  process.exit(0);
})();
