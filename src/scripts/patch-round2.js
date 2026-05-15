// Round-2 template patches:
//   - Recreate the sticker as inline SVG -> _brand/shop-now-badge.svg
//   - Inject base64-encoded SVG as .shop-badge background-image in tokens.css
//   - Inject base64 cursor SVG as .cursor-tap in tokens.css
//   - Replace footer URL text element with the .shop-badge span across 9 templates
//   - how-to-order: kicker -> big shop-badge at top + cursor-tap overlay on URL pill
//   - in-stock-hero: add size text override + dark pill positioned top-right of hero frame
//   - many-photos: headline default "ALL ANGLES" -> "Your new fav" (italic display)
//   - All templates: SKU refined as small pill badge

const fs = require("node:fs");
const path = require("node:path");

const T = path.resolve(__dirname, "../story-templates");
const BRAND = path.join(T, "_brand");

const SVG_BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 144">
  <defs>
    <style>
      .pill{fill:#fff8f0;stroke:#c75d4b;stroke-width:3}
      .title{font-family:Playfair Display,Georgia,serif;font-weight:700;font-size:42px;fill:#2b2b2b}
      .url{font-family:Playfair Display,Georgia,serif;font-weight:500;font-size:22px;fill:#c75d4b;letter-spacing:1px}
      .line{stroke:#c75d4b;stroke-width:1.5}
      .arrow{font-family:Georgia,serif;font-size:32px;fill:#c75d4b}
    </style>
  </defs>
  <rect class="pill" x="20" y="14" width="440" height="116" rx="58"/>
  <text class="title" x="240" y="64" text-anchor="middle">Shop now</text>
  <line class="line" x1="155" y1="80" x2="225" y2="80"/>
  <circle cx="232" cy="80" r="3" fill="#c75d4b"/>
  <circle cx="240" cy="74" r="3" fill="#c75d4b" opacity="0.9"/>
  <circle cx="248" cy="80" r="3" fill="#c75d4b"/>
  <circle cx="240" cy="86" r="3" fill="#c75d4b" opacity="0.9"/>
  <line class="line" x1="255" y1="80" x2="325" y2="80"/>
  <text class="url" x="240" y="112" text-anchor="middle">dollupboutique.com</text>
  <text class="arrow" x="425" y="78">->>></text>
</svg>
`;
fs.writeFileSync(path.join(BRAND, "shop-now-badge.svg"), SVG_BADGE);
const badgeDataUri = "data:image/svg+xml;base64," + Buffer.from(SVG_BADGE).toString("base64");

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M16 6 L16 38 L24 32 L30 48 L38 44 L32 30 L44 30 Z" fill="#ffffff" stroke="#2b2b2b" stroke-width="3" stroke-linejoin="round"/></svg>`;
const cursorDataUri = "data:image/svg+xml;base64," + Buffer.from(CURSOR_SVG).toString("base64");

let tokens = fs.readFileSync(path.join(BRAND, "tokens.css"), "utf8");
if (!tokens.includes("--dub-coral")) {
  tokens = tokens.replace(/(--dub-red:[^;]+;)/, "$1\n  --dub-coral: #c75d4b;");
}
if (!tokens.includes(".shop-badge")) {
  tokens += `\n.shop-badge { display: inline-block; background-image: url("${badgeDataUri}"); background-repeat: no-repeat; background-position: center; background-size: contain; width: 360px; height: 108px; vertical-align: middle; }
.shop-badge-lg { width: 720px; height: 216px; }
.shop-badge-sm { width: 260px; height: 78px; }
.cursor-tap { position: absolute; pointer-events: none; width: 96px; height: 96px; background-image: url("${cursorDataUri}"); background-repeat: no-repeat; background-size: contain; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3)); animation: tapCycle 2.2s ease-in-out infinite; }
@keyframes tapCycle { 0%, 30% { transform: scale(1) translateY(0); } 50% { transform: scale(0.86) translateY(-6px); } 70%, 100% { transform: scale(1) translateY(0); } }
`;
}
fs.writeFileSync(path.join(BRAND, "tokens.css"), tokens);
console.log("tokens.css: coral + .shop-badge + .cursor-tap injected");

const SKU_RULE_DARK_INK = ".sku { font-family: var(--dub-font-body); font-weight: 600; font-size: 22px; color: var(--dub-ink); background: rgba(43,43,43,0.08); padding: 5px 14px; border-radius: 999px; letter-spacing: 2px; }";
const SKU_RULE_LIGHT_INK = ".sku { font-family: var(--dub-font-body); font-weight: 600; font-size: 22px; color: var(--dub-cream); background: rgba(245,230,216,0.15); padding: 5px 14px; border-radius: 999px; letter-spacing: 2px; }";

const SLUGS = ["how-to-order","on-sale","new-arrival","in-stock-hero","lifestyle-overlay","product-1color","product-2colors","product-3colors","many-photos","customer-review"];

for (const slug of SLUGS) {
  if (slug === "how-to-order") continue;
  const hp = path.join(T, slug, "index.html");
  let html = fs.readFileSync(hp, "utf8");
  html = html.replace(
    /<div class="footer-url" data-hf-text="footer_url">[^<]*<\/div>/g,
    `<span class="shop-badge" role="img" aria-label="Shop dollupboutique.com"></span>`
  );
  fs.writeFileSync(hp, html);

  const cp = path.join(T, slug, "styles.css");
  let css = fs.readFileSync(cp, "utf8");
  css = css.replace(/\.footer-url\s*\{[^}]*\}\s*/g, "");
  const isDarkBg = slug === "in-stock-hero" || slug === "customer-review";
  css = css.replace(/\.sku\s*\{[^}]*\}/g, isDarkBg ? SKU_RULE_LIGHT_INK : SKU_RULE_DARK_INK);
  fs.writeFileSync(cp, css);
  console.log(`patched ${slug}`);
}

// many-photos: headline -> "Your new fav" + italic kicker style
{
  const mp = path.join(T, "many-photos/meta.json");
  const meta = JSON.parse(fs.readFileSync(mp, "utf8"));
  for (const o of meta.text_overrides) if (o.id === "headline") o.default = "Your new fav";
  fs.writeFileSync(mp, JSON.stringify(meta, null, 2) + "\n");
  const hp = path.join(T, "many-photos/index.html");
  let html = fs.readFileSync(hp, "utf8");
  html = html.replace(/(<h2 class="kicker" data-hf-text="headline">)[^<]*(<\/h2>)/, "$1Your new fav$2");
  fs.writeFileSync(hp, html);
  const cp = path.join(T, "many-photos/styles.css");
  let css = fs.readFileSync(cp, "utf8");
  css = css.replace(/\.kicker\s*\{[^}]*\}/, ".kicker { font-family: var(--dub-font-display); font-weight: 700; font-size: 86px; color: var(--dub-ink); letter-spacing: 1px; text-align: center; font-style: italic; animation: rise 0.6s ease-out both; }");
  fs.writeFileSync(cp, css);
  console.log("many-photos: 'Your new fav' (italic display)");
}

// in-stock-hero: add size text override + pill positioned top-right of hero
{
  const mp = path.join(T, "in-stock-hero/meta.json");
  const meta = JSON.parse(fs.readFileSync(mp, "utf8"));
  if (!meta.text_overrides.some(o => o.id === "size")) {
    const skuIdx = meta.text_overrides.findIndex(o => o.id === "sku");
    meta.text_overrides.splice(skuIdx + 1, 0, { id: "size", default: "Size: S, M, L", max_chars: 28 });
    fs.writeFileSync(mp, JSON.stringify(meta, null, 2) + "\n");
  }
  const hp = path.join(T, "in-stock-hero/index.html");
  let html = fs.readFileSync(hp, "utf8");
  if (!html.includes('data-hf-text="size"')) {
    html = html.replace(
      /(<div class="price-pill">)/,
      `<div class="size-pill" data-hf-text="size">Size: S, M, L</div>\n          $1`
    );
    fs.writeFileSync(hp, html);
  }
  const cp = path.join(T, "in-stock-hero/styles.css");
  let css = fs.readFileSync(cp, "utf8");
  if (!/\.size-pill\s*\{/.test(css)) {
    css = css.replace(/(\.price-pill\s*\{[^}]*\})/,
`.size-pill { position: absolute; top: 32px; right: 32px; background: rgba(0,0,0,0.78); color: var(--dub-cream); padding: 10px 22px; border-radius: 999px; font-family: var(--dub-font-body); font-weight: 700; font-size: 24px; letter-spacing: 3px; z-index: 2; animation: rise 0.6s ease-out 0.9s both; }
$1`);
  }
  fs.writeFileSync(cp, css);
  console.log("in-stock-hero: size pill added");
}

// how-to-order: replace kicker with shop-badge-lg + add cursor on URL pill + tighten top
{
  const hp = path.join(T, "how-to-order/index.html");
  let html = fs.readFileSync(hp, "utf8");
  html = html.replace(
    /<span class="kicker">[^<]*<\/span>/,
    `<span class="shop-badge shop-badge-lg" role="img" aria-label="Shop dollupboutique.com"></span>`
  );
  html = html.replace(
    /(<div class="url-pill" data-hf-text="url">[^<]*<\/div>)/,
    `<div class="url-wrap">$1<span class="cursor-tap"></span></div>`
  );
  fs.writeFileSync(hp, html);

  const cp = path.join(T, "how-to-order/styles.css");
  let css = fs.readFileSync(cp, "utf8");
  css = css.replace(/\.scene\s*\{[^}]*\}/, ".scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 80px 60px 60px; gap: 36px; }");
  css = css.replace(/\.kicker\s*\{[^}]*\}\s*/, "");
  if (!/\.url-wrap\s*\{/.test(css)) {
    css += "\n.url-wrap { position: relative; display: inline-block; margin-top: 8px; }\n.url-wrap .cursor-tap { top: 35%; right: -50px; }\n";
  }
  fs.writeFileSync(cp, css);
  console.log("how-to-order: badge top + cursor-tap on URL");
}

console.log("\nRound-2 patches done.");
