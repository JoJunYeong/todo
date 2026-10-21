# Loading, task details and note images

The task dialog opens with the title and memo first. Date, calendar, repeat and color controls sit under a collapsed “일정 설정” section. The dialog body owns vertical scrolling; the editor grows with its content, and the footer stays visible. Background and header blur were removed to reduce painting during scrolling. Opening a task warms a dedicated details chunk; an immediate memo preview covers the first chunk download.

Returning users can see a small, read-only preview of the current week while Firebase restores the session and loads current data. The current week remains cached even after browsing historical dates. This cache is scoped to the authenticated user, expires after seven days and is cleared on logout. It excludes note text, checklist text and image bytes. Editing remains disabled until the full snapshot arrives. Store loading runs alongside authentication, and search indexing starts when a search is entered.

On the same local production preview origin, three revisit samples changed from 1044/965/967 ms to 327/322/330 ms for first task display (median 967 → 327 ms). Full synchronization in the candidate took 823/810/829 ms. These measurements describe a local revisit with cached assets and a populated week cache, not first-visit network performance or a claim that synchronization finishes in 327 ms.

## Captures

The memo toolbar also provides a “가로 구분선” button. It inserts a horizontal rule at the current caret, retains normal typing below it and supports the editor's native undo/redo. Rules survive sanitization, Save and reopening. Native touch insertion, undo/redo, a second Save and reload persistence passed with the isolated synthetic store at widths 320, 390, 768, 1024 and 1440 pixels; these checks do not establish live Firebase persistence.

The memo accepts clipboard image files, rich HTML clipboard images, image uploads and image drops. Images are re-encoded, limited to 2560 pixels per side and 480 KiB encoded binary, and stored separately under `users/{uid}/noteImages/{id}`. The memo contains references rather than embedded image data. Images load when their memo opens, not in the initial task subscription. Clicking an image offers a larger view and original size.

New image documents are written on Save. Closing an unsaved draft does not upload images. Note and image access require the active owning account; administrator access to other users' private notes/images is denied. Existing image bytes are immutable. Removing an image from a note removes its reference; the original private image document remains available to older references. This release adds no paid storage service or billing upgrade.

JSON export includes referenced images. Restore validates images before writes, writes images before their referencing tasks, verifies the server data, and skips matching existing records on repeated import. Backups without images retain their existing format and behavior.

## Verification

- 42 domain/cache/image/holiday/rollover tests and 13 Firestore emulator security tests passed.
- Clipboard file paste, native rich HTML paste, upload, sanitization, original-size viewer and nested Escape behavior passed in ego-lite.
- Three captures, rich text and 100 lines of text survived Save, reload and another edit/Save/reload.
- At widths 320, 390, 768, 1024 and 1440 pixels, only the dialog body scrolled. The editor, outer dialog and document stayed at scroll position zero, the footer stayed fixed, and scrolling caused no editor DOM mutations or horizontal page overflow. These are browser viewport checks, not physical-device FPS measurements.
- At 390 × 844, the memo starts around 178 px from the top, compared with 446 px in the prior layout.
- Export/restore to a second emulator account preserved all three images. The new account was empty before import; first restore wrote four records and skipped its existing calendar; repeated restore wrote zero and skipped all five records.
- Normal production and emulator builds passed. Emulator connections are enabled only by `VITE_FIREBASE_EMULATORS=true` and use a dedicated demo project.

References: [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), [Cloud Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024), [clipboard image files](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFile).

## Korean holidays

The week header and mobile day picker show public holidays and their original names, including substitute holidays. The app fetches yearly JSON from `https://holidays.dist.be/{year}.json`, a public service that refreshes Korea Astronomy and Space Science Institute special-day data daily. It uses only records with `holiday: true` and `kind: 1`, preserving the source dates rather than calculating substitute days. Observances such as Teachers' Day are excluded.

Requests run independently of task loading, with a 24-hour per-year browser cache, an eight-second network timeout and a manual refresh button. A failed refresh retains the last good data and displays a retry state; a missing response is not treated as an empty holiday calendar. A week crossing New Year loads both years. The service is an external mirror, so newly announced holidays appear after its source update and the next refresh. The displayed source link explains this origin.

The received 2026 feed contains both October 3 (National Foundation Day) and October 5 (its substitute), plus October 9 (Hangul Day). Browser checks at five viewport widths confirmed the holiday names and accessible mobile labels without horizontal overflow. Unit tests cover original/substitute dates, observance filtering, invalid/incomplete responses, cache refresh and offline fallback. Sources: [data service and refresh policy](https://github.com/distbe/holidays), [original KASI API](https://www.data.go.kr/data/15012690/openapi.do).

## Unfinished tasks

Automatic carryover is enabled by default and can be disabled in account settings. It applies to unfinished, nondeleted, nonrecurring tasks dated on or after 2026-10-21. Older imported schedules remain in their original dates. A running app checks the local date every 30 seconds and when the page becomes visible; after an absence it catches up directly to today. This is client-triggered synchronization, not a server job while every device is closed.

Carryover waits for an online server snapshot with no pending local writes. Each transaction checks the current account preference and rereads at most 20 task documents before updating only date/history fields. A concurrently completed or rescheduled task is skipped. Task IDs, note text, images and checklist data are preserved. Original and last moved dates are retained, repeated checks are idempotent, and recurring masters/occurrences stay on their existing recurrence schedule. An open task draft is excluded until the dialog closes. Transient failures show a status message and retry after 30 seconds.

Emulator browser checks advanced only the dedicated QA page's local day: October 21 → 22 moved an unfinished task and preserved five excluded task dates and memo contents. A task completed after candidate selection was skipped by the transaction. Disabling the preference prevented movement; re-enabling it after a simulated multi-day absence caught up directly to October 25. A repeated transaction wrote zero additional moves. System time and production accounts were not changed for these checks.
