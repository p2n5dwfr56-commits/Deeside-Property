// Checks the published website opens the collector's encrypted data and shows its recorded changes.
//   node tests/collected-check.mjs <built site folder with collected.enc> <passphrase>
// Used by the "Collect listings" workflow on its test run (fictional [TEST] data).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require('playwright');
const [root, pass, dayArg] = process.argv.slice(2); const day = Number(dayArg || 1); // which collection this is
const scenarioDay = ((day - 1) % 3) + 1; // the test site repeats its three days (collector/testsite.py)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { const b = await readFile(p); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r)); const url = `http://localhost:${server.address().port}/`;
let fail = 0; const check = (name, ok, detail = '') => { console.log(ok ? '  ok  ' : '  FAIL', name, ok ? '' : detail); if (!ok) fail++; };
const browser = await pw.chromium.launch(); const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url);
await page.fill('#passphrase', 'wrong passphrase'); await page.click('button.primary');
await page.getByRole('alert').waitFor({ timeout: 20000 });
check('a wrong passphrase is refused', /not right/.test(await page.getByRole('alert').textContent()));
await page.fill('#passphrase', pass); await page.click('button.primary');
await page.locator('header.top').waitFor({ timeout: 30000 });
const dash = await page.textContent('body');
check('the dashboard opens with the collected listings', /\[TEST\]/.test(dash), dash.slice(0, 300));
await page.goto(url + '#p-T1'); await page.waitForTimeout(800);
const t1 = await page.textContent('body');
if (day === 1) check('day 1: 1 Example Road is a new listing at £350,000', /New listing/.test(t1) && /£350,000/.test(t1), t1.slice(0, 600));
else check('day 2+: 1 Example Road shows its price reduction £350,000 → £335,000 (needs the database from day 1)', /Price reduced/.test(t1) && /£350,000\s*→\s*£335,000/.test(t1), t1.slice(0, 600));
check('its floor area and type are shown', /140/.test(t1) && /Detached/.test(t1));
await page.goto(url + '#p-T4'); await page.waitForTimeout(800);
const t4 = await page.textContent('body');
if (scenarioDay >= 2) { const pill = await page.locator('.pill[class*="st-"]').first().textContent(); const sold = await page.locator('.pill.st-sold').count();
  check('day 2+: the agent’s “Sold” is shown as Under offer, not a confirmed sale', pill === 'Under offer' && sold === 0, `status badge: ${pill}`); }
await page.goto(url + '#p-T7'); await page.waitForTimeout(800);
check('a neighbouring village keeps its own name (Drumoak)', /Drumoak/.test(await page.textContent('body')));
await page.reload(); await page.locator('header.top').waitFor({ timeout: 30000 });
check('the passphrase is remembered on this device after a reload', true);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fail ? `${fail} check(s) FAILED` : 'All website checks passed'); process.exit(fail ? 1 : 0);
