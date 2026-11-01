# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
HTML, CSS and JavaScript bundled by a frontend build tool (`make web`; frameworks and self-hosted fonts allowed, D76); the C scheduler core compiled to WebAssembly. The built site needs no network and works from `file://`.

## Users
Primary: an examiner at the viva of an ADA course project, watching a laptop demo. Secondary: classmates and Ahaana Arya, who open the site alone and need to understand it without anyone explaining.

## Jobs to Be Done
- Examiner (3 minutes): understand what an online two-resource scheduler does, see one decision explained, see two schedulers differ on the same jobs.
- Krishna (demo, PRD §10A rows 4 to 6): open the site from the laptop with Wi-Fi off; big-job trap in Compare; memory hog, aging against aging with reservation, why log open; hand the laptop over so the examiner builds a case or adds a job mid-run.
- Classmates later: open it alone and follow the three steps without help.

## Viva Questions the Site Must Help Answer (PRD §10A)
- Is the website really running your C code? (The engine is the WebAssembly build; the page only shows what it returns.)
- Can a job starve? (Aging against aging with reservation on the memory hog: the reserved job's spot and start time.)
- Is your scheduler optimal? (Compare shows the exact best order and each scheduler's gap for nine jobs or fewer.)
- Doesn't aging change every priority each tick? (Run with aging: every waiting job's live score rises at the same rate, so the waiting order, the fixed heap key, does not change.)

## Product Purpose
APRM (Adaptive Priority Resource Manager) is an online, non-preemptive job scheduler for one machine with CPU and memory. The website runs the same C code as the console program and shows how different schedulers choose jobs. Success: in one minute a viewer sees why schedulers differ, and can inspect that every number matches the engine exactly.

## Positioning
The only page that shows the aging key, the starvation fix and the EASY-style reservation running live on the same jobs, with the engine's own plain-English reasons for every decision and an exact optimum for small cases.

## Operating Context
A twelve-minute viva demo on one laptop, possibly with no network; a recorded backup video exists as a fallback. Six presets are bundled.

## Capabilities and Constraints
Three steps (Build, Run, Compare). Engine sentences and numbers must be shown verbatim and exactly. The UI never decides scheduling. Limits: CSV up to 1 MB and 5,000 jobs. Chart.js only in Compare, pinned with SRI, with a table fallback.

## Brand Commitments
Flat solid colours, hairline borders, system sans-serif only (no monospace). Final palette: canvas F2F3F1, surface FFFFFF, text 1B1F1D, muted 5B625E, border CFD3D0, accent teal 0B5E6B, red B42318, amber 8A4B00, green 1D7A34, chart gray 8A918D. No purple or blue-purple palettes, glows, neon or emoji icons.

## Evidence on Hand
Six preset workloads in `web/js/presets_data.js`; golden cases in `tests/cases/`. No user testimonials or usage data exist.

## Product Principles
1. Plain words first, the technical term beside them; never hide technical depth ("Show details" reveals it).
2. Every number on screen equals the engine's JSON.
3. One primary action per screen; the path is Build, Run, Compare.
4. Calm: restraint over decoration; colour is never the only signal.
5. Works offline from a file, every state (loading, empty, error) is designed.

## Accessibility & Inclusion
WCAG AA contrast in light and dark, visible focus, keyboard shortcuts (Space, Right arrow), reduced motion and reduced transparency respected, colour-blind-safe job colours with labels and patterns.
