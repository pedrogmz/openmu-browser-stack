const naga = require('naga-wasm');

const shaders = {
  VertMain: `
struct UniformBlockTransform {
    Transform: mat4x4<f32>,
};

struct UniformBlockTranslate {
    Translate: vec2<f32>,
};

struct VertexOutput {
    @location(0) Color: vec4<f32>,
    @location(1) TexCoord: vec2<f32>,
    @builtin(position) Position: vec4<f32>,
};

@group(1) @binding(0) var<uniform> uTransform: UniformBlockTransform;
@group(1) @binding(1) var<uniform> uTranslate: UniformBlockTranslate;

@vertex
fn main(
    @location(0) Position: vec2<f32>,
    @location(1) Color: vec4<f32>,
    @location(2) TexCoord: vec2<f32>
) -> VertexOutput {
    var output: VertexOutput;
    output.Color = Color;
    output.TexCoord = TexCoord;
    let pos = vec4<f32>(Position + uTranslate.Translate, 0.0, 1.0);
    output.Position = pos * transpose(uTransform.Transform);
    return output;
}
`,
  VertPassthrough: `
struct UniformBlockQuad {
    QuadPosition: vec4<f32>,
    QuadTexCoord: vec4<f32>,
};

struct VertexOutput {
    @location(0) TexCoord: vec2<f32>,
    @builtin(position) Position: vec4<f32>,
};

@group(1) @binding(0) var<uniform> uQuad: UniformBlockQuad;

@vertex
fn main(
    @location(0) Position: vec2<f32>,
    @location(1) Color: vec4<f32>,
    @location(2) TexCoord: vec2<f32>
) -> VertexOutput {
    var output: VertexOutput;
    output.TexCoord = uQuad.QuadTexCoord.xy + TexCoord * uQuad.QuadTexCoord.zw;
    let pos = mix(uQuad.QuadPosition.xy, uQuad.QuadPosition.zw, TexCoord);
    output.Position = vec4<f32>(pos, 0.0, 1.0);
    return output;
}
`,
  FragColor: `
struct Varyings {
    @location(0) Color: vec4<f32>,
    @location(1) TexCoord: vec2<f32>,
};

@fragment
fn main(input: Varyings) -> @location(0) vec4<f32> {
    return input.Color;
}
`,
  FragTexture: `
struct Varyings {
    @location(0) Color: vec4<f32>,
    @location(1) TexCoord: vec2<f32>,
};

@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uSampler: sampler;

@fragment
fn main(input: Varyings) -> @location(0) vec4<f32> {
    return input.Color * textureSample(uTexture, uSampler, input.TexCoord);
}
`,
  FragPassthrough: `
struct PostVaryings {
    @location(0) TexCoord: vec2<f32>,
};

@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uSampler: sampler;

@fragment
fn main(input: PostVaryings) -> @location(0) vec4<f32> {
    return textureSample(uTexture, uSampler, input.TexCoord);
}
`,
  FragColorMatrix: `
struct PostVaryings {
    @location(0) TexCoord: vec2<f32>,
};

struct UniformBlockColorMatrix {
    ColorMatrix: mat4x4<f32>,
};

@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uSampler: sampler;
@group(3) @binding(0) var<uniform> uMatrix: UniformBlockColorMatrix;

@fragment
fn main(input: PostVaryings) -> @location(0) vec4<f32> {
    let tex_color = textureSample(uTexture, uSampler, input.TexCoord);
    let transformed = (uMatrix.ColorMatrix * tex_color).rgb;
    return vec4<f32>(transformed, tex_color.a);
}
`,
  FragBlendMask: `
struct PostVaryings {
    @location(0) TexCoord: vec2<f32>,
};

@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uSampler: sampler;
@group(2) @binding(2) var uMaskTexture: texture_2d<f32>;
@group(2) @binding(3) var uMaskSampler: sampler;

@fragment
fn main(input: PostVaryings) -> @location(0) vec4<f32> {
    let tex_color = textureSample(uTexture, uSampler, input.TexCoord);
    let mask_alpha = textureSample(uMaskTexture, uMaskSampler, input.TexCoord).a;
    return tex_color * mask_alpha;
}
`,
  FragGradient: `
struct Varyings {
    @location(0) Color: vec4<f32>,
    @location(1) TexCoord: vec2<f32>,
};

struct UniformBlockGradient {
    P: vec2<f32>,
    V: vec2<f32>,
    Func: i32,
    NumStops: i32,
    StopColors: array<vec4<f32>, 16>,
    StopPositions: array<vec4<f32>, 4>,
};

@group(3) @binding(0) var<uniform> uGrad: UniformBlockGradient;

fn get_stop_pos(i: i32) -> f32 {
    let row = i >> 2;
    let col = i & 3;
    let vec = uGrad.StopPositions[row];
    if (col == 0) { return vec.x; }
    if (col == 1) { return vec.y; }
    if (col == 2) { return vec.z; }
    return vec.w;
}

fn lerp_stop_colors(t: f32) -> vec4<f32> {
    var color = uGrad.StopColors[0];
    for (var i = 1; i < uGrad.NumStops; i = i + 1) {
        let p0 = get_stop_pos(i - 1);
        let p1 = get_stop_pos(i);
        let factor = smoothstep(p0, p1, t);
        color = mix(color, uGrad.StopColors[i], vec4<f32>(factor));
    }
    return color;
}

@fragment
fn main(input: Varyings) -> @location(0) vec4<f32> {
    var t: f32 = 0.0;
    let func = uGrad.Func;
    if (func == 0 || func == 3) {
        let dist_sq = dot(uGrad.V, uGrad.V);
        let delta = input.TexCoord - uGrad.P;
        t = dot(uGrad.V, delta) / dist_sq;
    } else if (func == 1 || func == 4) {
        let delta = input.TexCoord - uGrad.P;
        t = length(uGrad.V * delta);
    } else if (func == 2 || func == 5) {
        let delta = input.TexCoord - uGrad.P;
        let R = mat2x2<f32>(uGrad.V.x, uGrad.V.y, -uGrad.V.y, uGrad.V.x);
        let rotated = R * delta;
        t = 0.5 + atan2(-rotated.x, rotated.y) / (2.0 * 3.14159265);
    }
    if (func >= 3) {
        let t0 = get_stop_pos(0);
        let t1 = get_stop_pos(uGrad.NumStops - 1);
        t = t0 + (t - t0) - floor((t - t0) / (t1 - t0)) * (t1 - t0);
    }
    return input.Color * lerp_stop_colors(t);
}
`
};

for (const [name, code] of Object.entries(shaders)) {
  try {
    const mod = naga.parseWgsl(code);
    const info = naga.validate(mod);
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message || err);
  }
}
