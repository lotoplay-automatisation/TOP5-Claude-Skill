// TOP5 per-GEO project scaffolder.
// Builds a HyperFrames 9:16 project from a resolved config JSON: injects DATA into
// assets/template.html, writes index.html + the 4 scaffold JSONs, ensures media/ & renders/,
// and (optionally) encodes bg/avatar clips with the mandatory -an / dense-keyframe rules. The
// avatar is a plain re-encode (no chromakey/despill/alpha) — HyperFrames crops it to a circle
// via CSS instead.
//
// Usage:
//   node scaffold_project.mjs --config <config.json> --out <outputDir>
//     [--hf 0.6.25]            hyperframes version to pin in package.json (default 0.6.25)
//
// The <outputDir> is the PARENT directory the user chose; the project is created at
//   <outputDir>/temu-top5-<geo>/
// Config schema — see SKILL.md ("scaffold config"). Timing is auto-computed if omitted.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "..", "assets", "template.html");

// ---------- args ----------
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const configPath = opt("--config");
const outParent = opt("--out");
const HF = opt("--hf", "0.6.25");
if (!configPath || !outParent) { console.error("Usage: node scaffold_project.mjs --config <config.json> --out <dir>"); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
const geo = String(cfg.geo || "").toLowerCase();
if (!geo) { console.error("config.geo is required"); process.exit(1); }
const lang = cfg.lang || "en";
const compositionId = cfg.compositionId || `temu-top5-${geo}`;
const DUR = Number(cfg.duration);
if (!DUR || DUR <= 0) { console.error("config.duration (seconds, number) is required"); process.exit(1); }

const dir = path.join(outParent, `temu-top5-${geo}`);
const mediaDir = path.join(dir, "media");
fs.mkdirSync(mediaDir, { recursive: true });
fs.mkdirSync(path.join(dir, "renders"), { recursive: true });

// ---------- ffmpeg helpers (enforce the render gotchas) ----------
function ff(a) { execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: "inherit" }); }
function ffprobeDuration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim();
  return parseFloat(out);
}
// silent, dense-keyframe, 1080x1920 h264 (bg / avatar — both plain re-encodes, no keying)
function encodeVideo(src, dst, trim) {
  const a = ["-i", src, "-an"];
  if (trim) a.push("-t", String(trim));
  a.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "25", "-keyint_min", "25",
    "-pix_fmt", "yuv420p", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", "-movflags", "+faststart", dst);
  ff(a);
}

// ---------- optional media encoding ----------
const enc = cfg.encode || {};
if (enc.bg && enc.bg.from) { console.log("  encode bg → media/bg.mp4"); encodeVideo(enc.bg.from, path.join(mediaDir, "bg.mp4"), enc.bg.trim || Math.ceil(DUR)); cfg.bg = { src: "media/bg.mp4", mediaStart: 0 }; }
if (enc.avatar && enc.avatar.from) {
  console.log("  encode avatar → media/avatar.mp4");
  encodeVideo(enc.avatar.from, path.join(mediaDir, "avatar.mp4"), Math.ceil(DUR));
  cfg.avatar = Object.assign({ start: 0, duration: DUR }, cfg.avatar, { src: "media/avatar.mp4" });
}
// audio: if a voiceover mp3/wav path is given, convert to m4a and measure duration
if (enc.audio && enc.audio.from) {
  const m4a = path.join(dir, "voiceover.m4a");
  console.log("  encode audio → voiceover.m4a"); ff(["-i", enc.audio.from, "-vn", "-c:a", "aac", "-b:a", "192k", m4a]);
  cfg.audio = { src: "voiceover.m4a", duration: Number(ffprobeDuration(m4a).toFixed(2)) };
}

// product images: copy provided source PNGs into media/p{n}.png (transparent stage shots)
cfg.products.forEach((p, i) => {
  if (p.imgFrom) { const dst = `p${p.n ?? i + 1}.png`; fs.copyFileSync(p.imgFrom, path.join(mediaDir, dst)); p.img = `media/${dst}`; }
});

// TEMU logo badge: copy the provided logo into media/logo.png
if (cfg.branding && cfg.branding.logoFrom) {
  fs.copyFileSync(cfg.branding.logoFrom, path.join(mediaDir, "logo.png"));
  cfg.logo = "media/logo.png";
}

// ---------- resolve timing (VO-anchored if captionIndex given, else even spread) ----------
const N = cfg.products.length;
const cues = cfg.captions || [];
const cueStart = (idx) => (idx != null && cues[idx]) ? cues[idx].start : null;

// coupon climax anchor: explicit start > caption anchor > 68% fallback
let couponStart = cfg.timing?.coupon?.start;
if (couponStart == null && cfg.timing?.coupon?.atCaption != null) couponStart = cueStart(cfg.timing.coupon.atCaption);
if (couponStart == null) couponStart = +(DUR * 0.68).toFixed(2);

const hookStart = cfg.timing?.hook?.start ?? 0.4;
const ctaAt = cfg.timing?.cta ?? +(couponStart + Math.max(2, (DUR - couponStart) * 0.45)).toFixed(2);

// products
const anchored = cfg.products.some((p) => p.captionIndex != null || p.start != null);
if (anchored) {
  // lead the product reveal further ahead of its caption cue than the entrance animation's own
  // settle time (~0.5-0.6s) — a smaller lead left the product visibly trailing the avatar's
  // speech (user feedback 2026-07-13: "товары отстают от речи аватара")
  cfg.products.forEach((p) => { if (p.start == null && p.captionIndex != null) p.start = +Math.max(0, cueStart(p.captionIndex) - 0.35).toFixed(2); });
  cfg.products.forEach((p, i) => {
    if (p.end == null) {
      const next = cfg.products[i + 1];
      p.end = +((next && next.start != null ? next.start - 0.1 : couponStart - 0.2)).toFixed(2);
    }
  });
} else {
  const hookEndTmp = Math.min(hookStart + 3.6, DUR * 0.2);
  const segStart = hookEndTmp + 0.3, segEnd = couponStart - 0.3, per = (segEnd - segStart) / N;
  cfg.products.forEach((p, i) => { if (p.start == null) p.start = +(segStart + i * per).toFixed(2); if (p.end == null) p.end = +(p.start + per - 0.05).toFixed(2); });
}
// numbering: countdown (first shown = N) by default, or ascending
const order = cfg.numberingOrder || "countdown";
cfg.products.forEach((p, i) => { if (p.n == null) p.n = order === "countdown" ? (N - i) : (i + 1); });
// hook ends just before the first product appears
const firstStart = Math.min(...cfg.products.map((p) => p.start));
const hookEnd = cfg.timing?.hook?.end ?? +Math.min(hookStart + 3.6, firstStart - 0.2).toFixed(2);
// coupon chip reveal defaults to just AFTER the hook plate has fully faded out — never during it
// (an earlier reveal visually collided with the hook title/subtitle and felt like an unearned spoiler)
const couponChipIn = cfg.timing?.couponChipIn ?? +(hookEnd + 0.3).toFixed(2);

// ---------- build DATA ----------
const DATA = {
  compositionId, duration: DUR, seed: cfg.seed || 777,
  theme: cfg.theme,
  coupon: cfg.coupon,
  products: cfg.products.map((p) => ({ n: p.n, name: p.name, start: p.start, end: p.end, img: p.img || null })),
  captions: cfg.captions || [],
  avatar: cfg.avatar || null,
  bg: cfg.bg || null,
  audio: cfg.audio || null,
  logo: cfg.logo || null,
  timing: { couponChipIn, hook: { start: hookStart, end: hookEnd }, coupon: { start: couponStart }, cta: ctaAt },
};

// ---------- inject into template ----------
let html = fs.readFileSync(TEMPLATE, "utf8");
// STATIC media elements (HyperFrames' media contract needs a static src; muted video + -an at encode)
const audioEl = DATA.audio && DATA.audio.src
  ? `<audio id="vo" data-start="0" data-duration="${DATA.audio.duration || DUR}" data-track-index="1" data-volume="1" src="${DATA.audio.src}"></audio>`
  : "";
const bgEl = DATA.bg && DATA.bg.src
  ? `<video id="bg-video" muted playsinline data-start="0" data-duration="${DUR}" data-track-index="0" data-media-start="${DATA.bg.mediaStart || 0}" src="${DATA.bg.src}"></video>`
  : "";
const avatarEl = DATA.avatar && DATA.avatar.src
  ? `<video id="avatar-video" muted playsinline data-start="${DATA.avatar.start || 0}" data-duration="${DATA.avatar.duration || DUR}" data-track-index="2" src="${DATA.avatar.src}"></video>`
  : "";
const tokens = {
  LANG: lang, COMPOSITION_ID: compositionId, DURATION: String(DUR),
  AUDIO_EL: audioEl, BG_EL: bgEl, AVATAR_EL: avatarEl,
  DATA_JSON: JSON.stringify(DATA).replace(/</g, "\\u003c"),  // safe inside <script>
};
for (const [k, v] of Object.entries(tokens)) html = html.split(`{{${k}}}`).join(v);
const left = html.match(/\{\{[A-Z_]+\}\}/g);
if (left) { console.error(`Unreplaced tokens: ${[...new Set(left)].join(", ")}`); process.exit(1); }
fs.writeFileSync(path.join(dir, "index.html"), html);

// ---------- scaffold JSONs (mirror template-f-claude) ----------
const npx = (c) => `npx --yes hyperframes@${HF} ${c}`;
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
  name: `temu-top5-${geo}`, private: true, type: "module",
  scripts: {
    dev: npx("preview"),
    check: `${npx("lint")} && ${npx("validate")} && ${npx("inspect")}`,
    render: npx("render"),
    publish: npx("publish"),
  },
  devDependencies: { "@hyperframes/producer": `^${HF}` },
}, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id: `temu-top5-${geo}`, name: `temu-top5-${geo}`, createdAt: new Date().toISOString() }, null, 2) + "\n");
fs.writeFileSync(path.join(dir, "hyperframes.json"), JSON.stringify({
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
}, null, 2) + "\n");
// keep the resolved config for reproducibility / re-runs
fs.writeFileSync(path.join(dir, "top5.config.json"), JSON.stringify(cfg, null, 2) + "\n");

console.log(`\n✓ built ${dir}`);
console.log(`Next:\n  cd ${dir}\n  npm run check\n  npm run render -- --fps 25 --quality high`);
