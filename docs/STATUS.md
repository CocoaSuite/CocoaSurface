# Status

## Done (phases 1–3, part of 4, baking)

See the README. Baking: normal (from a high-poly model), world normal, position, ambient occlusion, curvature, thickness and ID, on the GPU, with progress and Stop; baked maps drive the normal and occlusion channels and generated masks. Bevel shader, low/high name matching, automatic per-mesh cages, painted skew and offset, anti-aliasing. Tested: unit tests for the project file, layer operations, the Cocoa Materials copy (catalog identical to CocoaWorlds'; every CocoaWorlds sample read, changed, written and read back with unknown fields kept); a browser workflow test that paints, fills with a `.cocoamat`, undoes, saves, reopens and checks the pixels match, and checks the exported `.cocoamat` files with the CocoaWorlds reader; a baking test that bakes from a bumpy high-poly model, checks the normal and curvature maps carry the bumps, masks a fill by curvature, and reopens the project with its maps.

## Not yet

- Opening an exported texture-set `.cocoamat` back into a layer stack (the data is written; the import isn't).
- Brush alphas, stencils, smudge, blur, fill tool, pressure, stabiliser.
- Graph editor (materials are edited through their exposed parameters only), procedural generators and smart masks beyond `.cocoamat` graphs.
- Baking: cage meshes from a file, bent normals, 16-bit mesh map export.
- 2D texture view, UV overlap warnings, multiple UV sets (the first UV set is used).
- Group masks and group blend modes (groups pass their layers through).
- EXR, TIFF, TGA and 16-bit export; export presets.
- Live link with CocoaWorlds; tested against the CocoaWorlds reader code, not yet inside the running CocoaWorlds editor.
- Installers and updates.

## Limits

- Painting a 4096 set means 4096² passes per channel per frame; it needs a real GPU.
- Normals can't be painted directly; painted height becomes normal detail.
- Skinned models are textured in their bind pose; morph targets are ignored.
