import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = '/tmp/rxtrack-screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1400, height: 900 });

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/01-landing.png`, fullPage: false });

// Dump all visible text to understand the UI
const text = await page.evaluate(() => document.body.innerText);
console.log('=== LANDING TEXT ===\n', text.slice(0, 3000));

// Find all buttons and nav items
const buttons = await page.$$eval('button, a, [role="tab"], [role="button"]', els =>
  els.map(el => el.innerText?.trim()).filter(t => t && t.length < 80)
);
console.log('\n=== BUTTONS/NAV ===\n', [...new Set(buttons)].join('\n'));

// Find all headings
const headings = await page.$$eval('h1,h2,h3,h4', els => els.map(el => el.innerText?.trim()));
console.log('\n=== HEADINGS ===\n', headings.join('\n'));

await browser.close();
