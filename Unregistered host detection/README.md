Finds machines that are on the network but have no CrowdStrike Falcon sensor — the EDR coverage
gap — and publishes the result as a nightly report page.

**Trigger.** [Nightly sweep](<Nightly sweep/script.ts>) runs on a cron at 03:00 UTC. It queries
Falcon Discover for `unmanaged` and `unsupported` assets seen in the last 24 hours, cross-checks
each candidate against the managed-host inventory by MAC and hostname, and stores the report in the
`falcon_coverage` volume.

**Reading it.** Open **`/unregistered-hosts`** ([Coverage report](<Coverage report/App.tsx>)),
restricted to members of this space. The page fetches
[`/unregistered-hosts-data`](<Report data/script.ts>) for the stored JSON, so it loads instantly and
never blocks on the CrowdStrike API.

Read-only throughout: nothing is written back to CrowdStrike and no notifications are sent. The
only side effect is the report file in the `falcon_coverage` volume.

**Operational notes.** A `403` from Discover fails the sweep on purpose — it means the module or the
Assets: Read scope went away, and the fix is a licensing change or a rebuild against Falcon Exposure
Management, not a silent fallback. Judge the trend rather than the raw count: passive discovery
produces false gaps from stale sensors, renames, DHCP churn and dual-homed hosts, which is why the
page separates cross-checked-out candidates and unsupported network gear.

To change the lookback window or add a filter (a specific subnet, platform), edit the
`queryAssetIds` call in [Nightly sweep/script.ts](<Nightly sweep/script.ts>).
