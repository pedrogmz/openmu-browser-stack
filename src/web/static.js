const fs = require("fs");
const path = require("path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// The Emscripten outputs keep fixed names (Main.data, Main.wasm, Main.js), so
// they cannot be marked immutable. `no-cache` lets the browser keep the body
// but makes it revalidate before every use: an unchanged file costs a 304,
// a rebuilt one is downloaded again. `no-store` would force the full ~775 MB
// download on every load.
const CACHE_CONTROL = "no-cache";

// Data buckets are named after a SHA256 of their bytes
// (scripts/build-data-buckets.js): a given URL never changes content, so the
// browser may reuse it without asking. Everything else, including the bucket
// manifest, keeps revalidating.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const IMMUTABLE_PATH = /^\/assets\/data-[0-9a-f]{20}\.data$/;

function cacheControlFor(filePath) {
  return IMMUTABLE_PATH.test(filePath) ? IMMUTABLE_CACHE_CONTROL : CACHE_CONTROL;
}

// Strong validator from size + modification time (ms). Rebuilding or copying a
// new client into public/ changes the mtime, which changes the tag.
function computeEtag(stats) {
  return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
}

// If-None-Match uses weak comparison (RFC 9110 13.1.2): ignore the W/ prefix.
function etagMatches(header, etag) {
  if (header.trim() === "*") {
    return true;
  }
  const bare = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === bare);
}

function isNotModified(req, stats, etag) {
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch !== undefined) {
    // When both are present If-None-Match wins (RFC 9110 13.2.2).
    return etagMatches(ifNoneMatch, etag);
  }
  const ifModifiedSince = req.headers["if-modified-since"];
  if (ifModifiedSince !== undefined) {
    const since = Date.parse(ifModifiedSince);
    if (Number.isNaN(since)) {
      return false;
    }
    // HTTP dates have one-second resolution.
    return Math.floor(stats.mtimeMs / 1000) <= Math.floor(since / 1000);
  }
  return false;
}

function sendError(res, status, message, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(message);
}

// Serves files from publicDir with revalidation headers. The caller sets any
// headers that must appear on every response (COOP/COEP) before calling it;
// they survive on 200, 304 and error responses alike.
function createStaticHandler(publicDir) {
  const root = path.resolve(publicDir);

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
      return;
    }

    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split("?")[0]);
    } catch {
      sendError(res, 400, "Bad request");
      return;
    }

    const filePath = urlPath === "/" ? "/index.html" : urlPath;
    const fullPath = path.join(root, filePath);

    if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
      sendError(res, 403, "Forbidden");
      return;
    }

    fs.stat(fullPath, (err, stats) => {
      if (err || !stats.isFile()) {
        sendError(res, 404, "Not found");
        return;
      }

      const etag = computeEtag(stats);
      const validators = {
        "Cache-Control": cacheControlFor(filePath),
        ETag: etag,
        "Last-Modified": stats.mtime.toUTCString(),
      };

      if (isNotModified(req, stats, etag)) {
        res.writeHead(304, validators);
        res.end();
        return;
      }

      res.writeHead(200, {
        ...validators,
        "Content-Type":
          MIME_TYPES[path.extname(fullPath).toLowerCase()] ||
          "application/octet-stream",
        "Content-Length": stats.size,
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const stream = fs.createReadStream(fullPath);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    });
  };
}

module.exports = {
  createStaticHandler,
  computeEtag,
  CACHE_CONTROL,
  IMMUTABLE_CACHE_CONTROL,
};
