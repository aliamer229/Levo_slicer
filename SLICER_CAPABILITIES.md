# Capability matrix

Status values are based on implemented code and local automated verification. No physical-printer test is implied.

| Capability | Status | Evidence / boundary |
|---|---|---|
| STL, OBJ, 3MF, AMF, PLY import | Verified in integration | Accepted and handed to the real viewer parser; extension, empty-file, and size checks run first. |
| STEP import | Missing | Not advertised or accepted. |
| 3D prepare view | Implemented | Real `three-slicer` viewport, loaded after model selection. |
| Browser slicing | Implemented | Real WASM engine in an ES-module Web Worker. |
| Progress | Implemented | Driven only by engine `progress` events. |
| Cancellation | Implemented | Invalidates the job and tears down the mounted worker. |
| Quality, strength, support | Implemented | Mapped to real slicer settings. |
| Advanced settings | Implemented | Lazy-loaded schema-driven `SettingsPanel`. |
| Stale-result protection | Implemented | Run ID and settings revision must both match. |
| X2D profile | Profile verified | Orca setting ID GM045; 256 × 256 × 261 mm profile envelope, 0.4 mm nozzle. Bambu’s published primary-nozzle hardware volume is 256 × 256 × 260 mm, so printer output remains gated. |
| H2D profile | Profile verified | Orca setting ID GM033; total printable polygon 350 × 320 mm and 325 mm profile height. Actual single/dual-nozzle hardware envelopes differ by mode. |
| Real estimates | Implemented | Time, layers, and filament length come from slice stats; PLA mass is derived from 1.75 mm volume at 1.24 g/cm³. |
| Bed overflow | Implemented | Slice/export is blocked when engine stats report model or toolpath overflow. |
| Toolpath preview | Implemented, basic | Real generated G-code is parsed and rendered; layer-range controls are not yet exposed. |
| Raw G-code download | Implemented | Local Blob download; no upload. |
| Multi-plate editing | Missing | 3MF parsing may contain project data, but LEVO’s workflow is single-result oriented. |
| Background persistence | Missing | Reloading clears the project. |
| Printer discovery/status | Disabled | No network probe or mock printer state. |
| AMS mapping/status | Disabled | No invented slots, colors, or material state. |
| Bambu project packaging | Missing | Raw G-code is not packaged as validated `.gcode.3mf`. |
| Direct print | Disabled | Requires bridge, authentication, package validation, state gates, and real hardware tests. |

## Verification language

“Implemented” means present in source and covered by build/type/lint/render checks where applicable. “Profile verified” means pinned against referenced OrcaSlicer profile definitions, not validated on the physical machine. Hardware-dependent states remain disabled until tested on real X2D and H2D printers.
