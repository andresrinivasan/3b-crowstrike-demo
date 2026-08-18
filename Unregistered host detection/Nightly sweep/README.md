Runs every night at 03:00 UTC (`cron = "0 3 * * *"`) and builds the coverage report the
[report page](<../Coverage report/App.tsx>) displays.

Source is **Falcon Discover** — every sensored host passively observes its network neighbours, so
anything seen with no sensor of its own comes back as `unmanaged`. Discover was confirmed licensed
on this tenant at build time; if `/discover/*` starts returning `403`, this step fails loudly
rather than falling back to a weaker source (that would need a code change).

Endpoints used, all read-only (scopes: **Assets: Read**, **Hosts: Read**):

- `GET /discover/queries/hosts/v1` → `GET /discover/entities/hosts/v1` — unmanaged and unsupported assets seen in the last 24 hours, paginated 100 at a time.
- `GET /devices/queries/devices-scroll/v1` → `GET /devices/entities/devices/v2` — managed hosts, used to cross-check candidates by MAC and hostname.

A candidate whose MAC or hostname matches a managed host is flagged
`matches_managed_host` and shown separately on the page — stale sensors, renames, DHCP churn and
dual-homed hosts all produce false gaps, so nothing is asserted as "unprotected".

Writes the full report to `/storage/falcon_coverage/latest.json` (volume `falcon_coverage`, this is
the only writer) and prints a one-line summary to stdout.

Logic lives in [script.ts](script.ts); change the lookback window or the entity filter in the
`queryAssetIds` call near the bottom.
