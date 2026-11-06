# Status

## Done (phases 1–3, part of 4, baking, effects, brush tools)

See the README. Baking: normal (from a high-poly model), world normal, position, ambient occlusion, curvature, thickness and ID, on the GPU, with progress and Stop; baked maps drive the normal and occlusion channels and generated masks. Bevel shader, low/high name matching, automatic per-mesh cages, painted skew and offset, anti-aliasing. Mesh curvature has an Edge angle: corners gentler than it (the sides of a low-poly cylinder) bake smooth. Tested: unit tests for the project file, layer operations, the Cocoa Materials copy (catalog identical to CocoaWorlds'; every CocoaWorlds sample read, changed, written and read back with unknown fields kept); a browser workflow test that paints, fills with a `.cocoamat`, undoes, saves, reopens and checks the pixels match, and checks the exported `.cocoamat` files with the CocoaWorlds reader; a baking test that bakes from a bumpy high-poly model, checks the normal and curvature maps carry the bumps, masks a fill by curvature, and reopens the project with its maps; an effects test that inverts, levels, paints and blurs a fill layer through effects, saves and reopens it, masks and multiplies a group, and checks the fill, blur and smudge tools, a square tip and a stencil. Normal maps are baked in MikkTSpace, the tangent frame Blender, Unreal and Unity read them in.

## Interface

Laid out like Substance Painter: menu bar, tool options bar, toolbar on the left (paint, erase, polygon fill, smudge, blur, color picker), viewport in the middle. Panels (Assets, Texture Set List, Texture Set Settings, Display Settings, Layers, Properties) dock: drag a tab onto another panel's tabs to join it, onto its top or bottom to split, or onto an empty edge to start a dock there; splitters resize; Window shows, hides and resets them. The layout is kept in localStorage (`ui/Dock.tsx`). Default: Assets on the left; texture sets, Layers and Properties stacked on the right. Layer rows carry visibility, thumbnail, mask thumbnail, blend and opacity, for the whole layer or for the channel picked above the list (a channel's own setting overrides the layer's, `channelBlend`); right-click for masks and effects. Assets drag from the shelf onto layers, the stack or the viewport. Camera is Alt + left/middle/right drag; Ctrl + right drag sets size and hardness, Ctrl + left drag flow and angle; Shift + click paints a straight line; S + left/middle/right drag turns, moves and scales the stencil.

## Assets, procedurals, export

- Imported alphas, textures and materials are stored in the project (`assets/`, `materials/`, listed in `project.assets` and `project.library`) and in a personal library in IndexedDB (`assets.ts`) that every project sees; a library item is copied into the project when used. Right-click an imported item in Assets to add it to or remove it from the library.
- Procedural effect (masks and layers): a library noise or pattern with scale, seed, contrast, balance and invert, drawn on the GPU (`proc:` refs in `engine.procTexture`); on layers it goes from a dark to a light color in the color channel. Smart masks include presets (edge wear, chipped edges, dirt, dust, ground grime, thin parts).
- Groups take effects: they run on what the group's layers make.
- Export presets (CocoaWorlds, glTF / Blender, Unreal, Unity URP, Godot), packing (separate, ORM, Unity metal-smoothness) and per-map ticks (`export.skip`).

## Baking interface

Bake mesh maps sits at the right end of the tool options bar. Occlusion, thickness and light rays follow a low-discrepancy (R2) sequence shifted per texel, and a denoise pass (on by default) averages nearby texels of the same surface (weighted by position and normal) before encoding. The viewport's display list has Mask when the selected layer has one.


The Bake panel sits over the left dock (not modal), so the viewport and cage stay in view; closing it turns the cage display off. While baking, the viewport shows each map as it's made (`shown` callback from `bakeSet`; ray maps refine pass by pass), then goes back to the view it had.

## Viewport lights

Display Settings > Lights adds preview lights (sun, point, spot) with color, strength, turn and height around the model, distance, cone and shadows (`view.lights`, `Viewport.showViewLights`). They are display settings like the environment: not saved in the project and not baked.

## 2D view

The 3D/2D switch in the viewport (and Viewport > 2D view) shows the current texture set laid out flat, with its UV wires, in whatever the Show list picks (Material shows color). Pan with middle drag or Alt + left, zoom with the wheel or Alt + right; Fit to screen resets it. Brushes, erase, smudge, blur, fill and the picker work there too: the dab shader takes `u_flat` and projects the texel's UV instead of its surface point, with no depth or facing test (`flatScene`, `flatCam`, `flatNav` in `viewport.ts`). Symmetry is off in 2D; placing bake lights switches back to 3D.

## Bake lights and occlusion casters

- The Bake dialog lists the meshes occlusion is cast against (the high-poly's when baking from it); untick one and it no longer darkens anything (`aoExclude`, a separate BVH in `baking.ts`). Bake lights use the same set.
- Bake lights (`project.bakeLights`: position in model space, size, strength) are placed from the Bake dialog: the viewport shows the model in grey with shadowed point lights and a draggable handle per light (`Viewport.showLights`, `ui/LightPanel.tsx`), and "Back to baking" reopens the dialog with its settings. They bake into the Light map (mode 9: soft-shadowed visibility times N·L, summed over lights) and can brighten occlusion (`lightMix`: `1 - (1 - ao)(1 - mix·light)`). "Lit by bake lights" is a smart mask source.

## Not yet

- Projection and clone tools.

- Opening an exported texture-set `.cocoamat` back into a layer stack (the data is written; the import isn't).
- Tip spacing jitter, scatter and angle following the stroke.
- Graph editor (materials are edited through their exposed parameters only).
- Baking: cage meshes from a file, bent normals, 16-bit mesh map export.
- UV overlap warnings, split 3D/2D view, multiple UV sets (the first UV set is used).
- EXR, TIFF, TGA and 16-bit export.
- Live link with CocoaWorlds; tested against the CocoaWorlds reader code, not yet inside the running CocoaWorlds editor.
- Installers and updates.

## Limits

- Painting a 4096 set means 4096² passes per channel per frame; it needs a real GPU.
- Normals can't be painted directly; painted height becomes normal detail. Filters (levels, invert, hue) skip the normal channel; blur doesn't.
- Blur (effect and tool) and smudge work in UV space, so they can reach across UV seams.
- Skinned models are textured in their bind pose; morph targets are ignored.
