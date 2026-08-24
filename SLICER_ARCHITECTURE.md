# Slicer architecture

## Runtime flow

1. The client validates the selected file extension, non-zero size, and the 80 MB mobile limit.
2. `three-slicer/viewer` is dynamically imported only after a model is selected. Its Emscripten worker and WASM kernel stay off the empty landing screen.
3. The prepare viewport parses the model and renders it with the selected local profile.
4. Starting a slice remounts the viewport with `defaultAutoSlice` enabled. The engine performs the actual slice in its dedicated Web Worker and emits real progress events.
5. Completion is accepted only when the run identifier and settings revision match the active job. Older results cannot replace a newer configuration.
6. Lightweight statistics enter React state. The potentially large G-code string stays in a ref and is passed directly to preview or a download Blob.
7. Cancellation invalidates the job and remounts the viewport, tearing down the current worker rather than merely hiding progress.

## Boundaries

- `app/slicer-client.tsx`: mobile workflow, state machine, profile presets, job identity, estimates, export.
- `three-slicer`: model parsing, prepare renderer, WASM slicing worker, G-code parser, toolpath renderer, advanced settings schema.
- `worker/index.ts`: application delivery and response security headers only. It never receives model data.
- Browser storage: none in this release. Files, settings, and results exist only for the current page lifetime.

## State model

`empty → modelReady → slicing → sliceReady → preview`

Validation and engine failures move to `error`. Any profile or setting change invalidates the current result and returns to `modelReady`. A run ID plus monotonic settings revision prevents stale worker callbacks from being committed.

## Performance choices

- Viewer, WASM engine, and advanced settings UI are split from the initial route.
- Slicing does not run on the main thread.
- Only one selected `File` object and one generated G-code string are retained.
- The G-code string is not copied into serializable React state.
- A reduced-motion mode removes decorative animation without changing progress semantics.

## Current intentional omissions

Multi-plate project editing, object-list transforms, a layer-range slider, STEP import, background persistence, printer discovery, AMS mapping, and direct printing are not implemented. They are documented as partial or missing rather than represented by mock data.
