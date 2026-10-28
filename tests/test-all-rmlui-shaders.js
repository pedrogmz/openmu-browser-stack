const fs = require('fs');
const path = require('path');
const naga = require('naga-wasm');

const compiledDir = 'C:/Users/Poisson/Documents/MuMain/src/ThirdParty/RmlUi/Backends/RmlUi_SDL_GPU/compiled';
const files = fs.readdirSync(compiledDir).filter(f => f.endsWith('.h') && f !== 'ShadersCompiled.h');

console.log('Testing', files.length, 'compiled shaders with naga-wasm:');

for (const f of files) {
  const content = fs.readFileSync(path.join(compiledDir, f), 'utf8');
  const match = content.match(/static const unsigned char ([a-zA-Z0-9_]+_spirv)\[\] = \{([^}]+)\}/s);
  if (!match) {
    console.log(`[SKIP] ${f}: No _spirv array found`);
    continue;
  }
  const varName = match[1];
  const bytes = match[2].split(',').map(s => parseInt(s.trim(), 16)).filter(n => !isNaN(n));
  const buf = Buffer.from(bytes);
  try {
    const mod = naga.parseSpirv(buf);
    const info = naga.validate(mod);
    const wgsl = naga.writeWgsl(mod, info);
    console.log(`[OK]   ${f} -> ${varName} (${bytes.length} bytes -> ${wgsl.length} chars WGSL)`);
  } catch (err) {
    console.log(`[ERR]  ${f} -> ${varName}: ${err.message || err}`);
  }
}
