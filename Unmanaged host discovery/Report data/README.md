Serves the latest sweep as JSON at `/unmanaged-hosts-data` (space members only) for
[the report page](<../Coverage report/App.tsx>) to fetch. Reads `/storage/discover/latest.json`
from the `discover` volume read-only, and returns an empty report if no sweep has run yet.

See [script.ts](script.ts) and [api.json](api.json).
