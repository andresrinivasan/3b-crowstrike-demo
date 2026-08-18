Nightly EDR coverage check: which machines are on the network without a Falcon sensor.

[Discover unmanaged assets](<Discover unmanaged assets/script.ts>) runs on a cron at 03:00 UTC,
queries Falcon Discover for `unmanaged` and `unsupported` assets seen in the last 24 hours,
groups them by the discovering host's department tag, and stores the report in the `discover`
volume. [Report data](<Report data/script.ts>) serves that file as JSON at
`/unmanaged-hosts-data`, and [Coverage report](<Coverage report/App.tsx>) renders the page at
`/unmanaged-hosts`. Both routes are restricted to members of this space.

Read-only against CrowdStrike — nothing is created or changed in Falcon. Requires a CrowdStrike
connector with the **Assets: Read** scope and the Falcon Discover module licensed; `/discover/*`
returning 403 usually means the module isn't enabled.

Caveats worth repeating to anyone reading the report: stale sensors, renamed hosts, dual-homed
machines, NAT/VPN addresses, and short DHCP leases all show up as unmanaged. Cross-check against
the Hosts API before declaring a machine unprotected, and watch the trend rather than the
absolute number.

To change the schedule, edit `cron` in [Discover unmanaged assets/config.toml](<Discover unmanaged assets/config.toml>);
to change the lookback window or filters, edit the filter string in its script.
