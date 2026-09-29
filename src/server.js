#!/usr/bin/env node
// Ráfaga · servidor MCP (stdio)
// Herramientas:
//   rafaga_schema   -> documentación del formato de spec
//   rafaga_validate -> normaliza la spec, duración por escena y avisos
//   rafaga_preview  -> miniaturas PNG de fotogramas, para que el agente VEA el resultado
//   rafaga_render   -> MP4 1080×1920 listo para TikTok
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect, preview, renderVideo, closeBrowser } from './renderer.js';
import { captureSite } from './site-capture.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = new McpServer({ name: 'rafaga', version: '0.1.0' });

const specInput = {
  spec: z.record(z.any()).optional().describe('Especificación del vídeo como objeto JSON (ver rafaga_schema).'),
  spec_path: z.string().optional().describe('Alternativa a spec: ruta a un archivo .json con la especificación.')
};
async function getSpec({ spec, spec_path }) {
  if (spec) return spec;
  if (spec_path) return JSON.parse(await readFile(resolve(spec_path), 'utf8'));
  throw new Error('Pasa "spec" (objeto) o "spec_path" (ruta a .json).');
}
const text = t => ({ content: [{ type: 'text', text: t }] });
const fail = e => ({ isError: true, content: [{ type: 'text', text: String(e && e.message || e) }] });
const summary = info => [
  `Duración: ${info.total.toFixed(2)} s · ${info.scenes.length} escenas · tiempo = ${info.beat.toFixed(3)} s`,
  ...info.scenes.map((s, i) => `  ${i + 1}. ${s.type.padEnd(8)} ${s.start.toFixed(2)}–${(s.start + s.dur).toFixed(2)} s`),
  info.warnings.length ? 'Avisos:\n' + info.warnings.map(w => '  - ' + w).join('\n') : 'Sin avisos.',
  info.missingFonts && info.missingFonts.length ? 'Fuentes no cargadas (se usará una alternativa): ' + info.missingFonts.join(', ') : ''
].filter(Boolean).join('\n');

server.registerTool('rafaga_schema', {
  title: 'Formato de spec de Ráfaga',
  description: 'Devuelve la documentación del formato JSON de los vídeos (tipos de escena, campos, pantallas, transiciones, paletas, ritmo) y un ejemplo completo. Llámala antes de escribir una spec.',
  inputSchema: {}
}, async () => {
  const doc = await readFile(join(ROOT, 'docs', 'SPEC.md'), 'utf8');
  const example = await readFile(join(ROOT, 'examples', 'agendo.json'), 'utf8');
  return text(doc + '\n\n## Ejemplo completo\n\n```json\n' + example + '\n```');
});

server.registerTool('rafaga_capture_site', {
  title: 'Capturar sitio real para el vídeo',
  description: 'Abre una URL real en Chrome y guarda una captura lista para una escena "site". Antes de llamarla, pregunta al usuario por la URL y si quiere web desktop o web móvil; no elijas por él. Usa la captura devuelta en la spec, no solo sus colores.',
  inputSchema: {
    url: z.string().url().describe('URL completa del sitio, con http:// o https://.'),
    view: z.enum(['desktop', 'mobile']).describe('Versión elegida por el usuario: desktop o mobile.')
  }
}, async ({ url, view }) => {
  try {
    const shot = await captureSite(url, view);
    const scene = { type: 'site', title: shot.title || 'Así se ve', sub: '', view, screenshot: shot.screenshot, beats: 5, transition: 'zoom' };
    return { content: [
      { type: 'text', text: `Captura ${view} de ${shot.url}\nArchivo: ${shot.path}\nUsa esta escena en la spec y ajusta el título según el vídeo:\n${JSON.stringify(scene, null, 2)}` },
      { type: 'image', data: (await readFile(shot.path)).toString('base64'), mimeType: 'image/png' }
    ] };
  } catch (e) { return fail(e); }
});

server.registerTool('rafaga_validate', {
  title: 'Validar spec',
  description: 'Normaliza la spec (rellena valores por defecto), calcula la duración de cada escena y devuelve avisos de legibilidad y estructura. Rápido; úsalo tras cada cambio.',
  inputSchema: specInput
}, async args => {
  try { const info = await inspect(await getSpec(args)); return text(summary(info) + '\n\nSpec normalizada:\n' + JSON.stringify(info.spec, null, 2)); }
  catch (e) { return fail(e); }
});

server.registerTool('rafaga_preview', {
  title: 'Previsualizar fotogramas',
  description: 'Renderiza fotogramas sueltos como imágenes PNG. Sin "times", devuelve uno por escena en su punto más completo (80 % de su duración). Úsalo para revisar composición y textos antes de renderizar el vídeo.',
  inputSchema: {
    ...specInput,
    times: z.array(z.number().min(0)).max(12).optional().describe('Instantes en segundos a capturar.'),
    width: z.number().int().min(180).max(1080).optional().describe('Ancho de la miniatura en px (por defecto 405).')
  }
}, async args => {
  try {
    const { info, frames } = await preview(await getSpec(args), { times: args.times, width: args.width || 405 });
    const content = [{ type: 'text', text: summary(info) }];
    frames.forEach(f => { content.push({ type: 'text', text: `t = ${f.t.toFixed(2)} s` }); content.push({ type: 'image', data: f.png, mimeType: 'image/png' }); });
    return { content };
  } catch (e) { return fail(e); }
});

server.registerTool('rafaga_render', {
  title: 'Renderizar vídeo',
  description: 'Renderiza la spec a MP4 1080×1920 (H.264 + AAC, faststart), fotograma a fotograma: el resultado es exacto aunque la máquina sea lenta. Tarda aproximadamente 1-3× la duración del vídeo a 30 fps.',
  inputSchema: {
    ...specInput,
    output_path: z.string().describe('Ruta del .mp4 de salida.'),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional().describe('Fotogramas por segundo (por defecto 30).'),
    audio: z.boolean().optional().describe('Incluir la pista rítmica sintetizada (por defecto true).'),
    crf: z.number().int().min(12).max(30).optional().describe('Calidad x264: menor = mejor (por defecto 18).')
  }
}, async args => {
  try {
    const r = await renderVideo(await getSpec(args), { out: args.output_path, fps: args.fps || 30, audio: args.audio !== false, crf: args.crf || 18 });
    return text([
      `Vídeo generado: ${r.out}`,
      `${r.duration.toFixed(2)} s · ${r.frames} fotogramas a ${r.fps} fps · ${(r.sizeBytes / 1048576).toFixed(1)} MB · render en ${r.seconds.toFixed(1)} s`,
      r.warnings.length ? 'Avisos:\n' + r.warnings.map(w => '  - ' + w).join('\n') : ''
    ].filter(Boolean).join('\n'));
  } catch (e) { return fail(e); }
});

const shutdown = async () => { await closeBrowser(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
await server.connect(new StdioServerTransport());
