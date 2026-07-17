---
name: top5
description: Auto-generate TOP5 9:16 vertical short videos (YouTube Shorts) per GEO from a theme. Use whenever the user invokes /top5, asks to build a "ТОП5" / "TOP5" / "top 5 products" short, wants a per-GEO talking-avatar promo Short assembled end-to-end, or says something like "ТОП5 — тема" or "top5 theme | UA,PL,DE". Generates a localized 30s script, a Comfy Cloud talking avatar (free/open-source templates only), Comfy Cloud background/product assets, ElevenLabs voiceover, assembles everything in HyperFrames with YT-Shorts оформлення (title plate, persistent case-exact coupon, captions, safe zones), and outputs a project folder (all assets + finished .mp4) per GEO. Even if the user doesn't say the word "skill", route TOP5 short-video-per-GEO requests here.
argument-hint: theme | GEO1,GEO2,...   e.g.  гаджети для кухні | UA,PL,DE
allowed-tools: Bash, Read, Write, Glob, Grep, Agent, AskUserQuestion
---

# /top5 — TOP5 9:16 Shorts, автогенерація per GEO

Orchestrate a full pipeline: **theme + GEO list → localized script → ElevenLabs voiceover →
Comfy Cloud talking avatar → Comfy Cloud background/product assets → HyperFrames 9:16 assembly
with YT-Shorts оформлення → rendered .mp4**, one project folder per GEO.

This skill is an **orchestrator**. Read `references/style.md` FIRST — it holds the durable style
rules (safe zones, product-dominant / circle-crop avatar, case-exact coupon, TEMU-mention
variability), the per-GEO voice map, and the mandatory render gotchas. Honor all of it.

> **RULE: never silently guess on anything creative or ambiguous.** Script tone/phrasing, product
> picks, coupon-phrasing edge cases, which free Comfy template to substitute if a primary one is
> unavailable, TEMU-mention placement — all of these go through `AskUserQuestion`, even when
> running unattended across parallel per-GEO or per-step subagents. Only *mechanical* decisions
> (ffmpeg flags, node ids, file paths) may be resolved without asking.

> **RULE: don't tight-loop `wait_for_job`/`get_job_status` on a long Comfy render — that burns
> tokens re-reading the same "in_progress" result every ~25s for no benefit.** Heavier jobs
> (InfiniteTalk-class lip-sync, especially the manual-workflow fallback in 1e with a full-length
> audio track) can genuinely take several minutes. Call `wait_for_job` a handful of times (each
> call itself blocks ~25s server-side, so 3–4 calls already covers ~1–2 min); if it's still
> `in_progress` after that, stop polling in a tight loop and use `ScheduleWakeup` with a ~120–270 s
> delay instead, telling the next wake-up to re-check the specific `prompt_id` and continue the
> pipeline from wherever it left off. This applies to any long-running background job in this
> skill (Comfy render queue backlog, batch jobs), not just avatar generation.

## Prerequisites (state clearly if missing; this skill is shared with colleagues)
- **comfy-cloud MCP** configured + a Comfy account (no credits needed for this pipeline — every
  Comfy template used here is **free/open-source**; discovery and generation are both free).
- **`npx hyperframes`** (Node ≥22 + FFmpeg on PATH). `ffprobe` too.
- **`ELEVENLABS_API_KEY`** — stored in `<skill-dir>/.env` (this skill's own directory, wherever
  it physically lives — a colleague who copies the whole folder elsewhere gets their own
  `.env`). Checked automatically in Step 0; asked for once, then never again. All voiceover goes
  **directly** to `api.elevenlabs.io` — never through Comfy (zero Comfy credits for TTS).

## Step 0 — gate, env, args, runtime questions

0. **Connection gate (do this FIRST, before anything else).** Call `get_server_info` on the
   comfy-cloud MCP. If it errors, is unauthenticated, or unreachable: tell the user plainly —
   *"Comfy Cloud MCP is not connected — connect it via /mcp or Connectors, then re-run /top5"* —
   and **STOP**. Do not retry, do not attempt partial/manual workarounds, do not proceed to
   Step 1. Retrying a dead connection burns tokens with no way to actually generate anything.
1. **`.env` / ElevenLabs key check.** Resolve `<skill-dir>` (this SKILL.md's own directory).
   ```bash
   KEY=$(node <skill>/scripts/load_env.mjs <skill>/.env ELEVENLABS_API_KEY) && export ELEVENLABS_API_KEY="$KEY"
   ```
   - If that prints a value (exit 0): proceed silently, `$ELEVENLABS_API_KEY` is set for this run.
   - If it exits non-zero (missing file or missing key): ask once via `AskUserQuestion` for the
     ElevenLabs API key, then append `ELEVENLABS_API_KEY=<key>` to `<skill-dir>/.env` (create the
     file if it doesn't exist yet). Never ask again once it's present.
2. Split the argument on `|`: left = **theme**, right = comma-separated **GEO list**
   (e.g. `гаджети для кухні | UA,PL,DE`). If no `|`/GEO list, ask for the GEOs. Lowercase GEOs.
3. Ask with **one `AskUserQuestion`** (these are per-run and genuinely the user's):
   - **Output directory** — the PARENT folder where `temu-top5-<geo>/` projects are created
     (do NOT hardcode — this skill is shared). Offer to create it if missing.
   - **Coupon type** — `discount` (e.g. "−30%") or `gift` (free gift).
   - **Coupon code** — the exact code string (rendered **case-exact**, never uppercased).
   - (Optional) **Avatar library path** — a folder with `avatar_<GEO>.png` portraits, if the
     user has one; otherwise portraits are generated on Comfy Cloud.

## Step 1 — per-GEO generation

For **each GEO**, run 1a (script) first — everything else depends on it. Once the script exists
and Step 0's answers are in hand, fan the independent sub-steps out to **concurrent subagents**
instead of running them in one long sequential turn:

- **Comfy subagent** — owns the whole Comfy Cloud chain for this GEO: portrait (1d) →
  InfiniteTalk lip-sync (1e — sequential *within this subagent*, since lip-sync needs the
  portrait first) → background/product generation (1f), including `wait_for_job`/`get_output`
  polling and downloads via `dl.mjs`.
- **Voiceover subagent** — owns ElevenLabs TTS (1b): `body.json` write, `eleven_tts.mjs` call,
  `ffprobe` duration measurement.
- **Captions subagent** — depends on the Voiceover subagent's `voiceover.mp3` (not fully
  independent): runs `eleven_stt.mjs` + `align_captions.mjs` (1c) once that file exists. Launch it
  right after Voiceover finishes, in parallel with the still-running Comfy subagent.

Brief each subagent with: this SKILL.md's path, the resolved Step-0 answers relevant to it (e.g.
the Comfy subagent doesn't need caption phrasing; the Voiceover subagent doesn't need Comfy
template names), and the GEO. Wait for all three to report back (`portrait.png`, `avatar_raw.mp4`,
`bg_raw.mp4`/`pN.png`, `voiceover.mp3`, `cues.json`) before moving to the sequential, dependent
phase: assemble (1g) → layout calibration (1g.5, first time only) → QA gate (1h) → final render.

For **multiple GEOs**, this composes with the existing per-GEO parallelism: delegate each GEO to
its own **`general-purpose` subagent in parallel** (Comfy allows ~5 concurrent jobs), and that
GEO's subagent in turn launches its own inner Comfy/Voiceover/Captions subagents as above. For a
**single GEO**, skip the outer fan-out and just run the inner one. Each GEO produces
`temu-top5-<geo>/` and returns the final `.mp4` path.

**Product images are generated ONCE per theme and shared across every GEO in this run — not
regenerated per GEO** (fixed 2026-07-17 — a prior multi-GEO run had each GEO's Comfy subagent
independently generate its own product photos, so visually different products shipped for the
literally-same theme across the GEO batch, which read as inconsistent). Do the 5 product-image
generations (1f's per-product shots) as one shared step **before** fanning out to per-GEO Comfy
subagents — either run it yourself first, or have one designated subagent produce them and hand
the resulting `pN.png` paths to every other GEO's Comfy subagent to reuse via `imgFrom`. Only the
background video (1f's `bg.mp4`) and the avatar (1d/1e, since portraits are per-GEO already) stay
per-GEO. Generate a *different* product image set per GEO only if the user explicitly asks for
that variety.

### 1a. Script (localized, ~30s)
Generate a TOP5 script for the theme, **in the GEO's language** (see the voice-map `lang`):
- Hook (theme headline + subtitle), then **5 products** matching the theme (short punchy name +
  one-line voiceover each), then a CTA that names the coupon.
- **TOP5 is a COUNTDOWN.** The voiceover counts from 5 down to 1 ("Platz 5 … Platz 1" / "№5 … №1").
  Each product's chip number **must equal the rank the VO speaks**, so the FIRST product shown is
  №5 and the last is №1. List `products` in **appearance order** (first-shown first) with matching
  `n` (5,4,3,2,1) and set `"numberingOrder": "countdown"`.
- **Sync every product to the VO.** Give each product a `captionIndex` = the index into
  `captionPhrases` where the narrator announces it (its "Platz N:" / product-name cue). Set
  `coupon.atCaption` = the caption index where the coupon/CTA section begins. The scaffold anchors
  each reveal to that cue's real (silence-detected) time, so products no longer hurry/drift.
- **Vary the TEMU mention every run — never reuse the same CTA line verbatim.** Pick ONE
  placement pattern for this run (ask the user if genuinely ambiguous, per the "always ask"
  rule): (a) early hook mention ("тільки на Temu…"), (b) a mid-countdown aside on one product
  ("…бери на Temu за…"), or (c) CTA-only (today's default). Vary the wording per language too —
  not just the position. See `style.md`'s "TEMU mention variability" section for the full list of
  patterns and phrasing examples. The persistent coupon chip + small TEMU logo badge (see 1g) are
  UNCHANGED regardless of which placement you pick — only the spoken/captioned mention varies.
- Keep total voiceover ≈ **28–34 s** when spoken (measure the real TTS length; set `duration` to it). Write `script.json`:
```json
{
  "geo": "ua", "lang": "uk", "duration": 30, "numberingOrder": "countdown",
  "theme": { "title": "ТОП-5 ДЛЯ КУХНІ", "subtitle": "усе для смачних страв 🍳" },
  "products": [
    { "n": 5, "name": "БЛЕНДЕР",   "captionIndex": 5 },
    { "n": 4, "name": "ЧАЙНИК",    "captionIndex": 8 },
    { "n": 3, "name": "СКОВОРОДА", "captionIndex": 11 },
    { "n": 2, "name": "НІЖ",       "captionIndex": 14 },
    { "n": 1, "name": "ВАГИ",      "captionIndex": 17 }
  ],
  "voiceover": "one flowing narration that counts Platz 5 → 1 then the coupon CTA ...",
  "captionPhrases": ["Готуй смачно", "№5 —", "блендер", ... 2–4-word chunks, IN SPOKEN ORDER ...],
  "coupon": { "label": "ЗНИЖКА -30%", "cardLabel": "ТВІЙ КУПОН НА ЗНИЖКУ",
    "hint": "введи код при оформленні замовлення ↗", "cta": "⬇ Знижка в застосунку Temu", "atCaption": 20 }
}
```
`coupon.code` and `coupon.type` come from the Step-0 answers (do not invent them). Localize
`label`/`cardLabel`/`hint`/`cta` per `coupon.type` (discount vs gift) and language. `captionIndex`
values must point at the real positions in your `captionPhrases` array (count them).

**The hint's entry-field instruction depends on `coupon.type` — these are NOT interchangeable**
(confirmed 2026-07-17, prior runs wrongly used "search field" for both): **`discount`** codes are
entered **at checkout, when completing the purchase** — the hint must say something like "enter
the code at checkout" (localized), never "search field". **`gift`** codes are entered in the
marketplace app's **search field** — that hint keeps the older "search field" phrasing. Get this
backwards and the video tells the viewer to do the wrong thing in the app. See `style.md`'s Coupon
section for the full rule and localized examples.

### 1b. Voiceover — ElevenLabs direct (no Comfy)
Look up the GEO's `voice_id`/`model_id` in `scripts/voices.json` (override with `--voice` if the
user asked). Write `body.json` **with the Write tool** (no `jq` here) as
`{"text": "<voiceover>", "model_id": "eleven_multilingual_v2", "voice_settings": {"stability":0.5,"similarity_boost":0.75}}`,
then POST via the bundled Node helper:
```bash
XI_KEY="$ELEVENLABS_API_KEY" node <skill>/scripts/eleven_tts.mjs <voice_id> body.json voiceover.mp3
```
**Why Node, not curl:** on this Windows machine curl uses Schannel and fails TLS with
`CRYPT_E_NO_REVOCATION_CHECK` (offline revocation check) for `api.elevenlabs.io` and
`cloud.comfy.org`. `eleven_tts.mjs`/`dl.mjs`/`up.mjs` use Node `fetch` (its own CA bundle, no
revocation lookup) — this **validates the certificate**, it does NOT weaken TLS (never use
`curl -k`). Sanity-check with `ffprobe voiceover.mp3`; `scaffold_project.mjs` converts it to
`voiceover.m4a` and measures the exact duration (set `script.json.duration` to it).

### 1c. Captions — real per-word timing via ElevenLabs STT (PRIMARY method)
**Do not use local silence-detection as the primary timing source — use ElevenLabs' hosted
Speech-to-Text (`scribe_v1`) for real per-word timestamps instead.** (Confirmed 2026-07-13, user
asked directly: *"можем субтитры не локально ебошить а на стороне из доступных подключенных
сервисов?"* — yes: we already hold `ELEVENLABS_API_KEY` for TTS, and the same account's STT
endpoint gives ground-truth word-level alignment for free/cheap, zero local approximation.)
```bash
XI_KEY="$ELEVENLABS_API_KEY" node <skill>/scripts/eleven_stt.mjs voiceover.mp3 stt.json de
node <skill>/scripts/align_captions.mjs --voiceover script.json --stt stt.json --out cues.json
```
`eleven_stt.mjs` uploads the voiceover and returns real word-level `{text,start,end}` timestamps
(language code is optional — pass the GEO's `lang`, e.g. `de`, `uk`, `pl`). `align_captions.mjs`
then walks `script.json`'s own `voiceover` text against STT's transcription word-by-word (they
often differ slightly — digits become spelled-out numbers, hyphenated words merge/split — the
script normalizes and handles both 1:2 and 2:1 merges) and maps each `captionPhrases` entry to the
**exact** start of its first word and end of its last word. It exits non-zero and prints
diagnostics if any phrase can't be matched — fix the mismatch (usually `captionPhrases` text not
appearing verbatim as a substring of `voiceover`) and rerun; do not silently fall back to guessed
timing.

**Why this replaced the old approach:** the previous `make_captions.mjs` (ffmpeg
`silencedetect`-based) only found ~13 broad speech/silence chunks and proportionally split
captions across each by character count, ignoring un-captioned filler words ("Hier sind die X",
"der/die/das ADJ X" — very common in normal narration). That positioned captions up to ~0.9s
before the word was actually spoken — confirmed on a real run, caught by ear, not by the numbers
(*"я говорю как глазами и ушами что спешать на секунду где-то"*). `make_captions.mjs` still
exists as an **emergency fallback only** (no network / STT quota exhausted / API down) — if used,
treat its output as a rough draft and manually cross-check the tightest cues against a direct
`ffmpeg silencedetect=noise=-30dB:d=0.08` pass before trusting it for product-reveal anchoring.

### 1d. Avatar portrait (still) — free template only
- If the user gave an **avatar library**: use `avatar_<GEO>.png` from it.
- Else generate a 9:16 portrait on Comfy Cloud with a **free/open-source** text-to-image
  template: `run_template image_z_image_turbo` (Z-Image-Turbo, default — fast, battle-tested) or
  `image_flux2_text_to_image` (Flux.2 Dev, higher quality/slower fallback). Verify the current
  input node ids via `get_template_schema` first (ids drift between template revisions — never
  hardcode from this doc). No `confirm:true` needed (free template, no credits spent).
- Prompt: friendly presenter facing camera, warm smile, upper body, vertical, on a **normal,
  neutral studio background** (soft gradient or shallow-DOF interior) — there is **no chroma
  screen requirement anymore**; the avatar is composited via a circle-crop mask, not a chroma key.
- **Framing must be consistent across every GEO's portrait**, because the circle-crop (1e) relies
  on it: face centered horizontally, positioned in the **upper third** of the vertical frame,
  fixed head-to-shoulder margin (don't let the face drift to a random spot frame-to-frame).
- `get_output` → save `portrait.png`. Download with `node <skill>/scripts/dl.mjs <url> portrait.png`
  (curl fails here — see 1b).

### 1e. Talking avatar (Comfy Cloud, lip-sync — fixed workflow, no template search)
**Do not search `search_templates` or try other lip-sync templates for this step.** Use the
skill's own pinned workflow file directly — it's a known-working graph, and hunting through
Comfy's template catalog each run just re-discovers the same flakiness that made this file exist
in the first place.

1. `upload_file` the `portrait.png` and `voiceover.mp3` to Comfy. The tool emits a `curl.exe`
   command that **fails here on Schannel TLS** — instead grab the `Authorization: Bearer` token
   from the emitted command and upload via the bundled helper:
   `CTOKEN="<bearer>" node <skill>/scripts/up.mjs portrait.png top5_<geo>_portrait.png` (repeat for
   the mp3, **as `.wav`** — convert first with `ffmpeg -i voiceover.mp3 -ar 44100 -ac 1
   voiceover.wav`; this node has been unreliable with `.mp3` input in practice). Use the returned
   `name` for both.
2. Read `assets/infinitetalk_workflow_api.json` — this is the skill's pinned, known-working
   InfiniteTalk graph in **API format** (node-id-keyed, ready for `submit_workflow` directly, no
   `save_workflow`/`run_saved_workflow` round-trip needed). Patch three fields in a copy of the
   JSON before submitting:
   - `"125".inputs.audio` → the uploaded `.wav` filename
   - `"284".inputs.image` → the uploaded portrait filename
   - `"330:332".inputs.positive_prompt` → a short prompt describing this GEO's avatar talking
     naturally to camera (e.g. "Friendly young presenter talking naturally to camera, warm smile,
     subtle head movement, natural lip sync, energetic delivery")
3. `submit_workflow` with the patched JSON as `workflow`. It's a free/open-source graph — no
   `confirm:true` needed.
4. `wait_for_job` — poll a few times (~1-2 min), then switch to `ScheduleWakeup` per the polling
   rule above rather than tight-looping; a full ~30s audio track can take 5-10+ minutes end to
   end. → `get_output` → `node <skill>/scripts/dl.mjs <url> avatar_raw.mp4`.
5. **Always check the actual output frame, not just job-success**, before trusting a lip-sync
   result (extract a frame with ffmpeg and look at it) — a "succeeded" job is not proof the
   graph used your inputs.

If this pinned workflow itself starts failing (not just occasional Comfy Cloud flakiness — verify
by resubmitting unchanged once), **stop and ask the user** rather than reaching for a different
template on your own initiative (per the "always ask" rule) — they may have an updated working
export to replace `assets/infinitetalk_workflow_api.json` with. **Keep every avatar-generation
asset for this skill in the skill's own `assets/`/`scripts/` directories** (this skill physically
lives at `Desktop\temu\skill-top5\`, junctioned into `~/.claude/skills/top5`) — this file is
shared when the skill is shared with colleagues; a fix that only lives in one person's chat
history or one project's temp folder doesn't propagate.

The avatar keeps its natural background — InfiniteTalk preserves the portrait's motion/
background, so there is **no chromakey/despill matting anymore**. `scaffold_project.mjs` just
re-encodes it plainly (`-an`, dense keyframes, plain h264 mp4 — no alpha/webm needed) and the
HyperFrames template crops it to a **circle** via CSS (`border-radius:50%; overflow:hidden` +
`object-fit:cover`). **The crop must reliably show the avatar's face, not a random guess:**
because the portrait framing (1d) is consistent across GEOs, an explicit `object-position` (set
during the layout-calibration session, 1g.5 — not the `50% 50%` default) keeps the face centered
in the circle. Verify by eye on the actual composited frame each time you touch the template.
Product stays dominant (see `style.md`).

### 1f. Background + product assets (Comfy Cloud, free templates only)
- **Background** (`bg.mp4`): a **bright, vivid, product-dominant** on-theme ambient video (it's a
  coupon ad — energetic/punchy, not dark/moody). Default: `video_ltx2_3_t2v` (LTX-2.3,
  open-source). If unavailable, free alternates exist — `video_wan2_2_14B_t2v`,
  `video_hunyuan_video_1.5_720p_t2v`, `video_kandinsky5_t2v` — **ask the user** before switching
  rather than silently substituting. `run_template` → `wait_for_job` → `get_output` →
  `dl.mjs … bg_raw.mp4`. If shorter than the video, loop to length first:
  `ffmpeg -stream_loop <n> -i bg_raw.mp4 -an -t <DUR> … bg_loop.mp4`.
- **One shared product-image set per theme, not per GEO** (fixed 2026-07-17 — a prior run
  generated visually different products per GEO for the literally-same theme, which read as
  inconsistent/off-brand across the GEO batch). Generate the 5 product cutouts **once** for the
  theme and **reuse the same images across every GEO in this run** — only the on-screen text
  (product name, captions, coupon) is localized per GEO. Generate a *different* product image set
  only if the user explicitly asks for per-GEO product variety.
- **Per-product shots** (`p1.png…p5.png`, recommended for variety): one **bright, vivid** product
  image per TOP item. **Do NOT require a green-screen background for these anymore** — generate
  the product on whatever background the template naturally produces (studio, neutral, or on-theme
  backdrop), then cut it out with the **BiRefNet background-removal workflow**
  (`<skill-dir>/assets/birefnet_remove_background_api.json`) instead of `colorkey`/`chromakey`.
  This is an AI segmentation model, not a color match, so it isn't fooled by the product's own
  colors overlapping the backdrop hue — the exact failure mode that repeatedly shipped
  semi-transparent/translucent products under the old green-screen+colorkey approach (a `colorkey`
  call with untuned `similarity`/`blend` ate into light, pastel, reflective, or greenish-adjacent
  product pixels; confirmed via alpha-channel inspection showing product pixels at ~211/255 instead
  of 255, i.e. genuinely translucent, not just a rendering artifact).

  **How to run it:**
  1. `upload_file` the raw product PNG (`up.mjs` if the emitted curl fails TLS on this machine —
     see 1e's note).
  2. Read `<skill-dir>/assets/birefnet_remove_background_api.json` — patch node `"17".inputs.image`
     to the uploaded filename. This copy already has a `SaveImage` node (id `"21"`) wired to the
     final `JoinImageWithAlpha` output added on top of the original preview-only graph — the raw
     upstream file only had `PreviewImage`/`MaskPreview`, which are NOT reliably retrievable via
     `get_output` for API-submitted jobs; always confirm a `SaveImage` node exists on the output
     you need before submitting, if you ever re-source this workflow from elsewhere.
  3. `submit_workflow` (free/open-source model, no `confirm:true` needed) → `wait_for_job` →
     `get_output` → download via `dl.mjs` as `pN.png`. The output already has a real alpha channel
     — no colorkey/chromakey step needed at all.
  4. **Still verify before shipping** — a wrong `image` patch or a bad upload is a silent failure
     mode regardless of method: composite over the actual generated background for this run
     (`bg_raw.mp4` frame, not a generic solid color — that's what the viewer will actually see
     behind it) and read the result as an image:
     ```bash
     ffmpeg -y -i bg_raw.mp4 -update 1 -frames:v 1 bg_frame.png
     ffmpeg -y -i bg_frame.png -i p5.png -filter_complex "[0][1]overlay=(W-w)/2:(H-h)/2" -update 1 -frames:v 1 verify_p5_on_bg.png
     ```
     Confirm the product reads fully opaque (no washed-out/see-through areas) and has clean edges
     (no fringe/halo). If a product still comes out translucent or fringed from BiRefNet itself
     (rare, but possible on a low-contrast product/background pair), that's a segmentation-quality
     issue, not a color-key-tuning issue — try a cleaner/higher-contrast generation of that product
     rather than reaching for `colorkey` as a patch.
  `scaffold_project.mjs` does NOT process these itself — it just copies whatever file `imgFrom`
  points at, already-cut-out. Pass each via `products[].imgFrom` (scaffold copies → `media/pN.png`)
  — only after this verification.

### 1g. Assemble the project
Write a resolved `config.json` (schema below) referencing the localized script text, the coupon
answers, `cues.json`, and the raw media to encode. Include `branding.logoFrom` pointing at
wherever the user's copy of the TEMU logo PNG lives (there is no fixed default — every user's
machine is different) so the small TEMU logo badge renders next to the coupon plate — **always
ask the user for this path** rather than assuming one. Then:
```bash
node <skill>/scripts/scaffold_project.mjs --config config.json --out "<OUTPUT_DIR>"
```
This creates `<OUTPUT_DIR>/temu-top5-<geo>/` with `index.html` (DATA injected), the 4 scaffold
JSONs, `media/` (bg.mp4, avatar.mp4, pN.png, logo.png), `voiceover.m4a`, `renders/`, and
`top5.config.json`. It enforces the render gotchas (`-an`, dense keyframes, circle-crop avatar —
no keying, numeric audio `data-duration`).

### 1g.5 — Layout calibration (human-in-the-loop, run once per template revision)
Before finalizing `assets/template.html`'s avatar size/position/`object-position`, caption band,
coupon chip, and product stage: start the HyperFrames dev/preview server (`npx hyperframes`) on
the scaffolded project so the user can visually inspect the real composition and call out fixes —
avatar too small/cornered, captions overlapping the avatar's face or the TikTok/YT-Shorts platform
UI chrome (top channel bar ~220px, bottom caption/CTA bar ~320px, right like/comment/share column
~150px). Iterate live with the user, then write the FINAL agreed coordinates back into
`assets/template.html` and mirror them into `references/style.md`'s "Layout tops" line, then
re-scaffold once with the finalized template. This is a **deliberate one-time (or per-major-
revision) session with the user** — not part of the automated per-GEO Step 1 loop, and not
something to guess alone.

### 1h. QA GATE — mandatory before the final render
Do **not** ship the high-quality render until all of this passes. Fix the source (script/config/
template) and re-scaffold on any failure.
```bash
cd "<OUTPUT_DIR>/temu-top5-<geo>"
node <skill>/scripts/qa_check.mjs --project .     # logical: numbering(countdown), VO-sync, timing, duration
npm run check                                     # lint + validate + inspect (0 errors)
npx --yes hyperframes@0.6.25 render --quality draft --fps 12   # FAST preview (no `--` separator)
```
Then extract frames at each product's mid-time + the coupon climax and **look at them**:
```bash
for t in <p5_mid> <p3_mid> <p1_mid> <coupon_mid>; do ffmpeg -y -ss $t -i renders/<draft>.mp4 -frames:v 1 qa_$t.png; done
```
Verify by eye (this is the quality gate the user requires):
- **Circle crop:** avatar face fully inside the circle mask, not awkwardly cropped at chin/
  forehead, no visible rectangular video edges peeking outside the circle.
- **Numbering:** the chip number matches the rank the VO is speaking at that moment (5→1 countdown).
- **Sync:** the right product is on screen when the VO names it (not early/rushed).
- **Captions:** inside the safe band (~y 1150–1300), fully readable, not near the bottom edge,
  never overlapping the avatar's face or the platform-UI chrome.
- **Avatar:** clearly visible / noticeably larger than the old cramped corner box, not stuffed in
  a tiny corner, not covering product or coupon.
- **Safe zones:** nothing important in the top ~220 px, bottom < ~1600 px, or right ~150 px column.
- **TEMU mention:** the coupon chip + logo badge are present; the spoken/captioned TEMU mention
  actually differs in placement/phrasing from the previous run (not a copy-paste CTA line).
- **Product opacity:** each `pN.png` product reads fully solid/opaque against the real background —
  no translucent/see-through product, no fringe/halo at its edges. This was a recurring failure
  mode under the old green-screen+colorkey approach; BiRefNet cutout (1f) fixes it at the root, but
  still check it explicitly here rather than assuming 1f's verification was done correctly.
- **Coupon field wording:** the hint names the field matching this run's actual `coupon.type` —
  "checkout" for `discount`, "search field" for `gift` — never the wrong one for the type shipped.
- **Animation:** things move — bg drift, product bob, chip pop, coupon shine.

Only when all pass, render final and hand off:
```bash
npx --yes hyperframes@0.6.25 render --fps 25 --quality high
cp renders/<final>.mp4 temu-top5-<geo>.mp4
```
Known non-blocking warnings (per `style.md`): contrast-on-chip false positives, google-fonts lint,
and the `StaticGuard hf-audio-0/hf-video-0` notice (framework stubs). On text overflow from
`inspect`, shorten the offending product name/subtitle and re-scaffold.

### 1i. YouTube SEO package — ONLY after the user has approved the render
**Do not generate this automatically right after the QA gate.** The QA gate is an agent-side
correctness check; SEO packaging happens only once the user has actually looked at the finished
`.mp4` and signed off on it (they may still ask for edits after 1h, in which case the render isn't
final yet — re-render, don't write SEO copy for a cut that's about to change). Trigger: user
says something like "готово"/"апрув"/"хорошо, финалим" (or equivalent) about the render itself —
per SKILL.md's global "always ask" rule, if it's ambiguous whether they're approving the video or
just this one note, ask rather than assume.

Once approved, **post the SEO package directly in the chat reply — never write it to a file.**
The user copy-pastes this straight into YouTube Studio; a file it has to go dig up in some
project folder is friction, not a deliverable. (Confirmed instruction, 2026-07-13: *"впиши в
скил что берешь и в чат оформление пишешь, а не в файлы какие-то."*) Write it in the **video's own
language** (not English, unless the GEO's language is English), containing:
- **Title** — under 100 characters, keyword-front-loaded (theme + "Temu" + year or "2026" if it
  reads naturally), include `#Shorts`. Localize to the GEO's language.
- **Description** — 150–300 words: opens with the hook/theme, lists the 5 products by name,
  mentions the coupon call-to-action (code + the correct entry-field instruction for its
  `coupon.type` — checkout for discount, search field for gift — matching what's in the
  video, never invent a different code/type/field), naturally works in 8–12 relevant search keywords
  for the theme + GEO market, ends with 5–8 hashtags (mix of broad + niche, e.g.
  `#Temu #SommerGadgets #TopProdukte #Shorts` for DE).
- **Keywords/tags** — a flat comma-separated list of 15–20 tags for YouTube's tags field (broad →
  specific, include the GEO-language product category terms and "Temu").
Do this **per GEO that was rendered and approved** — each GEO gets its own SEO package in its own
language, posted as its own chat block, not one shared English blob translated in the user's head.

## Scaffold config schema (`config.json`)
```json
{
  "geo": "ua", "lang": "uk", "duration": 30, "compositionId": "temu-top5-ua",
  "numberingOrder": "countdown",
  "theme": { "title": "ТОП-5 ДЛЯ КУХНІ", "subtitle": "усе для смачних страв 🍳" },
  "coupon": { "type": "discount", "label": "ЗНИЖКА -30%", "cardLabel": "ТВІЙ КУПОН",
              "code": "alh285663", "hint": "введи код при оформленні замовлення ↗", "cta": "⬇ Знижка в Temu" },
  "branding": { "logoFrom": "/abs/path/to/Temu-Logo.png" },
  "products": [ { "n": 5, "name": "БЛЕНДЕР", "captionIndex": 5, "imgFrom": "/abs/p5.png" }, ... 5, appearance order ... ],
  "captions": [ ...contents of cues.json... ],
  "timing": { "coupon": { "atCaption": 20 } },
  "encode": {
    "bg":     { "from": "/abs/bg_loop.mp4", "trim": 30 },
    "avatar": { "from": "/abs/avatar_raw.mp4" },
    "audio":  { "from": "/abs/voiceover.mp3" }
  }
}
```
- **Numbering:** `numberingOrder` = `"countdown"` (default; chips N→1, first product `n`=N) or
  `"ascending"`. Set each `product.n` to the rank the VO speaks.
- **Sync:** give each product `captionIndex` (→ scaffold sets `start` from that cue's real time,
  `end` from the next product); set `timing.coupon.atCaption` for the climax. Omit both only to
  fall back to even spacing. Explicit `start/end` still override.
- `encode.avatar`: just the raw lip-sync mp4 path — no keying fields anymore. The template
  applies the circle-crop mask unconditionally in CSS.
- `branding.logoFrom` (abs path, optional but recommended): scaffold copies it to `media/logo.png`
  and the template renders a small badge next to the coupon plate. Omit to render without a logo.
- `products[].imgFrom` (abs path) → scaffold copies to `media/pN.png` and floats it on the stage;
  omit if no per-product shot.

## Step 2 — summary
Report a table: **GEO → final .mp4 path**, plus any GEO that needed manual attention. Mention
that **no Comfy credits were spent** (every template used is open-source/free) — TTS was billed
to ElevenLabs only.

## Notes
- Never hardcode personal paths — always use the user's chosen output dir.
- `<skill-dir>` = this skill's own directory; resolve `scripts/`, `assets/`, `references/`
  relative to it. This skill physically lives at `Desktop\temu\skill-top5\` (junctioned into
  `~/.claude/skills/top5` so it still triggers as `/top5`).
- Test/example projects go under `<skill-dir>/examples/` — never under the old scattered
  `D:\projects\temu-*` dirs; those are deprecated, do not reuse or reference them.
- If a Comfy template's node ids differ from what this doc assumes (this covers
  `image_z_image_turbo`, `image_flux2_text_to_image`, `templates-wan2_1_infinitetalk_music`,
  `video_ltx2_3_t2v` and its free alternates), trust the live `get_template_schema` and adapt the
  `input_overrides` — surface the drift to the user.
