// Serve a directory and open a page in headless Chromium, printing the
// page's console until a line starting with stopPrefix appears.
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { createRequire } from 'module';
// playwright from the local project, or from the global install
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = createRequire(process.execPath.replace(/bin\/node$/, 'lib/node_modules/'))('playwright'); }
const { chromium } = playwright;

// usage: node run.mjs <dir> <page> [stopPrefix] [timeoutMs]
const [dir, page_, stopPrefix = 'DONE', timeoutMs = '60000'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream' };
const server = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  let done;
  const finished = new Promise(r => (done = r));
  page.on('console', m => { const t = m.text(); console.log(t); if (t.startsWith(stopPrefix)) done(); });
  page.on('pageerror', e => { console.log('PAGEERROR ' + e.message); });
  await page.goto(`http://127.0.0.1:${port}/${page_}`);
  const timer = setTimeout(() => { console.log('TIMEOUT'); done(); }, +timeoutMs);
  await finished;
  clearTimeout(timer);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await browser.close();
  server.close();
});
