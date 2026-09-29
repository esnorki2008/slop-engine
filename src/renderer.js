// Ráfaga · renderizador offline
// Carga engine/render.html en Chrome headless, pide cada fotograma como JPEG/PNG
// y lo envía por tubería a ffmpeg. El audio se sintetiza con OfflineAudioContext.
// Resultado: MP4 H.264 + AAC, yuv420p, faststart (lo que TikTok espera).
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RENDER_PAGE = pathToFileURL(join(ROOT, 'engine', 'render.html')).href;

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.RAFAGA_CHROME || undefined,
      args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync', '--no-sandbox']
    }).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}
export async function closeBrowser() {
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; if (b) await b.close(); }
}

async function openPage(spec) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(RENDER_PAGE, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true');
    const info = await page.evaluate(s => window.__rafaga.load(s), spec);
    if (errors.length) throw new Error('Error en el motor: ' + errors.join(' | '));
    return { page, info };
  } catch (e) {
    await page.close();
    throw e;
  }
}

/** Carga una spec y devuelve la versión normalizada, duración y avisos. */
export async function inspect(spec) {
  const { page, info } = await openPage(spec);
  await page.close();
  return info;
}

/** Devuelve miniaturas PNG (base64) en los instantes pedidos. Por defecto, una por escena en su punto más completo. */
export async function preview(spec, { times, width = 540 } = {}) {
  const { page, info } = await openPage(spec);
  try {
    const ts = (times && times.length) ? times : info.scenes.map(s => +(s.start + s.dur * 0.8).toFixed(3));
    const frames = [];
    for (const t of ts) {
      const url = await page.evaluate((t, w) => window.__rafaga.thumb(t, w), t, width);
      frames.push({ t, png: url.split(',')[1] });
    }
    return { info, frames };
  } finally { await page.close(); }
}

function ffmpegPath() { return process.env.RAFAGA_FFMPEG || 'ffmpeg'; }

/** Renderiza la spec a MP4. onProgress(frame, total) opcional. */
export async function renderVideo(spec, { out, fps = 30, audio = true, crf = 18, format = 'jpeg', onProgress } = {}) {
  if (!out) throw new Error('Falta la ruta de salida (out)');
  out = resolve(out);
  await mkdir(dirname(out), { recursive: true });
  const { page, info } = await openPage(spec);
  const tmp = await mkdtemp(join(tmpdir(), 'rafaga-'));
  const started = Date.now();
  try {
    let wavPath = null;
    if (audio) {
      const b64 = await page.evaluate(() => window.__rafaga.audio());
      wavPath = join(tmp, 'audio.wav');
      await writeFile(wavPath, Buffer.from(b64, 'base64'));
    }
    const total = Math.max(1, Math.round(info.total * fps));
    const codecIn = format === 'png' ? 'png' : 'mjpeg';
    const args = ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', codecIn, '-i', 'pipe:0',
      ...(wavPath ? ['-i', wavPath] : []),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-profile:v', 'high', '-level', '4.2',
      ...(wavPath ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']),
      '-movflags', '+faststart', out];
    const ff = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', d => { ffErr += d; });
    const done = new Promise((res, rej) => {
      ff.on('error', e => rej(new Error(`No se pudo ejecutar ffmpeg (${e.message}). Instálalo o define RAFAGA_FFMPEG.`)));
      ff.on('close', code => code === 0 ? res() : rej(new Error('ffmpeg terminó con código ' + code + ': ' + ffErr.trim())));
    });
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    for (let f = 0; f < total; f++) {
      const url = await page.evaluate((t, m) => window.__rafaga.frame(t, m, 0.95), f / fps, mime);
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (onProgress && (f % fps === 0 || f === total - 1)) onProgress(f + 1, total);
    }
    ff.stdin.end();
    await done;
    const size = (await readFile(out)).length;
    return { out, frames: total, fps, duration: info.total, sizeBytes: size, seconds: (Date.now() - started) / 1000, warnings: info.warnings, missingFonts: info.missingFonts };
  } finally {
    await page.close().catch(() => {});
    await rm(tmp, { recursive: true, force: true });
  }
}
