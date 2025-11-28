# threejs-perftest

An open-source library for material trait/lookdev testing and performance evaluation with Three.js. This project demonstrates LOD switching, modern texture formats (KTX2/BasisU and WebP), environment lighting, and mesh optimizations suitable for realtime and web delivery.

## Overview
- Focus: Evaluate material behaviors, maps, and shading traits across LODs while measuring performance.
- Rendering: Three.js, `MeshPhysicalMaterial`, PMREM-processed HDR environment lighting.
- Assets: Multiple LODs, KTX2 and WebP textures, optimized glTF 2.0 files.
- Tooling: Vite for dev server, glTF-Transform for model optimization, `toktx` for texture optimization.

![Keep biting](public/img/keep-biting-gif.gif)

The introduction image is an Arnold displacement map demonstration converted into static geometry. See “Arnold Displacement Reference” for geometry conversion context.

## Setup
- Requirements: Node.js 18+ recommended.
- Install: `npm install`
- Run dev: `npm run dev`
- Preview build: `npm run preview`

Dependencies from `package.json`:
- `three` ^0.177.0
- `dat.gui` ^0.7.9
- `vite` ^6.3.5
- Dev: `gltfpack` ^0.24.0 (optional, used in some pipelines)

## Usage
- Start the app and use the GUI to switch LODs, toggle maps, tweak physical properties, and manage shadows/environment.
- Programmatic LOD switch: `window.changeLOD('lod2')` (`src/main.js:679`).

## Material Assignment Issue (LOD2)
- LOD2 contains incorrect textures; the basecolor was baked incorrectly. This level is included to illustrate the workflow and process breakdown, not as a correctness reference. Inspect texture bindings at `public/lod2/Untitled.gltf:180–192`.

## Texture Optimization
- All original textures (especially PNGs) are preserved under `public/lod*/`.
- Optimized textures are produced with KTX v2 using `toktx`. Reference: https://github.com/KhronosGroup/KTX-Software
 - PNG→WebP conversions were created using Sharp (libvips). Reference: https://sharp.pixelplumbing.com/

## Texture Baking Process
- For testing and target look evaluation, per-LOD baking in Substance Painter was explored using specific low-poly versions.
- This section documents the approach for analysis purposes; it is not prescriptive for all pipelines.
- The intent is to surface how per-LOD bakes affect UV consistency and perceived quality across detail levels.

## Optimization Pipeline (LOD2)
- The folder `public/lod2/` contains all files demonstrating the pipeline from source PNGs to optimized delivery formats.
- Before/after comparisons (measured on disk):
  - Base Color: `lambert1_baseColor_1001.png` ≈ 17KB → `lambert1_baseColor_1001.ktx2` ≈ 1.8KB (≈ −89%).
  - AORM: `lambert1_occlusionRoughnessMetallic_1001.png` ≈ 3.7MB → `lambert1_occlusionRoughnessMetallic_1001.ktx2` ≈ 761KB (≈ −79%).
  - Normal: `lambert1_normal_1001.png` ≈ 8.4MB → `lambert1_normal_1001.webp` ≈ 1.3MB (≈ −85%).
  - Quality metrics:
    - Visual fidelity validated per-LOD in-app with `MeshPhysicalMaterial` under PMREM lighting.
    - File size reductions improve bandwidth and startup time without observable artifacts under target settings.

## 3D Model Implementation
- Geometry created in Maya using displacement baked to static geometry.
- Multiple LODs are included for testing: `public/lod1/`, `public/lod2/`, `public/lod3/`, `public/lod4/`. Each glTF contains quantized attributes and meshopt-compressed buffers.
- Materials authored in Substance Painter; exported maps are packed for AORM in KTX2 and normals in WebP.

## Arnold Displacement Reference
- The reference showcases an Arnold displacement map that was converted into static geometry.
- Process focus: Displacement was applied to a high-poly mesh, then baked into static geometry suitable for downstream optimization and LOD creation.
- The original high-poly geometry contained millions of polygons (e.g., the main mesh in the ~15M range or higher historically), serving as a stress case for downstream simplification.
- Geometry characteristics included significant depth and height variations created by displacement, with both deep recesses and high protruding details. These features expose where optimization can break (loss of microdetail, silhouette changes, UV distortion if not handled carefully).
- Web-friendly LODs were built starting from the LOD2 level for runtime evaluation; lower LODs continue reducing polygon density while maintaining key forms.
- The introduction GIF (`public/img/keep-biting-gif.gif`) illustrates the displacement-driven geometry that was later converted to static meshes and subsequently optimized.

## Triangle/Polygon Discussion
- The initial high-poly mesh contained millions of polygons due to displacement-driven detail (deep recesses, sharp protrusions, and height variations).
- Optimization produced LODs suitable for web delivery starting from LOD2, providing a practical balance of detail and performance.
- As polygon counts decrease across LODs, correlations with expensive material traits (e.g., clearcoat, transmission, sheen, specular) become visible in performance profiling. The asset is designed to surface these interactions for lookdev and optimization analysis.

## Environment Maps
- Environment maps are loaded from HDR files with PMREM (`src/main.js:453–495`). Available options in the GUI include `studio_small_01_1k.hdr`, `moonless_golf_1k.hdr`, `pond_bridge_night_1k.hdr`.
- Optimization tools referenced:
  - Gain map creator: https://gainmap-creator.monogrid.com/en/
  - `gainmap-js`: https://github.com/MONOGRID/gainmap-js
- For this project, environment map optimization was skipped because visual quality and performance were already sufficient.
- Source attribution: https://polyhaven.com/

## Quality Assurance
- Cross-reference against project files:
  - `public/lod2/` contains source PNGs and optimized KTX2/WebP counterparts.
  - Base color source: `public/lod2/lambert1_baseColor_1001.png`.
  - glTF texture assignments can be checked at `public/lod2/Untitled.gltf:180–192`.
  - Reference render: `public/img/keep-biting-gif.gif`.

## Model Optimization (glTF-Transform)
- All models/meshes are optimized using glTF-Transform (the files list "generator": "glTF-Transform" and use `EXT_meshopt_compression` and `KHR_mesh_quantization`). See `public/lod*/Untitled.gltf`.
- Common steps:
  - Quantize vertex attributes (positions/normals/tangents/UVs).
  - Meshopt compression for indices and attributes.
- Tools: https://gltf-transform.dev/

## Version Compatibility
- Tested with `three` 0.177.x, Vite 6.x, Node.js 18+.
- KTX2 textures require `KTX2Loader` with a configured transcoder path and GPU support.
- Meshopt-compressed glTF requires `MeshoptDecoder`.
- `KTX2Loader` needs the BasisU transcoder assets (`libs/basis/`) accessible at runtime.

## Contribution Guidelines
- Issues and PRs are welcome. Please include:
  - Clear description and reproduction steps.
  - Code references in the format `file_path:line_number` (e.g., `src/main.js:139`).
- Coding style: Prefer small, focused changes. Keep materials/data-driven. Avoid committing secrets.
- Additions should preserve original assets (PNGs/WebPs) and document optimization steps.
- For new features, include performance notes and LOD impact.

## Tools
- Geometry: Maya (displacement baked to static geometry).
- Materials & glTF export: Substance Painter.
- Environment maps: Poly Haven.
- Texture optimization: `toktx` from KTX-Software.
- Model optimization: glTF-Transform.
