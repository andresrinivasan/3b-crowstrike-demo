const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Hello world</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc}h1{font-size:3rem;letter-spacing:-.02em}</style>
</head>
<body><h1>Hello, world 👋</h1></body>
</html>`;

process.stdout.write(
  [
    "HTTP/1.1 200 OK",
    "Content-Type: text/html; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ].join("\r\n"),
);
