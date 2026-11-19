import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8137;
const BASE = `http://127.0.0.1:${PORT}`;
const MAX_BYTES = 262144;
const SERVER = join(repoRoot, 'serve.ts');

const require = createRequire('/home/hatch/workspace/makefun/scratch-game/package.json');
const puppeteer = require('puppeteer');

const shots = JSON.parse(readFileSync(join(repoRoot, 'shots.json'), 'utf8'));
const outDir = join(repoRoot, 'screenshots');
mkdirSync(outDir, { recursive: true });

const server = spawn('node', [SERVER, '--port', String(PORT)], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/');
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`server did not answer within 15s\n${serverLog}`);
}

let browser;
const failures = [];

try {
  await waitForServer();
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
    console.error(`[pageerror] ${err}`);
  });

  for (const { name, query } of shots) {
    const out = join(outDir, name);
    try {
      await page.goto(BASE + query, { waitUntil: 'load' });
      await page.waitForFunction('window.__shotReady === true', { timeout: 20000 });
      await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
      const bytes = statSync(out).size;
      console.log(`captured ${name}: ${bytes} bytes`);
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
      console.error(`FAILED ${name}: ${err.message}`);
    }
  }

  if (pageErrors.length) failures.push(`${pageErrors.length} page error(s)`);
} catch (err) {
  failures.push(err.message);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

for (const { name } of shots) {
  const file = join(outDir, name);
  try {
    const size = statSync(file).size;
    console.log(`size ${name}: ${size} bytes${size <= MAX_BYTES ? ' OK' : ' OVER LIMIT'}`);
    if (size > MAX_BYTES) failures.push(`${name} exceeds ${MAX_BYTES} bytes (${size})`);
  } catch {
    console.log(`size ${name}: MISSING`);
    failures.push(`${name} missing`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('All shots captured within size limit.');
