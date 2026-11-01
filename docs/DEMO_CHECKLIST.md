# Demo checklist (K-32)

Use with `docs/DEMO_SCRIPT.md` and PRD §10A "Pre-demo checklist" (PRD wins if they differ). Tick on the morning of the viva.

## One-time: make the offline copy

`web/vendor/aprm.js` is build output. It is git-ignored and is committed only on the `demo-ready` tag (K-41). On the demo laptop:

    git checkout demo-ready        # after K-41; until then, the latest main
    source ~/emsdk/emsdk_env.sh    # Emscripten from ~/emsdk
    make wasm                      # writes web/vendor/aprm.js (about 65 KB when last built)
    make                           # console program, build/aprm
    cp -R web ~/Desktop/aprm-web-offline    # self-contained folder

Open `~/Desktop/aprm-web-offline/index.html` by double-click (it runs from `file://`). No server is needed. On the second laptop, either do the same, or copy this folder (it is self-contained) together with the repository.

## Before the demo

- [ ] Laptop charged and charger plugged in; projector adapter tested; second laptop has the same tag or folder.
- [ ] Wi-Fi off. Notifications off. Browser zoom 125%. Dark/light mode chosen and the same as in the backup video.
- [ ] `web/index.html` (or the offline copy) opens and the header says "Engine ready".
- [ ] A dry run of rows 4 and 5 done that morning (see the script; `node tests/demo/rehearse_cdp.mjs web/index.html --offline` should print "23/23 checks passed").
- [ ] Terminal open in the repository root with `build/aprm` built; the two row 3 commands tested.
- [ ] Saved terminal screenshot of row 3 ready (fallback for row 3).
- [ ] Row 3 case `aging_overtake` paper-checked by Ahaana (README marks it "awaiting Ahaana's paper check").

## Browser tabs, in this order

1. Slides PDF (local file, not a web link)
2. Terminal (not a tab, keep it one keystroke away)
3. `web/index.html` already loaded, Build mode, Wi-Fi off
4. Backup video, paused at 0:00
5. Graphs E1, E2, E5, E6 as local image files, and the report PDF

## Fallbacks per row

| Row | If it breaks | Action (switch within 10 seconds; the other member keeps talking) |
| --- | --- | --- |
| 2 | Slides fail | Open the local PDF |
| 3 | Terminal fails | Show the saved screenshot |
| 4 | Website fails | Backup video at 0:00 |
| 5 | Website fails | Backup video at 1:00 |
| 6 | Website fails or examiner breaks it | Reload the page, press Load preset on Heavy load; otherwise backup video at 2:00 |
| 7 | Graphs fail | Report PDF has them |
| 1, 8, 9 | No fallback | Keep talking |

Never debug in front of the examiners. If the engine does not load, the page shows a red box with the reason; the speaker says "let me show you the recorded run" and the other member plays the video.

## Known things on the page not to point at

- "Exact optimum ... not available yet" line in Compare (exact solver is K-33).
- The knapsack box is disabled (K-34).
