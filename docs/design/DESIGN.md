---
name: APRM scheduler
description: A production planning board that the engine fills card by card, with every decision explained.
colors:
  canvas: "#F2F3F1"
  surface: "#FFFFFF"
  text: "#1B1F1D"
  muted: "#5B625E"
  border: "#CFD3D0"
  teal-rail: "#0B5E6B"
  on-teal: "#FFFFFF"
  stamp-red: "#B42318"
  stamp-amber: "#8A4B00"
  stamp-green: "#1D7A34"
  chart-gray: "#8A918D"
  error-wash: "#FBEDEB"
  warn-wash: "#FBF1E3"
  ok-wash: "#E9F5EC"
  job-0: "#3A6EA5"
  job-1: "#C27A1A"
  job-2: "#2E8B6A"
  job-3: "#B4483C"
  job-4: "#8A6D2E"
  job-5: "#5E8FA8"
  job-6: "#A8567A"
  job-7: "#6E7F2A"
  job-8: "#6B7280"
  job-9: "#94741A"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
    fontFeature: "tabular-nums"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "0.375rem"
  md: "0.625rem"
  lg: "0.875rem"
spacing:
  s-1: "0.25rem"
  s-2: "0.5rem"
  s-3: "0.75rem"
  s-4: "1rem"
  s-6: "1.5rem"
  s-10: "2.5rem"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.25rem"
  button-primary:
    backgroundColor: "{colors.teal-rail}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.teal-rail}"
  module:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0.75rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0.25rem 0.5rem"
    height: "2.25rem"
  magnet:
    backgroundColor: "{colors.job-0}"
    textColor: "{colors.text}"
    rounded: "3px"
    height: "1.625rem"
  stamp:
    textColor: "{colors.teal-rail}"
    rounded: "3px"
    padding: "0 0.25rem"
  stamp-reserve:
    backgroundColor: "{colors.warn-wash}"
    textColor: "{colors.stamp-amber}"
---

# Design System: APRM scheduler

Impeccable (`PRODUCT.md` in this folder and this file) is the design authority (D76). `APPLE_DESIGN.md` in this folder is reference only. The built site is plain HTML, CSS and classic scripts, so it works offline from `file://`, with no web fonts and no network. Engine, user, file and URL text is never injected as raw HTML, and colour is never the only signal.

## Overview

**Creative North Star: "The Production Planning Board"**

The machine is a planning board that the engine fills, card by card. Jobs wait in a tray on the left. The engine places each one into a CPU lane and a memory lane over one shared time axis. A shift log on the right gives the engine's reason for each move. The board refuses the dashboard of stat cards, charts and sidebars: the page sits directly on an enamel ground, and a step is not a card.

The world is built from a pale grey-green enamel ground (canvas), white slot surfaces ruled in hairlines, job magnets in ten muted hues, each with a stamped number and a hatch pattern, a teal rail that marks "now", and red, amber and green stamps for outcomes. Density is moderate and calm; text is plain sentence case. Numbers are tabular everywhere so columns hold their edges.

Build is the job rack (a ruled sheet; on a phone, one card per job). Run is the board proper (three columns: tray, board, log). Compare is two or more boards side by side as a ruled results table plus timelines.

**Key Characteristics:**
- Flat enamel and white surfaces, hairline borders, one whisper shadow.
- Job identity is colour plus stamped number plus hatch, never colour alone.
- One teal accent, used for "now", primary action, selection and focus.
- System sans-serif only; tabular numerals.
- Light and dark values for every colour; solid materials under reduced transparency or more contrast.

## Colors

Restrained: tinted neutrals, one teal accent, and three status stamps; the ten job hues are the only chromatic variety and appear only on magnets and chart marks.

### Primary
- **Teal Rail** (`colors.teal-rail`, dark `#5FB6C4`): the primary button, the "now" rail on the board canvas, selected tiles, links, switch on-state, focus ring, and the arrive and batch stamps.

### Secondary (status stamps)
- **Stamp Green** (`colors.stamp-green`, dark `#6FCB87`): start and backfill stamps, the "Best" stamp in Compare, ok text.
- **Stamp Amber** (`colors.stamp-amber`, dark `#E0A24A`): the reservation line and reserve and "saved" stamps.
- **Stamp Red** (`colors.stamp-red`, dark `#F0877C`): skip stamps, field errors, bad rows, and the canvas mark.
- Each has a wash (`error-wash`, `warn-wash`, `ok-wash`; dark `#3A1F1C`, `#38290F`, `#14301C`) used as the stamp or message background.

### Neutral
- **Enamel Ground** (`colors.canvas`, dark `#121513`): page ground, segmented-control track, selected tray card.
- **Slot White** (`colors.surface`, dark `#1B1F1D`): modules, tables, inputs, buttons, magnet number plates.
- **Ink** (`colors.text`, dark `#ECEFED`) and **Muted Ink** (`colors.muted`, dark `#A3ABA6`): body and secondary text, captions, labels.
- **Hairline** (`colors.border`, dark `#343A37`): every rule and border; darkened further under `prefers-contrast: more`.
- **Chart Gray** (`colors.chart-gray`, `#8A918D`): switch track, dashed separators, scrollbar, chart marks and rules only.

### Job hues
Ten muted hues `job-0` to `job-9` (dark values retuned lighter, defined in `tokens.css`). Job index maps to hue by id modulo ten.

### Named Rules
**The Never-Alone Rule.** Colour is never the only signal. A magnet carries its number on a surface plate, and hues 0 to 9 are paired with hatch patterns; status stamps carry words; "Best" is a word.
**The Chart Gray Rule.** Chart Gray is for marks and rules, never for text.
**The One Rail Rule.** Teal is the single accent. Status colours appear as stamps, not as surfaces or decoration.

## Typography

**Display, Body and Label Font:** the system sans-serif stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `system-ui`, `sans-serif`). No web fonts, no monospace.

**Character:** neutral and plain, like printed planning-sheet type; hierarchy comes from weight and size steps, not from face changes.

### Hierarchy
- **Title** (650, 1.75rem, 1.15, -0.02em): step titles (Build, Run, Compare).
- **Section** (600, 1.25rem, 1.25, -0.01em): sub-sections and the Compare verdict sentence (max 46rem).
- **Body** (400, 0.9375rem, 1.5): all running text; h3 is body size at 600.
- **Caption** (400, 0.8125rem, 1.4, 0.01em): labels, hints, table headings (600), module tabs (650), log lines.
- The top bar title is a one-off 1.0625rem at 650.
- Stamps and magnet-kind tags use 0.75rem at 650.

### Named Rules
**The Tabular Rule.** Numbers use `tabular-nums` globally; changing figures never shift their neighbours.
**The Plain Words Rule.** Sentence case; plain words first with the technical term beside it.

## Layout

Page width is capped at 78rem and centred, with `1rem` side padding and `2.5rem` bottom. Spacing steps are 0.25, 0.5, 0.75, 1, 1.5 and 2.5rem; gaps between modules are 0.75rem.

Run is a three-column grid: tray `13rem`-`15rem`, board `1fr`, log `14rem`-`19rem`, top-aligned. Under 62rem it collapses to one column with the board first. The board canvas is 360px high; the control rail sits under it, divided by a hairline, with Play primary and status pushed right.

Build uses an auto-fit grid of boxes (min 16rem) and a job table with a sticky footer; under 45rem each table row becomes a four-column grid card with data-label captions, and the Next row is sticky at the bottom. Example tiles are one ruled rack (3 columns, 2 under 60rem, 1 under 36rem) divided by 1px hairline gaps. Compare table keeps a right edge for numbers by reserving `3.25rem` for the Best stamp, and turns into per-row blocks under 45rem.

The top bar is sticky, wraps to two rows on a phone, and carries title, step control, and view controls (theme, Show details). "Engine ready" is announced but not displayed.

## Elevation & Depth

Flat. Depth is conveyed by tonal steps (enamel ground, white slot) and hairline borders. There is exactly one shadow, the whisper, used on the pressed segmented option, the flying magnet, the toast and the sticky Next button. The top bar is a translucent material (blur 20px, saturate 180%, hairline bottom and inset top edge) that becomes solid under reduced transparency or more contrast.

### Shadow Vocabulary
- **Whisper** (`box-shadow: 0 1px 2px rgba(27, 31, 29, 0.06)`; dark `0 1px 2px rgba(0, 0, 0, 0.4)`): the only drop shadow.
- **Selection inset** (`box-shadow: inset 0 0 0 2px var(--accent)` for tiles, `var(--text)` for selected tray cards): selection is an inset ring, not elevation.

### Named Rules
**The Flat Enamel Rule.** Surfaces are flat at rest; the whisper appears only on things that are raised or moving.

## Shapes

Small, practical radii: `0.375rem` for inputs and error blocks, `0.625rem` for buttons, modules, tables and the tile rack, `0.875rem` reserved in the scale. Magnets, stamps and kind tags are tighter, `3px`, like die-cut cards. The switch track is a pill. Hairlines are 1px; selection rings are 2px; the focus ring is `2px` solid teal with `2px` offset (inset on tiles). Dashed hairlines mark a "new" group in the job table.

## Components

### Buttons
- **Shape:** gently rounded (0.625rem), min height 2.25rem (small: 2rem), `0.5rem 1rem` padding.
- **Default:** white surface, ink text, hairline border.
- **Primary:** teal fill, on-teal text, weight 600; one per screen.
- **Quiet:** transparent, teal text.
- **Press:** instant scale to 0.97 over 100ms on `:active`; disabled is 0.5 opacity. Snaps under reduced motion.

### Segmented control (the three steps)
Enamel track in a hairline pill-rect; the pressed option is a white surface with the whisper shadow and weight 600; colour transitions 240ms.

### Modules
White surface, hairline border, `0.625rem` radius, `0.75rem` padding. Each has a caption-size tab title at 650. Modules are not nested inside cards.

### Job magnet (signature)
A rounded 3px block in its job hue, three sizes by share (heights 1.375, 1.625, 2rem), holding a white number plate in 650 caption. Two hatch patterns (135 degree and 90 degree 1px lines at `rgba(255,255,255,0.45)`, dark `rgba(0,0,0,0.3)`) differentiate hues. On the board canvas, magnets are drawn with the same tokens read from computed styles; the selected magnet gets a 2px ink outline. A started job's magnet flies from the tray to its slot (fixed position, whisper shadow) and snaps in under reduced motion.

### Stamps and kind tags
1px bordered, 3px radius, 0.75rem at 650. Start and backfill are green, skip is red, reserve and saved are amber, arrive, batch select and promote info are teal, anything else is muted. Washes sit behind green, red and amber ones.

### Inputs
White, hairline, `0.375rem` radius, 2.25rem min height. Errors use the error wash with a red border; a lead error is fused to the list under it. Labels are muted captions above.

### Tables and tray
Collapsed borders, bottom hairlines only, sticky muted caption headers, right-aligned numeric cells. The tray list is rows divided by hairlines; the selected card has an enamel fill and a 2px ink inset ring.

### Other
Disclosure (a CSS-drawn chevron that rotates 90 degrees, opens in one click), switch (pill track with a sliding thumb), toast (inverted ink on canvas, centred under the bar), empty state (one muted sentence plus one action).

### Motion
Press 100ms; move 240ms with `cubic-bezier(0.2, 0, 0, 1)`. All animation and transition collapse under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** read every colour from the tokens; give any new colour light and dark values.
- **Do** pair a hue with its number plate and hatch for anything that identifies a job.
- **Do** keep one primary teal button per screen.
- **Do** use hairlines and tonal steps to separate regions; use a ruled rack for related cells rather than separate cards.
- **Do** keep engine numbers and sentences verbatim, with `tabular-nums`.
- **Do** keep the focus ring visible on every control and honor reduced motion, transparency and contrast.

### Don't:
- **Don't** build a dashboard of stat cards, sidebars or decorative charts on top of the board.
- **Don't** nest cards in cards.
- **Don't** use Chart Gray for text or use status colours as page decoration.
- **Don't** add a second shadow style or web fonts.
- **Don't** signal state by colour alone.

### Not canonized
The build carries a handful of one-off sizes (top bar title 1.0625rem, 0.75rem stamps, the 360px/260px/220px canvas heights, `3.25rem` stamp reserve) and a glass blur on the top bar taken from the reference file. They are recorded in Layout and Elevation as observed values, not as extension rules; new surfaces should use the four type steps and the solid whisper-shadow vocabulary first.
