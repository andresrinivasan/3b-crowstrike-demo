// sample=1 is opt-in and never a fallback: a coverage report that quietly substitutes fabricated
// hosts when the sweep hasn't run is worse than one that admits it has nothing to show.
const requestLine = (await Bun.stdin.text()).split(/\r?\n/, 1)[0] ?? "";
const target = requestLine.split(" ")[1] ?? "/";
const wantsSample = new URL(target, "http://localhost").searchParams.get("sample") === "1";

const file = Bun.file(wantsSample ? "./sample.json" : "/storage/falcon_coverage/latest.json");
const found = await file.exists();

const body = found
  ? await file.text()
  : JSON.stringify({
      error: wantsSample ? "sample.json is missing from this step." : "No sweep has run yet.",
    });

process.stdout.write(
  [
    `HTTP/1.1 ${found ? 200 : 404} ${found ? "OK" : "Not Found"}`,
    "Content-Type: application/json",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Cache-Control: no-store",
    "",
    body,
  ].join("\r\n"),
);
