# Run page fidelity checklist (K-56)

Source: Claude Design project "APRM Build", `RunPage.dc.html` (+ `support.js`), read in full on 2026-11-10.
The design is the spec. Only three kinds of deviation are allowed (real engine data, the bundled font,
our classic-script code structure); every other difference is listed under "Deviations" with its decision.

Status key: ✅ matches the design value · ⚠️ deviates (see Deviations).

## 1. Layout regions (1440 × 900)

| Region | Design value | Status |
| --- | --- | --- |
| Top bar | 56 px, padding 0 24px, gap 16px, border-bottom 1px #2A2A2E, sticky z 20; brand and controls `flex: 1 1 0`, steps centred | ✅ (plus our theme button and engine status: ⚠️ D87.3) |
| Steps nav | padding 3px, gap 2px, bg #151517, border 1px #2A2A2E, radius 8; buttons 30px high, padding 0 14px, 13px, current = amber fill, 600 | ✅ |
| Show details | label then a 34 × 20 track (#6B6862 off, #E9C987 on), 16px knob, `transform 180ms cubic-bezier(0.3,1,0.5,1)` | ✅ |
| Head section | max-width 1280, padding 40px 40px 0, gap 24px | ✅ |
| Kicker | 11px / 1.2 / 600 / uppercase / 0.14em / #A8A39A "Step 2 · Run" | ✅ |
| Title | 40px (30px under 640), line-height 1, 800, −0.02em, uppercase "Run your jobs" | ✅ |
| Data line | "{n} jobs on {C} cores and {M} MB ({GB} GB)." | ✅ |
| Which jobs | group, padding 3, gap 2, border #2A2A2E radius 8; buttons 30px, padding 0 12px, 13px/500; pressed bg #1E1E21 text #E9C987; "Your jobs · n" (only with Build jobs), "Sample · 8 jobs", "Big case · 500 jobs" | ✅ |
| Scheduler cards | grid `repeat(auto-fill, minmax(280px,1fr))`, gap 8; card min-height 44, padding 8px 12px, radius 6, 14px, line-height normal; checked border/dot #E9C987 bg #1E1E21; hover #1E1E21 | ✅ |
| More settings | card border #2A2A2E radius 10; header padding 10px 14px, 14px; settings line 13px muted; chevron rotates 180° in 200ms | ✅ |
| Settings inputs | grid minmax(240px,1fr) gap 16, padding 4px 14px 16px; inputs 36px, padding 0 12px, border #6B6862, 15px/600 | ✅ (border ⚠️ D87.2) |
| Control bar | sticky top 56, z 15, border-bottom; padding 12px 40px, gap 8; Run 40px padding 0 20px 15px/600 no border; others 40px padding 0 14px 14px/500 border #6B6862; Play min-width 84; speed group 32px buttons min-width 40 13px/600 | ✅ |
| Status pill + clock | pill 13px padding 4px 10px border #2A2A2E, 6px dot; colours Not started #A8A39A, Playing #E9C987, Paused #F2EEE6, Finished #8FB8A8; "Time: tick N" 15px/600 | ✅ |
| Stage | max-width 1440, height `round(470·s + 40)`, s = screenW / 361 | ✅ |
| Screen width | narrow (<900): min(560, (w−32)·0.74); side (≥1100): min(640, w − 620); else min(600, (w−64)·0.76) | ✅ |
| Laptop placement | measured screen corners: scale until the projected screen is screenW wide, top edge 24 px below the stage top, centred on the page | ✅ (same measure loop) |
| Waiting column | left `max(24, w/2 − screenW/2 − 312)`, top 24, width 248 | ✅ |
| Finished column | left `min(w − 224, w/2 + screenW/2·1.06 + 40)`, top 24, width 200, gap 6 | ✅ |
| Below 1100 px | side columns hidden; "Waiting · n" grid of 2 above the stage | ✅ |
| Event line | max-width 900, padding 8px 24px 0, min-height 56; kind chip 11px caps padding 5px 8px radius 4 coloured border; text 16px | ✅ |
| Analysis | max-width 1280, padding 24px 40px 0, gap 24; panels padding 20, radius 10, bg #151517, border #2A2A2E | ✅ |
| Footer | border-top, padding-top 20, "Next: compare schedulers" 44px 15px/600 | ✅ |

## 2. The laptop

| Part | Design value | Status |
| --- | --- | --- |
| Perspective / camera | `perspective: 2200px`; Run pose `rotateX(60deg) rotateZ(-16deg)`; lid 114° | ✅ |
| Satin metal | `#1E1F22` + 3 px brushed lines at 2.2 % white + 118° sheen (6 % at 38 %) + 165° #26272B → #1E1F22 → #17181A | ✅ (`--satin`) |
| Bevels | inset 1px #2A2C30, top #5C5C64, left #4A4D54, right #3A3C42, bottom #4A4D54 | ✅ (`--bevel`) |
| Bezel | 160° #141416 → #060607 55 %, inset #4A4D54 / #0B0B0D, camera 5 px #141418 ring #24242A | ✅ |
| Screen | left 7 top 9 right 7 bottom 12 (386 × 251), #0C0C0D, inset 0 0 10px rgba(0,0,0,.85); 600 × 391 content scaled in | ✅ |
| Glass glare | 128°, 10 % → 3.5 % white at 26 %, hard edge 26.5 % | ✅ |
| Keycaps | 180° #1C1C1F → #131315, inset top 7 % white, bottom 60 % black, legends 5px rgba(246,234,212,.62 / .95 lit) | ✅ |
| Key glow | 1.5px rgba(246,226,190,.24 / .45 lit), text-shadow 0 0 2px | ✅ (D86) |
| Key well | #08080A, radial glow .04 / .09 lit, inset shadows | ✅ |
| Trackpad | #141417 + 155° gloss, inset #3A3C42 and 18 % white top | ✅ (Build geometry kept, ⚠️ D87.6) |
| Hinge | 312 × 6 at x 44, 180° #0B0B0D → #2A2C30 → #4A4D54 | ✅ |
| Shadow | 432 × 292 at −16/−4, radius 30, rgba(0,0,0,.6), blur 18px, translateZ(−12px) | ✅ |
| Spotlight | radial closest-side rgba(233,201,135,.08) → .035 55 % → 0 | ✅ |

## 3. Animations

| What | Design | Status |
| --- | --- | --- |
| Build → Run | 0: exploded at Build's place; 120 ms collapse (layers 440 ms `cubic-bezier(0.22,1,0.36,1)`); 600 ms glide + turn 700 ms `cubic-bezier(0.65,0,0.35,1)`; 1380 ms page fades in (300 ms linear); 1760 ms done | ✅ |
| Job moves (FLIP) | duration `max(260, 620 / speed)`, `cubic-bezier(0.22,1,0.36,1)`, origin 0 0 | ✅ |
| New element | opacity 0 → 1, translateX(−24px) → 0, 0.6 × duration | ✅ |
| Cell / chip pop | opacity 0 → 1, scale .4 → 1, 260 ms, delay 0.55 × duration, `cubic-bezier(0.34,1.25,0.64,1)`, fill backwards | ✅ |
| Skip shake | translateX 0, −5, 4, −2, 0 over 320 ms `cubic-bezier(0.3,0,0.3,1)` | ✅ |
| Bars | machine-use scaleX 300 ms `cubic-bezier(0.22,1,0.36,1)`; tile progress 300 ms linear | ✅ |
| Beat | 900 ms / speed; big case 120 ms per beat, 2 × speed ticks | ✅ |
| Toast | opacity 200 ms linear, transform 260 ms `cubic-bezier(0.22,1,0.36,1)`, 2600 ms | ✅ |
| Reduced motion | no reassembly, no FLIP, no pops | ✅ |

## 4. Engine → visual mapping (allowed deviation 1)

| Engine | Visual |
| --- | --- |
| ARRIVE | card enters the waiting column (slide-in) and a waiting row/strip row appears |
| START | card flies to a tile on the screen; its cores and memory pop in |
| BACKFILL | as START, tile tagged "squeezed in", table tag " · squeezed in" |
| RESERVE | card border amber 1.5px, "Spot saved · starts by tick T", dashed held cells, spot card, diamond on the strip |
| SKIP | dashed sand border, corner triangle, "Skipped: …" and a 320 ms shake |
| FINISH | tile flies to the finished column, "at T" |
| state JSON | cells, memory segments, tables, machine use (snapped at the end of each moment) |
| metrics JSON | "How it went" tiles and the priority row; Show details prints the exact values |
| engine dry run | the timeline spans makespan + 1 from the first event; "event N of M" |

Step = one engine log entry. Numbers equal the engine JSON (test: "Run page numbers equal the engine JSON for the six presets").

## 5. Copy (all strings in `web/js/copy.js`, checked against the design)

Every visible string on the Run page is the design's, including: the settings labels and hints, the
three validation sentences, "Press Run. The engine decides; the laptop shows each decision.", "Idle.
Jobs will appear here while they run.", the empty states ("No jobs waiting.", "Nothing running.",
"Nothing to show yet. Press Run.", "Nothing to show yet. Add jobs, then press Run.", "Shown once the
first job finishes."), the metric labels and how-lines, "— (still running)", the sort keys, the spot
card sentences, the strip legend and note, the tooltip lines and "Showing job N only · Show all". ✅
The engine's own log sentences are shown as the engine writes them (allowed deviation 1).

## 6. Tokens and type

Inter Tight 400/500/600/800 bundled (allowed deviation 2). Colours as in the design: #0C0C0D, #151517,
#1E1E21, #2A2A2E, #F2EEE6, #A8A39A, #E9C987, #F0D6A2, #D8B46C, #C8B9A0, #8FB8A8, #E07A6B; the ten job
tones #E9C987 #C8B9A0 #8FB8A8 #C98F6E #A7A57A #B7CDBF #C9A04F #8C8A85 #B07F68 #7FA39C (job N → tone
(N − 1) mod 10). ✅ Control border ⚠️ D87.2.

## 7. Verification (2026-11-10)

| Check | Result |
| --- | --- |
| Pixel diff, first screen 1440 × 900 (pixels > 24 levels apart) | 1.29 %: the theme button, engine-ordered cards, settings-line text width |
| `make test` (C, golden, CLI, web suites) | green |
| check_layout_cdp (file://, offline, font, no sideways scroll, no console errors, 60 fps, idle) | 80 / 80 |
| click_matrix_cdp | 158 rows, 0 failed |
| rehearse_cdp --offline | 24 / 24 |
| contrast | all pairs ≥ minimum |

Side by side (design left, ours right), in `screenshots/run-fidelity/`:
`sbs-before.png`, `sbs-step14.png` (mid-run, paused), `sbs-spot.png` (spot saved, Show details on),
`sbs-finished.png`, `sbs-reduced.png` (reduced motion), `sbs-phone.png` (375 px),
`sbs-laptop-finish.png` (satin, gloss and glare close-up). The flat fallback is checked by
check_layout_cdp ("without 3D transforms").

## 8. Deviations (D87)

1. **Engine data** (allowed): log sentences, event order and counts, metric values, waiting order (the engine's order: the design moves the saved job to the top), the knapsack sort key.
2. **Control border** #6C6862 instead of #6B6862: the design value gives 2.99 : 1 on the hover surface, below WCAG 1.4.11; one red step reaches 3.0 : 1.
3. **Top bar**: our theme button and the engine status stay (they exist on every page and are not on the Run design).
4. **Show details metrics** print the engine's exact numbers (the brief: "numbers on screen equal the engine JSON exactly"); the clean view rounds as the design does.
5. **Play after the end** replays from the start (the design's behaviour); Step and Jump stay off at the end because nothing is left.
6. **Trackpad and base layout** keep the shared Build laptop geometry (one component with Build); colours and finish are the design's.
7. **Phone top bar** wraps to two rows instead of truncating the brand (phones are lower priority, Krishna 2026-11-07).
