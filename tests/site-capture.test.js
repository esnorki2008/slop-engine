import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, unlink } from 'node:fs/promises';
import { captureSite } from '../src/site-capture.js';
import { preview, closeBrowser } from '../src/renderer.js';

test('captura desktop y móvil y dibuja la web real en la escena site', async t => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Web de prueba</title><style>body{margin:0;background:#18bfc6}main{height:900px;background:linear-gradient(90deg,#18bfc6,#063a80);color:white;font:80px Arial;padding:50px}</style></head><body><main>Sitio real</main></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await closeBrowser(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/`;

  for (const view of ['desktop', 'mobile']) {
    const shot = await captureSite(url, view);
    t.after(() => unlink(shot.path));
    assert.equal(shot.view, view);
    assert.match(shot.screenshot, /\.png$/);
    const capture = await readFile(shot.path);
    assert.equal(capture.readUInt32BE(16), view === 'desktop' ? 1440 : 780);
    assert.equal(capture.readUInt32BE(20), view === 'desktop' ? 900 : 1688);

    const spec = {
      brand: { name: 'Prueba', url, preset: 'menta' }, bpm: 120,
      scenes: [{ type: 'site', title: 'Sitio real', view, screenshot: shot.screenshot, beats: 5, transition: 'cut' }]
    };
    const { info, frames } = await preview(spec, { times: [0.1, 1.2], width: 270 });
    assert.equal(info.spec.scenes[0].view, view);
    assert.equal(info.warnings.some(w => w.includes('falta "screenshot"')), false);
    assert.equal(frames.length, 2);
    assert.notEqual(frames[0].png, frames[1].png);
    const png = Buffer.from(frames[1].png, 'base64');
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 270);
    assert.equal(png.readUInt32BE(20), 480);
  }
});
