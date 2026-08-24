# Capability matrix

Statuses describe the checked-in browser implementation and automated verification. They do not imply a physical-printer test.

| Capability | Status | Evidence / boundary |
|---|---|---|
| Mesh import | Implemented | STL, OBJ, 3MF, AMF, PLY, GLB/GLTF, FBX, DAE, 3DS, VRML/WRL, OFF, USDZ, KMZ, VTK/VTP, and MD2 use native or registered Three.js loaders. Unknown/extensionless common formats are signature-sniffed. |
| CAD import | Implemented | STEP/STP, IGES/IGS, and BREP/BRP are tessellated locally with `occt-import-js`/OpenCascade WebAssembly. |
| ZIP model import | Implemented | ZIP entries are decompressed incrementally, filtered/sniffed, naturally sorted, and the resulting objects are shelf-packed across up to nine plates. |
| Import sizing | Local/device-bounded | LEVO applies no fixed byte, batch, or project-count cap and uploads nothing to an application server. Browser/device memory and CPU are the practical limit. |
| Selection and object list | Implemented | Click and box selection, object visibility, select-all, and per-object extruder controls. |
| Move, rotate, scale | Implemented | Native Three.js transform gizmos plus keyboard nudging/rotation. |
| Delete, delete-all, duplicate | Implemented | Native toolbar, context-menu, keyboard, and mobile actions. |
| Split and place on bed | Implemented | Splits disconnected components into objects and re-seats objects at Z=0. Part-level splitting is not available. |
| Zoom all / zoom bed | Implemented | Native `Z`/`B` camera actions surfaced on the mobile rail and context menu. |
| Undo/redo and clipboard | Implemented | Native undo/redo plus copy, paste, cut, and duplicate shortcuts. |
| Multi-plate editing | Implemented | Add, select, and remove plates; slice current or all plates; project supports up to the engine's nine-plate limit. |
| 3MF project save | Implemented | Serializes geometry, transforms, plate layout, settings, and supported paint data for later reopening. |
| STL export | Implemented | Native selected/project geometry export. |
| X2D 0.4 profile | Profile-integrated | Orca GM045 preset; LEVO locks the primary volume to 256 × 256 × 260 mm. Physical X2D verification remains outstanding. |
| H2D 0.4 profile | Profile-integrated | Orca GM033 preset; bundled 350 × 320 × 325 mm envelope. Actual hardware mode/nozzle constraints still require device validation. |
| Quality, strength, support | Implemented | Real 0.12/0.20/0.24 mm X2D/H2D process presets with explicit strength/support overrides. |
| Advanced process/motion/filament settings | Implemented | Schema-driven native settings panels use the same active settings object as slicing. Machine identity and limits stay locked. |
| Support painting | Implemented | Native enforcer/blocker brushes, erase/clear tools, and radius control. |
| Full Bambu color/MMU painting | Partial | Basic filament/material mechanisms exist, but the complete Bambu facet codec and workflow are not wired; the unsupported top-level tool remains disabled. |
| Browser slicing | Implemented | Real WebAssembly slicer in an ES-module worker with progress and cancellation. |
| Bed overflow guard | Implemented | Out-of-volume model or generated path raises an error and prevents a ready/safe result state. |
| Toolpath preview | Implemented | Real G-code rendering with layer range, single-layer, travel toggle, and multiple view legends. |
| Raw G-code export and share | Implemented | Selected-plate and combined local downloads; mobile/desktop Web Share file handoff when supported; no application-server upload. |
| Bambu Connect / Studio handoff | Implemented | Print & Export explains the explicit official desktop handoff and links the Bambu Connect guide. Printer, plate, nozzle, and AMS confirmation remain in Bambu software. |
| ZIP multi-plate arrange | Implemented | Imported ZIP objects are size-sorted and packed across the active printer's bed dimensions. Oversized objects and the nine-plate ceiling produce explicit warnings. |
| General Auto Arrange / Auto Orient | Missing | Visible as disabled native controls; requires the corresponding libslic3r ports. |
| Cut / Boolean / modifier parts | Missing | Visible as disabled native controls; the web engine lacks the geometry/part implementation. |
| Seam paint / Text / Measure / variable layers | Missing | Visible as disabled native controls and described in the platform-status sheet. |
| Background persistence | Missing | Save `.3mf` explicitly; a reload clears unsaved state. |
| Printer discovery and status | Disabled | No network probe and no fabricated printer state. |
| AMS mapping and status | Disabled | No fabricated trays, colors, or material availability. |
| Bambu `.gcode.3mf` packaging | Missing | Raw G-code is not represented as a validated Bambu print project. |
| Direct Bambu cloud/browser print | Officially gated | Bambu's authorization system requires approved integration documentation and credentials for print initiation. LEVO exposes the real blocked state and partner-request path; it never fabricates a connection or asks for a Bambu account password. |

“Implemented” means the action exists in source and is covered by type, lint, build, rendered-shell, and engine-control contract checks where applicable. “Profile-integrated” means the bundled Orca profile is used and locked; it is not a claim of hardware certification.
