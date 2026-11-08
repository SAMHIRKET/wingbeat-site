# Pokedraw visual pass (WINGBEAT kit)

The art direction and all on-screen words now belong to the WINGBEAT side. Backend, API, drawing-op format and room state machine are unchanged.

## New files (public/)
- `kit.js`: the wingbe.at parts. Aero box windows (`.wb-win`), scratch-font lettering (`.wb-l`), glossy pills (`.wb-pill`), aero sky (`#wb-world`), and a boil clock (6 fps fill, 3 fps ink). Found by class through a MutationObserver, so render code only writes markup.
- `card.js`: one card renderer for the screen and the PNG export (`paintCard`, `exportCard`), including the face-down back used during reveal.
- `copy.js`: every visible word. Placeholders until SAM writes them. Do not add copy elsewhere.
- `preview.js`: `?preview=home|lobby|drawing|reveal|voting|results|gallery` fakes the room service for screenshots. It does nothing without the query (or `window.PD_PREVIEW`).
- `fonts/`: scratch-font atlases, copied from the wingbeat-site repo.

## Changed
- `app.js`: markup rewritten for the kit, and quips removed. Card export uses `card.js`. Network, polling, autosave, voting and hints logic are the original. Card art is kept in hidden 800x600 canvases (`artStore`), so replays animate on the card face.
- `hints.js`: takes a 6th `copy` argument for its three strings. The pointer/keyboard hold behaviour is unchanged.
- `index.html`: relative asset paths, and kit dialogs (filled by `app.js`).
- `style.css`: replaced.
- `server.mjs`: the static route also serves `/fonts/<name>.png|.txt` (`image/png`, `text/plain`). The path regex is stricter (one optional `fonts/` folder, a single extension).
- `test/http.test.mjs`: checks that the new modules and fonts are served.

`npm test`: 24/24 pass.

## Rules from SAM
- No music, sound or transitions without SAM's sign-off.
- No extra copy, taglines or jokes. Words live in `copy.js`, and SAM writes them.
- Do not restyle anything. Art comes from the WINGBEAT shader kits.
