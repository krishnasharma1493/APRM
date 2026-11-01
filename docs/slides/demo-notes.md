# Demo notes: timings and backup video (K-32)

The video itself is not committed (PRD, issue K-32). This file holds the timings and the timestamps the video must have.

## Timings (PRD §10A, copied)

| # | Time | Who | On screen |
| --- | --- | --- | --- |
| 1 | 0:00–1:00 | Ahaana | Problem slide |
| 2 | 1:00–4:00 | Krishna | Algorithm slides |
| 3 | 4:00–5:00 | Krishna | Console program on a golden case |
| 4 | 5:00–6:30 | Krishna | Website: big-job trap, FCFS vs ours in Compare |
| 5 | 6:30–7:30 | Krishna | Memory hog, aging vs aging + reservation, "why" log |
| 6 | 7:30–8:30 | Krishna | Examiner drives |
| 7 | 8:30–10:30 | Ahaana | Graphs E1, E2, E5, E6 |
| 8 | 10:30–11:30 | Krishna | Testing slide |
| 9 | 11:30–12:00 | Krishna | Limits slide |

## Timestamps the backup video must have (3 minutes, rows 4 to 6)

| Video time | Matches row | Content (see DEMO_SCRIPT.md for the clicks) |
| --- | --- | --- |
| 0:00–1:00 | 4 | Build: load Big-job trap. Compare: fcfs + reserve, press Compare. Table identical (17.1 / 19 / 22), timelines show the nine small jobs starting at 20. |
| 1:00–2:00 | 5 | Build: load Memory hog. Run: aging to the end (job 3 starts at 36), then aging_reserve to the end (job 3 starts at 12). Open the why log filtered to job 3. |
| 2:00–3:00 | 6 | Build mode: add a job to the table; Run mode: step a few times, add a job mid-run, run to the end. |

The fallback column of PRD §10A requires: row 4 at 0:00, row 5 at 1:00. Row 6's entry (2:00) is an extra convenience marker.

## TO DO by Krishna: record

Not done by the assistant. The recording is a human step. Do it after the website is final (re-record if the UI changes before K-41).

- [ ] Run `make wasm` and open `web/index.html` from the folder with Wi-Fi off (as in the demo).
- [ ] Screen: 1920x1080 (or the projector's resolution). Browser zoom 125%. One colour mode (light or dark) and use the same one on demo day. Hide bookmarks bar and notifications.
- [ ] Record with the macOS screen recorder (Shift-Command-5) or similar, mic on, voice-over speaking the "says" text from PRD §10A rows 4 to 6.
- [ ] Total length 3 minutes (+/- 10 s). Keep the three sections at 0:00, 1:00, 2:00 as in the table; add a visible pause or title card at each boundary if you need to hit the marks.
- [ ] Follow the click order in `docs/DEMO_SCRIPT.md` rows 4, 5, 6 exactly.
- [ ] Play it back with the network off: it plays and 0:00 / 1:00 / 2:00 land on the right screens (issue test `video-plays`).
- [ ] Save copies: (1) local on the laptop (for example `~/Desktop/aprm-demo-backup.mp4`); (2) USB stick; (3) cloud (Drive or similar, link not required to be public). Do not commit the video.
- [ ] Update the timestamps in the table above if they moved, then tick the boxes in issue #35 section 8.
- [ ] Optional: set `BACKUP_VIDEO_URL` in `web/js/app.js` once the video has a link (it is empty now; the error box says the link will be added). That edit belongs to a separate change.
