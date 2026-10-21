# Motion and resting holidays

Cards now lift under the pointer, move surrounding cards out of the way and settle with a short spring transition. The sidebar, task sheets, buttons and checkboxes use the same motion language. There is no continuous animation or memo scroll handler. System reduced-motion preferences disable the lift and shorten transitions.

Drag the grip on the right of a task. Its touch target is 44 × 44 pixels on phones; swiping the task text still scrolls the page. A phone can move a task to another day by dragging over its weekday tab. Keyboard users focus the grip, press Space to lift, use arrow keys to move, then Space to drop or Escape to cancel. Day, backlog and same-list sorting share the same saved date/list/order fields.

Hovering previews placement without database writes. A drop writes only the moved task. Cancelling or a failed save restores its previous position and selected mobile day. A task deleted or moved elsewhere during the gesture is rejected; unrelated memo edits are preserved. Changing the calendar, week or view cancels an active move.

An empty public holiday appears as a short, muted gray column with its holiday name, “쉬어가는 공휴일” and an enabled add field. Creating a task or dragging a card into it expands the column over 280 ms. Removing the last task returns it to the resting state. Completed tasks hidden by the current filter still count as scheduled tasks, so filtering does not incorrectly collapse a populated holiday. Ordinary weekdays and weekends keep their normal layout. Missing holiday data is not treated as a holiday.

Each dated list shows unfinished tasks first and completed tasks at the bottom. Both groups retain their existing manual order. Checking a task changes its completion status without rewriting order values; unchecking returns it to its previous position among unfinished tasks. This also applies after saving completion in the details dialog and after reload. Drag previews and drops preserve the same boundary, and a dated drop calculates order among tasks with the same completion status. Undated backlog lists retain their existing manual order.

## Verification

- 49 domain tests pass, including completion grouping, immutable drag previews, insertion order, holiday conditions and concurrent relocation checks.
- The real Planner component with an isolated synthetic store passed mouse sorting, cross-day/backlog moves, keyboard moves, mobile touch moves, edge scrolling, cancellation, failed-save recovery and reload persistence. Drag previews performed no writes; normal touch scrolling did not activate dragging.
- Completion from a native touch checkbox and from the details dialog moved tasks below unfinished tasks. Unchecking restored their manual order, hiding/showing completed tasks retained grouping, and reload preserved it. Keyboard and mobile cross-day moves kept both completion groups ordered; attempts to cross the status boundary performed no redundant writes. Notes were preserved throughout. These additional checks used the isolated synthetic store.
- Widths 320, 390, 768, 1024 and 1440 pixels passed holiday input/height, overflow, sidebar and memo layout checks. A 100-line memo produced no editor DOM mutations and no observed tasks of 50 ms or longer during the sampled scrolls. These are Chromium viewport checks, not physical iOS frame-rate measurements.
- Expanding and collapsing a phone holiday animated between approximately 137 and 220 pixels. Reduced-motion mode shortened modal motion to 0.01 ms.
- The production build passes. The main JavaScript gzip size increases by approximately 19 kB for pointer, touch and keyboard sorting. The existing startup week cache and lazy memo/auth/store chunks remain in place; this is not a new loading-speed benchmark.

The local synthetic-store checks do not establish Firebase persistence. Live persistence and the deployed artifact hashes are verified separately during the approved release. This change does not alter Firestore rules, account access or backend data formats.

References: [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion), [pointer sensors and touch-action](https://dndkit.com/legacy/api-documentation/sensors/pointer/), [sortable keyboard and overlay guidance](https://dndkit.com/legacy/presets/sortable/overview/).
