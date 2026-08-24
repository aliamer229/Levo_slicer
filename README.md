# LEVO Web Slicer

LEVO is a mobile-first, Arabic-first browser slicer for Bambu Lab X2D and H2D profiles. Model parsing, slicing, progress reporting, G-code generation, estimates, and toolpath rendering run locally in the browser through the `three-slicer` WebAssembly worker. No model or generated G-code is uploaded by this application.

The original repository was empty when this production baseline was created, so there was no prior UI or workflow to preserve. This release deliberately stops at verified raw G-code export: printer discovery, AMS state, package upload, and direct print are visible only as truthful capability boundaries and are not simulated.

## What works

- Import STL, OBJ, 3MF, AMF, and PLY files up to the 80 MB mobile safety limit.
- Inspect the real 3D model on the X2D or H2D build plate.
- Slice in a dedicated Web Worker with real progress and cancellation by worker teardown.
- Select 0.12, 0.20, or 0.28 mm layer presets, strength presets, support, and the full schema-driven advanced settings panel.
- Review real time, layer, and PLA filament estimates returned by the engine.
- Block export when the engine reports an out-of-volume model or toolpath.
- Render the generated toolpath and download raw `.gcode` locally.
- Install as a lightweight PWA shell.

## Run locally

Requirements: Node.js 22.13 or newer.

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

## Capability boundary

Raw G-code is not the same thing as a Bambu print project. Direct printing requires a correctly structured and validated `.gcode.3mf` package, an authenticated transport, printer-state checks, AMS mapping, firmware compatibility checks, and real-device validation. LEVO does not claim those capabilities in this release.

See [SLICER_CAPABILITIES.md](SLICER_CAPABILITIES.md) and [BAMBU_PRINT_PIPELINE.md](BAMBU_PRINT_PIPELINE.md) for the detailed matrix and gated implementation plan.

## License

This project is licensed under the GNU Affero General Public License v3.0 or later because its slicing integration is based on the AGPL-licensed `three-slicer`/OrcaSlicer line. See [LICENSE](LICENSE) and [OPEN_SOURCE_NOTICES.md](OPEN_SOURCE_NOTICES.md).
