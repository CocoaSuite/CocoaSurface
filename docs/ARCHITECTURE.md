# Architecture

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Electron + React + three.js (WebGL 2) + TypeScript, same as CocoaWorlds. | `.cocoamat` nodes are WebGL 2 GLSL; evaluating them with the same code gives the same maps as CocoaWorlds. UI components and tokens are shared. |
| D2 | Cocoa Materials is a vendored copy of CocoaWorlds' `packages/materials`, checked by a test. | CocoaSurface stays standalone. `packages/materials/test/sync.test.ts` fails if the node catalog differs from the one CocoaWorlds publishes; `tools/sync-materials.mjs` refreshes the copy. |
| D3 | Layers first. A fill layer can use a `.cocoamat` with its own parameter values. A texture set exports as a `.cocoamat` of Image nodes, with the layer stack in `extensions.cocoasurface`. | Familiar to texture artists; graphs stay intact and editable. |
| D4 | GPU projection painting into UV space. | Real 3D painting: the brush is projected from the screen, tested against a distance pass so it can't reach hidden surfaces, and written into the texture with seam padding. |

## Renderer

- `engine/model.ts` loads models, bakes transforms into geometry, removes skinning (texturing works in the bind pose), and records whether texture v points up the picture (OBJ, FBX, USD) or down it (glTF).
- `engine/gpu.ts`: `Passes` holds the shared shaders. `SetGPU` holds one texture set: painted pixels per layer and channel (RGBA8, premultiplied), the stroke buffer, the UV island mask and the finished maps.
  - **Stroke**: dabs from the pointer are batched per frame. The model is drawn in UV space; each texel projects its surface point to the screen, compares its distance with the distance pass, and adds brush coverage (`1 - Π(1 - aᵢ)`). The stroke is merged into a copy of the layer each frame (`min(coverage, opacity)`), shown live, and swapped in at the end. The replaced target becomes the undo entry, so strokes cost no copies.
  - **Compositing**: per channel, bottom to top, one pass per layer: source (flat value, painted pixels, or material map tiled by Repeat), mask, opacity and blend mode. Normals are mixed and renormalised. A final pass copies grey to RGB, adds height bumps to the normal, and spreads colour 8 texels past UV edges.
- `engine/bake.ts` bakes mesh maps on the GPU with ray casting through a BVH (three-mesh-bvh) in the fragment shader. The low-poly set is drawn in UV space; each texel casts from `P + N·front` along `-N` to find the surface (the high-poly model, or the mesh itself), within `front + rear`.
  - Normal: the high-poly normal in the same cotangent frame the viewer builds from the texture coordinates, so the bake shades the same in the viewport.
  - World normal, position (bounding box 0–1), ID (colour per material slot or mesh of the surface hit).
  - Occlusion and thickness: cosine rays over the hemisphere (inward for thickness), 8 rays per pass, added up in a half-float target.
  - Curvature: from the world normal and position maps (float targets), `dN·dP / |dP|²` in both texture directions, mapped with `tanh`.
  - Work is drawn in 256 px tiles, waiting for each, so the screen stays responsive and the graphics card isn't reset by a long draw; it reports progress and can be stopped. Results are padded 16 texels past UV edges.
  - Baked maps feed the stack: the baked normal is the base of the normal channel (layers add detail on top), baked occlusion multiplies the occlusion channel (and shades the viewport even without it), and layers can take a generated mask from curvature, occlusion, thickness, height or up-facing.
- `engine/library.ts` evaluates `.cocoamat` graphs in their own WebGL context with `GraphEvaluator`. Fill layers use up to 1024 px maps, re-evaluated a moment after their values change.
- `engine/viewport.ts`: scene, cameras (perspective and orthographic), room lighting, input and brush cursor. Colour and glow maps are decoded from sRGB in the shader; other maps are data.
- `store.ts`: Zustand store; the project is immutable data, and every change is an undo entry (`edit`, or `live` + `commit` for drags).
- `io.ts`: new, open, save, recovery, import, export.

## Orientation and conventions

Internally, texture row 0 is v = 0 and normals point green along +v. Exported images are flipped to the standard orientation (row 0 at the top), and green is adjusted to the requested convention. Graph maps (row 0 at the top, green down) are sampled at `(u, -v)` on v-up models, with green flipped.

## Main process

`src/main/main.ts` owns file access: it only reads and writes paths a dialog returned, recent projects and its recovery file, and only writes into folders a dialog returned.
