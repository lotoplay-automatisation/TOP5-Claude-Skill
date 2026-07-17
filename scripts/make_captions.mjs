// Caption timing without Whisper (not installed here).
// Detects speech segments in the voiceover via ffmpeg silencedetect, then distributes
// pre-chunked caption phrases across the SPEECH time proportionally to their length, so
// captions show during speech and rest during pauses. Outputs [{text,start,end}] JSON.
//
// Usage:
//   node make_captions.mjs --audio voiceover.m4a --phrases phrases.json [--out cues.json]
//     [--noise -34] [--mindur 0.14]
//   phrases.json = ["Літо, сонце", "готовий до відпустки?", ...]  (LLM pre-chunks to 2–4 words,
//   in the GEO language — it knows the wording; this script only assigns timing).
//
// Prints the cues JSON to stdout and, if --out given, writes it there.

import fs from "node:fs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const audio = opt("--audio");
const phrasesPath = opt("--phrases");
const outPath = opt("--out");
const noise = opt("--noise", "-30");     // dB threshold
const minDur = opt("--mindur", "0.08");  // min silence duration (s)
// NOTE 2026-07-13: was -34dB/0.14s, which only found ~13 broad segments on a 27-cue script and
// proportionally split MULTIPLE captions across each one by character count alone — ignoring
// un-captioned filler words ("Hier sind die", "der tragbare", "die wasserdichte" etc. between
// captioned chunks), so captions before/after a filler stretch could start up to ~0.85s off from
// when the word was actually spoken. Finer defaults catch ~20 real segments instead, which is
// closer but still isn't full per-word alignment — if a caption's own text is preceded by a filler
// word inside the SAME detected segment (no pause between them), it will still be positioned too
// early. For scripts with a lot of filler words before captioned phrases, cross-check the tightest
// cues against a manual `ffmpeg silencedetect` pass (see SKILL.md's timing-verification note)
// rather than trusting this script's output blindly.
if (!audio || !phrasesPath) { console.error("Usage: node make_captions.mjs --audio <file> --phrases <phrases.json> [--out cues.json]"); process.exit(1); }

const phrases = JSON.parse(fs.readFileSync(phrasesPath, "utf8")).filter((s) => String(s).trim().length);
if (!phrases.length) { console.error("no phrases"); process.exit(1); }

// total duration
const total = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio]).toString().trim());

// silencedetect writes to stderr; ffmpeg exits 0, so capture the stderr pipe directly
let log = "";
try {
  execFileSync("ffmpeg", ["-hide_banner", "-nostats", "-i", audio, "-af", `silencedetect=noise=${noise}dB:d=${minDur}`, "-f", "null", "-"],
    { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
} catch (e) { /* nonzero exit still carries stderr */ log = (e.stderr || e.stdout || "").toString(); }
// on success, stderr isn't returned by execFileSync; re-run through spawnSync to grab it
if (!log.includes("silence")) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", audio, "-af", `silencedetect=noise=${noise}dB:d=${minDur}`, "-f", "null", "-"], { encoding: "utf8" });
  log = (r.stderr || "") + (r.stdout || "");
}

// parse silence intervals
const silences = [];
let curStart = null;
for (const line of log.split(/\r?\n/)) {
  let m = line.match(/silence_start:\s*(-?[\d.]+)/);
  if (m) { curStart = Math.max(0, parseFloat(m[1])); continue; }
  m = line.match(/silence_end:\s*(-?[\d.]+)/);
  if (m && curStart != null) { silences.push([curStart, parseFloat(m[1])]); curStart = null; }
}

// speech segments = complement of silences within [0, total]
const speech = [];
let cursor = 0;
for (const [s, e] of silences.sort((a, b) => a[0] - b[0])) {
  if (s > cursor + 0.02) speech.push([cursor, s]);
  cursor = Math.max(cursor, e);
}
if (cursor < total - 0.02) speech.push([cursor, total]);
if (!speech.length) speech.push([0, total]);

// cumulative speech timeline mapping (speech-time -> real-time)
const segs = speech.map((seg) => ({ start: seg[0], end: seg[1], len: seg[1] - seg[0] }));
const speechTotal = segs.reduce((a, s) => a + s.len, 0);
function mapSpeechToReal(p) { // p in [0, speechTotal]
  let acc = 0;
  for (const s of segs) { if (p <= acc + s.len) return s.start + (p - acc); acc += s.len; }
  return segs[segs.length - 1].end;
}

// allocate phrases proportional to char length
const weights = phrases.map((t) => Math.max(4, t.length));
const wTotal = weights.reduce((a, b) => a + b, 0);
let pos = 0;
const cues = phrases.map((text, i) => {
  const dur = (weights[i] / wTotal) * speechTotal;
  const start = mapSpeechToReal(pos);
  let end = mapSpeechToReal(pos + dur);
  pos += dur;
  // ensure minimum on-screen time
  if (end - start < 0.55) end = Math.min(total, start + 0.55);
  return { text, start: +start.toFixed(2), end: +end.toFixed(2) };
});
// keep non-overlapping, clamp to total
for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end) cues[i].start = cues[i - 1].end;
cues[cues.length - 1].end = Math.min(cues[cues.length - 1].end, +total.toFixed(2));

const json = JSON.stringify(cues, null, 2);
if (outPath) fs.writeFileSync(outPath, json + "\n");
process.stdout.write(json + "\n");
console.error(`[make_captions] ${cues.length} cues • ${segs.length} speech segments • total ${total.toFixed(2)}s`);
