const fs = require('fs');

const path = 'C:/Users/Poisson/Documents/MuMain/src/source/Render/Renderer/MuRendererSDLGpu.cpp';
let content = fs.readFileSync(path, 'utf8');

// 1. Include XDL_wgpu.h
if (!content.includes('XDL_wgpu.h')) {
  content = content.replace(
    '#include <SDL3/SDL_gpu.h>',
    '#include <SDL3/SDL_gpu.h>\r\n#ifdef __EMSCRIPTEN__\r\n#include <XDL_wgpu.h>\r\n#endif'
  );
}

// 2. Ext for webgpu
if (!content.includes('ext = "wgsl"')) {
  content = content.replace(
    '    else if (driver && std::string(driver) == "metal")\r\n    {\r\n        ext = "msl";\r\n    }',
    '    else if (driver && std::string(driver) == "metal")\r\n    {\r\n        ext = "msl";\r\n    }\r\n#ifdef __EMSCRIPTEN__\r\n    else if (driver && std::string(driver) == "webgpu")\r\n    {\r\n        ext = "wgsl";\r\n    }\r\n#endif'
  );
}

// 3. Format for webgpu
if (!content.includes('return SDL_GPU_SHADERFORMAT_WGSL')) {
  content = content.replace(
    '    if (driver && std::string(driver) == "metal")\r\n    {\r\n        return SDL_GPU_SHADERFORMAT_MSL;\r\n    }',
    '    if (driver && std::string(driver) == "metal")\r\n    {\r\n        return SDL_GPU_SHADERFORMAT_MSL;\r\n    }\r\n#ifdef __EMSCRIPTEN__\r\n    if (driver && std::string(driver) == "webgpu")\r\n    {\r\n        return SDL_GPU_SHADERFORMAT_WGSL;\r\n    }\r\n#endif'
  );
}

// 4. Init formats
if (!content.includes('shaderFormats |= SDL_GPU_SHADERFORMAT_WGSL')) {
  const oldInit = `        s_device =
            SDL_CreateGPUDevice(SDL_GPU_SHADERFORMAT_SPIRV | SDL_GPU_SHADERFORMAT_DXIL | SDL_GPU_SHADERFORMAT_MSL,
                                Render::kGpuValidationEnabled, requestedDriverName);

        if (!s_device && requestedDriverName != nullptr)
        {
            mu::log::Get("render")->warn("SDL_gpu -- '{}' device creation failed ({}), falling back to "
                                         "SDL's own auto-picked driver", requestedDriverName, SDL_GetError());
            s_device = SDL_CreateGPUDevice(
                SDL_GPU_SHADERFORMAT_SPIRV | SDL_GPU_SHADERFORMAT_DXIL | SDL_GPU_SHADERFORMAT_MSL,
                Render::kGpuValidationEnabled, nullptr);
        }`;

  const newInit = `        SDL_GPUShaderFormat shaderFormats =
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

  content = content.replace(oldInit, newInit);
}

fs.writeFileSync(path, content, 'utf8');
console.log('MuRendererSDLGpu.cpp patched successfully!');
