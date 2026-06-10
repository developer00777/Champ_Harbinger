// Obscura HTTP gateway. Obscura's `serve` mode only exposes page-level CDP,
// which Playwright cannot drive. This thin wrapper exposes the `obscura fetch`
// renderer over HTTP so the app can call it like the Trafilatura service.
//
//   POST /fetch { url, dump?, timeout?, wait? } -> { url, content }
//   GET  /health -> "ok"
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const PORT = Number(process.env.PORT || 9223);
const OBSCURA_BIN = process.env.OBSCURA_BIN || "/usr/local/bin/obscura";
const ALLOWED_DUMP = new Set(["html", "text", "markdown", "links"]);

function obscuraFetch(url, { dump = "html", timeout = 30, wait = 3 }) {
  const safeDump = ALLOWED_DUMP.has(dump) ? dump : "html";
  const args = [
    "fetch",
    url,
    "--dump",
    safeDump,
    "--allow-private-network",
    "--timeout",
    String(timeout),
    "--wait",
    String(wait),
  ];
  return new Promise((resolve, reject) => {
    execFile(
      OBSCURA_BIN,
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: (Number(timeout) + 15) * 1000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr?.toString() || err.message).slice(0, 400)));
        } else {
          resolve(stdout.toString());
        }
      },
    );
  });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    return res.end("ok");
  }
  if (req.method === "POST" && req.url === "/fetch") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid json" }));
    }
    if (!body.url || typeof body.url !== "string") {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "url required" }));
    }
    try {
      const content = await obscuraFetch(body.url, body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: body.url, content }));
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`[obscura-gateway] listening on :${PORT}`),
);
