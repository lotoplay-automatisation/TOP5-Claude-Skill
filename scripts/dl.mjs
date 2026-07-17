// Download a URL to a file via Node fetch (validates cert chain; avoids Windows Schannel
// CRYPT_E_NO_REVOCATION_CHECK that breaks curl on this network). Follows redirects.
// Usage:  node dl.mjs <url> <outfile>
import fs from "node:fs";
const [url, out] = process.argv.slice(2);
if (!url || !out) { console.error("usage: node dl.mjs <url> <out>"); process.exit(2); }
const res = await fetch(url, { redirect: "follow" });
if (!res.ok) { console.error("HTTP", res.status, (await res.text()).slice(0, 300)); process.exit(1); }
fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
console.log("saved", out, fs.statSync(out).size, "bytes");
