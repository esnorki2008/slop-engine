# Ráfaga · guía para Claude Code

Motor de vídeos verticales (1080×1920) para promocionar funcionalidades web en TikTok, Reels y Shorts.

## Flujo para crear un vídeo
1. `rafaga_schema` para ver el formato (o lee `docs/SPEC.md`).
2. Escribe la spec en `videos/<nombre>.json`.
3. `rafaga_validate` y corrige los avisos.
4. `rafaga_preview` y **mira las imágenes**: textos cortados, solapes, legibilidad.
5. `rafaga_render` a `out/<nombre>.mp4`.

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
