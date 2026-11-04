# CocoaSurface project (`.cocoasurf`), version 1

A ZIP. The first entry is `mimetype`, stored, holding `application/vnd.cocoasuite.surface+zip`.

| Entry | What |
|---|---|
| `project.json` | `Project` (`packages/project/src/model.ts`): name, model reference, texture sets with their layer stacks, library, export settings. |
| `model/<file>` | The imported model, unchanged. |
| `highpoly/<file>` | The high-poly model baked from, unchanged (if any). |
| `baked/<set>/<map>.png` | Baked mesh maps, RGBA, row 0 at v = 0. |
| `materials/<id>.cocoamat` | Library materials, unchanged. |
| `pixels/<layer>/<channel>.png` | Painted pixels, RGBA, premultiplied, row 0 at v = 0. A mask's paint effect stores `pixels/<effect>/grey.png` (premultiplied grey); a layer's paint effect stores `pixels/<effect>/<channel>.png`. |
| `masks/<id>.<ext>` | Pictures used by image effects. |

Readers refuse a newer `version`, broken layers, duplicate layer ids, and missing model or material entries. Unknown `extensions` are kept.

## Texture set as `.cocoamat`

Standard `.cocoamat` 1.0 (see CocoaWorlds' `docs/cocoamat-format.md`): one Image node per map wired to its output node, `normalGreen: "down"`. `extensions.cocoasurface` holds the texture set (its layer stack), and `cocoasurface/…` entries hold its painted pixels and the materials its fills use. CocoaWorlds ignores both.

Layers may have `effects` (top first); files without it read as having none. Version 1 files from before mask stacks (`mask: true`, a layer `generator`) are converted when read.
