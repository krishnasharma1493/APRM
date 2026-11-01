# Design system

Recorded from the shipped site (K-47, K-48). The design authority is Impeccable: `PRODUCT.md` and this file (D76). `docs/design/APPLE_DESIGN.md` is an optional motion reference only. Fixed constraints: the built site works offline from `file://`, no raw HTML injection, colour never the only signal.

## Principles
- Calm and plain: short sentences, sentence case, plain words first with the technical term beside them ("Shortest job first (SJF)").
- Nothing hidden: "Show details" reveals exact numbers and raw log kinds; the engine's numbers and sentences are never changed or rounded away when it is on.
- Flat solid colour, hairline borders, one whisper shadow, translucent top bar and control dock (solid under reduced transparency or more contrast).
- Colour is never the only signal: job blocks carry their number and one of three hatch patterns; "Best" is a word.

## Tokens (`web/css/tokens.css`)
| Token | Light | Dark |
| --- | --- | --- |
| canvas | `#F2F3F1` | `#121513` |
| surface | `#FFFFFF` | `#1B1F1D` |
| text | `#1B1F1D` | `#ECEFED` |
| muted | `#5B625E` | `#A3ABA6` |
| border | `#CFD3D0` | `#343A37` |
| accent (teal) | `#0B5E6B` | `#5FB6C4` |
| red / amber / green | `#B42318` / `#8A4B00` / `#1D7A34` | `#F0877C` / `#E0A24A` / `#6FCB87` |
| chart gray (marks only, never text) | `#8A918D` | `#8A918D` |
Job colours: ten muted colour-blind-safe hues `--job-0` to `--job-9`, retuned for dark.
Type: system sans-serif only, `tabular-nums` for numbers. Title 1.75rem, section 1.25rem, body 0.9375rem, caption 0.8125rem; tracking -0.02em at title size.
Space 4/8/12/16/24/40 px (rem). Radius 6/10/14 px. Motion: press 100 ms (scale 0.97), moves 240 ms critically damped; reduced motion removes transitions.

## Components (`web/css/components.css`)
Buttons (one primary per screen), segmented control for the three steps, cards, translucent material, inputs with inline error lines, tables (sticky header, tabular numbers), toast (always-rendered live region), disclosure ("More settings", "More ways to add jobs", "Add a job right now"), switch ("Show details"), meter bars, example tiles, focus ring (2 px accent, 2 px offset).

## Pages
1. Build: welcome line, six example tiles, your jobs table, "More ways to add jobs".
2. Run: scheduler choice with one-line settings summary, resource strip (exact numbers), reservation card, jobs / timeline / Why, "How it went", control dock.
3. Compare: picker, verdict sentence, metrics table with "Best", exact best order, timelines, charts with a table fallback.

## Checks
`node tests/web/check_contrast.mjs` (72 pairs, AA), `node tests/demo/check_layout_cdp.mjs web/index.html` (no sideways scroll at 640, 1024, 1280 and 1440 px, focus rings, Space and Right arrow, reduced motion, reduced transparency, more contrast), `node tests/demo/rehearse_cdp.mjs web/index.html --offline` (PRD §10 website checklist).
