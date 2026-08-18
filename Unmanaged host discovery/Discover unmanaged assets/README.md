Runs nightly at 03:00 UTC (`cron = "0 3 * * *"`) and asks Falcon Discover which assets were seen
on the network in the last 24 hours with no Falcon sensor of their own.

Two calls against `https://api.crowdstrike.com` (needs the **Assets: Read** scope and the Falcon
Discover module):

1. `GET /discover/queries/hosts/v1` with filter `entity_type:['unmanaged','unsupported']+last_seen_timestamp:>'now-24h'`, paginated 100 at a time.
2. `GET /discover/entities/hosts/v1?ids=…` to hydrate each id.

Results are split into `unmanaged` (the coverage gap) and `unsupported` (printers, switches,
cameras — never going to run a sensor), counted by the *discovering* host's
`FalconGroupingTags/` department, and written to the `discover` volume as
`/storage/discover/latest.json`, plus a per-day counts file under `history/`.

Stdout is just the counts, so the run log shows the trend. See [script.ts](script.ts).

Errors throw rather than being swallowed — a report that silently drops a page understates the gap.
