// Tiny hand-rolled .env reader — no dotenv dependency (corporate cert blocks npm installs here).
// Usage: node load_env.mjs <path-to-.env> <KEY>
//   Prints the value to stdout if found, exits 1 with nothing printed if missing.
import fs from "node:fs";

const [, , envPath, key] = process.argv;
if (!envPath || !key) { console.error("Usage: node load_env.mjs <.env path> <KEY>"); process.exit(2); }

if (!fs.existsSync(envPath)) process.exit(1);

const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const k = trimmed.slice(0, eq).trim();
  if (k === key) { console.log(trimmed.slice(eq + 1).trim()); process.exit(0); }
}
process.exit(1);
