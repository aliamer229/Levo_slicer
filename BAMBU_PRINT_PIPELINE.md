# Bambu print pipeline

LEVO supports explicit, user-controlled print handoffs today. Desktop users can slice locally, download or share the actual `.gcode`, then open/transfer it to Bambu Connect or Bambu Studio and verify the real printer state there. Phone-only users can export the current Bambu/Orca-compatible `.3mf` project, upload it as a **Private Model** at MakerWorld, and initiate the cloud print from Bambu Handy after verifying the printer and AMS. Supported removable storage remains the offline fallback.

Direct browser-to-printer/cloud networking is intentionally disabled. A browser cannot open the printer's raw LAN MQTT/FTPS transports, and Bambu Lab's cloud authorization control restricts critical cloud operations. A safe implementation cannot treat raw G-code as a drop-in printer job, claim a printer is connected without live evidence, call an undocumented private cloud API, ask for the user's Bambu account password, or assume that a browser knows the downloaded file's absolute desktop path.

Official references:

- [Bambu Connect](https://wiki.bambulab.com/en/software/bambu-connect)
- [Bambu third-party integration](https://wiki.bambulab.com/en/software/third-party-integration)
- [Bambu authorization control announcement](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/)

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

## Mobile bridge milestone

The repository now contains a shared Capacitor 8 app for iOS and Android plus a versioned `LevoPrinter` contract. The web/native boundary supports capability negotiation and a sequential 192 KiB transfer protocol with per-asset SHA-256 validation, idempotency keys, cancellation, and native cache cleanup. Both native plugins currently advertise LAN transport, packaging, upload, telemetry, and start as unavailable. This is intentional: the UI cannot enable those controls before their respective adapters and physical-printer tests exist.

## Evidence required before enabling

- Bambu Lab partner approval, official technical documentation, and issued authorization credentials for the **cloud** route (`devpartner@bambulab.com`).
- Explicit LAN Only/Developer Mode enrollment for the **local** route; no cloud account credentials are accepted by this route.

- Golden package fixtures accepted by Bambu Studio/Connect without mutation.
- Negative tests for corrupt metadata, wrong model, wrong nozzle, overflow, and unsafe AMS mapping.
- Integration tests on real X2D and H2D hardware in each supported nozzle mode.
- Verified upload, start, cancellation, reconnect, and error-state behavior.
- A documented firmware/authorization compatibility matrix.

Until all local gates pass, the app may show LAN setup and capability status but must not enable upload/start or report a printer connected without an authenticated live acknowledgement. The website remains at real G-code preview/download/share, USB handoff, Bambu Connect/Studio, and the phone-only private MakerWorld → Bambu Handy flow.
