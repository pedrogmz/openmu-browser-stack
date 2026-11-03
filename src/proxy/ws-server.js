const http = require("http");
const https = require("https");
const { WebSocketServer, WebSocket } = require("ws");
const PacketParser = require("./packet-parser");
const PacketRewriter = require("./packet-rewriter");
const { createTcpConnection } = require("./tcp-client");
const { SimpleModulusSession } = require("./simple-modulus");

// ConnectionInfo carries the address the client must reconnect to. "auto"
// mirrors the host/port the browser used, so LAN clients are sent back to the
// same address instead of a hardcoded localhost. X-Forwarded-* is honoured so
// this also works behind nginx.
function firstHeader(value) {
  return String(value || "")
    .split(",")[0]
    .trim();
}

// The web server normalises X-Real-IP / X-Forwarded-For before forwarding an
// upgrade. Behind nginx every socket comes from 127.0.0.1, so the session key
// must use the real client address or players would collide.
function clientAddress(req) {
  const realIp = firstHeader(req.headers["x-real-ip"]);
  const cfIp = firstHeader(req.headers["cf-connecting-ip"]);
  const forwarded = firstHeader(req.headers["x-forwarded-for"]);
  return realIp || cfIp || forwarded || req.socket.remoteAddress;
}

function resolvePublicTarget(req, proxyPublicHost, proxyPublicPort) {
  const forwardedHost = firstHeader(req.headers["x-forwarded-host"]);
  const forwardedProto = firstHeader(
    req.headers["x-forwarded-proto"],
  ).toLowerCase();
  const forwardedPort = firstHeader(req.headers["x-forwarded-port"]);
  const hostHeader = (forwardedHost || req.headers.host || "").trim();
  const portMatch = /:(\d+)$/.exec(hostHeader);
  const headerHost = portMatch
    ? hostHeader.slice(0, portMatch.index)
    : hostHeader;
  const headerPort = portMatch
    ? parseInt(portMatch[1], 10)
    : forwardedPort
      ? parseInt(forwardedPort, 10)
      : forwardedProto === "https" || req.socket.encrypted
        ? 443
        : 80;

  return {
    host:
      !proxyPublicHost || proxyPublicHost === "auto"
        ? headerHost || "127.0.0.1"
        : proxyPublicHost,
    port:
      !proxyPublicPort || proxyPublicPort === "auto"
        ? headerPort
        : proxyPublicPort,
  };
}

function createProxyServer(config) {
  const {
    wsPort,
    wsHost,
    connectHost,
    connectPort,
    gameHost,
    proxyPublicHost,
    proxyPublicPort,
    tls,
  } = config;

  // ConnectionInfo (F4 03) redirects are stored per client IP so the next
  // WebSocket connection from that IP routes to the correct game server port
  const sessionTargets = new Map();

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

  // Plain HTTP requests on the WS port are a configuration mistake; keep the
  // response explicit instead of leaving the socket hanging.
  const rejectPlainHttp = (req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("WebSocket upgrade required");
  };

  const httpServer = tls
    ? https.createServer({ key: tls.key, cert: tls.cert }, rejectPlainHttp)
    : http.createServer(rejectPlainHttp);

  httpServer.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  httpServer.on("error", (err) => {
    console.error(`[WS] Server error: ${err.message}`);
  });

  httpServer.listen(wsPort, wsHost, () => {
    const scheme = tls ? "wss" : "ws";
    console.log(`[WS] Proxy listening on ${scheme}://${wsHost}:${wsPort}`);
    if (tls) {
      console.log(`[WS] TLS enabled (cert: ${tls.certFile})`);
    }
  });

  let connectionId = 0;

  wss.on("connection", (ws, req) => {
    const id = ++connectionId;
    const clientIp = clientAddress(req);
    const tag = `conn#${id}`;

    // Keep Cloudflare/nginx from closing an idle WebSocket. Browsers answer
    // ping frames automatically; Cloudflare's idle timeout is ~100 seconds.
    const keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    console.log(`[WS:${tag}] New connection from ${clientIp}`);

    const sessionKey = clientIp;
    let tcpHost, tcpPort;

    if (sessionTargets.has(sessionKey)) {
      const target = sessionTargets.get(sessionKey);
      sessionTargets.delete(sessionKey);
      tcpHost = target.host;
      tcpPort = target.port;
      console.log(
        `[WS:${tag}] Routing to Game Server (redirect): ${tcpHost}:${tcpPort}`,
      );
    } else {
      tcpHost = connectHost;
      tcpPort = connectPort;
      console.log(
        `[WS:${tag}] Routing to Connect Server: ${tcpHost}:${tcpPort}`,
      );
    }

    const isGameServer = tcpPort !== connectPort;
    const smSession = isGameServer ? new SimpleModulusSession() : null;

    const publicTarget = resolvePublicTarget(
      req,
      proxyPublicHost,
      proxyPublicPort,
    );
    const rewriter = new PacketRewriter(
      publicTarget.host,
      publicTarget.port,
      gameHost,
    );
    const tcp = createTcpConnection(tcpHost, tcpPort, tag);
    const serverParser = new PacketParser(`${tag}:server`);

    let wsAlive = true;
    let tcpAlive = false;

    tcp.on("connect", () => {
      tcpAlive = true;
    });

    tcp.on("data", (data) => {
      if (!wsAlive) return;
      serverParser.feed(data);
    });

    serverParser.on("packet", (packet) => {
      if (!wsAlive) return;

      if (isGameServer && (packet[0] === 0xc3 || packet[0] === 0xc4)) {
        try {
          packet = smSession.decryptServerPacket(packet);
        } catch (err) {
          console.error(`[${tag}] Failed to decrypt server packet:`, err.message);
        }
      }

      console.log(`[${tag} S->C] len=${packet.length} hex=${packet.toString("hex")}`);

      const result = rewriter.processServerPacket(packet);

      if (result.rewritten && result.gameServerTarget) {
        console.log(
          `[${tag}] Game server redirect: ${result.gameServerTarget.host}:${result.gameServerTarget.port}`,
        );
        sessionTargets.set(sessionKey, result.gameServerTarget);
      }

      try {
        ws.send(result.packet);
      } catch (err) {
        console.error(`[WS:${tag}] Send error: ${err.message}`);
      }
    });

    ws.on("message", (data) => {
      if (!tcpAlive) return;
      let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      console.log(`[${tag} C->S] len=${buf.length} hex=${buf.toString("hex")}`);
      if (isGameServer) {
        try {
          buf = smSession.encryptClientPacket(buf);
        } catch (err) {
          console.error(`[${tag}] Failed to encrypt client packet:`, err.message);
        }
      }
      tcp.write(buf);
    });

    ws.on("close", (code) => {
      clearInterval(keepAlive);
      wsAlive = false;
      console.log(`[WS:${tag}] Closed (code=${code})`);
      if (tcpAlive) {
        tcp.destroy();
        tcpAlive = false;
      }
    });

    ws.on("error", (err) => {
      clearInterval(keepAlive);
      console.error(`[WS:${tag}] Error: ${err.message}`);
      wsAlive = false;
      if (tcpAlive) {
        tcp.destroy();
        tcpAlive = false;
      }
    });

    tcp.on("close", () => {
      tcpAlive = false;
      if (wsAlive) {
        console.log(`[${tag}] TCP closed, closing WS`);
        ws.close();
        wsAlive = false;
      }
    });

    tcp.on("error", (err) => {
      console.error(`[TCP:${tag}] Error: ${err.message}`);
      tcpAlive = false;
      if (wsAlive) {
        ws.close();
        wsAlive = false;
      }
    });
  });

  wss.on("error", (err) => {
    console.error(`[WS] Server error: ${err.message}`);
  });

  return wss;
}

module.exports = { createProxyServer };
