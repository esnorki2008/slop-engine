# Formato de especificación de Ráfaga

Un vídeo es un objeto JSON con tres claves: `brand`, `bpm` y `scenes`. El lienzo es siempre 1080×1920 (9:16).

```json
{
  "brand": { "name": "Agendo", "url": "agendo.app", "font": "anton", "preset": "electrico" },
  "bpm": 128,
  "scenes": [ { "type": "hook", "beats": 3, "transition": "cut", "text": "¿Tu agenda sigue en papel?" } ]
}
```

## Ritmo

Cada escena dura `beats` tiempos. Un tiempo dura `60 / bpm` segundos (a 128 bpm, 0,47 s). Los cortes caen en el pulso de la pista generada. Duración total recomendada: 8–15 s. Una escena por debajo de 1 s no se llega a leer.

Guía de `beats`: hook 3 · feature 4–5 · site 4–5 · stat 3 · list 4 · compare 4 · cta 4–5.

## brand

| Campo | Valores |
|---|---|
| `name` | Nombre de la marca. Se usa en la cabecera de las pantallas y en el CTA. |
| `url` | Dirección que aparece en el CTA. Vacío para ocultarla. |
| `font` | `anton` (condensada, fuerza mayúsculas), `archivo`, `bricolage`, `unbounded` |
| `preset` | `electrico`, `chicle`, `mandarina`, `menta`, `tinta` |
| `bg`, `fg`, `accent`, `accent2`, `app` | Colores `#RRGGBB` que sobrescriben el preset. `accent` = resaltados y botones; `accent2` = formas de fondo; `app` = color primario de la app dentro del móvil. |

El color del texto sobre `accent` y `app` se calcula solo por contraste.

## Escenas

Campos comunes: `type`, `beats` (1–12), `transition` (cómo entra la escena): `cut`, `whip`, `push`, `zoom`, `flash`, `glitch`. La primera escena debería ser `cut`.

### hook
Palabras que entran de golpe, una por línea; la última queda resaltada con `accent`.
- `text`: 3–6 palabras. Un dolor o una pregunta.

### feature
Título, subtítulo y un móvil con una pantalla animada.
- `title`: 2–4 palabras · `sub`: ≤ 9 palabras
- `mockup` y su campo `ui`:
  - `slots`: calendario; un dedo toca una hora y aparece un aviso. `ui` = texto del aviso.
  - `notify`: pantalla de bloqueo con notificaciones que caen. `ui` = 1–3 notificaciones separadas por `|`.
  - `chart`: barras que crecen con una cifra. `ui` = `cifra|etiqueta`.
  - `typing`: campo que se escribe solo y un botón. `ui` = `texto escrito|botón|mensaje de éxito|título opcional`.

### site

Muestra una captura real del sitio dentro de un navegador desktop o un móvil. El título, el marco y sus controles aparecen con rebote. Para crearla, pide al usuario la URL y si prefiere web desktop o web móvil; llama a `rafaga_capture_site` y usa el campo `screenshot` que devuelve.

- `title`: 2–5 palabras · `sub`: descripción breve opcional.
- `view`: `desktop` o `mobile`, según la elección del usuario.
- `screenshot`: ruta PNG devuelta por `rafaga_capture_site`, por ejemplo `../assets/sites/ejemplo.com-desktop-abc12345.png`. Se carga antes de renderizar; si falta o no existe, el render falla con un error.
- La captura muestra el primer viewport de la web. Si el sitio requiere inicio de sesión o bloquea navegadores automáticos, proporciona una captura PNG accesible para el motor.

### stat
Contador con anillo de progreso.
- `prefix`, `value` (número; admite decimales con `.` o `,`), `suffix`, `label` (2–4 palabras).
- No inventes cifras: usa solo datos reales del producto.

### list
- `title`: 1–3 palabras · `items`: 3 frases de 2–4 palabras (máximo 5).

### compare
Mitad superior tachada, mitad inferior se revela con un barrido.
- `before`, `after`: 3–6 palabras. Opcionales `beforeLabel` y `afterLabel` (por defecto "Antes" / "Ahora").

### cta
Logo con la inicial, nombre, mensaje, URL y botón que late.
- `title`: 3–6 palabras · `button`: 2–3 palabras.

## Zonas que tapa TikTok

Sobre 1080×1920: arriba 0–150 px, abajo 1536–1920 px (descripción y música), derecha 940–1080 px (botones). Las escenas ya colocan el contenido importante fuera de esas zonas; si añades tipos nuevos, respétalas.

## Estructura que funciona

`hook` → `site` + 1–2 `feature` → como mucho uno de `stat` / `list` / `compare` → `cta`. Entre 5 y 7 escenas.
