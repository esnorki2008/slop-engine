/*
 * Ráfaga · núcleo del motor de render
 * ------------------------------------
 * Un solo archivo, sin dependencias. Lo cargan:
 *   - editor/index.html  (edición y previsualización en tiempo real)
 *   - engine/render.html (render fotograma a fotograma desde Node/Puppeteer)
 *
 * Principio clave: cada fotograma es una función pura de (spec, t).
 * Nada depende del reloj real, así que el render offline es exacto.
 *
 * API pública (window.Rafaga):
 *   normalize(spec, {strict})   -> spec limpio con valores por defecto
 *   lint(spec)                  -> [avisos] sobre textos largos, zonas, duración
 *   timeline(spec)              -> {b, T:[{start,dur}], total}
 *   createEngine(canvas)        -> {load(spec), renderFrame(t), locate(t), spec, timeline}
 *   scheduleAudio(ctx, dest, spec, tl, t0, from, noiseBuf) -> GainNode maestro
 *   renderAudioWav(spec)        -> Promise<base64 WAV> (OfflineAudioContext)
 *   catálogos: FONTS, PRESETS, TYPES, MOCKS, TRANS, NEW, EXAMPLE, W, H
 */
(function (global) {
  'use strict';
  const W = 1080, H = 1920;

  /* ============ Utilidades ============ */
  const E = {
    outExpo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
    outBack: t => { const a = 1.70158, b = a + 1; return 1 + b * Math.pow(t - 1, 3) + a * Math.pow(t - 1, 2); },
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    spring: t => t <= 0 ? 0 : 1 - Math.exp(-7 * t) * Math.cos(11 * t)
  };
  const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const P = (t, s, d) => cl((t - s) / d);
  const lerp = (a, b, t) => a + (b - a) * t;
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hexRgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function withA(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
  function shade(h, k) { const [r, g, b] = hexRgb(h); const f = v => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k); return `rgb(${f(r)},${f(g)},${f(b)})`; }
  function inkOn(h) { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return (.2126 * r + .7152 * g + .0722 * b) > .42 ? '#14161B' : '#FFFFFF'; }
  function rr(c, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  /* ============ Catálogos ============ */
  const FONTS = {
    anton: { fam: 'Anton', w: 400, upper: true, label: 'Anton · condensada en mayúsculas' },
    archivo: { fam: 'Archivo Black', w: 400, upper: false, label: 'Archivo Black · compacta' },
    bricolage: { fam: 'Bricolage Grotesque', w: 800, upper: false, label: 'Bricolage · expresiva' },
    unbounded: { fam: 'Unbounded', w: 800, upper: false, label: 'Unbounded · ancha' }
  };
  const PRESETS = {
    electrico: { label: 'Eléctrico', bg: '#2B2BFF', fg: '#FFFFFF', accent: '#FFE14D', accent2: '#FF5EA8', app: '#2B2BFF' },
    chicle: { label: 'Chicle', bg: '#FFD3E6', fg: '#1A0F2E', accent: '#FF2E88', accent2: '#7A5CFF', app: '#FF2E88' },
    mandarina: { label: 'Mandarina', bg: '#FF6A2B', fg: '#1A1208', accent: '#FFF1DC', accent2: '#2B1BFF', app: '#FF5A1F' },
    menta: { label: 'Menta', bg: '#DDFBEA', fg: '#0A2A20', accent: '#00B37A', accent2: '#FFB800', app: '#00A370' },
    tinta: { label: 'Tinta', bg: '#15161C', fg: '#F4F4F6', accent: '#B8A6FF', accent2: '#FF7A59', app: '#6B4EFF' }
  };
  const COLOR_KEYS = ['bg', 'fg', 'accent', 'accent2', 'app'];
  const TYPES = { hook: 'Gancho', feature: 'Funcionalidad', stat: 'Cifra', list: 'Lista', compare: 'Antes y ahora', cta: 'Llamada a la acción' };
  const MOCKS = { slots: 'Calendario de reservas', notify: 'Notificaciones', chart: 'Gráfica de resultados', typing: 'Formulario que se rellena' };
  const TRANS = { cut: 'Corte seco', whip: 'Barrido', push: 'Empuje', zoom: 'Zoom', flash: 'Destello', glitch: 'Glitch' };
  const NEW = {
    hook: { text: '¿Pierdes clientes cada semana?', beats: 3, transition: 'flash' },
    feature: { title: 'Nueva función', sub: 'Qué resuelve, en una frase', mockup: 'slots', ui: 'Hecho', beats: 4, transition: 'whip' },
    stat: { prefix: '+', value: 3, suffix: 'x', label: 'más reservas', beats: 3, transition: 'zoom' },
    list: { title: 'Incluye', items: ['Primera ventaja', 'Segunda ventaja', 'Tercera ventaja'], beats: 4, transition: 'push' },
    compare: { before: 'Horas con hojas de cálculo', after: 'Todo en un clic', beats: 4, transition: 'glitch' },
    cta: { title: 'Empieza hoy', button: 'Probar gratis', beats: 4, transition: 'zoom' }
  };
  const EXAMPLE = {
    brand: { name: 'Agendo', url: 'agendo.app', font: 'anton', preset: 'electrico', bg: '#2B2BFF', fg: '#FFFFFF', accent: '#FFE14D', accent2: '#FF5EA8', app: '#2B2BFF' },
    bpm: 128,
    scenes: [
      { type: 'hook', beats: 3, transition: 'cut', text: '¿Tu agenda sigue en papel?' },
      { type: 'feature', beats: 5, transition: 'whip', title: 'Reservas 24/7', sub: 'Tus clientes eligen hora sin llamarte', mockup: 'slots', ui: 'Reservado: jueves 11:30' },
      { type: 'feature', beats: 5, transition: 'zoom', title: 'Recordatorios solos', sub: 'Un aviso el día antes, sin mover un dedo', mockup: 'notify', ui: 'Mañana a las 11:30 tienes cita con Laura en Estudio Norte|Laura ha confirmado su cita' },
      { type: 'stat', beats: 3, transition: 'flash', prefix: '-', value: 68, suffix: '%', label: 'citas perdidas' },
      { type: 'list', beats: 4, transition: 'glitch', title: 'Y además', items: ['Pagos por adelantado', 'Ficha de cada cliente', 'Sin comisiones'] },
      { type: 'cta', beats: 5, transition: 'zoom', title: 'Pruébalo gratis 14 días', button: 'Crear mi agenda' }
    ]
  };
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ============ Spec: normalización, línea de tiempo y avisos ============ */
  function normalize(o, { strict = false } = {}) {
    if (!o || typeof o !== 'object') throw new Error('se esperaba un objeto');
    const brand = { ...EXAMPLE.brand, ...(o.brand && o.brand.preset && PRESETS[o.brand.preset] ? PRESETS[o.brand.preset] : {}), ...(o.brand || {}) };
    delete brand.label;
    if (!FONTS[brand.font]) brand.font = 'anton';
    COLOR_KEYS.forEach(k => { if (!/^#[0-9a-f]{6}$/i.test(brand[k] || '')) brand[k] = EXAMPLE.brand[k]; });
    const scenes = (Array.isArray(o.scenes) ? o.scenes : []).filter(s => s && TYPES[s.type]).map(s => {
      const n = { ...NEW[s.type], ...s };
      n.beats = cl(parseInt(n.beats) || 3, 1, 12);
      if (!TRANS[n.transition]) n.transition = 'cut';
      if (n.type === 'feature' && !MOCKS[n.mockup]) n.mockup = 'slots';
      if (n.type === 'list' && !Array.isArray(n.items)) n.items = String(n.items || '').split('\n');
      return n;
    });
    if (strict && !scenes.length) throw new Error('no hay escenas válidas');
    return { brand, bpm: cl(parseInt(o.bpm) || 128, 60, 200), scenes };
  }
  function timeline(spec) {
    const b = 60 / spec.bpm; let acc = 0;
    const T = spec.scenes.map(s => { const d = Math.max(1, +s.beats || 1) * b; const o = { start: acc, dur: d }; acc += d; return o; });
    return { b, T, total: acc };
  }
  function lint(spec) {
    const w = [], words = s => String(s || '').trim().split(/\s+/).filter(Boolean).length, tl = timeline(spec);
    const LIM = { hook: { text: 7 }, feature: { title: 4, sub: 10 }, stat: { label: 4 }, list: { title: 3 }, compare: { before: 7, after: 7 }, cta: { title: 7, button: 3 } };
    spec.scenes.forEach((s, i) => {
      Object.entries(LIM[s.type] || {}).forEach(([k, max]) => { const n = words(s[k]); if (n > max) w.push(`Escena ${i + 1} (${s.type}): "${k}" tiene ${n} palabras; recomendado ≤ ${max}.`); });
      if (s.type === 'list') { const it = s.items.filter(Boolean); if (it.length > 4) w.push(`Escena ${i + 1}: más de 4 puntos se leen mal en ${tl.T[i].dur.toFixed(1)} s.`); }
      if (tl.T[i].dur < 1) w.push(`Escena ${i + 1}: dura ${tl.T[i].dur.toFixed(2)} s, demasiado rápido para leer.`);
      if (s.type === 'stat' && !isFinite(parseFloat(String(s.value).replace(',', '.')))) w.push(`Escena ${i + 1}: "value" no es un número.`);
    });
    if (spec.scenes[0] && spec.scenes[0].type !== 'hook') w.push('El vídeo no empieza con un gancho: en TikTok los primeros 1-2 s deciden si se ve.');
    if (spec.scenes.length && spec.scenes[spec.scenes.length - 1].type !== 'cta') w.push('El vídeo no termina con una llamada a la acción.');
    if (tl.total > 20) w.push(`Duración ${tl.total.toFixed(1)} s: para este formato conviene 8-15 s.`);
    return w;
  }

  /* ============ Dibujo: helpers ============ */
  const disp = (B, z) => `${B.w} ${z}px "${B.fam}", "Arial Black", Impact, sans-serif`;
  const body = (z, w = 700) => `${w} ${z}px "Bricolage Grotesque", system-ui, sans-serif`;
  const up = (B, s) => B.upper ? String(s ?? '').toUpperCase() : String(s ?? '');
  function fit(c, txt, fn, max, maxW) { c.font = fn(max); const w = c.measureText(txt).width; return w > maxW ? Math.floor(max * maxW / w) : max; }
  function wrap(c, txt, maxW) { const ws = String(txt ?? '').split(/\s+/).filter(Boolean), out = []; let cur = ''; for (const w of ws) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
  function check(c, x, y, s, prog, color, lw) { if (prog <= 0) return; const p = [[-.5, 0], [-.15, .35], [.55, -.4]], L1 = Math.hypot(.35, .35), L2 = Math.hypot(.7, .75); const d = prog * (L1 + L2); c.save(); c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(x + p[0][0] * s, y + p[0][1] * s); if (d <= L1) { const f = d / L1; c.lineTo(x + lerp(p[0][0], p[1][0], f) * s, y + lerp(p[0][1], p[1][1], f) * s); } else { c.lineTo(x + p[1][0] * s, y + p[1][1] * s); const f = (d - L1) / L2; c.lineTo(x + lerp(p[1][0], p[2][0], f) * s, y + lerp(p[1][1], p[2][1], f) * s); } c.stroke(); c.restore(); }
  function touch(c, x, y, pressed, a) { if (a <= 0) return; c.save(); c.globalAlpha = a; const s = pressed ? .8 : 1; c.translate(x, y); c.scale(s, s); c.fillStyle = 'rgba(255,255,255,.96)'; c.strokeStyle = 'rgba(20,22,28,.85)'; c.lineWidth = 6; c.beginPath(); c.arc(0, 0, 38, 0, 7); c.fill(); c.stroke(); c.restore(); }
  function ripple(c, x, y, k, color) { if (k <= 0 || k >= 1) return; c.save(); c.globalAlpha = (1 - k) * .45; c.fillStyle = color; c.beginPath(); c.arc(x, y, 40 + E.outCubic(k) * 240, 0, 7); c.fill(); c.restore(); }
  function brandCtx(b) { const f = FONTS[b.font] || FONTS.anton; return { ...b, fam: f.fam, w: f.w, upper: f.upper, ink: inkOn(b.accent), appInk: inkOn(b.app) }; }

  const mkCanvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  let grainTile = null;
  function getGrainTile() {
    if (!grainTile) { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const d = g.createImageData(256, 256); const r = rng(7); for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 28; } g.putImageData(d, 0, 0); grainTile = c; }
    return grainTile;
  }
  const dotTiles = {};
  function dotPattern(c, color) { if (!dotTiles[color]) { const t = document.createElement('canvas'); t.width = t.height = 64; const g = t.getContext('2d'); g.fillStyle = color; g.beginPath(); g.arc(32, 32, 4, 0, 7); g.fill(); dotTiles[color] = t; } return c.createPattern(dotTiles[color], 'repeat'); }

  function background(c, B, t, i) {
    c.fillStyle = B.bg; c.fillRect(0, 0, W, H);
    const r = rng(i * 97 + 13);
    c.save(); c.globalAlpha = .1; c.fillStyle = dotPattern(c, B.fg); c.translate((t * 40) % 64, (t * 25) % 64); c.fillRect(-64, -64, W + 128, H + 128); c.restore();
    c.save(); c.globalAlpha = .22; c.fillStyle = B.accent2;
    const x = W * (.1 + r() * .8), y = H * (r() > .5 ? .14 : .86), s = 560 + r() * 300;
    c.translate(x, y); c.rotate(t * .35 * (r() > .5 ? 1 : -1)); rr(c, -s / 2, -s / 2, s, s, s * .3); c.fill(); c.restore();
  }
  function grain(c, t) { const pat = c.createPattern(getGrainTile(), 'repeat'); const r = rng(Math.floor(t * 30) + 1); c.save(); c.globalCompositeOperation = 'overlay'; c.fillStyle = pat; c.translate(-r() * 256, -r() * 256); c.fillRect(0, 0, W + 256, H + 256); c.restore(); }

  function phone(c, x, y, w, h, content) {
    c.save(); c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 80; c.shadowOffsetY = 40; c.fillStyle = '#0D0E12'; rr(c, x, y, w, h, 86); c.fill(); c.restore();
    const i = 16, sx = x + i, sy = y + i, sw = w - 2 * i, sh = h - 2 * i;
    c.save(); rr(c, sx, sy, sw, sh, 70); c.clip(); c.fillStyle = '#F5F6FA'; c.fillRect(sx, sy, sw, sh);
    content(sx, sy, sw, sh);
    c.fillStyle = '#0D0E12'; rr(c, x + w / 2 - 78, sy + 20, 156, 44, 22); c.fill();
    c.restore();
  }
  function appHeader(c, sx, sy, sw, B, title) {
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillStyle = '#8A909C'; c.font = body(28, 600); c.fillText(B.name || '', sx + 44, sy + 128);
    c.fillStyle = '#15171C'; c.font = body(50, 800); c.fillText(title, sx + 44, sy + 186);
    c.fillStyle = B.app; c.beginPath(); c.arc(sx + sw - 80, sy + 150, 34, 0, 7); c.fill();
    c.fillStyle = B.appInk; c.font = body(30, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText((B.name || '?')[0].toUpperCase(), sx + sw - 80, sy + 152);
  }

  /* ============ Pantallas dentro del móvil (escena feature) ============ */
  // Para añadir una pantalla nueva: MOCK.nombre = (c,sx,sy,sw,sh,s,lt,d,B) => {...}
  // (sx,sy,sw,sh) = rectángulo de la pantalla; lt = tiempo local; d = duración de la escena.
  const MOCK = {
    slots(c, sx, sy, sw, sh, s, lt, d, B) {
      appHeader(c, sx, sy, sw, B, 'Elige hora');
      const cols = 3, gap = 18, pad = 40, cw = (sw - pad * 2 - gap * (cols - 1)) / cols, ch = 100, gy = sy + 240;
      const times = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '16:00', '16:30', '17:00', '17:30'];
      const busy = [1, 3, 9], target = 5, tMove = d * .2, tClick = d * .46;
      times.forEach((tm, i) => {
        const col = i % cols, row = Math.floor(i / cols), x = sx + pad + col * (cw + gap), y = gy + row * (ch + gap);
        const k = E.outBack(P(lt, .28 + i * .025, .3)); if (k <= 0) return;
        const sel = i === target && lt > tClick, b = busy.includes(i);
        c.save(); c.translate(x + cw / 2, y + ch / 2); c.scale(k, k);
        c.fillStyle = sel ? B.app : b ? '#E7E9EE' : '#FFFFFF'; rr(c, -cw / 2, -ch / 2, cw, ch, 26); c.fill();
        if (!sel) { c.strokeStyle = '#D9DCE4'; c.lineWidth = 3; c.stroke(); }
        c.fillStyle = sel ? B.appInk : b ? '#A6ABB6' : '#15171C'; c.font = body(38, 700); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(tm, 0, 2);
        if (b) { c.strokeStyle = '#A6ABB6'; c.lineWidth = 4; c.beginPath(); c.moveTo(-50, 2); c.lineTo(50, 2); c.stroke(); }
        c.restore();
      });
      const col = target % cols, row = Math.floor(target / cols), tx = sx + pad + col * (cw + gap) + cw / 2, ty = gy + row * (ch + gap) + ch / 2;
      ripple(c, tx, ty, P(lt, tClick, .5), B.app);
      const kt = E.spring(P(lt, tClick + .12, .55));
      if (kt > 0) {
        const tw = sw - 80, th = 126, x = sx + 40, y = sy + sh - 210 + (1 - kt) * 320;
        c.save(); c.fillStyle = '#15171C'; rr(c, x, y, tw, th, 34); c.fill();
        c.fillStyle = B.app; c.beginPath(); c.arc(x + 68, y + th / 2, 34, 0, 7); c.fill(); check(c, x + 68, y + th / 2, 34, P(lt, tClick + .25, .25), B.appInk, 8);
        c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'middle'; const z = fit(c, s.ui || '', q => body(q, 700), 36, tw - 140); c.font = body(z, 700); c.fillText(s.ui || '', x + 120, y + th / 2 + 2); c.restore();
      }
      const m = E.inOut(P(lt, tMove, tClick - tMove));
      touch(c, lerp(sx + sw * .85, tx, m), lerp(sy + sh * .92, ty, m), lt > tClick && lt < tClick + .14, cl((lt - tMove + .1) * 6) * cl((tClick + .6 - lt) * 5));
    },
    notify(c, sx, sy, sw, sh, s, lt, d, B) {
      const g = c.createLinearGradient(0, sy, 0, sy + sh); g.addColorStop(0, shade(B.app, .15)); g.addColorStop(1, shade(B.app, -.55)); c.fillStyle = g; c.fillRect(sx, sy, sw, sh);
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.font = body(170, 600); c.fillText('9:41', sx + sw / 2, sy + 330);
      c.globalAlpha = .8; c.font = body(34, 500); c.fillText('jueves, 14 de mayo', sx + sw / 2, sy + 388); c.globalAlpha = 1;
      const msgs = String(s.ui || '').split('|').map(x => x.trim()).filter(Boolean).slice(0, 3);
      let y = sy + 460; const cw = sw - 56, x = sx + 28;
      msgs.forEach((m, i) => {
        c.font = body(32, 500); const lines = wrap(c, m, cw - 160).slice(0, 3), chh = 112 + lines.length * 40;
        const k = E.spring(P(lt, d * (.16 + i * .24), .6));
        if (k > 0) {
          c.save(); c.globalAlpha = cl(k * 2); const yy = y - (1 - k) * 240;
          c.fillStyle = 'rgba(255,255,255,.93)'; rr(c, x, yy, cw, chh, 40); c.fill();
          c.fillStyle = B.app; rr(c, x + 28, yy + 30, 76, 76, 20); c.fill();
          c.fillStyle = B.appInk; c.font = body(40, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText((B.name || '?')[0].toUpperCase(), x + 66, yy + 70);
          c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = '#15171C'; c.font = body(32, 800); c.fillText(B.name || '', x + 128, yy + 64);
          c.fillStyle = '#8A909C'; c.font = body(26, 500); c.textAlign = 'right'; c.fillText('ahora', x + cw - 30, yy + 62);
          c.textAlign = 'left'; c.fillStyle = '#2A2D35'; c.font = body(32, 500); lines.forEach((l, j) => c.fillText(l, x + 128, yy + 110 + j * 40));
          c.restore();
        }
        y += chh + 20;
      });
    },
    chart(c, sx, sy, sw, sh, s, lt, d, B) {
      appHeader(c, sx, sy, sw, B, 'Esta semana');
      const parts = String(s.ui || '+42%|reservas').split('|');
      const k0 = E.outExpo(P(lt, .3, .4));
      c.save(); c.globalAlpha = k0; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = '#15171C'; c.font = body(120, 800); c.fillText(parts[0] || '', sx + 44, sy + 340 + (1 - k0) * 40);
      c.fillStyle = '#8A909C'; c.font = body(34, 600); c.fillText(parts[1] || '', sx + 48, sy + 392); c.restore();
      const hs = [.34, .5, .42, .64, .56, .8, 1], n = 7, gap = 22, ax = sx + 44, aw = sw - 88, bw = (aw - gap * (n - 1)) / n, base = sy + sh - 170, mh = 440;
      hs.forEach((h, i) => {
        const k = E.outBack(P(lt, .35 + i * .07, .42)); const bh = Math.max(0, mh * h * k), x = ax + i * (bw + gap);
        c.fillStyle = i === n - 1 ? B.app : '#DCE0E8'; if (bh > 0) { rr(c, x, base - bh, bw, bh, 18); c.fill(); }
        c.fillStyle = '#8A909C'; c.font = body(28, 700); c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText('LMXJVSD'[i], x + bw / 2, base + 50);
      });
      const kt = E.spring(P(lt, .35 + 6 * .07 + .3, .5));
      if (kt > 0) { const x = ax + 6 * (bw + gap) + bw / 2, y = base - mh - 40; c.save(); c.translate(x, y); c.scale(kt, kt); c.font = body(34, 800); const tw = c.measureText(parts[0] || '').width + 44; c.fillStyle = '#15171C'; rr(c, -tw + bw / 2, -36, tw, 72, 36); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(parts[0] || '', -tw / 2 + bw / 2, 2); c.restore(); }
    },
    typing(c, sx, sy, sw, sh, s, lt, d, B) {
      const parts = String(s.ui || 'Hola, quiero reservar|Enviar|¡Listo!').split('|');
      appHeader(c, sx, sy, sw, B, parts[3] || 'Nuevo mensaje');
      const fx = sx + 40, fy = sy + 240, fw = sw - 80, fh = 290;
      c.fillStyle = '#fff'; rr(c, fx, fy, fw, fh, 32); c.fill(); c.strokeStyle = lt < d * .6 ? B.app : '#D9DCE4'; c.lineWidth = 4; c.stroke();
      const txt = parts[0] || '', n = Math.floor(txt.length * P(lt, d * .12, d * .36)), shown = txt.slice(0, n);
      c.font = body(40, 600); c.fillStyle = '#15171C'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      const lines = wrap(c, shown, fw - 70).slice(0, 4); lines.forEach((l, j) => c.fillText(l, fx + 34, fy + 76 + j * 54));
      if (lt < d * .6 && Math.floor(lt * 4) % 2 === 0) { const last = lines[lines.length - 1] || '', cx = fx + 34 + c.measureText(last).width + 4, cy = fy + 76 + Math.max(0, lines.length - 1) * 54; c.fillStyle = B.app; c.fillRect(cx, cy - 38, 4, 46); }
      const bx = fx, by = fy + fh + 36, bh = 118, tPress = d * .6, pr = lt > tPress && lt < tPress + .14;
      c.save(); c.translate(bx + fw / 2, by + bh / 2); c.scale(pr ? .95 : 1, pr ? .95 : 1); c.fillStyle = B.app; rr(c, -fw / 2, -bh / 2, fw, bh, 59); c.fill(); c.fillStyle = B.appInk; c.font = body(42, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(parts[1] || 'Enviar', 0, 2); c.restore();
      ripple(c, bx + fw / 2, by + bh / 2, P(lt, tPress, .5), B.app);
      const m = E.inOut(P(lt, d * .44, tPress - d * .44));
      touch(c, lerp(sx + sw * .8, bx + fw / 2, m), lerp(sy + sh * .95, by + bh / 2, m), pr, cl((lt - d * .42) * 6) * cl((tPress + .5 - lt) * 5));
      const ks = E.spring(P(lt, tPress + .1, .55));
      if (ks > 0) {
        const cy = by + bh + 190; c.save(); c.translate(sx + sw / 2, cy); c.scale(ks, ks); c.fillStyle = B.app; c.beginPath(); c.arc(0, 0, 70, 0, 7); c.fill(); c.restore(); check(c, sx + sw / 2, cy, 62, P(lt, tPress + .25, .3), B.appInk, 12);
        c.save(); c.globalAlpha = cl(ks); c.fillStyle = '#15171C'; c.font = body(44, 800); c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(parts[2] || '', sx + sw / 2, cy + 130); c.restore();
      }
    }
  };

  /* ============ Escenas ============ */
  // Para añadir un tipo: SCENES.nombre = (c,s,lt,d,B) => {...}, y regístralo en TYPES y NEW.
  const SCENES = {
    hook(c, s, lt, d, B) {
      const words = up(B, s.text).split(/\s+/).filter(Boolean); if (!words.length) return;
      const n = words.length, step = Math.min(.26, (d * .6) / n), lh = B.upper ? .98 : 1.1;
      let sizes = words.map(w => fit(c, w, z => disp(B, z), n <= 2 ? 380 : 310, 900));
      let tot = sizes.reduce((a, z) => a + z * lh, 0); const maxH = 1150;
      if (tot > maxH) { const f = maxH / tot; sizes = sizes.map(z => z * f); tot = maxH; }
      let sx = 0, sy = 0; words.forEach((w, i) => { const dt = lt - i * step; if (dt > 0) { const a = 28 * Math.exp(-dt * 16); sx += Math.sin(dt * 95 + i) * a; sy += Math.cos(dt * 80 + i * 2) * a; } });
      c.save(); c.translate(sx, sy); c.textAlign = 'center'; c.textBaseline = 'middle';
      let y = H * .45 - tot / 2;
      words.forEach((w, i) => {
        const z = sizes[i], cy = y + z * lh / 2; y += z * lh;
        const ti = i * step, k = P(lt, ti, .22); if (k <= 0) return;
        const e = E.outExpo(k), sc = 1 + 1.6 * (1 - e), last = i === n - 1 && n > 1;
        c.save(); c.translate(W / 2, cy); if (last) c.rotate(-.04); c.scale(sc, sc); c.globalAlpha = cl(k * 4); c.font = disp(B, z);
        if (last) { const tw = c.measureText(w).width + 70, g = E.outCubic(P(lt, ti + .08, .25)); c.fillStyle = B.accent; rr(c, -tw / 2, -z * .54, tw * g, z * 1.08, 20); c.fill(); c.fillStyle = B.ink; } else c.fillStyle = B.fg;
        c.fillText(w, 0, z * .04); c.restore();
      });
      c.restore();
    },
    feature(c, s, lt, d, B) {
      const title = up(B, s.title), tz = fit(c, title, z => disp(B, z), 150, 940), k1 = E.outExpo(P(lt, 0, .35));
      c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      c.save(); c.globalAlpha = cl(k1 * 2); c.fillStyle = B.fg; c.font = disp(B, tz); c.fillText(title, W / 2, 240 + tz * .8 + (1 - k1) * 120); c.restore();
      c.font = body(50, 600); const lines = wrap(c, s.sub, 880).slice(0, 2), k2 = E.outExpo(P(lt, .12, .35));
      c.save(); c.globalAlpha = cl(k2 * 1.5) * .88; c.fillStyle = B.fg; lines.forEach((l, j) => c.fillText(l, W / 2, 240 + tz + 70 + j * 62 + (1 - k2) * 60)); c.restore();
      const pw = 600, ph = 1000, px = (W - pw) / 2, py = 580 + (lines.length > 1 ? 30 : 0), e = E.outBack(P(lt, .05, .55));
      c.save(); c.translate(W / 2, py + ph / 2 + (1 - e) * 1000); c.rotate((1 - e) * .18); c.translate(-W / 2, -(py + ph / 2));
      phone(c, px, py, pw, ph, (sx, sy, sw, sh) => (MOCK[s.mockup] || MOCK.slots)(c, sx, sy, sw, sh, s, lt - .25, d, B));
      c.restore();
    },
    stat(c, s, lt, d, B) {
      const raw = String(s.value ?? 0), v = parseFloat(raw.replace(',', '.')) || 0, dec = (raw.split(/[.,]/)[1] || '').length;
      const cd = Math.max(.4, d * .55), k = E.outExpo(P(lt, .05, cd));
      const f = x => x.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const txt = (s.prefix || '') + f(v * k) + (s.suffix || ''), full = (s.prefix || '') + f(v) + (s.suffix || ''), cx = W / 2, cy = H * .42;
      c.save(); c.translate(cx, cy); c.rotate(lt * .5); c.fillStyle = B.accent2; c.globalAlpha = .22;
      for (let i = 0; i < 12; i++) { c.rotate(Math.PI / 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(1500, -120); c.lineTo(1500, 120); c.closePath(); c.fill(); } c.restore();
      c.save(); c.lineWidth = 34; c.strokeStyle = B.fg; c.globalAlpha = .16; c.beginPath(); c.arc(cx, cy, 410, 0, 7); c.stroke();
      c.globalAlpha = 1; c.strokeStyle = B.accent; c.lineCap = 'round'; c.beginPath(); c.arc(cx, cy, 410, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k * .999); c.stroke(); c.restore();
      const z = fit(c, full, q => disp(B, q), 360, 690), done = lt - .05 - cd, pop = done > 0 ? 1 + .12 * (1 - E.outCubic(cl(done / .3))) : 1;
      c.save(); c.translate(cx, cy); c.scale(pop, pop); c.font = disp(B, z); c.fillStyle = B.fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, 0, z * .05); c.restore();
      const lab = up(B, s.label);
      if (lab) {
        const lz = fit(c, lab, q => disp(B, q), 120, 860), kl = E.outBack(P(lt, .2, .4));
        c.save(); c.translate(cx, cy + 560); c.rotate(-.03); c.scale(kl, kl); c.font = disp(B, lz); const tw = c.measureText(lab).width + 80;
        c.fillStyle = B.accent; rr(c, -tw / 2, -lz * .6, tw, lz * 1.2, 20); c.fill(); c.fillStyle = B.ink; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(lab, 0, lz * .04); c.restore();
      }
    },
    list(c, s, lt, d, B) {
      const items = (Array.isArray(s.items) ? s.items : String(s.items || '').split('\n')).map(x => String(x).trim()).filter(Boolean).slice(0, 5);
      const title = up(B, s.title); let y0 = 300;
      if (title) { const z = fit(c, title, q => disp(B, q), 160, 920), k = E.outExpo(P(lt, 0, .3)); c.save(); c.globalAlpha = cl(k * 2); c.fillStyle = B.fg; c.font = disp(B, z); c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(title, W / 2, y0 + z * .8 - (1 - k) * 80); c.restore(); y0 += z + 90; }
      const n = items.length, ih = 170, gap = 38, step = Math.min(.3, (d * .55) / Math.max(1, n));
      items.forEach((it, i) => {
        const t0 = .16 + i * step, k = P(lt, t0, .35); if (k <= 0) return; const e = E.outBack(k), y = y0 + i * (ih + gap), x = 90 + (1 - e) * 520;
        c.save(); c.globalAlpha = cl(k * 3);
        c.fillStyle = withA(B.fg, .12); rr(c, x, y, 900, ih, ih / 2); c.fill();
        c.fillStyle = B.accent; c.beginPath(); c.arc(x + ih / 2, y + ih / 2, 58, 0, 7); c.fill();
        check(c, x + ih / 2, y + ih / 2, 56, E.outCubic(P(lt, t0 + .1, .25)), B.ink, 12);
        const fz = fit(c, it, q => body(q, 800), 58, 900 - ih - 50); c.font = body(fz, 800); c.fillStyle = B.fg; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(it, x + ih + 8, y + ih / 2 + 2);
        c.restore();
      });
    },
    compare(c, s, lt, d, B) {
      const mid = H * .5; c.fillStyle = 'rgba(0,0,0,.26)'; c.fillRect(0, 0, W, mid);
      const pill = (txt, y, bg, fg, a) => { c.save(); c.globalAlpha = a; c.font = body(40, 800); const tw = c.measureText(txt).width + 56; c.fillStyle = bg; rr(c, W / 2 - tw / 2, y - 34, tw, 68, 34); c.fill(); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, W / 2, y + 2); c.restore(); };
      const bt = up(B, s.before); c.font = disp(B, 110); const bl = wrap(c, bt, 900).slice(0, 3); const k0 = E.outExpo(P(lt, 0, .3));
      pill(s.beforeLabel || 'Antes', mid * .3, withA(B.fg, .2), B.fg, k0);
      c.save(); c.globalAlpha = k0 * .7; c.fillStyle = B.fg; c.font = disp(B, 110); c.textAlign = 'center'; c.textBaseline = 'middle';
      bl.forEach((l, j) => { const y = mid * .3 + 130 + j * 118; c.fillText(l, W / 2, y); const sw = E.inOut(P(lt, .3 + j * .08, .3)), lw = c.measureText(l).width; if (sw > 0) { c.save(); c.globalAlpha = 1; c.strokeStyle = B.accent2; c.lineWidth = 16; c.lineCap = 'round'; c.beginPath(); c.moveTo(W / 2 - lw / 2 - 10, y); c.lineTo(W / 2 - lw / 2 - 10 + (lw + 20) * sw, y); c.stroke(); c.restore(); } });
      c.restore();
      const wp = E.inOut(P(lt, d * .34, .35));
      if (wp > 0) {
        c.save(); c.beginPath(); c.rect(0, mid, W * wp, H - mid); c.clip(); c.fillStyle = B.accent; c.fillRect(0, mid, W, H - mid);
        pill(s.afterLabel || 'Ahora', mid + 110, withA(B.ink, .14), B.ink, 1);
        const at = up(B, s.after); c.font = disp(B, 130); const al = wrap(c, at, 900).slice(0, 3), ka = E.outBack(P(lt, d * .4, .35));
        c.translate(W / 2, mid + 330); c.scale(.7 + .3 * ka, .7 + .3 * ka); c.fillStyle = B.ink; c.font = disp(B, 130); c.textAlign = 'center'; c.textBaseline = 'middle'; al.forEach((l, j) => c.fillText(l, 0, j * 138)); c.restore();
        c.fillStyle = B.fg; c.fillRect(W * wp - 6, mid, 12, H - mid);
      }
      c.fillStyle = B.fg; c.fillRect(0, mid - 5, W, 10);
    },
    cta(c, s, lt, d, B) {
      const cx = W / 2, k0 = E.outBack(P(lt, 0, .4));
      c.save(); c.translate(cx, 470); c.scale(k0, k0); c.rotate((1 - k0) * -1.2); c.fillStyle = B.accent; rr(c, -110, -110, 220, 220, 64); c.fill();
      c.fillStyle = B.ink; c.font = disp(B, 150); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(up(B, (B.name || '?')[0]), 0, 8); c.restore();
      const name = up(B, B.name), z = fit(c, name, q => disp(B, q), 230, 920), k1 = E.outExpo(P(lt, .1, .4));
      c.save(); c.globalAlpha = cl(k1 * 2); c.translate(cx, 700 + z * .45); c.scale(.8 + .2 * k1, .8 + .2 * k1); c.fillStyle = B.fg; c.font = disp(B, z); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, 0, 0); c.restore();
      let y = 700 + z + 70; c.font = body(58, 700); const tl = wrap(c, s.title, 880).slice(0, 2), k2 = E.outExpo(P(lt, .2, .35));
      c.save(); c.globalAlpha = cl(k2 * 1.5); c.fillStyle = B.fg; c.textAlign = 'center'; c.textBaseline = 'middle'; tl.forEach((l, j) => c.fillText(l, cx, y + j * 70 + (1 - k2) * 40)); c.restore();
      y += tl.length * 70 + 60;
      if (B.url) { const k3 = E.outBack(P(lt, .3, .35)); c.save(); c.translate(cx, y + 45); c.scale(k3, k3); c.font = body(50, 800); const tw = c.measureText(B.url).width + 80; c.fillStyle = B.fg; rr(c, -tw / 2, -45, tw, 90, 45); c.fill(); c.fillStyle = B.bg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(B.url, 0, 3); c.restore(); y += 150; }
      const btn = s.button || '';
      if (btn) {
        const k4 = E.outBack(P(lt, .4, .4)), tp = d * .62, pr = lt > tp && lt < tp + .14, pulse = lt > .8 ? 1 + .035 * Math.sin((lt - .8) * 11) : 1;
        c.font = disp(B, 78); const tw = Math.min(900, c.measureText(up(B, btn)).width + 160);
        c.save(); c.translate(cx, y + 75); c.scale(k4 * pulse * (pr ? .94 : 1), k4 * pulse * (pr ? .94 : 1)); c.font = disp(B, 78);
        c.fillStyle = B.accent; rr(c, -tw / 2, -75, tw, 150, 75); c.fill(); c.fillStyle = B.ink; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(up(B, btn), 0, 4); c.restore();
        ripple(c, cx, y + 75, P(lt, tp, .55), B.accent);
        const m = E.inOut(P(lt, d * .4, tp - d * .4)); touch(c, lerp(W * .9, cx + tw * .38, m), lerp(H * .8, y + 105, m), pr, cl((lt - d * .38) * 6));
      }
    }
  };

  /* ============ Transiciones ============ */
  function composite(c, a, b, k, type, t, accent) {
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; const e = E.inOut(k);
    const scaled = (img, s, al) => { c.save(); c.globalAlpha = al; c.translate(W / 2, H / 2); c.scale(s, s); c.drawImage(img, -W / 2, -H / 2); c.restore(); };
    if (type === 'whip' || type === 'push') {
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H); const bl = Math.sin(Math.PI * k), hz = type === 'whip';
      for (let j = 3; j >= 0; j--) { c.globalAlpha = j ? .28 : 1; const o = j * 70 * bl; if (hz) { c.drawImage(a, -W * e - o, 0); c.drawImage(b, W * (1 - e) - o, 0); } else { c.drawImage(a, 0, -H * e - o); c.drawImage(b, 0, H * (1 - e) - o); } }
    } else if (type === 'zoom') { scaled(a, 1 + .7 * e, 1); scaled(b, 1.45 - .45 * E.outCubic(k), cl(k * 1.8)); }
    else if (type === 'flash') { c.drawImage(k < .5 ? a : b, 0, 0); c.globalAlpha = (1 - Math.abs(k * 2 - 1)) * .95; c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); }
    else if (type === 'glitch') {
      const base = k < .5 ? a : b, other = k < .5 ? b : a, r = rng(Math.floor(t * 60) + 3); c.drawImage(base, 0, 0);
      for (let i = 0; i < 11; i++) { const y = r() * H, h = 20 + r() * 150, dx = (r() - .5) * 260; c.drawImage(r() > .5 ? other : base, 0, y, W, h, dx, y, W, h); }
      c.globalAlpha = .55; c.fillStyle = accent; for (let i = 0; i < 4; i++) c.fillRect(0, r() * H, W, 6 + r() * 20);
    } else c.drawImage(b, 0, 0);
    c.restore();
  }

  /* ============ Motor ============ */
  function createEngine(canvas) {
    const ctx = canvas.getContext('2d');
    const cA = mkCanvas(), cB = mkCanvas(), xA = cA.getContext('2d'), xB = cB.getContext('2d');
    let spec = normalize(EXAMPLE), TL = timeline(spec), B = brandCtx(spec.brand);
    function load(s) { spec = normalize(s); TL = timeline(spec); B = brandCtx(spec.brand); return TL; }
    function locate(t) { for (let i = TL.T.length - 1; i >= 0; i--) if (t >= TL.T[i].start) return [i, t - TL.T[i].start]; return [0, t]; }
    function drawScene(c, i, lt, t) {
      const s = spec.scenes[i], d = TL.T[i].dur;
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      background(c, B, t, i);
      const punch = 1 + .07 * (1 - E.outCubic(P(lt, 0, .3))), bp = (t % TL.b) / TL.b, bump = 1 + .012 * (1 - E.outCubic(cl(bp * 4))), sc = punch * bump;
      c.translate(W / 2, H / 2); c.scale(sc, sc); c.translate(-W / 2, -H / 2);
      (SCENES[s.type] || SCENES.hook)(c, s, lt, d, B, t);
      c.restore();
      grain(c, t);
    }
    function renderFrame(t) {
      if (!spec.scenes.length) { ctx.fillStyle = B.bg; ctx.fillRect(0, 0, W, H); ctx.fillStyle = B.fg; ctx.font = body(56, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Añade una escena para empezar', W / 2, H / 2); return; }
      t = cl(t, 0, TL.total - 1e-4); const [i, lt] = locate(t), s = spec.scenes[i], tr = Math.min(.24, TL.b * .5);
      if (i > 0 && lt < tr && s.transition && s.transition !== 'cut') { drawScene(xA, i - 1, TL.T[i - 1].dur + lt, t); drawScene(xB, i, lt, t); composite(ctx, cA, cB, lt / tr, s.transition, t, B.accent); }
      else drawScene(ctx, i, lt, t);
    }
    return { load, renderFrame, locate, canvas, get spec() { return spec; }, get timeline() { return TL; } };
  }

  /* ============ Audio sintetizado (mismo código en tiempo real y offline) ============ */
  function makeNoise(A) { const b = A.createBuffer(1, A.sampleRate, A.sampleRate), d = b.getChannelData(0), r = rng(99); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; return b; }
  function scheduleAudio(A, dest, spec, tl, t0, from = 0, noiseBuf) {
    noiseBuf = noiseBuf || makeNoise(A);
    const master = A.createGain(); master.gain.value = .5; (Array.isArray(dest) ? dest : [dest]).forEach(d => d && master.connect(d));
    const at = v => t0 + v;
    const kick = v => { const o = A.createOscillator(), g = A.createGain(); o.frequency.setValueAtTime(150, at(v)); o.frequency.exponentialRampToValueAtTime(42, at(v) + .13); g.gain.setValueAtTime(.95, at(v)); g.gain.exponentialRampToValueAtTime(.001, at(v) + .32); o.connect(g).connect(master); o.start(at(v)); o.stop(at(v) + .35); };
    const noise = (v, dur, type, f0, f1, gain) => { const s = A.createBufferSource(); s.buffer = noiseBuf; const f = A.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, at(v)); if (f1) f.frequency.exponentialRampToValueAtTime(f1, at(v) + dur); const g = A.createGain(); g.gain.setValueAtTime(.0001, at(v)); g.gain.linearRampToValueAtTime(gain, at(v) + dur * .4); g.gain.exponentialRampToValueAtTime(.001, at(v) + dur); s.connect(f).connect(g).connect(master); s.start(at(v)); s.stop(at(v) + dur + .02); };
    const ding = v => [880, 1320, 1760].forEach((fq, j) => { const o = A.createOscillator(), g = A.createGain(); o.type = 'sine'; o.frequency.value = fq; g.gain.setValueAtTime(.18 / (j + 1), at(v)); g.gain.exponentialRampToValueAtTime(.001, at(v) + .8); o.connect(g).connect(master); o.start(at(v)); o.stop(at(v) + .85); });
    for (let k = 0; k * tl.b < tl.total - .01; k++) {
      const v = k * tl.b; if (v >= from - .01) { kick(v); if (k % 2) noise(v, .08, 'highpass', 6000, 0, .18); }
      const h = v + tl.b / 2; if (h >= from && h < tl.total) noise(h, .05, 'highpass', 8000, 0, .1);
    }
    spec.scenes.forEach((s, i) => { const st = tl.T[i].start; if (i > 0 && s.transition !== 'cut' && st - .14 >= from) noise(st - .14, .28, 'bandpass', 500, 4000, .45); if (s.type === 'cta' && st + .3 >= from) ding(st + .3); });
    return master;
  }
  async function renderAudioWav(specIn, sampleRate = 48000) {
    const spec = normalize(specIn), tl = timeline(spec), len = Math.ceil((tl.total + .05) * sampleRate);
    const A = new OfflineAudioContext(2, len, sampleRate);
    scheduleAudio(A, A.destination, spec, tl, 0, 0);
    const buf = await A.startRendering();
    const ch = [buf.getChannelData(0), buf.getChannelData(1)], n = buf.length, out = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
    out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) { const v = Math.max(-1, Math.min(1, ch[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7FFF, true); o += 2; }
    const bytes = new Uint8Array(out.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  global.Rafaga = { W, H, FONTS, PRESETS, COLOR_KEYS, TYPES, MOCKS, TRANS, NEW, EXAMPLE, SCENES, MOCK, normalize, timeline, lint, createEngine, scheduleAudio, makeNoise, renderAudioWav, inkOn, clone };
})(typeof window !== 'undefined' ? window : globalThis);
