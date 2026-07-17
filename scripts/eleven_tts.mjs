// ElevenLabs TTS via Node fetch (validates cert chain via Node CA bundle; avoids the Windows
// Schannel CRYPT_E_NO_REVOCATION_CHECK that breaks curl on this network). No TLS weakening.
// Usage:  XI_KEY=... node eleven_tts.mjs <voice_id> <body.json> <out.mp3>
import fs from "node:fs";
const key = process.env.XI_KEY;
const [voice, bodyPath, out] = process.argv.slice(2);
if (!key || !voice || !bodyPath || !out) { console.error("need XI_KEY env + voice + body + out"); process.exit(2); }
const body = fs.readFileSync(bodyPath);
const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
  method: "POST",
  headers: { "xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg" },
  body,
});
if (!res.ok) { console.error("HTTP", res.status, (await res.text()).slice(0, 800)); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(out, buf);
console.log("ok bytes", buf.length);
