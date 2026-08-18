Serves the latest sweep as JSON at `GET /unregistered-hosts-data` (space members only) for the
[report page](<../Coverage report/App.tsx>) to fetch.

Reads `/storage/falcon_coverage/latest.json` (volume `falcon_coverage`, mounted read-only) — written
by [the nightly sweep](<../Nightly sweep/script.ts>). Returns `404` with an `error` field when no
sweep has run yet. See [api.json](api.json) for the response shape.
