# WebGPU compatibility-mode spike

Objetivo: comprobar si el cliente WASM actual puede correr en GPUs/drivers viejos
pidiendo un adapter de **WebGPU compatibility mode** (D3D11 / GLES 3.1) en vez de
escribir un renderer WebGL.

Decisión registrada en [ADR 0004](../../MuMain/docs/adr/0004-webgpu-compatibility-is-not-a-webgl-fallback.md).

## Qué se tocó

- `MuMain/src/dependencies/XDL_wgpu/src/SDL_gpu_webgpu.c`
  - Lee `window.MU_WEBGPU_COMPAT` antes de pedir el adapter.
  - Pide `WGPUFeatureLevel_Compatibility` cuando el flag está activo.
  - No exige `depth-clip-control` ni `indirect-first-instance` en compat.
  - Pide los límites de storage buffers del adapter en compat (para probar el
    renderer actual antes de mover esos buffers).
- `MuMain/src/shaders/compiled/skinned_*.wgsl`
  - `@interpolate(flat)` → `@interpolate(flat, either)`, que es lo que exige
    compatibility mode.
- `openmu-browser-stack/public/index.html`
  - Preflight: intenta core; si no hay adapter, intenta compatibility mode.
  - `?compat=1` fuerza compatibility mode aunque haya core.
- `openmu-browser-stack/public/compat-probe.html`
  - Página autocontenida que reporta WebGL2, `navigator.gpu`, adapters core /
    compat / fallback, límites del device y dos tests de pipeline:
    storage buffer en vertex y `@interpolate(flat)` vs `flat, either`.

## Cómo probar en la VM

1. Sirve `openmu-browser-stack/public` por localhost (WebGPU no existe en
   `file://`):

   ```powershell
   python -m http.server 8099 --bind 127.0.0.1 --directory C:\ruta\a\openmu-browser-stack\public
   ```

2. Abre `http://127.0.0.1:8099/compat-probe.html`.

3. Si el informe dice `"gpu": { "present": false }`, el navegador no expone
   WebGPU en absoluto. Compatibility mode no puede ayudar ahí. Cierra Chrome y
   arráncalo con:

   ```text
   chrome.exe --enable-unsafe-webgpu --enable-unsafe-swiftshader --ignore-gpu-blocklist --use-webgpu-adapter=swiftshader
   ```

   (En Linux, `google-chrome` con los mismos flags). Vuelve a abrir el probe.
   Si sigue sin haber `navigator.gpu`, esa VM solo puede ejecutar WebGL.

4. Si el probe muestra `adapter/compat`, abre el cliente con:

   ```text
   http://127.0.0.1:8099/index.html?compat=1
   ```

   En la consola deben aparecer:

   - `[OpenMU] WebGPU compatibility adapter selected`
   - `WebGPU: requesting a compatibility-mode adapter`
   - `WebGPU compat: requesting vertex storage buffers = N, fragment storage buffers = M`

5. Guarda los errores de validación de WebGPU que salgan. Los bloqueadores que
   ya conocemos:

   - Storage buffers en vertex (`boneRows`, `terrainWords`). Si el adapter
     expone `maxStorageBuffersInVertexStage = 0`, hay que moverlos a UBO/textura.
   - `@interpolate(flat)` (ya corregido en los WGSL del spike).
   - Límites de compat: 16 KB de UBO, 4096 de textura 2D, 15 variables
     inter-stage, 4 color attachments.

## Resultado en el host (GTX 1080, Chrome 152)

- `adapter/core` y `adapter/compat` existen.
- Device compat por defecto: `maxStorageBuffersInVertexStage = 0`.
- Pipeline con storage buffer en vertex: falla con el límite 0.
- Pipeline con `@interpolate(flat)`: falla.
- Pipeline con `@interpolate(flat, either)`: pasa.
- Si se pide `requiredLimits.maxStorageBuffersInVertexStage = 16`, el pipeline
  con storage buffer en vertex pasa.

Esto confirma que el único trabajo de renderer para el spike es mover los dos
storage buffers de vertex (o pedir el límite cuando el hardware lo soporte).

## Primera ejecución del cliente en compat (host)

El cliente llegó a `Iniciando el cliente` y a los logs de input, así que el
adapter compat, el device y los límites de storage buffers funcionaron. La
primera pasada destapó dos bloqueadores más, ya corregidos en el spike:

1. **Variables inter-stage.** `maxInterStageShaderVariables` en compat es 15
   (locations 0..14), y varios vertex shaders emitían `clipDist` en
   `@location(15)`. Se renumeraron los `clipDist` a un hueco libre:
   `basic_textured` → 4, `skinned_shadow`/`skinned_weighted_shadow` → 3,
   `skinned_textured`/`skinned_weighted` → 11.
2. **`DepthClipControl`.** El renderer creaba pipelines con
   `unclippedDepth = true`, feature que compat no expone. El backend ahora solo
   lo activa si el device tiene `DepthClipControl`.

La segunda pasada llegó a la pantalla de login con el renderer en compat:

- `WebGPU compat: vertex storage buffers = 16, fragment storage buffers = 16, uniform buffer binding = 65536`
- `SDL_gpu -- device driver: webgpu`
- `shaders loaded`, `Enhanced lighting pipelines ready`, `SDL_gpu init success`
- La UI (login, botones) renderiza; el canvas ya no se queda en la pantalla de carga.

El UBO de 32 KB era el último límite encontrado: se resolvió pidiendo
`maxUniformBufferBindingSize` y `maxStorageBufferBindingSize` del adapter.

## Qué queda para producción

El spike pide los límites máximos que expone el adapter. En el host (GTX 1080)
el adapter compat expone 16 storage buffers en vertex y 64 KB de UBO, así que
pasa. En hardware viejo esos límites pueden ser 0 y 16 KB respectivamente. Para
producción hay que:

1. Mover `boneRows` y `terrainWords` fuera del vertex stage (textura o UBO).
2. Partir el UBO de 32 KB o meterlo en un storage buffer (compat permite 4
   storage buffers en fragment).
3. No depender de `DepthClipControl` ni de `clipDistances`.
4. Mantener `@interpolate(flat, either)`.

El error `Destroyed texture ... used in a submit` apareció al ocultar/enfocar la
pestaña; no bloqueó el login. Hay que comprobar si se repite en la VM.

## VM sin GPU: Firefox 157 + Mesa llvmpipe

Resultado del probe en la VM:

- WebGL2 sí, con renderer `llvmpipe` (software).
- `navigator.gpu` existe, pero `requestAdapter()` devuelve `null` para core,
  compat, fallback y compat+fallback.

Eso **no es el caso “driver viejo”**: es “no hay ningún adapter WebGPU”. Además,
la VM usa Firefox 157, y compatibility mode es una feature de Chromium
(Chrome/Edge 146+); Firefox no la implementa. Por tanto, ese resultado no prueba
ni invalida la ruta compat.

Para probar el caso “driver viejo” en esa VM hay que repetir el probe en
Chrome/Edge con:

```text
--enable-unsafe-webgpu --enable-unsafe-swiftshader --ignore-gpu-blocklist --use-webgpu-adapter=swiftshader
```

Si Chrome tampoco devuelve adapter, la VM es WebGL-only. Ese segmento necesita
un renderer WebGL, que es un proyecto distinto; el spike no lo cubre.

## Cómo decidir con datos

No hace falta adivinar el tamaño del segmento. En el preflight de producción se
puede registrar en Sentry/analytics:

- `navigator.gpu` presente o no,
- resultado de `requestAdapter()` core y compat,
- user agent,
- renderer de WebGL2 (`WEBGL_debug_renderer_info`).

Con unas semanas de datos se separa “driver viejo con WebGPU disponible” (donde
compat funciona y merece la pena) de “sin adapter WebGPU” (donde solo WebGL
funciona). Si el segundo grupo es pequeño, aceptar el hueco es más barato que
mantener un segundo renderer.
