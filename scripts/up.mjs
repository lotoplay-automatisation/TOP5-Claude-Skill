// Upload a file to Comfy Cloud's input via Node fetch (avoids Windows Schannel revocation
// failure that breaks curl here). Auth via Bearer token in env CTOKEN.
// Usage:  CTOKEN=<bearer> node up.mjs <filepath> <filename> [endpoint]
import fs from "node:fs";
const [fp, fn, endpoint = "https://cloud.comfy.org/api/upload/image"] = process.argv.slice(2);
const token = process.env.CTOKEN;
if (!token || !fp || !fn) { console.error("need CTOKEN env + filepath + filename"); process.exit(2); }
const fd = new FormData();
fd.append("image", new Blob([fs.readFileSync(fp)]), fn);
const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
const text = await res.text();
console.log(res.status, text);
if (!res.ok) process.exit(1);
