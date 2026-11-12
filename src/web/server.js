const http = require("http");
const https = require("https");
const net = require("net");
const tls = require("tls");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const { loadTlsConfig } = require("../tls");
const { createStaticHandler } = require("./static");

const PORT = parseInt(process.env.WEB_PORT || "8080", 10);
const HOST = process.env.WEB_HOST || "0.0.0.0";
const PUBLIC_DIR = process.env.WEB_PUBLIC_DIR
  ? path.resolve(process.env.WEB_PUBLIC_DIR)
  : path.join(__dirname, "../../public");
const TLS_CONFIG = loadTlsConfig();

// Only these peers may supply X-Forwarded-* headers. Loopback covers bare-metal
// nginx; Docker's bridge range covers nginx on the host (and nginx containers).
// A direct LAN client is not trusted, so it cannot spoof the session IP.
const TRUSTED_PROXIES = (process.env.TRUSTED_PROXY_IPS || "127.0.0.1,::1")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

// The browser reaches the WebSocket proxy through this server at /ws. Keeping
// a single public origin/port avoids mixed content on HTTPS pages and lets
// nginx terminate TLS without exposing the proxy port.
const WS_FORWARD_HOST = process.env.WS_FORWARD_HOST || "127.0.0.1";
const WS_FORWARD_PORT = parseInt(
  process.env.WS_FORWARD_PORT || process.env.WS_PORT || "7100",
  10,
);

const serveStatic = createStaticHandler(PUBLIC_DIR);

const requestHandler = (req, res) => {
  const urlPath = req.url.split("?")[0];

  // Lightweight liveness probe for Docker/systemd; keep it out of the static
  // file path and out of the request log.
  if (urlPath === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (!req.url.includes(".wasm") && !req.url.includes(".data")) {
    console.log(`[WEB] ${req.method} ${req.url}`);
  }

  // Required for SharedArrayBuffer (WASM threading)
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

  serveStatic(req, res);
};

const server = TLS_CONFIG
  ? https.createServer(
      { key: TLS_CONFIG.key, cert: TLS_CONFIG.cert },
      requestHandler,
    )
  : http.createServer(requestHandler);

function parseIpv4(address) {
  if (!address) {
    return null;
  }
  const normalized = address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  const parts = normalized.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const text of parts) {
    if (!/^\d+$/.test(text)) {
      return null;
    }
    const part = Number(text);
    if (part < 0 || part > 255) {
      return null;
    }
    value = (value << 8) | part;
  }
  return value >>> 0;
}

function ipv4InCidr(address, cidr) {
  const [range, bitsText] = cidr.split("/");
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  const ip = parseIpv4(address);
  const rangeIp = parseIpv4(range);
  if (
    ip === null ||
    rangeIp === null ||
    !Number.isInteger(bits) ||
    bits < 0 ||
    bits > 32
  ) {
    return false;
  }
  if (bits === 0) {
    return true;
  }
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (rangeIp & mask);
}

function isTrustedProxy(address, proxies) {
  if (!address) {
    return false;
  }
  for (const entry of proxies) {
    if (entry === address) {
      return true;
    }
    if (entry.includes("/") && ipv4InCidr(address, entry)) {
      return true;
    }
    if (address.startsWith("::ffff:") && entry === address.slice(7)) {
      return true;
    }
  }
  return false;
}

function firstHeader(value) {
  return String(value || "")
    .split(",")[0]
    .trim();
}

// Rebuild the upgrade request for the proxy while normalising the forwarding
// headers. Only a trusted peer (nginx, the local reverse proxy or Docker's
// bridge) may supply X-Forwarded-*; a direct client cannot spoof the IP used
// as the session key.
function buildUpgradeRequest(req) {
  const peer = req.socket.remoteAddress || "";
  const trustForwarded = isTrustedProxy(peer, TRUSTED_PROXIES);
  const forwardedFor = trustForwarded
    ? firstHeader(req.headers["x-forwarded-for"])
    : "";
  const forwardedRealIp = trustForwarded
    ? firstHeader(req.headers["x-real-ip"])
    : "";
  const forwardedHost = trustForwarded
    ? firstHeader(req.headers["x-forwarded-host"])
    : "";
  const forwardedProto = trustForwarded
    ? firstHeader(req.headers["x-forwarded-proto"])
    : "";
  const forwardedPort = trustForwarded
    ? firstHeader(req.headers["x-forwarded-port"])
    : "";
  const cfConnectingIp = trustForwarded
    ? firstHeader(req.headers["cf-connecting-ip"])
    : "";

  const clientIp = cfConnectingIp || forwardedRealIp || forwardedFor || peer;
  const host = forwardedHost || req.headers.host || "";
  const proto = forwardedProto || (TLS_CONFIG ? "https" : "http");
  let port = forwardedPort;
  if (!port) {
    const portMatch = /:(\d+)$/.exec(req.headers.host || "");
    port = portMatch ? portMatch[1] : proto === "https" ? "443" : "80";
  }

  const skip = new Set([
    "cf-connecting-ip",
    "x-forwarded-for",
    "x-real-ip",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
  ]);
  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (skip.has(req.rawHeaders[i].toLowerCase())) {
      continue;
    }
    lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  }
  lines.push(`X-Real-IP: ${clientIp}`);
  lines.push(`X-Forwarded-For: ${forwardedFor || cfConnectingIp || peer}`);
  lines.push(`X-Forwarded-Host: ${host}`);
  lines.push(`X-Forwarded-Port: ${port}`);
  lines.push(`X-Forwarded-Proto: ${proto}`);

  return lines.join("\r\n") + "\r\n\r\n";
}

// Forward /ws upgrades to the local proxy. When the web server itself serves
// HTTPS (direct LAN setup) the proxy is also TLS, so connect with TLS. Behind
// nginx TLS is terminated at the edge and this hop stays plain.
function connectToWebSocketProxy(onConnect) {
  const options = {
    host: WS_FORWARD_HOST,
    port: WS_FORWARD_PORT,
  };
  if (TLS_CONFIG) {
    // Loopback connection to our own proxy; its certificate is the same one
    // this server uses, so hostname validation would fail on 127.0.0.1.
    options.rejectUnauthorized = false;
  }
  return TLS_CONFIG
    ? tls.connect(options, onConnect)
    : net.connect(options, onConnect);
}

server.on("upgrade", (req, socket, head) => {
  const pathname = (req.url || "").split("?")[0];
  if (pathname !== "/ws" && pathname !== "/ws/") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const upstream = connectToWebSocketProxy(() => {
    upstream.write(buildUpgradeRequest(req));
    if (head && head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(PORT, HOST, () => {
  const scheme = TLS_CONFIG ? "https" : "http";
  console.log(`[WEB] Server at ${scheme}://${HOST}:${PORT}`);
  console.log(`[WEB] Static files: ${PUBLIC_DIR}`);
  console.log(
    `[WEB] WebSocket endpoint: /ws -> ${
      TLS_CONFIG ? "wss" : "ws"
    }://${WS_FORWARD_HOST}:${WS_FORWARD_PORT}`,
  );
  if (TLS_CONFIG) {
    console.log(`[WEB] TLS enabled (cert: ${TLS_CONFIG.certFile})`);
  } else {
    console.log(
      "[WEB] TLS disabled -- browsers only expose WebGPU on localhost. " +
        "Set TLS_CERT_PATH/TLS_KEY_PATH for direct LAN HTTPS, or terminate " +
        "TLS in a reverse proxy such as nginx.",
    );
  }
});
