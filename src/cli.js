#!/usr/bin/env node
// Uso:
//   node src/cli.js render  examples/agendo.json out/agendo.mp4 [--fps 30] [--no-audio] [--crf 18]
//   node src/cli.js preview examples/agendo.json out/frames [--times 0.5,2,4]
//   node src/cli.js validate examples/agendo.json
//   node src/cli.js editor           (muestra la ruta del editor visual)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspect, preview, renderVideo, closeBrowser } from './renderer.js';
import { captureSite } from './site-capture.js';

const [cmd, a, b, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf('--' + n); return i < 0 ? d : rest[i + 1]; };
const has = n => rest.includes('--' + n);
const load = async p => JSON.parse(await readFile(resolve(p), 'utf8'));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  if (cmd === 'render') {
    if (!a || !b) throw new Error('Uso: render <spec.json> <salida.mp4>');
    const r = await renderVideo(await load(a), { out: b, fps: +flag('fps', 30), audio: !has('no-audio'), crf: +flag('crf', 18),
      onProgress: (f, t) => process.stderr.write(`\r  ${f}/${t} fotogramas`) });
    process.stderr.write('\n');
    console.log(`✔ ${r.out}  ${r.duration.toFixed(2)} s · ${(r.sizeBytes / 1048576).toFixed(1)} MB · ${r.seconds.toFixed(1)} s de render`);
    r.warnings.forEach(w => console.log('  aviso: ' + w));
  } else if (cmd === 'preview') {
    if (!a || !b) throw new Error('Uso: preview <spec.json> <carpeta>');
    const times = flag('times') ? flag('times').split(',').map(Number) : undefined;
    const { frames } = await preview(await load(a), { times, width: +flag('width', 540) });
    await mkdir(resolve(b), { recursive: true });
    for (const f of frames) await writeFile(join(resolve(b), `frame-${f.t.toFixed(2)}.png`), Buffer.from(f.png, 'base64'));
    console.log(`✔ ${frames.length} fotogramas en ${resolve(b)}`);
  } else if (cmd === 'validate') {
    const info = await inspect(await load(a));
    console.log(`${info.total.toFixed(2)} s · ${info.scenes.length} escenas`);
    info.warnings.forEach(w => console.log('  aviso: ' + w));
  } else if (cmd === 'capture') {
    if (!a || !['desktop', 'mobile'].includes(b)) throw new Error('Uso: capture <URL> <desktop|mobile>');
    const shot = await captureSite(a, b);
    console.log(`Captura guardada: ${shot.path}`);
    console.log(JSON.stringify({ type: 'site', title: shot.title || 'Así se ve', sub: '', view: b, screenshot: shot.screenshot, beats: 5, transition: 'zoom' }, null, 2));
  } else if (cmd === 'editor') {
    console.log('Abre en el navegador: ' + pathToFileURL(join(ROOT, 'editor', 'index.html')).href);
  } else {
    console.log('Comandos: capture | render | preview | validate | editor');
  }
} catch (e) { console.error('✖ ' + e.message); process.exitCode = 1; }
finally { await closeBrowser(); }
