# K-49 findings (ranked)

Audit of the site as shipped by K-43 to K-48, against `PRODUCT.md` and the direction contract (Production Planning Board, `.impeccable/surfaces/web-index-html.md`). Evidence: screenshots at 375 and 1366 px in light and dark, `tests/demo/check_layout_cdp.mjs` (passes 33/33 at 640 to 1440 px), the Impeccable detector (clean in regex mode, which undercounts). Severity: P0 blocks the demo, P1 hurts understanding, P2 is friction, P3 polish.

| # | Sev | Where | Finding | Fix (PR) |
| --- | --- | --- | --- | --- |
| 1 | P1 | Run | The resource picture is drawn twice: DOM meters in the strip and canvas bars inside the timeline. Neither shows capacity filling over time, which is the mechanism. | Replace both with the planning board: CPU lane and memory lane over one time axis, each running job a card as tall as its demand (PR 5) |
| 2 | P1 | Run | The first viewport is setup (scheduler card, strip, reservation note); the timeline starts below the fold at 1366 x 768 and far below at 375. | Board first; setup collapses to one rail line (PR 5) |
| 3 | P1 | Run | "Your jobs" repeats the Build table as long prose and pushes the timeline and log down. | Replace with the tray: waiting cards in the engine's order with their score (PR 5) |
| 4 | P1 | Run | Canvas text is a fixed 13 px drawn on a 640 px-high canvas; at 375 px the waiting list and labels are unreadable. | Board drawn in HTML/SVG at the page's type scale; canvas only where it pays (PR 5) |
| 5 | P1 | Compare | Charts come from a CDN, so offline they always fall back; the demo runs offline. | Bundle the chart library (PR 3) or draw the four bars natively (PR 6) |
| 6 | P2 | Run | The sticky control dock covers content while scrolling at 375 px, and the toast sits on top of it. | Control rail under the board, not sticky; toast above the rail (PR 5) |
| 7 | P2 | All | The top bar wraps into three rows at 375 px; the Show details hint takes a full line. | Compact top bar: steps, details switch, day/night icon button; hint moves to a tooltip (PR 4) |
| 8 | P2 | Build | The job table has 8 columns; at 375 px it scrolls inside its box with the add row cut off. | Job rack: one card per job on narrow screens, table on wide (PR 4) |
| 9 | P2 | Compare | Timelines have no axis label or unit ("ticks") and no legend for the hatch patterns. | Boards side by side with labelled axes and a key (PR 6) |
| 10 | P2 | Run | Score and priority are plain text; nothing shows which waiting job is next. | Fixed size ramp for score on tray cards; first card marked "next" in words (PR 5) |
| 11 | P3 | Run | The why-log kind label is generated CSS content, read inconsistently by screen readers. | Real text label element beside the engine sentence, sentence node kept intact (PR 5) |
| 12 | P3 | All | "Engine ready" sits in the top bar permanently. | Show only loading and error; ready is silent (PR 4) |
| 13 | P3 | All | Primary buttons were restyled twice to beat page rules (`.panel .btn-primary`); page rules fight components. | One component layer in the rebuild; remove the overrides (PR 3/4) |

Accepted: all. Deferred: none yet. Each PR states which numbers it closes.

Typeface decision: the site is an Operate surface; Impeccable's guidance is that system stacks serve it well, and the system face already has tabular figures. No web font is added (one less dependency to defend). Revisit only if the board's stamped numbers need a face the system does not provide.
