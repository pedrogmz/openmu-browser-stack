const fs = require('fs');
const path = 'C:/Users/Poisson/Documents/MuMain/src/source/Render/Renderer/MuRendererSDLGpu.cpp';
let content = fs.readFileSync(path, 'utf8');

const target = `        s_device =
            SDL_CreateGPUDevice(SDL_GPU_SHADERFORMAT_SPIRV | SDL_GPU_SHADERFORMAT_DXIL | SDL_GPU_SHADERFORMAT_MSL
#ifdef __EMSCRIPTEN__
                                    | SDL_GPU_SHADERFORMAT_WGSL
#endif,
                                Render::kGpuValidationEnabled, requestedDriverName);

        if (!s_device && requestedDriverName != nullptr)
        {
            mu::log::Get("render")->warn("SDL_gpu -- '{}' device creation failed ({}), falling back to "
                                         "SDL's own auto-picked driver", requestedDriverName, SDL_GetError());
            s_device = SDL_CreateGPUDevice(
                SDL_GPU_SHADERFORMAT_SPIRV | SDL_GPU_SHADERFORMAT_DXIL | SDL_GPU_SHADERFORMAT_MSL
#ifdef __EMSCRIPTEN__
                | SDL_GPU_SHADERFORMAT_WGSL
#endif,
                Render::kGpuValidationEnabled, nullptr);
        }`;

const replacement = `        SDL_GPUShaderFormat shaderFormats =
            SDL_GPU_SHADERFORMAT_SPIRV | SDL_GPU_SHADERFORMAT_DXIL | SDL_GPU_SHADERFORMAT_MSL;
#ifdef __EMSCRIPTEN__
        shaderFormats |= SDL_GPU_SHADERFORMAT_WGSL;
#endif
        s_device =
            SDL_CreateGPUDevice(shaderFormats, Render::kGpuValidationEnabled, requestedDriverName);

        if (!s_device && requestedDriverName != nullptr)
        {
            mu::log::Get("render")->warn("SDL_gpu -- '{}' device creation failed ({}), falling back to "
                                         "SDL's own auto-picked driver", requestedDriverName, SDL_GetError());
            s_device = SDL_CreateGPUDevice(shaderFormats, Render::kGpuValidationEnabled, nullptr);
        }`;

const normalizedContent = content.replace(/\r\n/g, '\n');
const normalizedTarget = target.replace(/\r\n/g, '\n');
const normalizedReplacement = replacement.replace(/\r\n/g, '\r\n');

if (normalizedContent.includes(normalizedTarget)) {
  const newContent = normalizedContent.replace(normalizedTarget, normalizedReplacement).replace(/\n/g, '\r\n');
  fs.writeFileSync(path, newContent, 'utf8');
  console.log('Successfully replaced!');
} else {
  console.error('Target not found!');
}
