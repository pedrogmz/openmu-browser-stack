const naga = require('naga-wasm');

const wgsl = `
struct FogUniforms {
    fogEnabled: u32,
    alphaDiscardEnabled: u32,
    alphaThreshold: f32,
    alphaToCoverage: u32,
    fogStart: f32,
    fogEnd: f32,
    fogPad: vec2<f32>,
    fogColor: vec4<f32>,
}

@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var s: sampler;
@group(3) @binding(0) var<uniform> fogUniforms: FogUniforms;

struct FSInput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) fogFactor: f32,
}

@fragment
fn main(input: FSInput) -> @location(0) vec4<f32> {
    var color = textureSample(tex, s, input.uv) * input.color;
    if (fogUniforms.alphaToCoverage != 0u) {
        let edge = clamp((color.a - fogUniforms.alphaThreshold) / max(fwidth(color.a), 0.0001) + 0.5, 0.0, 1.0);
        color.a *= edge;
        if (color.a <= 0.0) {
            discard;
        }
    } else if (fogUniforms.alphaDiscardEnabled != 0u && color.a <= fogUniforms.alphaThreshold) {
        discard;
    }
    if (fogUniforms.fogEnabled != 0u) {
        color = vec4<f32>(mix(fogUniforms.fogColor.rgb, color.rgb, input.fogFactor), color.a);
    }
    return color;
}
`;

try {
  const mod = naga.parseWgsl(wgsl);
  const info = naga.validate(mod);
  console.log('VALIDATION SUCCESSFUL!');
} catch (e) {
  console.error('Error:', e.formatted || e);
}
