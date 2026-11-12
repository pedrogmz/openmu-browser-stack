// Cache revalidation for the static web server (issue #1).
// Run with: npm test
//
// Starts the real src/web/server.js against a temporary public/ directory and
// checks that a second load costs only 304s, and that a rebuilt file is served
// in full again.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "src", "web", "server.js");
const ASSETS = ["index.html", "Main.data.js", "Main.js", "Main.wasm", "Main.data"];

let publicDir;
let server;
let baseUrl;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function writeAsset(name, content, mtimeSeconds) {
  const file = path.join(publicDir, name);
  fs.writeFileSync(file, content);
  if (mtimeSeconds !== undefined) {
    fs.utimesSync(file, mtimeSeconds, mtimeSeconds);
  }
}

before(async () => {
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "mu-static-"));
  const past = Math.floor(Date.now() / 1000) - 3600;
  for (const name of ASSETS) {
    writeAsset(name, `initial ${name}\n`.repeat(64), past);
  }

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      WEB_PORT: String(port),
      WEB_HOST: "127.0.0.1",
      WEB_PUBLIC_DIR: publicDir,
      TLS_CERT_PATH: "",
      TLS_KEY_PATH: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 10000);
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("[WEB] Server at")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}`));
    });
  });
});

after(() => {
  if (server) server.kill();
  if (publicDir) fs.rmSync(publicDir, { recursive: true, force: true });
});

function urlFor(name) {
  return name === "index.html" ? `${baseUrl}/` : `${baseUrl}/${name}`;
}

function assertCrossOriginIsolation(res) {
  assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(res.headers.get("cross-origin-embedder-policy"), "require-corp");
}

test("first load sends validators and revalidation policy", async () => {
  for (const name of ASSETS) {
    const res = await fetch(urlFor(name));
    assert.equal(res.status, 200, name);
    assert.equal(res.headers.get("cache-control"), "no-cache", name);
    assert.match(res.headers.get("etag"), /^"[0-9a-f]+-[0-9a-f]+"$/, name);
    assert.ok(res.headers.get("last-modified"), name);
    assertCrossOriginIsolation(res);
    assert.equal((await res.text()).length, `initial ${name}\n`.length * 64);
  }
});

test("second load is 304 without a body (If-None-Match)", async () => {
  for (const name of ASSETS) {
    const first = await fetch(urlFor(name));
    await first.arrayBuffer();
    const etag = first.headers.get("etag");

    const second = await fetch(urlFor(name), { headers: { "If-None-Match": etag } });
    assert.equal(second.status, 304, name);
    assert.equal(second.headers.get("etag"), etag);
    assert.equal(second.headers.get("cache-control"), "no-cache");
    assertCrossOriginIsolation(second);
    assert.equal((await second.arrayBuffer()).byteLength, 0);
  }
});

test("second load is 304 with If-Modified-Since", async () => {
  const first = await fetch(urlFor("Main.data"));
  await first.arrayBuffer();
  const res = await fetch(urlFor("Main.data"), {
    headers: { "If-Modified-Since": first.headers.get("last-modified") },
  });
  assert.equal(res.status, 304);
  assertCrossOriginIsolation(res);
});

test("If-None-Match accepts lists and weak tags", async () => {
  const first = await fetch(urlFor("Main.wasm"));
  await first.arrayBuffer();
  const etag = first.headers.get("etag");
  const res = await fetch(urlFor("Main.wasm"), {
    headers: { "If-None-Match": `"other", W/${etag}` },
  });
  assert.equal(res.status, 304);
});

test("a mismatching If-None-Match wins over a matching If-Modified-Since", async () => {
  const first = await fetch(urlFor("Main.js"));
  await first.arrayBuffer();
  const res = await fetch(urlFor("Main.js"), {
    headers: {
      "If-None-Match": '"stale"',
      "If-Modified-Since": first.headers.get("last-modified"),
    },
  });
  assert.equal(res.status, 200);
  await res.arrayBuffer();
});

test("a rebuilt file is served in full again", async () => {
  for (const name of ["Main.data", "index.html", "Main.data.js"]) {
    const before = await fetch(urlFor(name));
    await before.arrayBuffer();
    const oldEtag = before.headers.get("etag");
    const oldModified = before.headers.get("last-modified");

    // Same size, new content and mtime: what a rebuild of a fixed-layout file looks like.
    const content = `rebuilt ${name}\n`.repeat(64).slice(0, `initial ${name}\n`.length * 64);
    writeAsset(name, content);

    const byEtag = await fetch(urlFor(name), { headers: { "If-None-Match": oldEtag } });
    assert.equal(byEtag.status, 200, name);
    assert.notEqual(byEtag.headers.get("etag"), oldEtag, name);
    assert.equal(await byEtag.text(), content, name);

    const byDate = await fetch(urlFor(name), { headers: { "If-Modified-Since": oldModified } });
    assert.equal(byDate.status, 200, name);
    assert.equal(await byDate.text(), content, name);

    const again = await fetch(urlFor(name), {
      headers: { "If-None-Match": byEtag.headers.get("etag") },
    });
    assert.equal(again.status, 304, name);
  }
});

test("HEAD returns headers without a body", async () => {
  const res = await fetch(urlFor("Main.data"), { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("etag"));
  assert.ok(Number(res.headers.get("content-length")) > 0);
  assert.equal((await res.arrayBuffer()).byteLength, 0);
});

test("missing files and traversal are not cacheable", async () => {
  const missing = await fetch(`${baseUrl}/nope.data`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assertCrossOriginIsolation(missing);
  await missing.arrayBuffer();

  const traversal = await fetch(`${baseUrl}/..%2f..%2fpackage.json`);
  assert.ok([403, 404].includes(traversal.status));
  await traversal.arrayBuffer();
});

test("content-addressed data buckets are immutable, the manifest is not", async () => {
  fs.mkdirSync(path.join(publicDir, "assets"), { recursive: true });
  const bucket = "assets/data-0123456789abcdef0123.data";
  writeAsset(bucket, "bucket");
  writeAsset("assets/data-manifest.json", "{}");

  const res = await fetch(`${baseUrl}/${bucket}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok(res.headers.get("etag"));
  assertCrossOriginIsolation(res);
  await res.arrayBuffer();

  const manifest = await fetch(`${baseUrl}/assets/data-manifest.json`);
  assert.equal(manifest.headers.get("cache-control"), "no-cache");
  assert.match(manifest.headers.get("content-type"), /^application\/json/);
  await manifest.arrayBuffer();

  // Main.data keeps a fixed name, so it must keep revalidating.
  const main = await fetch(urlFor("Main.data"), { method: "HEAD" });
  assert.equal(main.headers.get("cache-control"), "no-cache");
});

test("other methods are rejected", async () => {
  const res = await fetch(urlFor("Main.data"), { method: "POST" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET, HEAD");
  await res.arrayBuffer();
});
