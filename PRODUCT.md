# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Static HTML, CSS and classic `<script>` files on `window.APRM`; the C scheduler core compiled to WebAssembly. No framework, no build step, no network (works from `file://`).

## Users
Primary: an examiner at the viva of an ADA course project, watching a laptop demo. Secondary: classmates and Ahaana Arya, who open the site alone and need to understand it without anyone explaining.

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
