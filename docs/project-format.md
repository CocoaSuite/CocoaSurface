# CocoaSurface project (`.cocoasurf`), version 1

A ZIP. The first entry is `mimetype`, stored, holding `application/vnd.cocoasuite.surface+zip`.

| Entry | What |
|---|---|
| `project.json` | `Project` (`packages/project/src/model.ts`): name, model reference, texture sets with their layer stacks, library, export settings. |
| `model/<file>` | The imported model, unchanged. |
| `materials/<id>.cocoamat` | Library materials, unchanged. |
| `pixels/<layer>/<channel>.png` | Painted pixels, RGBA, premultiplied, row 0 at v = 0. `mask.png` is a layer's mask (grey, white shows). |

Readers refuse a newer `version`, broken layers, duplicate layer ids, and missing model or material entries. Unknown `extensions` are kept.

## Texture set as `.cocoamat`

Standard `.cocoamat` 1.0 (see CocoaWorlds' `docs/cocoamat-format.md`): one Image node per map wired to its output node, `normalGreen: "down"`. `extensions.cocoasurface` holds the texture set (its layer stack), and `cocoasurface/…` entries hold its painted pixels and the materials its fills use. CocoaWorlds ignores both.
