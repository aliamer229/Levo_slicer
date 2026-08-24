# Slicer security

## Local-data model

LEVO does not upload models or G-code. The selected `File` is handed directly to the browser slicer, and generated output remains in memory until the user downloads it or leaves the page. There are no analytics, remote model URLs, cloud storage calls, printer credentials, or background sync endpoints in this release.

## Input controls

- Allowlist: STL, OBJ, 3MF, AMF, and PLY.
- Empty files are rejected.
- Files over 80 MB are rejected before the heavy viewer is loaded.
- Engine failures are surfaced as errors, not reinterpreted as successful slices.
- Raw G-code export is blocked when the engine reports bed or height overflow.

These checks reduce accidental resource exhaustion but do not make complex geometry formats intrinsically safe. The parser and slicer still process untrusted input inside a same-origin Worker/WASM environment.

## Browser policy

Every application response receives:

- a Content Security Policy restricted to the same origin, with `wasm-unsafe-eval` required by WebAssembly, `blob:` workers/images required by the slicer, and inline scripts/styles currently required by Vinext’s hydration and the dynamic progress indicator;
- `frame-ancestors 'none'` and `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- a strict-origin referrer policy;
- a permissions policy disabling camera, microphone, geolocation, payment, and USB.

Inline allowances are the principal remaining CSP hardening gap. A future nonce-aware Vinext integration should replace `unsafe-inline` for scripts; no third-party script origin is permitted in the current policy.

## Printer credentials

No access codes, cloud tokens, certificates, or printer addresses are requested or stored. A future LEVO Bridge must keep credentials outside the browser, bind to an explicitly configured interface, use authenticated requests, validate target printers, rate-limit operations, and redact secrets from logs.

## Output trust boundary

A generated `.gcode` file is an expert artifact, not a verified Bambu project. The UI labels it accordingly and disables direct print. Enabling hardware actions requires package validation, printer-state validation, model/firmware compatibility gates, and physical X2D/H2D tests described in `BAMBU_PRINT_PIPELINE.md`.
