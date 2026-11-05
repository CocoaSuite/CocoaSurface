# Status

## Done (phases 1–3, part of 4, baking, effects, brush tools)

See the README. Baking: normal (from a high-poly model), world normal, position, ambient occlusion, curvature, thickness and ID, on the GPU, with progress and Stop; baked maps drive the normal and occlusion channels and generated masks. Bevel shader, low/high name matching, automatic per-mesh cages, painted skew and offset, anti-aliasing. Tested: unit tests for the project file, layer operations, the Cocoa Materials copy (catalog identical to CocoaWorlds'; every CocoaWorlds sample read, changed, written and read back with unknown fields kept); a browser workflow test that paints, fills with a `.cocoamat`, undoes, saves, reopens and checks the pixels match, and checks the exported `.cocoamat` files with the CocoaWorlds reader; a baking test that bakes from a bumpy high-poly model, checks the normal and curvature maps carry the bumps, masks a fill by curvature, and reopens the project with its maps; an effects test that inverts, levels, paints and blurs a fill layer through effects, saves and reopens it, masks and multiplies a group, and checks the fill, blur and smudge tools, a square tip and a stencil.

## Interface

Laid out like Substance Painter: menu bar, tool options bar, toolbar on the left (paint, erase, polygon fill, smudge, blur, color picker), viewport in the middle. Panels (Assets, Texture Set List, Texture Set Settings, Display Settings, Layers, Properties) dock: drag a tab onto another panel's tabs to join it, onto its top or bottom to split, or onto an empty edge to start a dock there; splitters resize; Window shows, hides and resets them. The layout is kept in localStorage (`ui/Dock.tsx`). Default: Assets on the left; texture sets, Layers and Properties stacked on the right. Layer rows carry visibility, thumbnail, mask thumbnail, blend and opacity, for the whole layer or for the channel picked above the list (a channel's own setting overrides the layer's, `channelBlend`); right-click for masks and effects. Assets drag from the shelf onto layers, the stack or the viewport. Camera is Alt + left/middle/right drag; Ctrl + right drag sets size and hardness, Ctrl + left drag flow and angle; Shift + click paints a straight line; S + left/middle/right drag turns, moves and scales the stencil.

## Not yet

- Projection and clone tools, 2D view.

- Opening an exported texture-set `.cocoamat` back into a layer stack (the data is written; the import isn't).
- Brush tip and stencil pictures are kept for the session, not in the project. Tip spacing jitter, scatter and angle following the stroke.
- Graph editor (materials are edited through their exposed parameters only), procedural generators and smart masks beyond `.cocoamat` graphs.
- Baking: cage meshes from a file, bent normals, 16-bit mesh map export.
- 2D texture view, UV overlap warnings, multiple UV sets (the first UV set is used).
- Effects on groups (groups take masks, not effects).
- EXR, TIFF, TGA and 16-bit export; export presets.
- Live link with CocoaWorlds; tested against the CocoaWorlds reader code, not yet inside the running CocoaWorlds editor.
- Installers and updates.

## Limits

- Painting a 4096 set means 4096² passes per channel per frame; it needs a real GPU.
- Normals can't be painted directly; painted height becomes normal detail. Filters (levels, invert, hue) skip the normal channel; blur doesn't.
- Blur (effect and tool) and smudge work in UV space, so they can reach across UV seams.
- Skinned models are textured in their bind pose; morph targets are ignored.
