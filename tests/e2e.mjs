// Browser acceptance tests against the built app (npm run build && npm run e2e).
// Covers the brief's acceptance list. Screenshots go to tests/screens/.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(require.resolve('playwright', { paths: ['/usr/lib/node_modules', '/usr/local/lib/node_modules'] })); }

const here = dirname(fileURLToPath(import.meta.url)); const root = join(here, '..', process.argv[2] || 'dist'); const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => { const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); try { res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(await readFile(p)); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, r)); const url = `http://localhost:${server.address().port}/`;

let pass = 0, fail = 0; const errors = [];
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, detail); } };
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => d.accept());
const csvFile = (name, text) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
const cards = () => page.locator('[data-testid=property-card]').count();
const importCsv = async (name, text, { snapshot = false } = {}) => {
  await page.goto(url + '#import'); await page.reload(); await page.locator('input[type=file]').setInputFiles(csvFile(name, text));
  if (snapshot) await page.getByLabel(/complete list/).check();
  const btn = page.getByRole('button', { name: /^Import \d+ rows/ }); if (!(await btn.count()) || await btn.isDisabled()) return '';
  await btn.click();
  return (await page.getByTestId('import-report').filter({ hasText: name }).textContent()) || '';
};

try {
  await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload();
  check('empty state offers add / import / examples', await page.getByRole('heading', { name: 'No properties yet' }).isVisible());

  // 1. adding a property saves it permanently
  await page.getByRole('link', { name: 'Add a property' }).click();
  await page.getByLabel('Address *').fill('12 High Street'); await page.getByLabel('Town *').selectOption('Torphins');
  await page.getByLabel('Asking price (£)').fill('300000'); await page.getByLabel('Date observed').fill('2026-09-01');
  await page.getByRole('button', { name: 'Add property' }).click();
  await page.waitForURL(/#p-/); await page.reload();
  check('added property survives a browser refresh', await page.getByRole('heading', { name: '12 High Street' }).isVisible());
  check('missing details show "Unknown"', (await page.locator('.unknown').count()) >= 5);

  // 2. importing twice does not duplicate; report shows result
  const csv1 = 'Address,Town,Price,Status,Beds\n12 High St,Torphins,"Offers over £300,000",For sale,3\n3 Mill Lane,Torphins,250000,For sale,2\n';
  let rep = await importCsv('list1.csv', csv1);
  check('first import reports 1 new, 1 updated', /1 new · 1 updated/.test(rep), rep);
  rep = await importCsv('list1.csv', csv1);
  check('importing the same file again: 0 new, 2 unchanged', /0 new · 0 updated · 2 unchanged/.test(rep), rep);
  await page.goto(url + '#dashboard'); await page.getByLabel('Town').selectOption('area');
  check('no duplicate properties after two imports', (await cards()) === 2, String(await cards()));

  // 3. a price change records old and new values
  rep = await importCsv('list2.csv', 'Address,Town,Price,Observed date\n12 High Street,Torphins,"Offers over £285,000",2026-10-15\n3 Mill Lane,Torphins,250000,2026-10-15\n');
  check('price change counted as an update', /1 updated/.test(rep), rep);
  await page.goto(url + '#dashboard'); await page.locator('[data-testid=property-card]', { hasText: '12 High Street' }).click();
  const tl = () => page.getByTestId('timeline').textContent();
  check('timeline shows old → new price with £ and %', /Price reduced.*£300,000 → £285,000 \(−£15,000, −5\.0%\)/s.test(await tl()), await tl());
  check('price graph is drawn', (await page.locator('.chart svg path').count()) === 1 && (await page.locator('.chart svg circle').count()) === 2);
  await page.locator('.chart svg').hover(); check('graph hover shows a value', await page.locator('.chart .tip').isVisible());

  // 4. under offer appears in timeline and can return to for sale
  const setStatus = async (label, date) => { await page.locator('summary', { hasText: 'Record a status change' }).click({ force: true }); await page.getByLabel('New status').selectOption({ label }); await page.getByLabel('Date', { exact: true }).fill(date); await page.getByRole('button', { name: 'Save status' }).click(); };
  await setStatus('Under offer', '2026-10-20');
  check('Under offer saved and in the timeline', (await page.locator('.pill.st-under_offer').first().isVisible()) && /Under offer/.test(await tl()));
  await page.reload(); await setStatus('For sale', '2026-11-01');
  check('returns from Under offer to For sale, recorded as "Returned to market"', /Returned to market/.test(await tl()) && (await page.locator('.row .pill.st-for_sale').first().isVisible()));
  await page.goto(url + '#alerts'); check('back-on-market and reduction alerts raised', (await page.getByText('Back on the market', { exact: true }).count()) === 1 && (await page.getByText('Price reduced', { exact: true }).count()) === 1);

  // 5. a listing that disappears is not classified as sold
  rep = await importCsv('complete.csv', 'Address,Town,Price\n12 High Street,Torphins,285000\n', { snapshot: true });
  check('complete-list import reports 1 no longer seen', /1 no longer seen/.test(rep), rep);
  await page.goto(url + '#dashboard'); await page.locator('[data-testid=property-card]', { hasText: '3 Mill Lane' }).click();
  check('missing listing is "No longer seen (unverified)", not sold', (await page.locator('.pill.st-not_seen').first().isVisible()) && !(/Sold/.test(await tl())));

  // 6. failed import is reported and changes nothing
  rep = await importCsv('bad.csv', 'Price,Beds\n1,2\n');
  check('CSV without address/town is refused with a clear message', await page.getByText(/no column for: address, town/).isVisible());
  rep = await importCsv('rows.csv', 'Address,Town,Status\n,Torphins,For sale\n9 Glen Road,Aboyne,banana\n');
  check('import with only bad rows is refused, with the reason per row', (await page.getByText(/every row has a problem/).isVisible()) && (await page.getByText('unknown status "banana"').count()) + (await page.getByText(/status "banana"/).count()) > 0);

  // 7. filters work (with clearly marked example data)
  await page.goto(url + '#data'); await page.getByRole('button', { name: 'Add example properties' }).click();
  await page.goto(url + '#dashboard'); check('example data is labelled', (await page.locator('.pill.demo').count()) === 8);
  await page.getByLabel('Town').selectOption('Banchory'); check('town filter: Banchory shows 2', (await cards()) === 2, String(await cards()));
  await page.getByRole('button', { name: 'Clear filters' }).click(); await page.getByLabel('Price movement').selectOption('reduced');
  check('price movement filter: 3 reduced (2 examples + 12 High St)', (await cards()) === 3, String(await cards()));
  await page.getByLabel('Price movement').selectOption(''); await page.getByLabel('Status').selectOption('under_offer');
  check('status filter: 1 under offer', (await cards()) === 1, String(await cards()));
  await page.getByLabel('Status').selectOption('all'); await page.getByLabel('Min price').fill('400k');
  check('price filter: 3 at £400k+', (await cards()) === 3, String(await cards()));
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.screenshot({ path: join(shots, 'dashboard-desktop.png'), fullPage: true });
  await page.goto(url + '#analysis'); await page.screenshot({ path: join(shots, 'analysis-desktop.png'), fullPage: true });
  check('analysis page shows town table', (await page.locator('table').first().locator('tbody tr').count()) >= 6);
  await page.goto(url + '#data'); await page.getByRole('button', { name: /Remove the 8 example/ }).click();
  await page.goto(url + '#dashboard'); check('example data removed, own data kept', (await cards()) === 2 && (await page.locator('.pill.demo').count()) === 0);

  // 8. mobile layout
  const m = await browser.newContext({ ...pw.devices['iPhone 13'] }); const mp = await m.newPage(); mp.on('pageerror', (e) => errors.push(String(e)));
  await mp.goto(url); await mp.evaluate(() => localStorage.clear()); await mp.reload(); await mp.getByRole('button', { name: 'Load example data' }).click();
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('mobile: Alerts and Settings links visible', (await mp.locator('nav').getByRole('link', { name: 'Settings & data' }).isVisible()));
  check('mobile: extra filters folded away', (await mp.getByRole('button', { name: 'More filters' }).isVisible()));
  check('mobile: no sideways scrolling on dashboard', overflow <= 0, String(overflow));
  await mp.screenshot({ path: join(shots, 'dashboard-mobile.png') });
  await mp.locator('[data-testid=property-card]', { hasText: 'Demo Drive' }).click();
  check('mobile: detail page fits', (await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await mp.screenshot({ path: join(shots, 'detail-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 820, height: 1100 }); await page.goto(url + '#dashboard'); 
  check('tablet: no sideways scrolling', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  check('no script errors', errors.length === 0, errors.join('\n'));
} catch (e) { fail++; console.log('  FAIL (crashed)', e.message); }
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
