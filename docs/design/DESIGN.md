---
name: APRM scheduler
description: A near-black void with warm stone greys and one soft amber light; the Build step shows the machine as an exploded laptop.
colors:
  bg: "#0C0C0D"
  surface: "#151517"
  raised: "#1E1E21"
  hairline: "#2A2A2E"
  control-border: "#75716A"
  text: "#F2EEE6"
  muted: "#A8A39A"
  amber: "#E9C987"
  amber-ink: "#E9C987"
  on-amber: "#0C0C0D"
  amber-hover: "#F0D6A2"
  amber-pressed: "#D8B46C"
  amber-soft: "#2A2419"
  sand: "#C8B9A0"
  sage: "#8FB8A8"
  error: "#E07A6B"
  stone: "#8E8A84"
  job-0: "#E9C987"
  job-1: "#8FB8A8"
  job-2: "#C8B9A0"
  job-3: "#B9803F"
  job-4: "#D98579"
  job-5: "#807924"
  job-6: "#8A6A67"
  job-7: "#A7D9CB"
  job-8: "#E3B467"
  job-9: "#9D7356"
typography:
  hero:
    fontFamily: "'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.03em"
    textTransform: "uppercase"
  title:
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
    textTransform: "uppercase"
  section:
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  label:
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.14em"
    textTransform: "uppercase"
  body:
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tabular-nums"
  caption:
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "0.375rem"
  md: "0.625rem"
spacing:
  s-1: "0.25rem"
  s-2: "0.5rem"
  s-3: "0.75rem"
  s-4: "1rem"
  s-6: "1.5rem"
  s-10: "2.5rem"
---

# Design System: APRM scheduler

The tokens live in `web/css/tokens.css` (dark default and the warm-paper light set); this file records why they are what they are. The Build page follows the design project "APRM Build" (its `BuildPage` prototype and design board, direction 1a). Decision record: `DECISIONS.md` D81.

## Overview

**North star: "One amber light in a dark room."** A near-black void, warm stone greys, and one soft amber light. Colour means a state, never decoration. Everything is flat: no gradients, glows, neon or glass blur, with one exception, a faint static amber spotlight behind the Build laptop so the black-metal laptop reads on the dark page.

- **Build** is a split page. Left (55%): the machine drawn as a laptop pulled apart into five layers (lid, keyboard, logic board with the CPU socket, memory carrier, bottom case), each with a leader line to a label holding the exact number. Right: the settings (machine, examples, jobs, more ways) and a sticky bar with the one primary button.
- **Run** shows the same laptop assembled, with the run on its screen (K-52, D83); the one spotlight moves with the laptop. **Compare** keeps its layout and takes the new palette and type.

## Colours

| Token | Dark (default) | Light (warm paper) | Use |
| --- | --- | --- | --- |
| `--bg` | `#0C0C0D` | `#F5F1E8` | Page background |
| `--surface` | `#151517` | `#FBF8F2` | Cards, panels, inputs |
| `--raised` | `#1E1E21` | `#ECE6DA` | Hover surfaces, popovers, selected rows |
| `--hairline` | `#2A2A2E` | `#DDD5C6` | Decorative borders and dividers only |
| `--control-border` | `#75716A` (3.8:1 on surface, 3.4:1 on raised) | `#857D71` (3.8:1, 3.3:1) | Input and button outlines (WCAG 1.4.11) |
| `--text` | `#F2EEE6` (16.9:1 on bg) | `#1C1A17` | Main text |
| `--muted` | `#A8A39A` (7.8:1 on bg) | `#5C574F` | Secondary text, hints |
| `--amber` | `#E9C987` | `#E9C987` | Primary fill, current step, running jobs, CPU, slider, selection |
| `--amber-ink` | `#E9C987` | `#7A5714` (6.2:1) | Amber as text or a thin line |
| `--on-amber` | `#0C0C0D` (12.3:1) | `#1C1A17` | Text on amber |
| `--amber-hover` / `--amber-pressed` | `#F0D6A2` (13.8:1) / `#D8B46C` (9.9:1) | `#EFD49C` / `#D8B46C` | Primary button states |
| `--amber-soft` | `#2A2419` | `#F2E4C4` | Selected-card wash |
| `--sand` | `#C8B9A0` | `#7D6D52` | Memory, reservations, secondary highlights |
| `--sage` | `#8FB8A8` | `#3F6B5B` | Success labels ("12 jobs on 8 cores and 32 GB", "Started", "Best") |
| `--error` | `#E07A6B` | `#A8402F` | Error text and outlines |
| `--stone` | `#8E8A84` | `#857D71` | Chart marks and rules only, never text |

**Choices that differ from the brief.** The design board proposed `--control-border: #6B6862`; it is 3.28:1 on surface but only 2.99:1 on raised, so `#75716A` is used (3:1 or more on every surface). The light `--sand-soft` and `--series-4` were adjusted until every pair passed (`tests/web/check_contrast.mjs`, 106 pairs, both themes).

**Dark is the default** whatever the system's colour scheme. The top-bar button switches to warm paper and the choice is remembered (`localStorage`, wrapped in `try`).

### Job tones

Ten muted warm tones derived from amber, sand, sage and stone (`--job-0` to `--job-9`, lighter on dark, deeper on paper). They were chosen by a small search that spreads lightness across the set: the smallest CIE76 distance between any two tones is 8.5 (dark) and 9.8 (light) under normal vision and simulated deuteranopia, protanopia and tritanopia (Machado 2009). Colour is still never the only signal: every block keeps its job number on a surface plate and one of three hatch patterns.

### Compare charts

Bars for the first three schedulers are amber, sand and sage; the fourth on are stone shades with a diagonal hatch (a bar chart has no line to dash, so the hatch is its equivalent).

## Typography

**Inter Tight** (SIL OFL 1.1), from Google Fonts (`intertight` v9, Latin subset, font version 3.004, one variable file for weights 400 to 800), embedded as a base64 woff2 in `web/css/fonts.css` by `web/fonts/embed_font.mjs`. The licence is in `web/fonts/OFL.txt`. No font link and no network request; `tests/demo/check_layout_cdp.mjs` checks `document.fonts.check('800 40px "Inter Tight"')` from `file://` with the network off. Fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.

| Role | Size / line-height | Weight | Case and tracking |
| --- | --- | --- | --- |
| Hero (Build only) | 56px / 0.95 (48px under 1360px wide, 36px under 640px) | 800 | ALL CAPS, -0.03em |
| Page title (Run, Compare) | 40px / 1.0 (32px under 640px) | 800 | ALL CAPS, -0.02em |
| Section title | 20px / 1.25 | 600 | Sentence case, -0.01em |
| Small label ("STEP 1 · YOUR MACHINE", "CPU", module tabs) | 11px / 1.2 | 600 | ALL CAPS, +0.14em |
| Body | 15px / 1.55 | 400 | Sentence case |
| Caption, hints | 13px / 1.45 | 400 | Sentence case |
| Numbers | inherit | 600 | `tabular-nums` |

Only weights 400, 500, 600 and 800 appear (a test enforces it). No monospace anywhere and no bracket-style "[ LABEL ]" tags.

## The Build laptop

- **Layers** (footprint 400 × 272 px): bottom case z 0, memory carrier 70, logic board 170, keyboard 272, lid 322 (lid upright at rotateX 100°). Closed, they sit 0 to 9.5 px apart.
- **Camera:** three-quarter view, perspective 2200px, stage `rotateX(54°) rotateZ(-32°)`. The intro starts facing the front (`rotateX(60°)`, no turn) and turns to the three-quarter view as it glides left.
- **Rules:** 1 cell = 1 core in a fixed 8 × 8 socket (above 64: a full grid and "grid × N = cores"); 1 chip = 4096 MB in 16 slots, the last chip part-filled (above 65536 MB: 16 chips and "+ N GB more"). Invalid input keeps the last valid picture and shakes the part once.
- **Linking:** pointing at the CPU, memory or keyboard part (or its label) lights its setting card, and the other way round; clicking jumps to the setting.
- **Intro (once per visit, `sessionStorage`):** closed (300 ms) → lid opens over 1100 ms → glide left and turn over 900 ms → layers separate over 900 ms, top-down, 90 ms apart (so a rising layer never passes through the one above) → labels fade in → settings rise in at 3.0 s; done at 3.5 s. Skip and Replay buttons. Reduced motion: a 300 ms cross-fade only, with no parallax, lift or shake.
- **Pointer parallax:** at most 2.5° and 3°.
- **Fallbacks:** narrow screens put the laptop on top with a two-column label list; without 3D transforms the drawing is left out and the labels show as a list.

## Components

- **Buttons:** outlined in `--control-border`, transparent, 6px radius; hover `--raised`. **Primary:** amber fill, on-amber text, hover and pressed ambers; one per screen. Quiet: amber-ink text.
- **Step control:** surface track; the current step is filled amber (it is the selected state).
- **Inputs:** surface fill, control-border outline, 600 tabular numbers; errors outline in `--error` with the message next to the field.
- **Setting cards:** hairline border; highlighted with an amber border and a 3px amber-soft ring.
- **Examples:** one card per example, hairline border; hover border amber; selected = amber-soft fill, amber border, amber-ink title.
- **Top bar:** solid `--bg` with a hairline under it (no glass).
- **Toast:** `--raised` with a hairline.

## Do's and Don'ts

- **Do** read every colour from the tokens; a new colour needs a dark and a light value and a contrast pair in the check.
- **Do** pair a job tone with its number and hatch.
- **Do** keep one amber primary button per screen.
- **Don't** add gradients, glows or blur (the Build spotlight is the only light effect, and it goes under `prefers-contrast: more`).
- **Don't** use all caps outside the hero, page titles and small labels.
- **Don't** use monospace or a second typeface.
