# Mobile UX

LEVO treats the phone as the primary surface rather than a compressed desktop slicer.

## Interaction model

- Arabic and RTL are the default; English and LTR are available from the header.
- The empty state has one dominant action: add a model.
- Once loaded, the model owns the largest part of the screen and slicing stays in a thumb-reachable bottom dock.
- Common choices use large segmented controls: quality, strength, support, and printer profile.
- Advanced Orca-style settings are lazy-loaded in a separate full-height sheet.
- During slicing, an explicit progress overlay reports the engine’s real value and exposes cancellation.
- Results place estimates, toolpath preview, download, and the direct-print boundary in one decision surface.

## Accessibility and resilience

- Controls have accessible names, visible text, and minimum touch-friendly sizing.
- Dialog sheets use modal semantics and close on their explicit button or backdrop.
- Progress uses an `aria-live` region.
- Safe-area insets protect the header and bottom dock on notched devices.
- Dark mode and reduced-motion preferences are supported.
- Desktop layouts widen the viewer and dock but keep the same task order.

## Known UX gaps

Touch transforms, object arrangement, multi-object management, per-layer filtering, keyboard focus trapping inside sheets, and localized engine error messages remain incomplete. The real embedded viewer still supports orbit interaction, but LEVO does not yet expose a full mobile transform rail.
