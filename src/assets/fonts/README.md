# Fonts used by the backend's own image drawing

`Inter-Medium.ttf` draws the "SIZES" row on the daily grid-post photos (`src/lib/feed-image-prep.ts`).

- **Font:** Inter, by Rasmus Andersson (https://github.com/rsms/inter).
- **Licence:** SIL Open Font License 1.1 (https://openfontlicense.org).
- **Source:** copied byte for byte from `node_modules/@medusajs/dashboard/src/assets/fonts/Inter-Medium.ttf`. That is
  already a dependency here; the copy means a Medusa upgrade can't move or drop it.
- **Why TTF:** sharp draws the text through Pango/FreeType, and the libvips build in the live image can't read
  WOFF2. It falls back to a monospace font, as tested on 2026-11-25 in a throwaway container of the live backend
  image. If this file goes missing, the drawing falls back to the system `sans-serif` font instead of failing.

`PlayfairDisplay-VF.ttf` draws the price on the same photos, as on the collection 30 catalogue cards.

- **Font:** Playfair Display (variable, weights 400 to 900), by Claus Eggers Sørensen
  (https://github.com/clauseggers/Playfair-Display). The price uses the Bold instance (`weight="bold"` in the markup).
- **Licence:** SIL Open Font License 1.1, with Reserved Font Name "Playfair Display" (see the font's own name
  table). The file is bundled unmodified, which the licence allows; a modified copy would have to be renamed.
- **Source:** copied byte for byte from `campaigns/2026-11-collection30-edited/fonts/PlayfairDisplay-VF.ttf`, the file
  the approved catalogue cards were drawn with (Google Fonts release).
- If this file goes missing, the price falls back to the system `serif` font instead of failing.
