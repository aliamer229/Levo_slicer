# Slicer security

## Local-data model

LEVO does not upload models, projects, or generated G-code to an application server. Files are passed directly to the browser editor and slicer; output remains in memory until saved/downloaded, intentionally shared through the device's operating-system share sheet, or the page is closed. There are no analytics, third-party scripts, cloud-model storage calls, printer credentials, or background synchronization endpoints.

## Input and resource controls

- Format allowlist: STL, OBJ, 3MF, AMF, and PLY.
- Empty files are rejected.
- Maximum 80 MB per file, 160 MB per selection, 12 files added at once, and 24 imported files in a workspace.
- The same capturing validation runs before both native file-input and drop handlers.
- A project change clears previously generated G-code so stale output is not presented as current.
- The selected printer's machine keys are re-applied after settings changes/import to prevent silent profile or build-volume replacement.
- Engine errors remain errors; an out-of-bed model/toolpath cannot enter LEVO's ready state.

These limits reduce accidental resource exhaustion but do not make complex geometry intrinsically safe. Parsing and slicing untrusted input still occur in the application's same-origin Worker/WebAssembly context.

## Browser policy

Every application response receives:

- a same-origin Content Security Policy; `wasm-unsafe-eval` is required by WebAssembly, `blob:` is required for workers/downloads, and current Vinext hydration still requires inline allowances;
- `frame-ancestors 'none'` and `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- a strict-origin referrer policy;
- a permissions policy disabling camera, microphone, geolocation, payment, and USB.

Replacing `unsafe-inline` with a nonce-aware Vinext integration is the main remaining CSP hardening item. No third-party script origin is permitted.

## Printer credentials and output trust

LEVO does not request or store printer addresses, access codes, cloud tokens, or certificates. Raw `.gcode` is a real sliced export, but not a verified Bambu `.gcode.3mf` project. The UI sends users through Bambu Connect/Studio so those applications can perform the final printer, firmware, nozzle, plate, and AMS checks. Direct browser-to-printer networking remains disabled until an approved bridge can keep secrets outside the browser, authenticate every request, validate a deterministic package, verify the real device state, and pass the physical-device tests described in `BAMBU_PRINT_PIPELINE.md`.
