const file = Bun.file("/storage/discover/latest.json");
const body = (await file.exists())
  ? await file.text()
  : JSON.stringify({
      generated_at: null,
      window: "last 24h",
      counts: { unmanaged: 0, unsupported: 0, new_today: 0 },
      by_department: {},
      unmanaged: [],
      unsupported: [],
    });

process.stdout.write(
  [
    "HTTP/1.1 200 OK",
    "Content-Type: application/json",
    "Cache-Control: no-store",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n"),
);
