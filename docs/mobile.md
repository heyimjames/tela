# Mobile web — status & roadmap

Tela is desktop-first today, but the engine and state stores are entirely
platform-agnostic — all the desktop coupling lives in the interaction and chrome
layer. Mobile is therefore an **additive UI layer over the same core**, not a
rewrite. This doc tracks where that stands and what's next.

## Where it stands

Already in place:

- Responsive layout (`App.tsx`): single column on mobile, three columns on `md+`.
- Side panels hide on mobile (`hidden md:flex`); a bottom `MobileControlSheet`
  exposes a Layers drawer.
- The canvas uses **pointer events**, so single-finger tap-to-select and
  drag-to-move already work on touch.
- Larger touch targets in form controls (`max-md:` sizing).
- **Phase 0 (done):** touch **pinch-zoom + two-finger pan** on the canvas, and
  **finger-sized, circular selection handles** on coarse pointers.

## Design principles (from how the best mobile editors work)

Studying Canva, Pinterest, and Unfold, the consistent pattern is: don't shrink
the desktop chrome — build a touch-native shell over the same document.

- **Bottom sheets over side panels.** Properties live in a sheet that slides up,
  not a rail.
- **Contextual toolbar on selection.** Selecting a layer reveals its actions
  (duplicate / delete / order) as a floating cluster and its properties in a
  sheet.
- **A tab bar / FAB to add** text, shapes, images, templates.
- **Finger-sized, round handles.**
- **Fullscreen keyboard for text editing.**
- **No hover, right-click, or keyboard dependencies** on touch.

## Roadmap

### Phase 0 — Navigable ✅ (done)
- [x] Touch pinch-zoom + two-finger pan (`PreviewPanel`, anchored via `zoomAtPoint`)
- [x] Finger-sized circular handles on coarse pointers (`useCoarsePointer`)
- [x] `touch-action: none` on the canvas so the browser doesn't hijack gestures

### Phase 1 — Editable
- [ ] Property editing as a **bottom sheet** — wire the stubbed inspector drawer
      in `MobileControlSheet` to the real inspector controls
- [ ] **Contextual selection toolbar** (duplicate / delete / order / group)
- [ ] **Add** bottom bar (Text / Shape / Image / Templates)

### Phase 2 — Complete
- [ ] Fullscreen text editing
- [ ] Template picker and export as sheets
- [ ] Replace hover affordances (alignment guides, distance measure) and
      right-click menus with tap equivalents on touch

### Phase 3 — Polish
- [ ] Rotate gesture and snap haptics
- [ ] PWA / installable, offline-ready (state is already local)
- [ ] Mobile empty-state onboarding

## Notes for contributors

- Detect touch with `useCoarsePointer()` (`(pointer: coarse)`), not viewport
  width — a small window on a desktop is still a mouse.
- The camera transform is `screen = centre + panOffset + world * zoom`; use
  `zoomAtPoint` in `PreviewPanel` to zoom around a specific screen point.
- Keep gestures on non-passive listeners (`{ passive: false }`) so
  `preventDefault` can stop browser scroll/zoom.
