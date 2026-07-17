// ElevenLabs Speech-to-Text (scribe_v1) — real per-word timestamps, via Node fetch (see
// eleven_tts.mjs for why Node not curl on this machine).
// Usage:  XI_KEY=... node eleven_stt.mjs <audio-file> <out.json> [languageCode]
import fs from "node:fs";
const key = process.env.XI_KEY;
const [audioPath, out, lang] = process.argv.slice(2);
if (!key || !audioPath || !out) { console.error("need XI_KEY env + audio path + out path"); process.exit(2); }
const form = new FormData();
form.append("model_id", "scribe_v1");
if (lang) form.append("language_code", lang);
form.append("file", new Blob([fs.readFileSync(audioPath)]), audioPath.split(/[\\/]/).pop());
const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
  method: "POST",
  headers: { "xi-api-key": key },
  body: form,
});
if (!res.ok) { console.error("HTTP", res.status, (await res.text()).slice(0, 800)); process.exit(1); }
const json = await res.text();
fs.writeFileSync(out, json);
console.log("ok, wrote", out);
