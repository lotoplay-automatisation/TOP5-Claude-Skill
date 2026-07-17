// Aligns pre-chunked captionPhrases to REAL per-word timestamps from ElevenLabs STT
// (eleven_stt.mjs), instead of make_captions.mjs's silence-detection approximation.
//
// Usage:
//   node align_captions.mjs --voiceover script.json --stt stt.json --out cues.json
//   script.json needs a top-level "voiceover" (the exact text that was spoken) and
//   "captionPhrases" (2-4-word chunks, in spoken order, all substrings of "voiceover").
//
// Method: two-pointer walk over (our own written tokens) vs (STT's transcribed word tokens).
// STT's transcription of the SAME audio can differ from what we wrote — digits become spelled-
// out numbers ("5" -> "fünf"), hyphens get dropped or words get merged/split ("gratis Geschenk"
// -> "Gratisgeschenk") — so this is NOT a naive positional zip. It normalizes both sides and
// handles 1:1, 2:1 (our two tokens = their one), and 1:2 merges before falling back to a
// best-effort advance. Once every OUR token has a real start/end, captionPhrases are just
// contiguous ranges of our own tokens (found by substring search), so cue boundaries are the
// first token's start and the last token's end — exact, not estimated.

import fs from "node:fs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const scriptPath = opt("--voiceover");
const sttPath = opt("--stt");
const outPath = opt("--out");
if (!scriptPath || !sttPath) { console.error("Usage: node align_captions.mjs --voiceover script.json --stt stt.json [--out cues.json]"); process.exit(1); }

const script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
const stt = JSON.parse(fs.readFileSync(sttPath, "utf8"));

const ourTokens = script.voiceover.split(/\s+/).filter(Boolean);
const sttWords = stt.words.filter((w) => w.type === "word");

// common German digit -> spoken-word equivalents (extend if a script ever uses other digits)
const DIGIT_WORDS = { "0": "null", "1": "eins", "2": "zwei", "3": "drei", "4": "vier", "5": "fünf", "6": "sechs", "7": "sieben", "8": "acht", "9": "neun", "10": "zehn" };
function norm(s) {
  let t = s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
  if (DIGIT_WORDS[t]) t = DIGIT_WORDS[t];
  return t;
}

const timing = new Array(ourTokens.length).fill(null);
let i = 0, j = 0;
const warnings = [];
while (i < ourTokens.length && j < sttWords.length) {
  const a = norm(ourTokens[i]);
  const b = norm(sttWords[j].text);
  if (a === b) { timing[i] = { start: sttWords[j].start, end: sttWords[j].end }; i++; j++; continue; }
  if (i + 1 < ourTokens.length && norm(ourTokens[i] + ourTokens[i + 1]) === b) {
    timing[i] = timing[i + 1] = { start: sttWords[j].start, end: sttWords[j].end }; i += 2; j++; continue;
  }
  if (j + 1 < sttWords.length && norm(sttWords[j].text + sttWords[j + 1].text) === a) {
    timing[i] = { start: sttWords[j].start, end: sttWords[j + 1].end }; i++; j += 2; continue;
  }
  warnings.push(`mismatch at our[${i}]="${ourTokens[i]}" vs stt[${j}]="${sttWords[j].text}" — best-effort advance`);
  timing[i] = { start: sttWords[j].start, end: sttWords[j].end }; i++; j++;
}
if (i < ourTokens.length) warnings.push(`${ourTokens.length - i} trailing our-tokens had no STT match (STT ran out first)`);

// find each captionPhrase's contiguous token range within ourTokens (case/punct-insensitive)
const ourNorm = ourTokens.map(norm);
let cursor = 0;
const cues = script.captionPhrases.map((phrase) => {
  const pTokens = phrase.split(/\s+/).filter(Boolean).map(norm);
  for (let start = cursor; start <= ourTokens.length - pTokens.length; start++) {
    let ok = true;
    for (let k = 0; k < pTokens.length; k++) if (ourNorm[start + k] !== pTokens[k]) { ok = false; break; }
    if (ok) {
      const first = timing[start], last = timing[start + pTokens.length - 1];
      cursor = start + pTokens.length;
      return { text: phrase, start: +first.start.toFixed(2), end: +last.end.toFixed(2) };
    }
  }
  warnings.push(`captionPhrase "${phrase}" not found as a contiguous run in voiceover text starting at token ${cursor}`);
  return { text: phrase, start: null, end: null };
});

if (warnings.length) { console.error("[align_captions] warnings:\n" + warnings.map((w) => "  " + w).join("\n")); }
if (cues.some((c) => c.start == null)) { console.error("[align_captions] FAILED — some cues unaligned, fix captionPhrases/voiceover text and retry"); process.exit(1); }

const json = JSON.stringify(cues, null, 2);
if (outPath) fs.writeFileSync(outPath, json + "\n");
process.stdout.write(json + "\n");
console.error(`[align_captions] ${cues.length} cues aligned to real STT word timestamps, 0 unresolved`);
