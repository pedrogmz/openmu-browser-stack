const fs = require('fs');
const path = require('path');
const naga = require('naga-wasm');

const spvDir = 'C:/Users/Poisson/Documents/MuMain/out/build/wasm-web/shaders';
const targetDir1 = 'C:/Users/Poisson/Documents/MuMain/out/build/wasm-web/shaders';
const targetDir2 = 'C:/Users/Poisson/Documents/MuMain/src/shaders/compiled';
const targetDir3 = 'C:/Users/Poisson/Documents/MuMain/out/build/wasm-web/src/shaders';

// 1. Handcrafted & validated WGSL for fragment shaders where SPIR-V had texture/sampler binding collisions:

const basic_textured_frag = `
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
    var color: vec4<f32> = textureSample(tex, s, input.uv) * input.color;
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

const basic_textured_fog_frag = `
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

struct SceneLighting {
    sceneLightDirection: vec4<f32>,
    sceneLightColor: vec4<f32>,
    diffuseCurve: vec4<f32>,
    rimParameters: vec4<f32>,
    specularParameters: vec4<f32>,
    sceneFogColor: vec4<f32>,
    sceneFogParameters: vec4<f32>,
    cameraPosition: vec4<f32>,
}

@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var s: sampler;
@group(3) @binding(0) var<uniform> fogUniforms: FogUniforms;
@group(3) @binding(1) var<uniform> sceneLighting: SceneLighting;

struct FSInput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) fogFactor: f32,
    @location(3) eyeDepth: f32,
}

fn enhancedFogAmount(eyeDepth: f32) -> f32 {
    let scaledDistance = max(eyeDepth - sceneLighting.sceneFogParameters.x, 0.0) * sceneLighting.sceneFogParameters.z;
    return clamp(1.0 - exp(-(scaledDistance * scaledDistance)), 0.0, 1.0);
}

@fragment
fn main(input: FSInput) -> @location(0) vec4<f32> {
    var color: vec4<f32> = textureSample(tex, s, input.uv) * input.color;
    if (fogUniforms.alphaToCoverage != 0u) {
        let edge = clamp((color.a - fogUniforms.alphaThreshold) / max(fwidth(color.a), 0.0001) + 0.5, 0.0, 1.0);
        color.a *= edge;
        if (color.a <= 0.0) {
            discard;
        }
    } else if (fogUniforms.alphaDiscardEnabled != 0u && color.a <= fogUniforms.alphaThreshold) {
        discard;
    }
    if (fogUniforms.fogEnabled != 0u && sceneLighting.sceneFogColor.w > 0.0) {
        color = vec4<f32>(mix(color.rgb, sceneLighting.sceneFogColor.rgb, enhancedFogAmount(input.eyeDepth)), color.a);
    }
    return color;
}
`;

const post_bloom_down_frag = `
struct BloomUniforms {
    sourceTexelSize: vec2<f32>,
    levelWeight: f32,
    padding: f32,
}

@group(2) @binding(0) var source: texture_2d<f32>;
@group(2) @binding(1) var linearSampler: sampler;
@group(3) @binding(0) var<uniform> bloomUniforms: BloomUniforms;

struct FSInput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

const kCentreWeight: f32 = 4.0;
const kTotalWeight: f32 = 8.0;

@fragment
fn main(input: FSInput) -> @location(0) vec4<f32> {
    let halfTexel = bloomUniforms.sourceTexelSize * 0.5;
    var sum: vec3<f32> = textureSample(source, linearSampler, input.uv).rgb * kCentreWeight;
    sum += textureSample(source, linearSampler, input.uv - halfTexel).rgb;
    sum += textureSample(source, linearSampler, input.uv + halfTexel).rgb;
    sum += textureSample(source, linearSampler, input.uv + vec2<f32>(halfTexel.x, -halfTexel.y)).rgb;
    sum += textureSample(source, linearSampler, input.uv - vec2<f32>(halfTexel.x, -halfTexel.y)).rgb;
    return vec4<f32>(sum / kTotalWeight, 1.0);
}
`;

const post_bloom_up_frag = `
struct BloomUniforms {
    sourceTexelSize: vec2<f32>,
    levelWeight: f32,
    padding: f32,
}

@group(2) @binding(0) var source: texture_2d<f32>;
@group(2) @binding(1) var linearSampler: sampler;
@group(3) @binding(0) var<uniform> bloomUniforms: BloomUniforms;

struct FSInput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

const kDiagonalWeight: f32 = 2.0;
const kTotalWeight: f32 = 12.0;

@fragment
fn main(input: FSInput) -> @location(0) vec4<f32> {
    let halfTexel = bloomUniforms.sourceTexelSize * 0.5;
    let uv = input.uv;
    var sum: vec3<f32> = textureSample(source, linearSampler, uv + vec2<f32>(-halfTexel.x * 2.0, 0.0)).rgb;
    sum += textureSample(source, linearSampler, uv + vec2<f32>(halfTexel.x * 2.0, 0.0)).rgb;
    sum += textureSample(source, linearSampler, uv + vec2<f32>(0.0, -halfTexel.y * 2.0)).rgb;
    sum += textureSample(source, linearSampler, uv + vec2<f32>(0.0, halfTexel.y * 2.0)).rgb;
    sum += textureSample(source, linearSampler, uv + vec2<f32>(-halfTexel.x, -halfTexel.y)).rgb * kDiagonalWeight;
    sum += textureSample(source, linearSampler, uv + vec2<f32>(halfTexel.x, -halfTexel.y)).rgb * kDiagonalWeight;
    sum += textureSample(source, linearSampler, uv + vec2<f32>(-halfTexel.x, halfTexel.y)).rgb * kDiagonalWeight;
    sum += textureSample(source, linearSampler, uv + vec2<f32>(halfTexel.x, halfTexel.y)).rgb * kDiagonalWeight;
    return vec4<f32>(sum / kTotalWeight * bloomUniforms.levelWeight, 1.0);
}
`;

const post_composite_frag = `
struct CompositeUniforms {
    inverseTargetSize: vec2<f32>,
    bloomScale: f32,
    gradingStrength: f32,
}

@group(2) @binding(0) var scene: texture_2d<f32>;
@group(2) @binding(1) var sceneSampler: sampler;
@group(2) @binding(2) var bloom: texture_2d<f32>;
@group(2) @binding(3) var bloomSampler: sampler;
@group(2) @binding(4) var grading: texture_2d<f32>;
@group(2) @binding(5) var gradingSampler: sampler;
@group(3) @binding(0) var<uniform> compositeUniforms: CompositeUniforms;

struct FSInput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

const kGradingSize: f32 = 32.0;

fn grade(color: vec3<f32>) -> vec3<f32> {
    let lastEntry = kGradingSize - 1.0;
    let blue = color.b * lastEntry;
    let lowerSlice = floor(blue);
    let upperSlice = min(lowerSlice + 1.0, lastEntry);
    let sliceBlend = blue - lowerSlice;

    let x = (color.r * lastEntry + 0.5) / (kGradingSize * kGradingSize);
    let y = (color.g * lastEntry + 0.5) / kGradingSize;

    let lowerUv = vec2<f32>(x + lowerSlice / kGradingSize, y);
    let upperUv = vec2<f32>(x + upperSlice / kGradingSize, y);

    let lowerSample = textureSample(grading, gradingSampler, lowerUv).rgb;
    let upperSample = textureSample(grading, gradingSampler, upperUv).rgb;
    return mix(lowerSample, upperSample, sliceBlend);
}

@fragment
fn main(input: FSInput) -> @location(0) vec4<f32> {
    let uv = input.pos.xy * compositeUniforms.inverseTargetSize;
    var color: vec4<f32> = textureSample(scene, sceneSampler, uv);
    if (compositeUniforms.bloomScale > 0.0) {
        let glow = clamp(textureSample(bloom, bloomSampler, uv).rgb * compositeUniforms.bloomScale, vec3<f32>(0.0), vec3<f32>(1.0));
        color = vec4<f32>(vec3<f32>(1.0) - (vec3<f32>(1.0) - color.rgb) * (vec3<f32>(1.0) - glow), color.a);
    }
    if (compositeUniforms.gradingStrength > 0.0) {
        color = vec4<f32>(mix(color.rgb, grade(color.rgb), compositeUniforms.gradingStrength), color.a);
    }
    return color;
}
`;

const skinned_lit_frag = `
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

struct SceneLighting {
    sceneLightDirection: vec4<f32>,
    sceneLightColor: vec4<f32>,
    diffuseCurve: vec4<f32>,
    rimParameters: vec4<f32>,
    specularParameters: vec4<f32>,
    sceneFogColor: vec4<f32>,
    sceneFogParameters: vec4<f32>,
    cameraPosition: vec4<f32>,
}

const MaxDynamicLights: u32 = 32u;
struct DynamicLights {
    dynamicLightCount: u32,
    dynamicLightWrap: f32,
    dynamicLightPadding: vec2<u32>,
    dynamicLightPositionAndRadius: array<vec4<f32>, 32>,
    dynamicLightColor: array<vec4<f32>, 32>,
}

@group(2) @binding(0) var tex: texture_2d<f32>;
@group(2) @binding(1) var s: sampler;
@group(3) @binding(0) var<uniform> fogUniforms: FogUniforms;
@group(3) @binding(1) var<uniform> sceneLighting: SceneLighting;
@group(3) @binding(2) var<uniform> dynamicLights: DynamicLights;

struct FSInput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) fogFactor: f32,
    @location(3) eyeDepth: f32,
    @location(4) normal: vec3<f32>,
    @location(5) viewVector: vec3<f32>,
    @location(6) @interpolate(flat) lightDirectionAndSpecular: vec4<f32>,
    @location(7) worldPositionAndDynamicLights: vec4<f32>,
    @location(8) worldNormal: vec3<f32>,
}

fn rollsOffHighlight(knee: f32) -> bool {
    return knee > 0.0 && knee < 1.0;
}

fn rollOffChannel(value: f32, knee: f32) -> f32 {
    let range = 1.0 - knee;
    return select(value, knee + range * (1.0 - exp(-max(value - knee, 0.0) / range)), value > knee);
}

fn rollOffHighlight(color: vec3<f32>, knee: f32) -> vec3<f32> {
    return clamp(vec3<f32>(rollOffChannel(color.r, knee), rollOffChannel(color.g, knee), rollOffChannel(color.b, knee)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn safeNormalize(value: vec3<f32>) -> vec3<f32> {
    let lengthSquared = dot(value, value);
    return select(vec3<f32>(0.0), value * inverseSqrt(lengthSquared), lengthSquared > 1e-12);
}

fn enhancedFogAmount(eyeDepth: f32) -> f32 {
    let scaledDistance = max(eyeDepth - sceneLighting.sceneFogParameters.x, 0.0) * sceneLighting.sceneFogParameters.z;
    return clamp(1.0 - exp(-(scaledDistance * scaledDistance)), 0.0, 1.0);
}

fn dynamicLighting(worldPosition: vec3<f32>, worldNormal: vec3<f32>) -> vec3<f32> {
    var light = vec3<f32>(0.0);
    let count = min(dynamicLights.dynamicLightCount, MaxDynamicLights);
    for (var i: u32 = 0u; i < count; i = i + 1u) {
        let positionAndRadius = dynamicLights.dynamicLightPositionAndRadius[i];
        let toLight = positionAndRadius.xyz - worldPosition;
        let radius = positionAndRadius.w;
        let horizontalDistance = length(toLight.xy);
        if (horizontalDistance >= radius) {
            continue;
        }
        let falloff = (radius - horizontalDistance) / radius;
        let wrapped = clamp(dot(worldNormal, safeNormalize(toLight)) * (1.0 - dynamicLights.dynamicLightWrap) + dynamicLights.dynamicLightWrap, 0.0, 1.0);
        light += dynamicLights.dynamicLightColor[i].rgb * (falloff * wrapped);
    }
    return light;
}

@fragment
fn main(input: FSInput) -> @location(0) vec4<f32> {
    let objectLight = input.color.rgb;
    let normal = safeNormalize(input.normal);
    let view = safeNormalize(input.viewVector);
    let light = input.lightDirectionAndSpecular.xyz;
    let lightDot = dot(input.normal, light);

    let luminosity = max(lightDot * sceneLighting.diffuseCurve.x + sceneLighting.diffuseCurve.y, sceneLighting.diffuseCurve.z);
    let dynamicLight = select(vec3<f32>(0.0), dynamicLighting(input.worldPositionAndDynamicLights.xyz, safeNormalize(input.worldNormal)), input.worldPositionAndDynamicLights.w > 0.5);
    var diffuse = clamp(objectLight * luminosity + dynamicLight, vec3<f32>(0.0), vec3<f32>(1.0));
    if (rollsOffHighlight(sceneLighting.diffuseCurve.w)) {
        diffuse = rollOffHighlight(objectLight * luminosity + dynamicLight, sceneLighting.diffuseCurve.w);
    }

    let facing = clamp(abs(dot(normal, view)), 0.0, 1.0);
    let rim = sceneLighting.rimParameters.x * pow(1.0 - facing, sceneLighting.rimParameters.y) * objectLight;

    let specularStrength = input.lightDirectionAndSpecular.w * sceneLighting.specularParameters.x;
    var specular = vec3<f32>(0.0);
    if (specularStrength > 0.0 && lightDot > 0.0) {
        let halfVector = safeNormalize(safeNormalize(light) + view);
        let highlight = pow(clamp(dot(normal, halfVector), 0.0, 1.0), sceneLighting.specularParameters.y);
        specular = specularStrength * highlight * sceneLighting.sceneLightColor.rgb * objectLight;
    }

    let texel = textureSample(tex, s, input.uv);
    var color = vec4<f32>(texel.rgb * diffuse + rim + specular, texel.a * input.color.a);
    if (fogUniforms.alphaToCoverage != 0u) {
        let edge = clamp((color.a - fogUniforms.alphaThreshold) / max(fwidth(color.a), 0.0001) + 0.5, 0.0, 1.0);
        color.a *= edge;
        if (color.a <= 0.0) {
            discard;
        }
    } else if (fogUniforms.alphaDiscardEnabled != 0u && color.a <= fogUniforms.alphaThreshold) {
        discard;
    }
    if (fogUniforms.fogEnabled != 0u && sceneLighting.sceneFogColor.w > 0.0) {
        color = vec4<f32>(mix(color.rgb, sceneLighting.sceneFogColor.rgb, enhancedFogAmount(input.eyeDepth)), color.a);
    }
    return color;
}
`;

const shaders = {
  'basic_textured.frag.wgsl': basic_textured_frag,
  'basic_textured_fog.frag.wgsl': basic_textured_fog_frag,
  'post_bloom_down.frag.wgsl': post_bloom_down_frag,
  'post_bloom_up.frag.wgsl': post_bloom_up_frag,
  'post_composite.frag.wgsl': post_composite_frag,
  'skinned_lit.frag.wgsl': skinned_lit_frag,
};

// 2. Automated translation for the remaining shaders:
const autoShaders = [
  'basic_colored.frag',
  'basic_colored.vert',
  'basic_textured.vert',
  'post_fullscreen.vert',
  'shadow_volume.vert',
  'skinned_shadow.vert',
  'skinned_textured.vert',
];

for (const name of autoShaders) {
  const spvFile = path.join(spvDir, name + '.spv');
  const buf = fs.readFileSync(spvFile);
  let wgsl = naga.translate({ from: 'spirv', source: new Uint8Array(buf), to: 'wgsl' });
  
  // Remove Naga's automatic Y inversion since game code & projection matrices already handle coordinates:
  wgsl = wgsl.replace(/let\s+(\w+)\s*=\s*u0040_entryPointOutput_u002e_pos\.y;\s*u0040_entryPointOutput_u002e_pos\.y\s*=\s*-\(\1\);\s*/g, '');

  // Transform clip_distances array to scalar f32 to avoid WebGPU extension dependency:
  if (wgsl.includes('enable clip_distances;')) {
    wgsl = wgsl.replace('enable clip_distances;\n', '');
    wgsl = wgsl.replace('enable clip_distances;', '');
    // Change @builtin(clip_distances) member_X: array<f32, 1> -> @location(X) member_X: f32
    wgsl = wgsl.replace(/@builtin\(clip_distances\)\s*(\w+):\s*array<f32,\s*1>,/, '@location(15) $1: f32,');
    // Change return VertexOutput(..., _eX) -> return VertexOutput(..., _eX[0])
    wgsl = wgsl.replace(/return VertexOutput\(([\s\S]*?)\);/, (match, args) => {
      const parts = args.split(',').map(s => s.trim()).filter(Boolean);
      const last = parts[parts.length - 1];
      parts[parts.length - 1] = last + '[0]';
      return 'return VertexOutput(' + parts.join(', ') + ');';
    });
  }
  
  shaders[name + '.wgsl'] = wgsl;
}

// 3. Validate ALL 13 shaders with Naga:
console.log('=== Validating and Writing All 13 Shaders ===');
let successCount = 0;
for (const [filename, code] of Object.entries(shaders)) {
  try {
    const mod = naga.parseWgsl(code);
    naga.validate(mod);
    fs.writeFileSync(path.join(targetDir1, filename), code.trim() + '\n', 'utf8');
    fs.writeFileSync(path.join(targetDir2, filename), code.trim() + '\n', 'utf8');
    fs.writeFileSync(path.join(targetDir3, filename), code.trim() + '\n', 'utf8');
    console.log('[OK]', filename);
    successCount++;
  } catch (err) {
    console.error('[FAIL]', filename, err.formatted || err.message || err);
  }
}

console.log(`Finished: ${successCount} / ${Object.keys(shaders).length} shaders generated & validated successfully.`);
