// One-shot patcher: applies the HF .scene-wrapper fix to 5 templates that
// suffer from HF's auto-injected `position: absolute; width:100%; height:100%`
// rule on every id'd element.
//
// HTML transform:
//   - wrap everything between <div id="root" ...> and the matching close
//     in <div class="scene">...</div>
//   - on inner elements only, strip id=, data-start=, data-duration=,
//     data-track-index=, and " clip" from class attrs
//
// CSS transform:
//   - find the .canvas { ... } rule, split it so .canvas keeps only
//     width/height/background, and a new .scene rule receives
//     the flex/grid layout declarations + padding/gap.
//
// Run from Backend/dollup-medusa/:
//   node src/scripts/patch-scene-wrapper.js

const fs = require("node:fs");
const path = require("node:path");

const TPL_ROOT = path.resolve(__dirname, "../story-templates");
const TARGETS = ["new-arrival", "on-sale", "product-1color", "product-2colors", "product-3colors"];

function patchHtml(html) {
  const rootOpen = html.match(/<div id="root"[^>]*>/);
  if (!rootOpen) return html;
  const rootOpenIdx = rootOpen.index + rootOpen[0].length;
  const bodyClose = html.indexOf("</body>");
  if (bodyClose === -1) return html;
  const innerEnd = html.lastIndexOf("</div>", bodyClose);
  if (innerEnd <= rootOpenIdx) return html;
  const innerRaw = html.slice(rootOpenIdx, innerEnd).trimEnd();
  const after = html.slice(innerEnd);

  let innerPatched = innerRaw
    .replace(/\s+id="[^"]*"/g, "")
    .replace(/\s+data-start="[^"]*"/g, "")
    .replace(/\s+data-duration="[^"]*"/g, "")
    .replace(/\s+data-track-index="[^"]*"/g, "")
    .replace(/\s+clip(?=["\s])/g, "");

  innerPatched = innerPatched.replace(/\n      /g, "\n        ");

  const wrapped = `\n      <div class="scene">${innerPatched}\n      </div>\n    `;
  return html.slice(0, rootOpenIdx) + wrapped + after;
}

function patchCss(css) {
  const canvasRule = css.match(/\.canvas\s*\{([\s\S]*?)\}/);
  if (!canvasRule) return css;
  const ruleBody = canvasRule[1];

  const KEEP = new Set(["width", "height", "background", "background-color", "background-image"]);
  const MOVE = new Set([
    "display", "flex-direction", "flex-flow", "align-items", "justify-content",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "gap", "row-gap", "column-gap", "position",
  ]);

  const decls = ruleBody
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const keptDecls = [];
  const movedDecls = [];

  for (const decl of decls) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim();
    if (KEEP.has(prop)) keptDecls.push(decl);
    else if (MOVE.has(prop)) movedDecls.push(decl);
    else keptDecls.push(decl);
  }

  if (!movedDecls.some((d) => d.startsWith("position"))) movedDecls.unshift("position: absolute");
  if (!movedDecls.some((d) => d.startsWith("inset"))) movedDecls.push("inset: 0");

  const indent = "  ";
  const newCanvasBlock =
    ".canvas {\n" +
    keptDecls.map((d) => `${indent}${d};`).join("\n") +
    "\n}\n.scene {\n" +
    movedDecls.map((d) => `${indent}${d};`).join("\n") +
    "\n}";

  return css.replace(/\.canvas\s*\{[\s\S]*?\}/, newCanvasBlock);
}

let ok = 0, fail = 0;
for (const slug of TARGETS) {
  const htmlPath = path.join(TPL_ROOT, slug, "index.html");
  const cssPath = path.join(TPL_ROOT, slug, "styles.css");
  try {
    const html = fs.readFileSync(htmlPath, "utf8");
    const newHtml = patchHtml(html);
    fs.writeFileSync(htmlPath, newHtml);

    const css = fs.readFileSync(cssPath, "utf8");
    const newCss = patchCss(css);
    fs.writeFileSync(cssPath, newCss);

    console.log(`OK  ${slug}`);
    ok++;
  } catch (e) {
    console.error(`ERR ${slug}: ${e.message}`);
    fail++;
  }
}
console.log(`\n${ok} patched, ${fail} failed.`);
