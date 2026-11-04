# CocoaSurface

3D texture painting and material authoring, part of the Cocoa software family. CocoaSurface works on its own, and reads and writes CocoaWorlds' `.cocoamat` materials natively.

## What works today

- Desktop app (Electron) with the Cocoa design language; also runs in a browser for development (`npm run web -w @cocoasurface/app`).
- Import FBX, OBJ, glTF (.glb), USDZ. One texture set per material slot, warnings for meshes without UVs.
- Projected 3D painting on the GPU, written into the UV textures: size, flow, opacity, hardness, spacing, erase, mirror X, occlusion-aware (you can't paint through the model), seam padding. Round, square or picture tips with an angle, stencils, pen pressure (size, flow or both), a stabiliser, and fill, smudge and blur tools (the fill tool fills a UV island or a whole mesh).
- Layer stack per texture set: paint layers, fill layers, groups, blend modes, opacity, per-layer channels, visibility and lock, drag to reorder, duplicate.
- Effects on paint and fill layers and in masks: paint, fill, generator, image, levels, blur, invert, and hue and saturation on layers, each with blend and opacity. A Paint effect draws on a fill layer.
- Black or white masks on layers and groups, with their own effects. Groups pass through by default; any other blend mode blends the group as one.
- Channels: base colour, roughness, metal, normal, height (turned into normal detail), occlusion, glow, opacity. Each channel can be viewed on its own.
- `.cocoamat` materials in fill layers: the graph is evaluated on the GPU with CocoaWorlds' own node code, and every exposed parameter is editable live. Unknown node kinds are reported.
- Baking on the GPU: normal from a high-poly model, world normal, position, ambient occlusion, curvature, thickness, ID. Baked maps become the base of the normal and occlusion channels and drive generated masks (edges, cavities, thin parts, height, facing up), each with noise to break up the edge (edge wear). A bevel shader rounds hard edges in every baked map; low and high meshes pair up by name, cages are measured per mesh, and skew and offset can be painted to fix spots. The cage can be shown in the viewport.
- Undo and redo for every edit and stroke, autosave to a recovery copy, unsaved-changes guard.
- Projects (`.cocoasurf`) keep everything editable: model, materials, layers, painted pixels.
- Export: PNG maps per texture set (naming pattern, size, normal green up/down, packed ORM); a texture set as a `.cocoamat` (opens in CocoaWorlds); a fill's material with its parameter values as a `.cocoamat`.

See [docs/STATUS.md](docs/STATUS.md) for what's planned and the current limits.

## Setup

Node 22 or newer.

```sh
npm install
npm run build      # main process and renderer
npm start          # launch the desktop app
npm run dev        # renderer with hot reload inside Electron
npm test           # unit tests (formats, layers, Cocoa Materials sync)
npm run test:e2e -w @cocoasurface/app   # browser workflow test; set CHROMIUM to a Chromium binary
```

## Layout

| Path | What |
|---|---|
| `apps/app` | The desktop application: main process, preload, renderer (React + three.js). |
| `packages/project` | Project model, layer operations, `.cocoasurf` file, texture set → `.cocoamat`. No UI. |
| `packages/materials` | Cocoa Materials, copied from CocoaWorlds (`npm run sync-materials -- <path to CocoaWorlds>`). |
| `packages/ui` | Cocoa components and tokens. |
| `docs` | Architecture, formats, status. |

## Controls

Left drag paints. Right drag or Alt + left drag orbits, Shift + right drag turns the light, middle drag pans, the wheel zooms. `[` and `]` change the brush size. S + left drag moves the stencil, S + wheel scales it.
