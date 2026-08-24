# Mobile UX

LEVO presents the same editor state on desktop and mobile instead of maintaining a simplified second slicer.

## Touch workflow

- The workspace opens immediately with a visible build plate and one dominant Add action.
- A horizontally scrollable object rail exposes Add, Move, Rotate, Scale, Duplicate, Delete, Zoom All, Zoom Plate, and Add Plate with touch-sized targets.
- The persistent lower bar switches Prepare/Preview, saves `.3mf`, slices/cancels, slices all plates when relevant, and opens the complete object/settings drawer.
- The native transform rail, object toolbar, plate switcher, overflow warning, paint panel, and status remain available above the LEVO bars.
- Quick setup uses compact X2D/H2D, quality, strength, and support choices. The complete Orca-style process, motion, filament, object, and preview controls remain in the responsive drawer.
- Arabic/RTL is the initial product language; English is available from the header. Coordinates, file names, and the embedded technical editor stay LTR.

## Desktop workflow

At 900 px and wider, LEVO removes the duplicated mobile rails and exposes the native full workspace: top project actions, prepare/preview tabs, gizmos, object tools, right sidebar, plate tabs, slice current/all, and G-code export.

## Accessibility and resilience

- Buttons have visible labels or accessible names and keyboard focus indicators.
- Modal sheets use dialog semantics, close explicitly or by backdrop, and honor device safe areas.
- Error and notice banners use alert/status roles.
- Slicing progress is reflected in visible state and the primary action.
- Reduced-motion preferences disable nonessential animation.
- File limits are enforced for both picker and drag/drop paths before parsing.

## Known UX gaps

Focus trapping inside the setup/status sheet and complete localization of engine-owned English labels/errors remain incomplete. Unsupported geometry tools stay visible but disabled in the native object toolbar so their status is discoverable rather than hidden.
