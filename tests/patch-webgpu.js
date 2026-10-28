const fs = require('fs');
const filePath = 'C:/Users/Poisson/Documents/openmu-browser-stack/public/Main.js';
let code = fs.readFileSync(filePath, 'utf8');

// Robust regex for wgpuSurfaceConfigure
const configRegex = /([a-zA-Z0-9_$]+):\s*\(surfacePtr,\s*config\)\s*=>\s*\{var context=WebGPU\.getJsObject\(surfacePtr\);/;
if (configRegex.test(code)) {
  code = code.replace(configRegex, '$1:(surfacePtr,config)=>{var context=WebGPU.getJsObject(surfacePtr);if(!context){console.warn("[WEBGPU configure GUARD] surfacePtr=", surfacePtr);return;}');
  console.log('Patched wgpuSurfaceConfigure successfully');
} else {
  console.warn('configRegex not matched');
}

// Robust regex for wgpuSurfaceGetCurrentTexture
const currentTexRegex = /([a-zA-Z0-9_$]+):\s*\(surfacePtr,\s*surfaceTexturePtr\)\s*=>\s*\{var context=WebGPU\.getJsObject\(surfacePtr\);try\{/;
if (currentTexRegex.test(code)) {
  code = code.replace(currentTexRegex, '$1:(surfacePtr,surfaceTexturePtr)=>{var context=WebGPU.getJsObject(surfacePtr);if(!context){console.warn("[WEBGPU getCurrentTexture GUARD] surfacePtr=", surfacePtr);HEAPU32[surfaceTexturePtr+4>>2]=0;HEAP32[surfaceTexturePtr+8>>2]=6;return;}try{');
  console.log('Patched wgpuSurfaceGetCurrentTexture successfully');
} else {
  console.warn('currentTexRegex not matched');
}

// Check m (wgpu*Release)
const targetM = 'm:ptr=>{delete WebGPU.Internals.jsObjects[ptr]}';
const replacementM = `m:ptr=>{if(WebGPU.Internals.jsObjects[ptr]?.constructor?.name?.includes('Canvas') || WebGPU.Internals.jsObjects[ptr]?.canvas){console.warn('[WEBGPU m RELEASE SURFACE!] ptr=', ptr, 'stack=', new Error().stack);}delete WebGPU.Internals.jsObjects[ptr]}`;
if (code.includes(targetM)) {
  code = code.replace(targetM, replacementM);
  console.log('Patched m successfully');
} else {
  console.log('m already patched or not found');
}

fs.writeFileSync(filePath, code);
console.log('Main.js updated successfully!');
