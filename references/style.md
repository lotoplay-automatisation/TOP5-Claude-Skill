# TOP5 Shorts — style, voices & render gotchas

Consolidated from the user's durable prefs and render learnings. The skill and the
`scaffold_project.mjs` output must honor everything here.

## 9:16 layout & safe zones (YT Shorts)

- Canvas **1080×1920, 25 fps**. Warm near-black bg `#0D0907` / `#0E0B08`.
- **Product/background is dominant, full-frame.** The AI product video (`media/bg.mp4`) or
  per-item product shots fill the frame — they are the star.
- **Avatar is NOT full-screen**, but must be **clearly visible** — a circle-crop bubble,
  bottom-left, 420×420 px, `#avatar-wrap` left 24 top 900. Never covers product/coupon/its own
  face.
- **Safe zones (enforce in QA):** all important content within **y 220 … 1600** and **x 20 … 930**
  (top = channel/title UI; bottom ~320 px = Shorts caption/CTA UI; right ~150 px = like/comment/
  share column). Captions sit at **top ≈ 1220 px** (raised from an earlier too-low 1310/1630 pass
  — user feedback 2026-07-12: "субтитры выше").
- **TEMU logo mark: raw PNG only, NO plate/background/border box behind it.** A dark rounded
  "badge" card (matching the coupon chip's styling) was tried and explicitly rejected — user
  feedback 2026-07-12: *"лого ТЕМУ не надо делать милипиздрическим, не ставь его на фон какой-то,
  просто лого в нормальном размере справа в углу, можешь обводочку для контрастности ебануть."*
  Render it **large** (208×208 px container, bumped up again 2026-07-13 per "чуть больше",
  `object-fit: contain`), **top-right corner** (`top: 178px; right: 30px`), with only a thin dark
  **outline/drop-shadow for contrast** against the busy background (CSS `filter: drop-shadow(...)`
  stack, not a filled box) — see `#temu-logo-badge` in `assets/template.html` for the exact filter.
- Layout tops (template defaults, current): coupon-chip 250 · hook-plate 300 · number-chip 500 ·
  product-stage 570 · avatar 900–1320 (face ~960–1140) · TEMU logo 178 (top-right, no plate) ·
  captions 1245 · cta 1400. Captions must clear the avatar's face (they may cross its lower/chest
  area — that's intentional, never the face). Number-chip/product-stage were nudged down from
  470/540 on 2026-07-13 per user feedback ("подписи товаров и сами товары чуть ниже") — verify by
  rendering + eyeballing frames (not just `hyperframes inspect`, which only audits *text*
  overflow — it will NOT catch an image visually overlapping the avatar) if nudging further.
  Captions were nudged again 1220→1245 the same day; captions/CTA coexist on screen near the end
  (last caption ends ~29s, CTA appears ~27s) — check that gap by rendering + extracting a frame in
  that window before pushing captions any lower, don't just trust `inspect`.

## Timing feel — sync product/caption reveals to the actual voiceover, not a flat offset
- **Caption pop-in must read as calm, not snappy/rushed**, even though the underlying speech
  itself is fast (short 2-4-word cue windows). User feedback 2026-07-13: *"спешат они слегонца и в
  глаза это бросается"* (they rush a bit, it catches the eye — badly). Fix was NOT to change
  timing (captions are already accurately synced via real silencedetect) but to soften the
  animation itself with a gentler ease (`power2.out`, not an aggressive `back.out` bounce).
  **First attempt used a flat 0.22s-in/0.15s-out and made it WORSE** — on a real ~0.55-0.6s
  caption window (several exist, fast 1-2-word beats are normal speech) that ate 60-70% of the
  ENTIRE window in transition, leaving almost nothing readable, which reads as more rushed, not
  less — same user, same message, called it out again: *"спешат... на секунду где-то"*. Fixed by
  making transition duration **proportional to each caption's own window**
  (`inD = min(0.22, groupDuration*0.28)`, `outD = min(0.15, groupDuration*0.22)`) so short cues
  keep ≥45% of their window fully settled/readable while longer cues still get the fuller, calmer
  pop — see the caption tween in `assets/template.html`. If a future GEO's captions still feel
  rushed, check the actual per-cue durations (`cues.json`) for outliers before touching easing
  again — a flat number will always break on whatever GEO/script happens to have the shortest cue.
- **Products must lead their caption cue by enough margin that they're fully settled (not still
  mid-entrance-animation) by the time the avatar starts saying the product's name**, or they read
  as lagging behind the speech. User feedback 2026-07-13: *"товары отстают от речи аватара"*.
  `scaffold_project.mjs`'s caption-anchored product-start default lead was bumped from `-0.15` to
  `-0.35` (the product's own entrance tween needs ~0.5-0.6s to fully settle after `p.start`, so the
  lead has to clear that plus a beat before the "Platz N:"/rank cue even starts). If products still
  feel behind after this, increase the lead further rather than reverting to a flat/no lead.
- Avoid pure `#000`/`#fff`, neon, gradient text. Fonts below.

## Brand system

- Colors: bg `#0D0907`; orange `#FB7701` → `#E25A00`; gold `#F4C95D` → `#FFE08A`; white.
- Fonts (Google Fonts `<link>` — works in headless-Chrome render even though the lint warns):
  **Barlow Condensed 800/900** (display/plates/chips) + **DM Sans 700/800** (captions, codes).
  These resolve cleanly; `JetBrains Mono`/`Inter` also OK.

## TEMU mention variability

The spoken/captioned TEMU mention must **vary every run** — never reuse the same CTA phrasing
verbatim across GEOs or across repeat runs of the same GEO. Pick one placement pattern per run
(ask the user if genuinely ambiguous):
- **Hook mention** — dropped in the opening line ("тільки на Temu…" / "only on Temu…").
- **Mid-countdown aside** — attached to one product's line ("…бери на Temu за…" / "…grab it on
  Temu for…").
- **CTA-only** — named just in the closing CTA (today's default baseline).
Vary the wording per language too, not just the position (synonyms for "found on Temu" / "deal on
Temu" / "тільки в Temu" etc.). This is a script-writing instruction (Step 1a) — it does not change
the persistent coupon chip or the small TEMU logo badge, which are always present regardless of
which placement is chosen for the spoken line.

## Coupon — ONE element only, delayed reveal, with a type-correct entry-field hint

**There is exactly ONE coupon element (`#coupon-chip-small`, top-left), not two.** An earlier
version also spawned a separate "big coupon card" at the climax — user feedback 2026-07-12
rejected this outright: *"в конце нахуя два купона нужны"* (why do you need two coupons at the
end). The single chip carries **label + code + hint** stacked, and at the climax it pops bigger
and glows in place — no second card is created.

- The skill asks per run: **type** (`discount` → "-30%" style, or `gift` → "gift/free" style)
  and the **exact code**.
- Render the code **CASE-EXACT**: never `text-transform`. Example `alh285663` stays lowercase.
- **Reveal timing: NEVER immediately at video start, and NEVER while the hook plate/subtitle is
  still on screen.** An earlier version revealed the chip at a flat ~2.2s, which visually
  collided with the hook title/subtitle (still on screen until ~4s) and felt like an unearned
  spoiler — user feedback 2026-07-12: *"он перекрывает надпись"* / *"нахуй ты его палишь сразу"*.
  `scaffold_project.mjs` now defaults `couponChipIn` to `hookEnd + 0.3` (computed automatically,
  after the hook has fully faded) — do not hardcode an earlier flat value unless the user asks.
- **The hint's entry-field wording depends on `coupon.type` — do not use the same field for both**
  (fixed 2026-07-17 — earlier runs wrongly told discount-coupon viewers to use the search field,
  which is wrong for that flow and tells the viewer to do the wrong thing in the app):
  - **`discount`** (e.g. "-30%"): the code is entered **at checkout, when completing the
    purchase** — never "search field" for this type. Localize e.g. UK: *"введи код при оформленні
    замовлення ↗"*, PL: *"wpisz kod przy finalizacji zakupu ↗"*, DE: *"Code beim Checkout
    eingeben ↗"*, IT: *"inserisci il codice al checkout ↗"*.
  - **`gift`** (free gift): the code IS entered in the marketplace app's **search field** — this is
    the one case that keeps the older phrasing. Localize e.g. UK: *"введи код у пошук ↗"*, DE:
    *"Code ins Suchfeld eingeben ↗"*.
  Every GEO's `coupon.hint` must reference the correct field for its actual `coupon.type` — never
  vaguely "in the shop", and never copy a hint from one type's example when writing the other's.
- The chip enters once (after the hook, see above), **stays visible to the end**, with a subtle
  idle pulse before the climax and a bigger pop + glow at the climax (`DATA.timing.coupon.start`)
  — all on the same element.
- **If the coupon (or anything) animates into a spot another element occupies (e.g. flying to
  center stage where the last product sat), gate it on that element's actual exit completing —
  never a raw hardcoded timestamp.** A literal `24` (taken from a Studio scrubber position while
  eyeballing where it "felt right") fired before the last product had even started its exit
  animation, so the coupon slid in on top of a still-fully-visible product — ghosting/bleed-through
  — user feedback 2026-07-13: *"убери из-под плашки картинку с товаром"*. Compute
  `Math.max(climaxCueTime, lastProductEnd + buffer)` from `DATA.products[].end` instead (see
  `assets/template.html`'s `lastProductEnd`/`moveAt` pattern) so the timing self-corrects if
  product timing ever changes.

## Captions

- Whisper is **not installed** here — do not call `hyperframes transcribe`. Derive cue
  boundaries from speech pauses via `make_captions.mjs` (ffmpeg `silencedetect`).
- Merge choppy 1–2-word fragments into **2–4-word** phrases. Clean STT artifacts.
- Caption band: `#captions-wrap` at top ≈ **1310 px**, 820 px wide, centered, dark pill bg
  (readable, inside the safe band, over the avatar's chest — never the bottom edge, never the face).

## Avatar (Comfy talking-avatar → circle-crop bubble)

The Comfy avatar (`templates-wan2_1_infinitetalk_music`, Wan2.1 InfiniteTalk) comes back as a
normal MP4 that **preserves the source portrait's own background** — there is nothing to key.
`scaffold_project.mjs` just re-encodes it plainly (audio stripped, dense keyframes, plain h264
mp4 — no alpha/webm/VP9 needed since there's no transparency):

```
ffmpeg -i avatar_raw.mp4 -an \
  -c:v libx264 -preset veryfast -crf 20 -g 25 -keyint_min 25 \
  -pix_fmt yuv420p -movflags +faststart media/avatar.mp4
```

HyperFrames renders it inside a circular mask, unconditionally:
`#avatar-wrap { border-radius: 50%; overflow: hidden; }` +
`#avatar-video { object-fit: cover; object-position: <TBD — see layout calibration>; }`.

- **No chroma screen requirement anymore.** Generate the portrait (1d) on a normal neutral studio
  background — the circle-crop, not a key, is what isolates the avatar.
- **Framing consistency is what makes the crop work.** Because every GEO's portrait uses the same
  composition (face centered horizontally, upper third of frame, fixed head-to-shoulder margin —
  see SKILL.md 1d), a single tuned `object-position` keeps the face centered in the circle across
  all GEOs. That value is set once, live, in the 1g.5 layout-calibration session — not guessed.
- Verify by eye on the actual composited frame each time the template changes: face fully inside
  the circle, no chin/forehead cropped off, no visible rectangular video edge peeking outside.

## Render gotchas (must-follow)

- `<audio src="…mp4">` renders **silent** → always extract audio to `.m4a`
  (`ffmpeg -i voiceover.mp3 -c:a aac -b:a 192k voiceover.m4a`) and give `<audio>` an
  **explicit numeric** `data-duration` (from `ffprobe`), never `"auto"`.
- A `muted <video>` still **leaks its source audio** into the render → reencode every bg/avatar
  clip with `-an`.
- Sparse-keyframe warning → reencode dense: `-g 25 -keyint_min 25 -c:v libx264 -crf 18/20
  -pix_fmt yuv420p -movflags +faststart`.
- `@fontsource`/`npm install` of fonts fails here (corporate cert) → use Google Fonts `<link>`.
- `hyperframes validate` contrast flags dark-text-on-colored-chip as a **false positive**
  (it samples the page behind the element, not the chip fill). Verify by eye.
- Verify final by extracting frames: `ffmpeg -ss <t> -i renders\*.mp4 -frames:v 1 f.png`.

## Per-GEO ElevenLabs voice map

Each GEO gets its **own** voice (different voice per GEO), matched to the locale language.
`model_id: eleven_multilingual_v2` (or newer — confirm at build time). **All voices in this table
are FEMALE** (fixed 2026-07-17 — IT was shipping a male voice, "Arnold", which is wrong for this
brand's presenter persona; audited the whole table while at it).

**IMPORTANT — these are pulled from THIS account's own `GET /v1/voices` library, not legacy public
IDs.** The previous table used ElevenLabs' old "legacy public" premade voice ids (Rachel, Domi,
Elli, Freya, Arnold, Sam, Josh, Antoni, Adam) as generic cross-lingual defaults. That turned out to
be unreliable, not just non-native-sounding: PL's old id (`EXAVITQu4vr4xnSdxM3`) 404'd outright
(fixed 2026-07-13), and a full audit on 2026-07-17 found most of the *other* legacy ids in that old
table weren't even present in this account's own voice library — unverifiable, and liable to fail
the same way without warning. **Always resolve voices via `GET https://api.elevenlabs.io/v1/voices`
(header `xi-api-key`) on the account that will actually run the TTS**, filter `labels.gender ==
"female"` and `labels.language == <target>`, and only fall back to a cross-lingual pick (closest
related language, e.g. Czech for Slovak, Croatian for Slovenian) when the account genuinely has no
native female voice for that language — note which is which, and re-audit if a GEO ever 404s.
`lang` is the BCP-47 hint (ElevenLabs auto-detects from text).

| GEO | lang | voice_id | name (native / cross-lingual) |
|-----|------|------------------|--------|
| UA  | uk | `ARxhnQPZCfSLpMBASSii` | Olena — Rich, Deep and Vibrant (native uk) |
| PL  | pl | `mm5VPgPEmjoD9MmwFLFW` | Tabaza — Clear and Neutral (native pl) |
| DE  | de | `MOOG1hZESAxDt4UaletY` | Irene UGC — Conversational & Optimistic (native de) |
| AT  | de | `rKiu7lQ4c5P3az3745s3` | Carla Blum — Confident and Informative (native de, distinct from DE's Irene) |
| CZ  | cs | `Nr9bRiFsgPeaoVggMD2V` | Marketa — Czech Female Voice (native cs) |
| SVK | sk | `MpbYQvoTmXjHkaxtLiSh` | Anet — Youthful and Lively (cross-lingual cs; no native sk female in this account) |
| SI  | sl | `L1kQ6rz0P1bI4L5Av3Ow` | Lara — Positive, Formal (cross-lingual hr; no native sl female in this account) |
| HR  | hr | `JDYfAX20MbYfJGIjPTZz` | Ivana — Calm, Slow & Friendly (native hr) |
| HU  | hu | `WNxHBFUm0NC5fojx98kr` | Mária (native hu) |
| GR  | el | `7smwXrU3C1PfaspIIUZB` | Sophia — Assertive, Joyful and Warm (native el) |
| NL  | nl | `Xb7hH8MSUJpSbSDYk0k2` | Alice — Clear, Engaging Educator (cross-lingual en; no native nl female in this account) |
| SE  | sv | `cgSgspJ2msm6clMCkdW9` | Jessica — Playful, Bright, Warm (cross-lingual en; no native sv female in this account) |
| DK  | da | `4RklGmuxoAskAbGXplXN` | Camilla — Engaging, Clear and Calm (native da) |
| LAT | lv | `XrExE9yKIg1WjnnlVkGX` | Matilda — Knowledgable, Professional (cross-lingual en; no native lv female in this account) |
| ES  | es | `KDG2CWzkFgcZz4Vqbu8m` | Belén — Kind and soft (native es) |
| PT  | pt | `CcElPA8NBrawbunFs7rh` | Letícia — Gentle, Pleasant & Warm (native pt) |
| FR  | fr | `Hy28BjVfgieDVMiyQpQe` | Chloé — Warm, Friendly & UGC Ready (native fr) |
| IT  | it | `QttbagfgqUCm9K0VgUyT` | Aida — Engaging, Convincing and Smiley (native it — replaces the old male "Arnold") |
| EN  | en | `EXAVITQu4vr4xnSDxMaL` | Sarah — Mature, Reassuring, Confident (native en) |
| KR  | ko | `cBOtnpVZNlQ5VJygXGB8` | Eunha — Elegant Korean Female (native ko) |
| JP  | ja | `EnLxjGl88dNO1Jv6AZk2` | Miyu — Bright and Compelling (native ja) |

For a GEO not in this table: query `GET /v1/voices`, filter female + that language (fall back to
the closest related language if none), then add a row here. `scaffold_project.mjs` reads this map
from `voices.json` (generated beside it) — keep the two in sync, or pass `--voice <id>` to override
per run.
