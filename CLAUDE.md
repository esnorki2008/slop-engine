# Ráfaga · guía para Claude Code

Motor de vídeos verticales (1080×1920) para promocionar funcionalidades web en TikTok, Reels y Shorts.

## Flujo para crear un vídeo
1. Pide al usuario la URL completa del sitio y pregúntale si quiere mostrar la versión web desktop o web móvil. Si ya dio uno de esos datos, pregunta solo por el que falte.
2. `rafaga_schema` para ver el formato (o lee `docs/SPEC.md`).
3. `rafaga_capture_site` con la URL y la versión elegida. Incluye al menos una escena `site` con la captura devuelta; los colores de la página pueden inspirar la paleta, pero la captura debe verse en el vídeo.
4. Escribe la spec en `videos/<nombre>.json`.
5. `rafaga_validate` y corrige los avisos.
6. `rafaga_preview` y **mira las imágenes**: sitio visible, textos cortados, solapes, legibilidad y entrada bouncy.
7. `rafaga_render` a `out/<nombre>.mp4`.

## Reglas de contenido
- Textos cortísimos: el lector tiene menos de 2 s por escena.
- No inventes cifras para escenas `stat`: solo datos reales que dé el usuario.
- Empieza con `hook`, termina con `cta`, 8–15 s en total.

## Arquitectura
- `engine/rafaga-engine.js`: todo el dibujo. Función pura de (spec, t). Sin dependencias.
  - Escena nueva: añade a `SCENES`, `TYPES` y `NEW`, y documéntala en `docs/SPEC.md`.
  - Pantalla de móvil nueva: añade a `MOCK` y `MOCKS`.
  - Respeta las zonas que tapa TikTok (ver SPEC.md).
- `engine/render.html`: puente que usa Puppeteer (`window.__rafaga`).
- `src/renderer.js`: Chrome headless → JPEG por fotograma → ffmpeg (H.264 + AAC).
- `src/server.js`: servidor MCP (stdio). `src/cli.js`: la misma funcionalidad por terminal.
- `editor/index.html`: editor visual; carga el mismo motor.

Tras cambiar el motor, comprueba con `npm run preview -- examples/agendo.json out/frames`.
