Serves the latest sweep as JSON at `GET /unregistered-hosts-data` (space members only) for the
[report page](<../Coverage report/App.tsx>) to fetch.

Reads `/storage/falcon_coverage/latest.json` (volume `falcon_coverage`, mounted read-only) — written
by [the nightly sweep](<../Nightly sweep/script.ts>). Returns `404` with an `error` field when no
sweep has run yet. See [api.json](api.json) for the response shape.

**Sample mode.** `GET /unregistered-hosts-data?sample=1` serves [sample.json](sample.json) — a
fabricated report covering every case the page renders: unmanaged hosts with no matching sensor,
two cross-checked-out hosts that carry the `matches managed host` badge, unsupported network gear,
and rows with a missing hostname or no grouping tag. Use it to demo or style the page without
waiting for a sweep; the report page passes the flag through, so `/unregistered-hosts?sample=1`
renders the populated page.

Sample mode is opt-in and deliberately **not** a fallback. A coverage report that quietly
substitutes invented hosts when the sweep hasn't run would read as real EDR gaps, so an absent
report stays a `404` and the page keeps saying so.
