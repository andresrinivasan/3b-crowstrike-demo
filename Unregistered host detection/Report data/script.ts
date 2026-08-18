const file = Bun.file("/storage/falcon_coverage/latest.json");
const body = (await file.exists())
  ? await file.text()
  : JSON.stringify({ error: "No sweep has run yet." });

process.stdout.write(
  [
    `HTTP/1.1 ${(await file.exists()) ? 200 : 404} ${(await file.exists()) ? "OK" : "Not Found"}`,
    "Content-Type: application/json",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Cache-Control: no-store",
    "",
    body,
  ].join("\r\n"),
);
