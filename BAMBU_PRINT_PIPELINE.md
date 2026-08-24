# Bambu print pipeline

LEVO supports an explicit, user-controlled print handoff today: slice locally, download or share the actual `.gcode`, then open/transfer it to Bambu Connect or Bambu Studio and verify the real printer state there. On phones, the supported handoff is share/download to a Bambu Connect computer or a printer-supported removable-storage path.

Direct browser-to-printer networking is intentionally disabled. A safe implementation cannot treat raw G-code as a drop-in printer job, claim a printer is connected without live evidence, or assume that a browser knows the downloaded file's absolute desktop path.

Official references:

- [Bambu Connect](https://wiki.bambulab.com/en/software/bambu-connect)
- [Bambu third-party integration](https://wiki.bambulab.com/en/software/third-party-integration)

## Required gated pipeline

1. **Generate** — accept a successful in-volume slice and freeze its settings, profile ID, model checksum, and G-code checksum.
2. **Package** — build a deterministic Bambu-compatible `.gcode.3mf` containing the required metadata, thumbnails, plate mapping, printer profile, and G-code entries.
3. **Validate** — reopen the package, verify its ZIP/3MF structure, checksums, metadata schema, tool/nozzle assumptions, plate bounds, and compatibility with the selected X2D/H2D print mode.
4. **Map materials** — read real AMS/external-spool state from the target printer and require an explicit mapping for every used filament. Never synthesize tray IDs, colors, or availability.
5. **Gate printer state** — require a reachable, authenticated, idle, compatible printer; confirm model, firmware support, build plate/nozzle assumptions, and sufficient storage.
6. **Upload** — transfer over an authenticated bridge or a currently supported Bambu integration path, with retry limits, checksum confirmation, and no secrets in browser logs.
7. **Start** — require a final user confirmation tied to the exact package checksum and target printer. Start only after upload and state confirmation.
8. **Observe** — verify the printer acknowledged the same project and surface any error without claiming success prematurely.

## LEVO Bridge requirements

- Local-only by default; explicit interface binding and origin allowlist.
- Strong request authentication and CSRF/replay protection.
- Encrypted credential storage outside the browser.
- Strict JSON/schema validation and bounded file sizes.
- Printer identity pinning, timeouts, rate limits, and idempotency keys.
- Redacted structured logs and an auditable action trail.
- Compatibility adapters isolated by printer model/firmware generation.

## Evidence required before enabling

- Golden package fixtures accepted by Bambu Studio/Connect without mutation.
- Negative tests for corrupt metadata, wrong model, wrong nozzle, overflow, and unsafe AMS mapping.
- Integration tests on real X2D and H2D hardware in each supported nozzle mode.
- Verified upload, start, cancellation, reconnect, and error-state behavior.
- A documented firmware/authorization compatibility matrix.

Until all gates pass, the product remains at real G-code preview/download/share plus the official user-confirmed Bambu Connect/Studio handoff. It must not expose a direct-network button that can report success without the target printer's acknowledgement.
