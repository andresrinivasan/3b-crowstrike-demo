import { useEffect, useState } from "react";

type Asset = {
  id: string;
  hostname?: string;
  current_local_ip?: string;
  mac_address?: string;
  platform_name?: string;
  os_version?: string;
  confidence?: number;
  first_seen?: string;
  last_seen?: string;
  discovered_by?: string;
  discoverer_tags: string[];
};

type Report = {
  generated_at: string | null;
  window: string;
  counts: { unmanaged: number; unsupported: number; new_today: number };
  by_department: Record<string, number>;
  unmanaged: Asset[];
  unsupported: Asset[];
};

const branch = new URLSearchParams(window.location.search).get("branch") ?? "";

function dept(a: Asset) {
  const tag = a.discoverer_tags?.find((t) => t.startsWith("FalconGroupingTags/"));
  return tag ? tag.slice("FalconGroupingTags/".length) : "unattributed";
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="border border-neutral-800 bg-neutral-950/60 p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">{label}</div>
      <div className={`mt-3 font-mono text-4xl ${tone}`}>{value}</div>
    </div>
  );
}

function Table({ rows, showDept }: { rows: Asset[]; showDept: boolean }) {
  if (rows.length === 0)
    return <p className="px-1 py-6 text-sm text-neutral-500">Nothing seen in this window.</p>;

  return (
    <div className="overflow-x-auto border border-neutral-800">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-400">
            <th className="px-4 py-3 font-normal">Host</th>
            <th className="px-4 py-3 font-normal">IP</th>
            <th className="px-4 py-3 font-normal">MAC</th>
            <th className="px-4 py-3 font-normal">OS guess</th>
            {showDept && <th className="px-4 py-3 font-normal">Discoverer</th>}
            <th className="px-4 py-3 font-normal">First seen</th>
          </tr>
        </thead>
        <tbody className="font-mono text-neutral-300">
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-neutral-800/80 hover:bg-neutral-900/60">
              <td className="px-4 py-3 text-neutral-100">{a.hostname || "—"}</td>
              <td className="px-4 py-3">{a.current_local_ip || "—"}</td>
              <td className="px-4 py-3 text-neutral-500">{a.mac_address || "—"}</td>
              <td className="px-4 py-3">
                {a.os_version || a.platform_name || "unknown"}
                {typeof a.confidence === "number" && (
                  <span className="ml-2 text-xs text-neutral-600">{a.confidence}%</span>
                )}
              </td>
              {showDept && (
                <td className="px-4 py-3">
                  <span className="text-neutral-100">{a.discovered_by || "—"}</span>
                  <span className="ml-2 text-xs text-amber-500/80">{dept(a)}</span>
                </td>
              )}
              <td className="px-4 py-3 text-neutral-500">
                {a.first_seen ? a.first_seen.replace("T", " ").slice(0, 16) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"unmanaged" | "unsupported">("unmanaged");

  useEffect(() => {
    const url = branch
      ? `/unmanaged-hosts-data?branch=${branch}`
      : "/unmanaged-hosts-data";
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setReport)
      .catch((e) => setError(String(e)));
  }, []);

  const depts = report
    ? Object.entries(report.by_department).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <title>Unmanaged host discovery</title>

      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="border-b border-neutral-800 pb-8">
          <p className="text-xs uppercase tracking-[0.35em] text-amber-500">
            Falcon Discover · nightly sweep
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-50">
            Hosts on the network with no Falcon sensor
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
            Assets observed by sensored neighbors in the last 24 hours that have no matching
            Falcon sensor. Treat these as candidates: stale sensors, renames, NAT, and short
            DHCP leases all produce false gaps.
          </p>
          <p className="mt-4 font-mono text-xs text-neutral-600">
            {report?.generated_at
              ? `generated ${report.generated_at.replace("T", " ").slice(0, 16)} UTC`
              : "no sweep has run yet"}
          </p>
        </header>

        {error && (
          <p className="mt-8 border border-red-900 bg-red-950/40 p-4 font-mono text-sm text-red-300">
            Could not load report: {error}
          </p>
        )}

        {report && (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <Metric label="Unmanaged" value={report.counts.unmanaged} tone="text-amber-400" />
              <Metric label="New today" value={report.counts.new_today} tone="text-red-400" />
              <Metric
                label="Unsupported (printers, switches)"
                value={report.counts.unsupported}
                tone="text-neutral-400"
              />
            </div>

            {depts.length > 0 && (
              <section className="mt-10">
                <h2 className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                  By discovering host's department
                </h2>
                <div className="mt-4 space-y-2">
                  {depts.map(([name, count]) => (
                    <div key={name} className="flex items-center gap-4">
                      <span className="w-40 shrink-0 truncate font-mono text-sm text-neutral-300">
                        {name}
                      </span>
                      <div className="h-2 flex-1 bg-neutral-900">
                        <div
                          className="h-2 bg-amber-500/70"
                          style={{ width: `${(count / depts[0][1]) * 100}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono text-sm text-neutral-400">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-12">
              <div className="mb-4 flex gap-6 border-b border-neutral-800">
                {(["unmanaged", "unsupported"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 px-1 pb-3 text-xs uppercase tracking-[0.2em] ${
                      tab === t
                        ? "border-amber-500 text-neutral-100"
                        : "border-transparent text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    {t} ({report[t].length})
                  </button>
                ))}
              </div>
              <Table rows={report[tab]} showDept={tab === "unmanaged"} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
