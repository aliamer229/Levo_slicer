# LEVO Studio

LEVO Studio is an Arabic-first, mobile-first browser workspace for preparing and slicing models with Bambu Lab X2D and H2D profiles. The editor, model parser, Orca-derived settings, WebAssembly slicer, G-code generation, and toolpath preview run locally in the browser through `three-slicer` 0.2.2. This application does not upload models or generated G-code to an application server.

## Editor workspace

- Import several STL, OBJ, 3MF, AMF, or PLY files by picker or drag-and-drop.
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

LEVO supports real G-code export and an official Bambu Connect/Studio handoff, but direct browser-to-printer networking remains disabled. Raw G-code is not a validated Bambu `.gcode.3mf` job, and a website cannot reliably know the absolute local path required by desktop handoff schemes. Safe direct activation requires an approved local bridge, deterministic package validation, authenticated transport, live printer and AMS checks, firmware compatibility gates, and tests on physical X2D/H2D hardware. See [SLICER_CAPABILITIES.md](SLICER_CAPABILITIES.md) and [BAMBU_PRINT_PIPELINE.md](BAMBU_PRINT_PIPELINE.md).

## License

GNU Affero General Public License v3.0 or later. The slicing integration is based on the AGPL-licensed `three-slicer`/OrcaSlicer line. See [LICENSE](LICENSE) and [OPEN_SOURCE_NOTICES.md](OPEN_SOURCE_NOTICES.md).
