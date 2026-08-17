import { useEffect, useMemo, useRef, useState } from "react";

import hostsLookup from "./hosts-lookup.md" with { type: "text" };
import hostTagging from "./host-tagging.md" with { type: "text" };
import assetDiscovery from "./asset-discovery.md" with { type: "text" };

type Skill = {
  slug: string;
  label: string;
  blurb: string;
  source: string;
};

const SKILLS: Skill[] = [
  {
    slug: "crowdstrike-hosts-lookup",
    label: "Hosts lookup",
    blurb: "Hostname to AID, host details, and the FQDN trap.",
    source: hostsLookup,
  },
  {
    slug: "crowdstrike-host-tagging",
    label: "Host tagging",
    blurb: "FalconGroupingTags, batching, partial-success handling.",
    source: hostTagging,
  },
  {
    slug: "crowdstrike-asset-discovery",
    label: "Asset discovery",
    blurb: "Unmanaged neighbours, coverage gaps, attribution.",
    source: assetDiscovery,
  },
];

function frontmatterDescription(source: string): string {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const line = match[1].match(/description:\s*([\s\S]*?)(?:\n[a-z-]+:|$)/);
  return line ? line[1].trim() : "";
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      document.body.removeChild(field);
    }
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };

  return { copied, copy };
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-rule pl-3">
      <div className="text-[0.6rem] uppercase tracking-[0.22em] text-muted">{label}</div>
      <div className="font-display text-lg text-paper">{value}</div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState(SKILLS[0].slug);
  const { copied, copy } = useCopy();

  const skill = useMemo(
    () => SKILLS.find((s) => s.slug === active) ?? SKILLS[0],
    [active],
  );

  const description = useMemo(() => frontmatterDescription(skill.source), [skill]);
  const lines = useMemo(() => skill.source.split("\n").length, [skill]);
  const words = useMemo(() => skill.source.split(/\s+/).filter(Boolean).length, [skill]);

  return (
    <div className="grain min-h-screen">
      <title>CrowdStrike skills library</title>

      <header className="border-b border-rule bg-ink-soft">
        <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
          <div className="flex items-baseline gap-3 text-[0.62rem] uppercase tracking-[0.3em] text-ember">
            <span>Field manual</span>
            <span className="h-px flex-1 bg-rule" />
            <span className="text-muted">3 skills</span>
          </div>

          <h1 className="mt-6 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-6xl">
            CrowdStrike
            <span className="block text-brass">skills library</span>
          </h1>

          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-muted">
            Three Agent Skills bundles distilled from the EDgaR story. Each is a
            single <code className="text-paper">SKILL.md</code>. Copy the text, save it as{" "}
            <code className="text-paper">&lt;skill-name&gt;/SKILL.md</code>, and hand the
            directory to whoever administers skills in your tenant — the directory name must
            match the <code className="text-paper">name</code> in the frontmatter.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <nav className="grid gap-3 sm:grid-cols-3">
          {SKILLS.map((s, index) => {
            const isActive = s.slug === active;
            return (
              <button
                key={s.slug}
                onClick={() => setActive(s.slug)}
                className={`group relative overflow-hidden border p-4 text-left transition-colors duration-200 ${
                  isActive
                    ? "border-ember bg-panel"
                    : "border-rule bg-ink-soft hover:border-brass"
                }`}
              >
                <div className="flex items-center justify-between text-[0.6rem] uppercase tracking-[0.22em] text-muted">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {isActive && <span className="text-ember">selected</span>}
                </div>
                <div className="mt-3 font-display text-xl text-paper">{s.label}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted">{s.blurb}</div>
              </button>
            );
          })}
        </nav>

        <section className="mt-8 border border-rule bg-ink-soft">
          <div className="flex flex-wrap items-start justify-between gap-6 border-b border-rule p-5 sm:p-6">
            <div className="min-w-0">
              <div className="text-[0.6rem] uppercase tracking-[0.22em] text-muted">
                skills/{skill.slug}/
              </div>
              <div className="mt-1 font-display text-2xl text-paper">SKILL.md</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => copy(skill.slug, skill.source)}
                className="border border-ember bg-ember/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-paper transition-colors hover:bg-ember/25"
              >
                {copied === skill.slug ? "Copied ✓" : "Copy markdown"}
              </button>
              <button
                onClick={() => download("SKILL.md", skill.source)}
                className="border border-rule px-4 py-2 text-xs uppercase tracking-[0.18em] text-muted transition-colors hover:border-brass hover:text-paper"
              >
                Download
              </button>
            </div>
          </div>

          <div className="grid gap-4 border-b border-rule p-5 sm:grid-cols-3 sm:p-6">
            <Stat label="Lines" value={String(lines)} />
            <Stat label="Words" value={String(words)} />
            <Stat label="Supporting files" value="none" />
          </div>

          {description && (
            <div className="border-b border-rule p-5 sm:p-6">
              <div className="text-[0.6rem] uppercase tracking-[0.22em] text-muted">
                Trigger description
              </div>
              <p className="mt-2 text-sm leading-relaxed text-paper/85">{description}</p>
            </div>
          )}

          <div className="p-5 sm:p-6">
            <div className="mb-3 flex items-center gap-3 text-[0.6rem] uppercase tracking-[0.22em] text-muted">
              <span>Raw source</span>
              <span className="h-px flex-1 bg-rule" />
            </div>
            <pre className="doc rule-grid max-h-[32rem] overflow-auto border border-rule bg-ink p-5 text-[0.78rem] leading-9 whitespace-pre-wrap text-paper/90">
              {skill.source}
            </pre>
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-6 text-xs text-muted">
          <span>
            Endpoint details are drawn from the EDgaR story and documented Falcon API surface —
            not verified against a live tenant.
          </span>
          <button
            onClick={() =>
              copy(
                "all",
                SKILLS.map((s) => `===== ${s.slug}/SKILL.md =====\n\n${s.source}`).join("\n\n"),
              )
            }
            className="border border-rule px-4 py-2 uppercase tracking-[0.18em] transition-colors hover:border-brass hover:text-paper"
          >
            {copied === "all" ? "Copied all ✓" : "Copy all three"}
          </button>
        </footer>
      </main>
    </div>
  );
}
