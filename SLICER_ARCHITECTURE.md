# Slicer architecture

## Runtime flow

1. `app/slicer-client.tsx` dynamically imports the editor and settings UI on the client. The page shell can render without touching WebGL or WebAssembly.
2. The full `three-slicer` viewport owns geometry, selection, transforms, plates, undo history, painting, and preview state. LEVO listens to typed viewport events for object, plate, mode, progress, layer, notice, and error updates.
3. Capturing listeners at the open editor shadow root validate picker and drag/drop batches before the native loader sees them: allowlisted extension, non-empty file, 80 MB per file, 160 MB per batch, 12 files per batch, and 24 imported files per project.
4. X2D/H2D machine, process, and filament data are loaded from the engine's bundled Orca presets. Machine keys are re-applied after any advanced settings update or project import so a project cannot silently replace the selected machine envelope.
5. Slicing starts from the native current/all-plate controls. The engine performs computation in its WebAssembly worker and reports real progress. Its own cancel action terminates the active work.
6. Toolpath preview parses generated G-code and exposes layer range, single-layer, travel, and feature/speed/height/width/fan/temperature/filament views.
7. Large G-code strings are stored outside React state in a per-workspace `Map`; only progress, counts, modes, and lightweight status reach the component tree.
8. Native project save serializes geometry, transforms, plate placement, painting, and settings into `.3mf`. Reloading the page still clears the in-memory workspace unless the user saved it.

## UI composition

- Desktop uses the engine's complete top bar, gizmo rail, object toolbar, plate bar, object/filament/process sidebar, slice controls, and preview controls.
- Mobile keeps those native controls but adds a touch-sized LEVO rail for the common commands. Buttons dispatch to native controls by stable `data-testid` rather than maintaining a second geometry model.
- Shadow-root CSS only changes responsive layout. It does not replace engine action handlers.
- Arabic/RTL applies to the LEVO shell; the technical editor canvas and transform coordinate system remain LTR.

## Trust boundaries

- `three-slicer`: model parsing, geometry editing, project serialization, Orca settings, WASM slicing, and G-code/toolpath rendering.
- `app/slicer-client.tsx`: product shell, profile locking, validation limits, mobile command adapters, status, and capability disclosure.
- `worker/index.ts`: static delivery and response security headers. It does not receive models, projects, or G-code.
- Browser memory: project and generated outputs for the current page lifetime.

## Intentional boundaries

Auto Arrange, Auto Orient, Cut, mesh Boolean, part modifiers, seam painting, full Bambu color/MMU painting, text/SVG emboss, Measure, variable layers, STEP import, background persistence, printer discovery, AMS mapping, `.gcode.3mf` packaging, and direct printing are not implemented. Disabled native controls and the platform-status sheet state this explicitly.
