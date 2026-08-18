The page at `/unmanaged-hosts` (space members only). Renders immediately and fetches
[`/unmanaged-hosts-data`](<../Report data/script.ts>) client-side: headline counts (unmanaged,
first seen today, unsupported), a breakdown by the discovering host's department tag, and
sortable-by-tab tables of the assets themselves.

Copy is deliberately hedged — Discover reports network sightings, not proof a machine is
unprotected. See [App.tsx](App.tsx).
