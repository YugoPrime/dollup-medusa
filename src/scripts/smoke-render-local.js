// Local smoke renderer for story templates.
//
// Injects sample product images from C:/Users/rahvi/Desktop/Pruductsamples
// as base64 data URIs and renders each template via HyperFrames CLI.
// Does NOT use R2, the DB, or the Medusa service container.
//
// Run from Backend/dollup-medusa/:
//   node src/scripts/smoke-render-local.js
//
// Output: /tmp/dub3-<slug>.mp4 per template.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const { createHash } = require("node:crypto");

const ROOT = process.cwd();
const TPL = path.join(ROOT, "src/story-templates");
const AUDIO_DIR = path.join(TPL, "_brand", "audio");
const SAMPLES = "C:/Users/rahvi/Desktop/Pruductsamples";
const OUT_DIR = "/tmp";
const HF_CLI = path.join(ROOT, "node_modules/hyperframes/dist/cli.js");

const SLUG_MAP = {
  "how-to-order": {},
  "on-sale": { hero: "IS2306.jpg" },
  "new-arrival": { hero: "IS1903.jpg" },
  "in-stock-hero": { hero: "IS2138-ch.jpg" },
  "lifestyle-overlay": { lifestyle: "IS2304.jpg" },
  "product-1color": { front: "IS2306.jpg", back: "IS2306-b.jpg" },
  "product-2colors": { front_a: "IS1903.jpg", front_b: "IS2138-ch.jpg", back: "IS2306-b.jpg" },
  "product-3colors": { front_a: "IS1903.jpg", front_b: "IS2138-ch.jpg", front_c: "IS2304.jpg", back: "IS934-1.jpg" },
  "many-photos": { photo_1: "IS2306.jpg", photo_2: "IS1903.jpg", photo_3: "IS2138-ch.jpg", photo_4: "IS2304.jpg", photo_5: "IS2306-b.jpg", photo_6: "IS934-1.jpg", photo_7: "IS2306.jpg", photo_8: "IS1903.jpg" },
  "customer-review": { product_photo: "IS2138-ch.jpg" },
  "cutout-spotlight": { product_cutout: "IS1903-cutout.png" },
};

const TEXT_OVERRIDES = {
  "on-sale": { old_price: "Rs.1500", new_price: "Rs.999", sku: "IS2306", size: "Size: S, M, L", footer: "DM to ORDER" },
  "new-arrival": { headline: "NEW ARRIVAL", price: "Rs.1200", sku: "IS1903", footer: "DM to ORDER" },
  "in-stock-hero": { headline: "IN STOCK", subhead: "MUST HAVE", price: "Rs.1100", sku: "IS2138", footer: "DM to ORDER" },
  "lifestyle-overlay": { status: "IN STOCK", size: "Size: S, M, L", price: "Rs.950", sku: "IS2304", footer: "DM to ORDER" },
  "product-1color": { headline: "FRONT & BACK", price: "Rs.1100", sku: "IS2306", footer: "DM to ORDER" },
  "product-2colors": { headline: "2 COLORS AVAILABLE", price: "Rs.1200", sku: "IS1903", footer: "DM to ORDER" },
  "product-3colors": { headline: "3 COLORS", price: "Rs.1200", sku: "IS2304", footer: "DM to ORDER" },
  "many-photos": { headline: "Your new fav", price: "Rs.1200", sku: "IS2306", footer: "DM to ORDER", footer_url: "shop dollupboutique.com" },
  "customer-review": { stars: "★ ★ ★ ★ ★", quote: "Absolutely love it - the fit is perfect and the fabric is gorgeous!", reviewer: "- Anna M.", product_name: "Pink Satin Midi", footer: "DM to ORDER", footer_url: "shop dollupboutique.com" },
  "cutout-spotlight": { kicker: "MUST HAVE", headline: "IN STOCK", price: "Rs.1100", sku: "IS2138", size: "Size: S, M, L", footer: "DM to ORDER" },
};

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fileToDataUri(p) {
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : ext === ".png" ? "image/png"
    : ext === ".webp" ? "image/webp"
    : "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function materialize(slug) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `hf-${slug}-`));
  fs.cpSync(path.join(TPL, slug), path.join(tmpRoot, slug), { recursive: true });
  fs.cpSync(path.join(TPL, "_brand"), path.join(tmpRoot, "_brand"), { recursive: true });

  const indexPath = path.join(tmpRoot, slug, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");

  const slotMap = SLUG_MAP[slug] || {};
  for (const [slotId, imgFile] of Object.entries(slotMap)) {
    const imgPath = path.join(SAMPLES, imgFile);
    if (!fs.existsSync(imgPath)) {
      console.error(`  MISSING sample image: ${imgPath}`);
      continue;
    }
    const uri = fileToDataUri(imgPath);
    const re = new RegExp(`(<img[^>]*data-hf-image="${slotId}"[^>]*?)(\\s+src="[^"]*")?(\\s*\\/?\\s*>)`, "g");
    html = html.replace(re, `$1 src="${uri}"$3`);
  }

  const txt = TEXT_OVERRIDES[slug] || {};
  for (const [id, val] of Object.entries(txt)) {
    const re = new RegExp(`(data-hf-text="${id}"[^>]*>)([^<]*)(<)`, "g");
    html = html.replace(re, `$1${escapeHtml(val)}$3`);
  }

  fs.writeFileSync(indexPath, html);
  return { tmpTplDir: path.join(tmpRoot, slug), tmpRoot };
}

function listAudioTracks() {
  try {
    return fs.readdirSync(AUDIO_DIR).filter((f) => /\.(mp3|m4a|aac|wav)$/i.test(f)).sort();
  } catch { return []; }
}

function pickTrackForSlot(slotId, tracks) {
  if (tracks.length === 0) return null;
  const hash = createHash("sha256").update(slotId).digest();
  const idx = hash.readUInt32BE(0) % tracks.length;
  return tracks[idx];
}

function mixAudio(videoPath, audioPath, outPath, durationSeconds) {
  const fadeOut = Math.max(0, durationSeconds - 0.5);
  const filter = `[1:a]volume=0.4,afade=t=in:d=0.3,afade=t=out:st=${fadeOut}:d=0.5[a]`;
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", videoPath, "-i", audioPath,
      "-filter_complex", filter,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
      "-shortest", outPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (c) => { stderr += c.toString(); });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg mix exit ${code}: ${stderr.slice(-300)}`));
    });
  });
}

function getDuration(slug) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(TPL, slug, "meta.json"), "utf8"));
    return meta.duration_seconds || 6;
  } catch { return 6; }
}

function renderSlug(slug) {
  return new Promise((resolve, reject) => {
    const { tmpTplDir, tmpRoot } = materialize(slug);
    const outMp4 = path.join(OUT_DIR, `dub3-${slug}.mp4`);
    let stderrBuf = "";
    const proc = spawn(
      process.execPath,
      [HF_CLI, "render", tmpTplDir, "-o", outMp4, "--quiet"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    proc.stderr.on("data", (chunk) => { stderrBuf += chunk.toString(); });
    proc.on("exit", async (code) => {
      if (code !== 0) {
        reject(new Error(`exit ${code}: ${stderrBuf.slice(-300)}`));
        return;
      }
      // Try audio mix; graceful fallback to silent on error.
      try {
        const tracks = listAudioTracks();
        const trackName = pickTrackForSlot(slug, tracks);
        if (trackName) {
          const mixedPath = outMp4.replace(/\.mp4$/i, ".mixed.mp4");
          await mixAudio(outMp4, path.join(AUDIO_DIR, trackName), mixedPath, getDuration(slug));
          fs.renameSync(mixedPath, outMp4);
          resolve({ outMp4, track: trackName });
        } else {
          resolve({ outMp4, track: null });
        }
      } catch (e) {
        console.error(`  audio mix failed for ${slug}: ${e.message}`);
        resolve({ outMp4, track: null });
      } finally {
        try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
      }
    });
  });
}

async function main() {
  const tracks = listAudioTracks();
  console.log(`Rendering ${Object.keys(SLUG_MAP).length} templates with local samples ${tracks.length ? `+ ${tracks.length} audio track(s)` : "(silent)"} ...`);
  for (const slug of Object.keys(SLUG_MAP)) {
    process.stdout.write(`  ${slug.padEnd(22)} `);
    try {
      const { outMp4, track } = await renderSlug(slug);
      const size = fs.statSync(outMp4).size;
      const audioTag = track ? `♪ ${track}` : "(silent)";
      console.log(`✓ ${(size / 1024).toFixed(0).padStart(5)} KB  ${audioTag.padEnd(28)}  →  ${outMp4}`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
