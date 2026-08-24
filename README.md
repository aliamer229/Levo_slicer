# LEVO Studio

LEVO Studio is an Arabic-first, mobile-first browser workspace for preparing and slicing models with Bambu Lab X2D and H2D profiles. The editor, model parser, Orca-derived settings, WebAssembly slicer, G-code generation, and toolpath preview run locally in the browser through `three-slicer` 0.2.2. This application does not upload models or generated G-code to an application server.

## Editor workspace

- Import STL, OBJ, 3MF, AMF, PLY, STEP/STP, IGES/IGS, BREP, GLB/GLTF, FBX, DAE, 3DS, VRML/WRL, OFF, USDZ, KMZ, VTK/VTP, or MD2 files by picker or drag-and-drop.
- Open a ZIP archive locally, stream its entries, identify supported models, and shelf-pack the imported objects across as many as nine plates.
- Work without an application-defined file-size, batch-size, or project-count cap. Files never upload to the LEVO application server; practical capacity is still bounded by browser/device memory.
- Select, move, rotate, scale, duplicate, delete, split disconnected components, and place objects on the bed.
- Use multiple plates, switch the active plate, delete plates, and slice the current plate or every plate.
- Use undo/redo, copy/paste/cut, box selection, zoom-all, zoom-bed, object visibility, and per-object extruder selection.
- Paint support enforcers/blockers and manage filaments from the complete desktop sidebar.
- Save a `.3mf` project, export STL, preview real G-code by layer and feature, and download per-plate or combined output.
- Download the selected plate's actual `.gcode` or share it with the device share sheet after a successful slice.
- Work from the full desktop interface or a five-action phone bar with an expandable, touch-sized editing tray.

The quick setup sheet uses the Orca profile and process presets shipped by the engine:

- `Bambu Lab X2D 0.4 nozzle` (GM045), clamped to the published 256 × 256 × 260 mm primary-nozzle volume.
- `Bambu Lab H2D 0.4 nozzle` (GM033), using its bundled 350 × 320 × 325 mm profile.
- Real 0.12, 0.20, and 0.24 mm process presets, plus strength and automatic-support overrides.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Verification:

```bash
npm run lint
npx tsc --noEmit
npm test
```

## Print and export workflow

After a successful slice, the Print & Export sheet downloads the selected plate's actual G-code, shares it through the operating system when Web Share files are supported, saves the editable 3MF project, or exports all sliced plates. The recommended printer handoff is explicit:

1. Download the sliced G-code from LEVO.
2. On desktop, open or drag it into Bambu Connect or Bambu Studio.
3. Verify the target printer, build plate, nozzle, material/AMS mapping, and preview before starting.
4. From a phone, share or transfer the file to a Bambu Connect computer, or use a printer-supported USB/memory-card path.

See Bambu Lab's official [Bambu Connect guide](https://wiki.bambulab.com/en/software/bambu-connect) and [third-party integration notice](https://wiki.bambulab.com/en/software/third-party-integration).

## Honest compatibility boundary

The current web engine does not implement Bambu Studio's Auto Arrange, Auto Orient, Cut, Boolean, modifier/negative parts, seam painting, complete color/MMU painting, text/SVG emboss, Measure, or variable layer-height tools. Their native toolbar entries stay disabled and LEVO reports the limitation instead of simulating success.

LEVO supports real G-code export and an official Bambu Connect/Studio handoff, but direct browser-to-printer/cloud networking remains disabled. Bambu Lab's current authorization system restricts critical printer operations, including starting a print, to authorized software. Handy-style cloud printing therefore requires Bambu Lab partner approval, official integration documentation, and issued credentials; LEVO does not request a user's Bambu password or call undocumented private APIs. Raw G-code is also not a validated Bambu `.gcode.3mf` job, and a website cannot reliably know the absolute local path required by desktop handoff schemes. See [SLICER_CAPABILITIES.md](SLICER_CAPABILITIES.md) and [BAMBU_PRINT_PIPELINE.md](BAMBU_PRINT_PIPELINE.md).

## License

GNU Affero General Public License v3.0 or later. The slicing integration is based on the AGPL-licensed `three-slicer`/OrcaSlicer line. See [LICENSE](LICENSE) and [OPEN_SOURCE_NOTICES.md](OPEN_SOURCE_NOTICES.md).
