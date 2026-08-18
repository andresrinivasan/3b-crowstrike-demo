import { useEffect, useState } from "react";

type Asset = {
  id: string;
  hostname?: string;
  current_local_ip?: string;
  mac_address?: string;
  os_version?: string;
  platform_name?: string;
  confidence?: number;
  first_seen?: string;
  last_seen?: string;
  discovered_by?: string;
  discoverer_tags: string[];
  matches_managed_host?: boolean;
};

type Report = {
  generated_at: string;
  window: string;
  source: string;
  managed_hosts_compared: number;
  unmanaged: Asset[];
  unsupported: Asset[];
  error?: string;
};

const MONO = "'IBM Plex Mono', ui-monospace, monospace";

function tag(a: Asset) {
  const t = a.discoverer_tags
    .filter((x) => x.startsWith("FalconGroupingTags/"))
    .map((x) => x.replace("FalconGroupingTags/", ""));
  return t.length > 0 ? t.join(", ") : "unattributed";
}

function Table({ rows, empty }: { rows: Asset[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="px-5 py-8 text-sm text-amber-200/40">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.18em] text-amber-200/40">
            {["Host", "IP", "MAC", "OS", "Seen by", "Group", "First seen"].map((h) => (
              <th key={h} className="border-b border-amber-200/15 px-5 py-3 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-amber-200/10 hover:bg-amber-200/5">
              <td className="px-5 py-3 text-amber-50">
                {a.hostname ?? <span className="text-amber-200/40">unknown</span>}
                {a.matches_managed_host && (
                  <span className="ml-2 rounded-sm bg-emerald-400/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
                    matches managed host
                  </span>
                )}
              </td>
              <td className="px-5 py-3 text-amber-100/80">{a.current_local_ip ?? "—"}</td>
              <td className="px-5 py-3 text-amber-100/60">{a.mac_address ?? "—"}</td>
              <td className="px-5 py-3 text-amber-100/70">
                {a.os_version ?? a.platform_name ?? "—"}
                {a.confidence !== undefined && (
                  <span className="ml-1 text-amber-200/35">({a.confidence})</span>
                )}
              </td>
              <td className="px-5 py-3 text-amber-100/70">{a.discovered_by ?? "—"}</td>
              <td className="px-5 py-3 text-amber-100/60">{tag(a)}</td>
              <td className="px-5 py-3 text-amber-100/50">
                {a.first_seen ? a.first_seen.slice(0, 16).replace("T", " ") : "—"}
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

  useEffect(() => {
    const branch = window.location.search;
    fetch(`/unregistered-hosts-data${branch}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        return body as Report;
      })
      .then(setReport)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const gaps = report?.unmanaged.filter((a) => !a.matches_managed_host) ?? [];
  const excluded = report?.unmanaged.filter((a) => a.matches_managed_host) ?? [];

  return (
    <div
      className="min-h-screen bg-neutral-950 px-6 py-12 text-amber-50"
      style={{
        fontFamily: MONO,
        backgroundImage:
          "radial-gradient(circle at 15% -10%, rgba(251,191,36,0.10), transparent 55%), radial-gradient(circle at 90% 0%, rgba(248,113,113,0.08), transparent 45%)",
      }}
    >
      <title>Unregistered host detection</title>
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;600&display=swap"
        rel="stylesheet"
      />

      <div className="mx-auto max-w-6xl">
        <header className="mb-10 border-b border-amber-200/20 pb-8">
          <p className="text-[11px] uppercase tracking-[0.35em] text-amber-300/60">
            Falcon Discover · nightly sweep
          </p>
          <h1 className="mt-3 text-4xl font-light tracking-tight sm:text-5xl">
            Hosts on the network
            <span className="block text-amber-300">with no Falcon sensor</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-amber-100/60">
            Machines observed on the network by a sensored neighbour that have no matching Falcon
            sensor of their own. Passive observation — treat each row as a candidate to verify,
            not a confirmed unprotected machine.
          </p>
        </header>

        {error && (
          <p className="rounded border border-red-400/30 bg-red-400/10 px-5 py-4 text-sm text-red-200">
            {error}
          </p>
        )}
        {!report && !error && <p className="text-sm text-amber-200/50">Loading latest sweep…</p>}

        {report && (
          <>
            <div className="mb-10 grid gap-4 sm:grid-cols-3">
              {[
                ["Likely coverage gaps", gaps.length, "text-amber-300"],
                ["Unsupported devices", report.unsupported.length, "text-amber-100/70"],
                ["Managed hosts compared", report.managed_hosts_compared, "text-amber-100/70"],
              ].map(([label, value, cls]) => (
                <div
                  key={label as string}
                  className="border border-amber-200/15 bg-amber-200/[0.03] px-5 py-6"
                >
                  <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200/45">
                    {label}
                  </p>
                  <p className={`mt-2 text-4xl font-light ${cls}`}>{value}</p>
                </div>
              ))}
            </div>

            <section className="mb-12 border border-amber-200/15">
              <h2 className="border-b border-amber-200/15 px-5 py-4 text-sm uppercase tracking-[0.2em] text-amber-300">
                Unmanaged — seen on network, no matching sensor
              </h2>
              <Table rows={gaps} empty="No unmanaged assets in the last 24 hours." />
              {excluded.length > 0 && (
                <div className="border-t border-amber-200/15">
                  <p className="px-5 pt-4 text-[11px] uppercase tracking-[0.2em] text-emerald-300/70">
                    Cross-checked out — MAC or hostname matches a managed host
                  </p>
                  <Table rows={excluded} empty="" />
                </div>
              )}
            </section>

            <section className="border border-amber-200/15">
              <h2 className="border-b border-amber-200/15 px-5 py-4 text-sm uppercase tracking-[0.2em] text-amber-100/60">
                Unsupported — sensor cannot run here
              </h2>
              <Table rows={report.unsupported} empty="No unsupported devices seen." />
            </section>

            <footer className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-xs text-amber-200/40">
              <span>Window: {report.window}</span>
              <span>Source: {report.source}</span>
              <span>Generated {report.generated_at.replace("T", " ").slice(0, 19)} UTC</span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
