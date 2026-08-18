The report page, at `/unregistered-hosts` (space members only). Opens instantly and fetches
[the data endpoint](<../Report data/script.ts>) client-side, so it never waits on CrowdStrike.

Shows three groups: likely coverage gaps, candidates cross-checked out because their MAC or
hostname matches a managed host, and `unsupported` devices (printers, switches, cameras) that will
never run a sensor. Rows carry the discovering host and its grouping tags — a routing hint for
which team should go look at the subnet, not an ownership claim.

Markup and styling are in [App.tsx](App.tsx).
