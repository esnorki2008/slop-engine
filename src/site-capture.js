import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
};

export async function captureSite(url, view) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('La URL debe empezar por http:// o https://.');
  if (!VIEWPORTS[view]) throw new Error('Elige view: "desktop" o "mobile".');

  const viewport = VIEWPORTS[view];
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.RAFAGA_CHROME || undefined,
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (response && response.status() >= 400) throw new Error(`El sitio respondió HTTP ${response.status()}.`);
    // Algunas rutas de registro cargan vacías y redirigen al proveedor de identidad.
    await page.waitForFunction(() => document.body?.innerText.trim().length > 40, { timeout: 10000 }).catch(() => {});
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 }).catch(() => {});
    await page.evaluate(async () => {
      await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]);
      await Promise.race([
        Promise.all(Array.from(document.images).map(img => img.complete ? null : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }))),
        new Promise(r => setTimeout(r, 2500))
      ]);
    });
    const title = await page.title();
    const slug = target.hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(0, 60) || 'sitio';
    const name = `${slug}-${view}-${randomUUID().slice(0, 8)}.png`;
    const relative = `../assets/sites/${name}`;
    const path = join(ROOT, 'assets', 'sites', name);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, type: 'png', animations: 'disabled', caret: 'hide' });
    return { url: page.url(), title, view, screenshot: relative, path, width: viewport.width, height: viewport.height };
  } finally {
    await browser.close();
  }
}
