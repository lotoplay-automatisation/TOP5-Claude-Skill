// Pre-render QA gate (logical checks) for a scaffolded TOP5 project.
// Reads <project>/top5.config.json (resolved config the scaffold writes) and asserts the
// things the eye can't quickly verify: numbering order, product↔voiceover sync, monotonic
// timing, caption sanity, duration match. Exits non-zero with a report if anything fails.
// Spatial safe-zone + keying quality are verified visually on draft-render frames (see SKILL.md).
//
// Usage:  node qa_check.mjs --project <dir>        (or)  --config <path/to/top5.config.json>

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const proj = opt("--project");
const cfgPath = opt("--config") || (proj ? path.join(proj, "top5.config.json") : null);
if (!cfgPath) { console.error("Usage: node qa_check.mjs --project <dir> | --config <file>"); process.exit(2); }

const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const fails = [];
const warns = [];
const F = (m) => fails.push(m);
const W = (m) => warns.push(m);

const DUR = Number(cfg.duration);
const products = cfg.products || [];
const cues = cfg.captions || [];
const N = products.length;
const order = cfg.numberingOrder || "countdown";
const TOL = 0.75; // s — product start vs its caption anchor

// 1) numbering
const nums = products.map((p) => p.n);
const expected = products.map((_, i) => order === "countdown" ? N - i : i + 1);
if (new Set(nums).size !== N) F(`numbering: n values not unique → [${nums.join(",")}]`);
if (JSON.stringify(nums) !== JSON.stringify(expected)) F(`numbering: order is [${nums.join(",")}] but ${order} expects [${expected.join(",")}] (first shown must be ${expected[0]})`);

// 2) product↔VO sync + monotonic, non-overlapping
let prevEnd = -1;
products.forEach((p, i) => {
  if (p.start == null || p.end == null) { F(`product ${i} (${p.name}) missing start/end`); return; }
  if (p.start <= prevEnd - 0.05) F(`product ${i} (${p.name}) starts ${p.start}s before previous ended ${prevEnd}s (overlap/out of order)`);
  if (p.end <= p.start) F(`product ${i} (${p.name}) end ${p.end} ≤ start ${p.start}`);
  if (p.captionIndex != null) {
    const c = cues[p.captionIndex];
    if (!c) F(`product ${i} (${p.name}) captionIndex ${p.captionIndex} out of range (cues=${cues.length})`);
    else if (Math.abs(p.start - c.start) > TOL) F(`product ${i} (${p.name}) start ${p.start}s not synced to its VO cue "${c.text}" @${c.start}s (>${TOL}s off)`);
  } else W(`product ${i} (${p.name}) has no captionIndex — reveal not VO-anchored`);
  prevEnd = p.end;
});
if (products[0] && products[0].start < 1.0) W(`first product at ${products[0].start}s — very early; check it doesn't precede the intro VO`);

// 3) duration vs audio
if (cfg.audio && cfg.audio.duration != null) {
  if (Math.abs(DUR - cfg.audio.duration) > 0.6) F(`duration ${DUR}s vs audio ${cfg.audio.duration}s differ by >0.6s`);
}

// 4) captions sanity
let cPrev = -1;
cues.forEach((c, i) => {
  if (!(c.start >= 0 && c.end > c.start && c.end <= DUR + 0.05)) F(`caption ${i} "${c.text}" bad timing start=${c.start} end=${c.end} (dur=${DUR})`);
  if (c.start < cPrev - 0.05) F(`caption ${i} "${c.text}" overlaps previous (start ${c.start} < prev end ${cPrev})`);
  cPrev = c.end;
});
if (!cues.length) W("no captions");

// 5) coupon
if (!cfg.coupon || !cfg.coupon.code) F("coupon.code missing");

// report
console.log(`QA — ${N} products, ${cues.length} cues, ${DUR}s, numbering=${order}`);
warns.forEach((w) => console.log("  ⚠ " + w));
if (fails.length) { console.log("\nQA FAILED:"); fails.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
console.log("  ✓ logical QA passed");
