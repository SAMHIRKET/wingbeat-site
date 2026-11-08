# WINGBEAT redesign integration

Claude's visual kit, scratch font assets, card renderer and copy are retained.
The room service and drawing-operation format are unchanged.

## Fix included

Visual preview screens now keep their sample seats, tutorial flags and drafts in
separate storage, including separate keys for each preview screen. Opening
`?preview=home` or another preview no longer replaces the player's real room seat.
Unknown preview values leave the real room service active.

## Verification

- Self-host package: 30 automated tests passed.
- Hosted adapter: 24 automated tests passed, including byte-for-byte font and
  module delivery at both `/` and `/pokedraw/`.
- Browser: real room creation, readiness, drawing input, autosave, submission
  and results card checked.
- Layout: drawing and tutorial at 390 px; gallery at 320 px; home at 390 px.
  These are browser viewport checks, not physical-device touch tests.
- Card download was initiated but the remote browser reported a failed download;
  the exported PNG still needs an end-user download check.
- Docker deployment and physical phone/stylus input remain unverified here.

## Running or editing

Follow `START-HERE.md` for the self-host setup. Use Node 24+ or the included
Docker setup. Visual previews remain available with `?preview=home`, `lobby`,
`drawing`, `reveal`, `voting`, `results`, or `gallery`.

No soundtrack has been integrated; audio edits still require approval.

## Idle rendering, Brave font compatibility and paper update

- Glyph boundaries are now generated from the original PNG files into
  `public/font-metrics.js`; the browser no longer scans canvas pixels to decide
  which character is which. All 12 atlas files are checked against their hashes.
- Decorative animation pauses after 15 seconds without input, while the window
  is unfocused, or when the tab is hidden; it resumes on interaction. The drawing
  timer and room service continue. Reduced motion stops decorative animation.
- Each decorative canvas is capped at two million pixels and 4096 pixels per
  side; the font cache has a 12 MiB/240-entry target including tinted canvases.
- Settled windows reuse edge-only shadow paths. Leaving a room releases its
  cached art canvases and fetched drawing data.
- The drawing board has a warm off-white paper layer with grain, faint creases
  and gentle dot shading. It cycles three reusable 400×300 frames on fours
  (3 fps on the 12 fps art clock). Drawing operations, white erasing, and saved
  drawing data retain their existing format; paper is a display surface.
- Browser checks confirmed paper display, drawing input and idle pause/resume.
  The laptop's reported memory exhaustion has not been reproduced, and physical
  Brave on a Flip 7 still needs the user's confirmation after reloading.

If the font PNGs change, regenerate metrics using
`python3 scripts/build-font-metrics.py` (requires Pillow).
