# Ráfaga

Motor de vídeos verticales ultrarrápidos (1080×1920, 8–15 s) para enseñar funcionalidades de un sitio web en TikTok. Un vídeo es un JSON de escenas; el motor lo dibuja en canvas, fotograma a fotograma, con transiciones sincronizadas a una pista rítmica generada.

Incluye un **servidor MCP** para que Claude Code escriba la spec, vea fotogramas de prueba y renderice el MP4 final.

## Requisitos
- Node.js 18 o superior
- ffmpeg en el PATH (`brew install ffmpeg`, `apt install ffmpeg`, `winget install ffmpeg`)

## Instalación
```bash
npm install          # descarga también un Chrome para Puppeteer
npm run render -- examples/agendo.json out/agendo.mp4
```

## Usarlo desde Claude Code
El archivo `.mcp.json` ya registra el servidor para este proyecto. Abre Claude Code en esta carpeta y acepta el servidor `rafaga`. O regístralo a mano:
```bash
claude mcp add rafaga -- node /ruta/a/rafaga-mcp/src/server.js
```
Luego pídele, por ejemplo: *"Haz un vídeo para TikTok de las 3 funciones principales de mi web, revisa los fotogramas y renderízalo."*

### Herramientas MCP
| Herramienta | Qué hace |
|---|---|
| `rafaga_schema` | Documentación del formato y ejemplo completo |
| `rafaga_validate` | Normaliza la spec, duración por escena, avisos de legibilidad |
| `rafaga_preview` | Devuelve fotogramas PNG para que el agente vea el resultado |
| `rafaga_render` | MP4 H.264 + AAC, yuv420p, faststart; 24/30/60 fps |

Todas aceptan `spec` (objeto) o `spec_path` (ruta a .json).

## Línea de comandos
```bash
node src/cli.js validate examples/agendo.json
node src/cli.js preview  examples/agendo.json out/frames --times 1,4,8
node src/cli.js render   examples/agendo.json out/agendo.mp4 --fps 60 --crf 20
node src/cli.js editor   # imprime la ruta del editor visual
```

## Editor visual
Abre `editor/index.html` en Chrome, Edge o Safari. Edita escenas, marca y ritmo; la pestaña JSON exporta la spec que entiende el MCP. También graba el vídeo en tiempo real desde el navegador.

## Variables de entorno
- `RAFAGA_CHROME`: ruta a un Chrome/Chromium propio (evita la descarga de Puppeteer).
- `RAFAGA_FFMPEG`: ruta a ffmpeg si no está en el PATH.

## Rendimiento
Cada fotograma se dibuja y se codifica por separado, así que el resultado es exacto aunque la máquina vaya lenta. En un portátil moderno, 30 fps tarda del orden de la duración del vídeo.

Si necesitas más velocidad:
- renderizar por tramos en paralelo con varias páginas y concatenarlos con ffmpeg;
- o pasar a WebCodecs dentro del navegador.

## Extender
Ver `CLAUDE.md` y `docs/SPEC.md`. Todo el dibujo vive en `engine/rafaga-engine.js`.
