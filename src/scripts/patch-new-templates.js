// One-shot scaffolder: creates 2 new templates + updates the smoke script.
//   - many-photos: 2x2 grid of 4 flip-cards cycling through 8 photos
//   - customer-review: full-bleed product photo + 5 stars + quote + reviewer
//
// Run from Backend/dollup-medusa/:
//   node src/scripts/patch-new-templates.js

const fs = require("node:fs");
const path = require("node:path");

const T = path.resolve(__dirname, "../story-templates");

// ============ MANY-PHOTOS ============
const manyDir = path.join(T, "many-photos");
fs.mkdirSync(manyDir, { recursive: true });

fs.writeFileSync(path.join(manyDir, "meta.json"), JSON.stringify({
  slug: "many-photos",
  name: "Many Photos · 2x2 Flip Carousel",
  category: "single-product-multi-image",
  duration_seconds: 8,
  wave: 1,
  slots: [
    { id: "photo_1", hint: "front", label: "Card 1 · primary", required: true },
    { id: "photo_2", hint: "front", label: "Card 2 · primary", required: true },
    { id: "photo_3", hint: "front", label: "Card 3 · primary", required: true },
    { id: "photo_4", hint: "back", label: "Card 4 · primary", required: true },
    { id: "photo_5", hint: "detail", label: "Card 1 · flip-to", required: true },
    { id: "photo_6", hint: "detail", label: "Card 2 · flip-to", required: true },
    { id: "photo_7", hint: "detail", label: "Card 3 · flip-to", required: true },
    { id: "photo_8", hint: "detail", label: "Card 4 · flip-to", required: true },
  ],
  text_overrides: [
    { id: "headline", default: "ALL ANGLES", max_chars: 24 },
    { id: "price", default: "Rs.0", max_chars: 12 },
    { id: "sku", default: "IS0000", max_chars: 10 },
    { id: "footer", default: "DM to ORDER", max_chars: 20 },
    { id: "footer_url", default: "shop dollupboutique.com", max_chars: 32 },
  ],
}, null, 2) + "\n");

fs.writeFileSync(path.join(manyDir, "index.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="8" data-width="1080" data-height="1920">
      <div class="scene">
        <h2 class="kicker" data-hf-text="headline">ALL ANGLES</h2>
        <div class="grid">
          <div class="flip-card card-1"><div class="flip-inner"><div class="flip-front"><img data-hf-image="photo_1" alt=""></div><div class="flip-back"><img data-hf-image="photo_5" alt=""></div></div></div>
          <div class="flip-card card-2"><div class="flip-inner"><div class="flip-front"><img data-hf-image="photo_2" alt=""></div><div class="flip-back"><img data-hf-image="photo_6" alt=""></div></div></div>
          <div class="flip-card card-3"><div class="flip-inner"><div class="flip-front"><img data-hf-image="photo_3" alt=""></div><div class="flip-back"><img data-hf-image="photo_7" alt=""></div></div></div>
          <div class="flip-card card-4"><div class="flip-inner"><div class="flip-front"><img data-hf-image="photo_4" alt=""></div><div class="flip-back"><img data-hf-image="photo_8" alt=""></div></div></div>
        </div>
        <div class="meta">
          <span class="price" data-hf-text="price">Rs.0</span>
          <span class="sku" data-hf-text="sku">IS0000</span>
        </div>
        <div class="footer" data-hf-text="footer">DM to ORDER</div>
        <div class="footer-url" data-hf-text="footer_url">shop dollupboutique.com</div>
      </div>
    </div>
  </body>
</html>
`);

fs.writeFileSync(path.join(manyDir, "styles.css"), `* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-soft); }
.scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; padding: 90px 60px 70px; gap: 22px; }
.kicker { font-family: var(--dub-font-display); font-weight: 700; font-size: 70px; color: var(--dub-ink); letter-spacing: 8px; text-align: center; animation: rise 0.6s ease-out both; }
.grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 14px; flex: 1; min-height: 0; width: 100%; }
.flip-card { perspective: 1600px; background: transparent; }
.flip-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; }
.flip-front, .flip-back { position: absolute; inset: 0; backface-visibility: hidden; border-radius: 20px; overflow: hidden; box-shadow: 0 16px 32px rgba(0,0,0,0.10); }
.flip-front img, .flip-back img { width: 100%; height: 100%; object-fit: cover; display: block; }
.flip-back { transform: rotateY(180deg); }
.card-1 .flip-inner { animation: enter 0.7s ease-out 0.2s both, flipCycle 6s ease-in-out 1.2s 1 forwards; }
.card-2 .flip-inner { animation: enter 0.7s ease-out 0.4s both, flipCycle 6s ease-in-out 1.6s 1 forwards; }
.card-3 .flip-inner { animation: enter 0.7s ease-out 0.6s both, flipCycle 6s ease-in-out 2.0s 1 forwards; }
.card-4 .flip-inner { animation: enter 0.7s ease-out 0.8s both, flipCycle 6s ease-in-out 2.4s 1 forwards; }
.meta { display: flex; align-items: baseline; gap: 16px; animation: rise 0.6s ease-out 1.3s both; }
.price { font-family: var(--dub-font-display); font-weight: 700; font-size: 96px; color: var(--dub-ink); line-height: 1; }
.sku { font-family: var(--dub-font-body); font-size: 30px; color: var(--dub-ink); opacity: 0.6; letter-spacing: 3px; }
.footer { font-family: var(--dub-font-body); font-weight: 700; font-size: 38px; color: var(--dub-ink); letter-spacing: 4px; animation: rise 0.6s ease-out 1.55s both; }
.footer-url { font-family: var(--dub-font-body); font-weight: 500; font-size: 24px; color: var(--dub-ink); opacity: 0.6; letter-spacing: 2px; margin-top: 2px; animation: rise 0.6s ease-out 1.8s both; }
@keyframes enter { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
@keyframes rise { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes flipCycle { 0% { transform: rotateY(0); } 20% { transform: rotateY(180deg); } 65% { transform: rotateY(180deg); } 100% { transform: rotateY(0); } }
`);
console.log("many-photos template created");

// ============ CUSTOMER-REVIEW ============
const revDir = path.join(T, "customer-review");
fs.mkdirSync(revDir, { recursive: true });

fs.writeFileSync(path.join(revDir, "meta.json"), JSON.stringify({
  slug: "customer-review",
  name: "Customer Review",
  category: "editorial",
  duration_seconds: 6,
  wave: 1,
  slots: [
    { id: "product_photo", hint: "lifestyle", label: "Product or lifestyle photo (full-bleed)", required: true },
  ],
  text_overrides: [
    { id: "stars", default: "★ ★ ★ ★ ★", max_chars: 12 },
    { id: "quote", default: "Absolutely love it - fits perfectly and the fabric is gorgeous!", max_chars: 140 },
    { id: "reviewer", default: "- Anna M.", max_chars: 28 },
    { id: "product_name", default: "Babe Essentials", max_chars: 28 },
    { id: "footer", default: "DM to ORDER", max_chars: 20 },
    { id: "footer_url", default: "shop dollupboutique.com", max_chars: 32 },
  ],
}, null, 2) + "\n");

fs.writeFileSync(path.join(revDir, "index.html"), `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="bg-wrap">
        <img class="bg" data-hf-image="product_photo" alt="" />
        <div class="bg-tint"></div>
      </div>
      <div class="scene">
        <div class="badge">CUSTOMER LOVE</div>
        <div class="stars" data-hf-text="stars">★ ★ ★ ★ ★</div>
        <blockquote class="quote" data-hf-text="quote">Absolutely love it - fits perfectly and the fabric is gorgeous!</blockquote>
        <div class="reviewer" data-hf-text="reviewer">- Anna M.</div>
        <div class="product-name" data-hf-text="product_name">Babe Essentials</div>
        <div class="footer" data-hf-text="footer">DM to ORDER</div>
        <div class="footer-url" data-hf-text="footer_url">shop dollupboutique.com</div>
      </div>
    </div>
  </body>
</html>
`);

fs.writeFileSync(path.join(revDir, "styles.css"), `* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-ink); position: relative; }
.bg-wrap { position: absolute; inset: 0; overflow: hidden; }
.bg { width: 100%; height: 100%; object-fit: cover; display: block; animation: drift 6s ease-out both; filter: blur(2px); }
.bg-tint { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.75) 100%); }
.scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 110px 70px; gap: 30px; }
.badge { font-family: var(--dub-font-body); font-weight: 700; font-size: 26px; color: var(--dub-pink); background: rgba(244, 194, 194, 0.20); padding: 12px 28px; border-radius: 999px; letter-spacing: 6px; animation: rise 0.6s ease-out both; }
.stars { font-size: 60px; color: var(--dub-gold); letter-spacing: 8px; animation: rise 0.6s ease-out 0.3s both; }
.quote { font-family: var(--dub-font-display); font-weight: 700; font-size: 64px; color: var(--dub-cream); text-align: center; line-height: 1.2; max-width: 940px; font-style: italic; animation: rise 0.7s ease-out 0.6s both; }
.reviewer { font-family: var(--dub-font-body); font-weight: 600; font-size: 32px; color: var(--dub-cream); letter-spacing: 3px; animation: rise 0.6s ease-out 1.1s both; }
.product-name { font-family: var(--dub-font-body); font-weight: 700; font-size: 26px; color: var(--dub-pink); background: rgba(0,0,0,0.40); padding: 10px 24px; border-radius: 999px; letter-spacing: 4px; animation: rise 0.6s ease-out 1.4s both; }
.footer { font-family: var(--dub-font-body); font-weight: 700; font-size: 36px; color: var(--dub-cream); letter-spacing: 4px; margin-top: 30px; animation: rise 0.6s ease-out 1.7s both; }
.footer-url { font-family: var(--dub-font-body); font-weight: 500; font-size: 24px; color: var(--dub-cream); opacity: 0.65; letter-spacing: 2px; margin-top: 2px; animation: rise 0.6s ease-out 2.0s both; }
@keyframes drift { from { transform: scale(1.06); } to { transform: scale(1.0); } }
@keyframes rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
`);
console.log("customer-review template created");

// ============ UPDATE SMOKE SCRIPT ============
const sp = path.resolve(__dirname, "smoke-render-local.js");
let s = fs.readFileSync(sp, "utf8");
if (!s.includes('"many-photos":')) {
  // 1. Add to SLUG_MAP after product-3colors
  s = s.replace(/("product-3colors":\s*\{[^}]*\},)\n/, (m, g1) => g1 + "\n" +
    `  "many-photos": { photo_1: "IS2306.jpg", photo_2: "IS1903.jpg", photo_3: "IS2138-ch.jpg", photo_4: "IS2304.jpg", photo_5: "IS2306-b.jpg", photo_6: "IS934-1.jpg", photo_7: "IS2306.jpg", photo_8: "IS1903.jpg" },\n` +
    `  "customer-review": { product_photo: "IS2138-ch.jpg" },\n`
  );

  // 2. Add to TEXT_OVERRIDES — find second occurrence after TEXT_OVERRIDES marker
  const txtIdx = s.indexOf("TEXT_OVERRIDES");
  if (txtIdx >= 0) {
    const head = s.slice(0, txtIdx);
    const tail = s.slice(txtIdx);
    const patchedTail = tail.replace(/("product-3colors":\s*\{[^}]*\},)\n/, (m, g1) => g1 + "\n" +
      `  "many-photos": { headline: "ALL ANGLES", price: "Rs.1200", sku: "IS2306", footer: "DM to ORDER", footer_url: "shop dollupboutique.com" },\n` +
      `  "customer-review": { stars: "★ ★ ★ ★ ★", quote: "Absolutely love it - the fit is perfect and the fabric is gorgeous!", reviewer: "- Anna M.", product_name: "Pink Satin Midi", footer: "DM to ORDER", footer_url: "shop dollupboutique.com" },\n`
    );
    s = head + patchedTail;
  }

  fs.writeFileSync(sp, s);
  console.log("smoke script updated with new templates");
} else {
  console.log("smoke script already has new templates");
}

console.log("\nDone.");
