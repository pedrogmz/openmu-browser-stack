// Data bucket builder and browser loader (issue #2).
// Run with: npm test

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const { buildBuckets, MANIFEST_NAME } = require("../scripts/build-data-buckets");

const LOADER = path.join(__dirname, "..", "public", "mu-data-loader.js");
const KB = 1024;
// Small scale so a few hundred 1 KB files make ~20 buckets.
const SCALE = { minMb: 8 / 1024, maxMb: 64 / 1024, cutModulus: 8 };

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeTree(root, count) {
  for (let i = 0; i < count; i++) {
    const dir = path.join(root, `dir${i % 7}`, `sub${i % 3}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `file${String(i).padStart(4, "0")}.bin`), crypto.randomBytes(KB));
  }
}

function build(source, out, extra = {}) {
  return buildBuckets({ sources: [{ dir: source, mount: "/Data" }], out, prune: true, ...SCALE, ...extra });
}

function names(manifest) {
  return manifest.buckets.map((bucket) => bucket.file);
}

function sourceFiles(root, mount = "/Data") {
  const files = new Map();
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relPath = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(full, relPath);
      else files.set(mount + relPath, fs.readFileSync(full));
    }
  };
  walk(root, "");
  return files;
}

test("the same input produces the same buckets", () => {
  const source = tempDir("mu-src-");
  makeTree(source, 400);
  const a = build(source, tempDir("mu-out-")).manifest;
  const b = build(source, tempDir("mu-out-")).manifest;
  assert.ok(a.buckets.length >= 10, `expected many buckets, got ${a.buckets.length}`);
  assert.deepEqual(a, b);
  for (const bucket of a.buckets) {
    assert.match(bucket.file, /^data-[0-9a-f]{20}\.data$/);
    assert.equal(bucket.file, `data-${bucket.sha256.slice(0, 20)}.data`);
    assert.ok(bucket.bytes <= 64 * KB);
  }
});

test("buckets hold exactly the source files", () => {
  const source = tempDir("mu-src-");
  makeTree(source, 300);
  const out = tempDir("mu-out-");
  const { manifest } = build(source, out);

  const mounted = new Map();
  for (const bucket of manifest.buckets) {
    const data = fs.readFileSync(path.join(out, bucket.file));
    assert.equal(data.length, bucket.bytes);
    assert.equal(crypto.createHash("sha256").update(data).digest("hex"), bucket.sha256);
    let offset = 0;
    for (const [filePath, size] of bucket.files) {
      mounted.set(filePath, data.subarray(offset, offset + size));
      offset += size;
    }
  }
  const expected = sourceFiles(source);
  assert.equal(mounted.size, expected.size);
  assert.equal(manifest.file_count, expected.size);
  for (const [filePath, bytes] of expected) {
    assert.ok(mounted.get(filePath).equals(bytes), filePath);
  }
});

test("editing one file changes only its bucket", () => {
  const source = tempDir("mu-src-");
  makeTree(source, 400);
  const out = tempDir("mu-out-");
  const before = build(source, out).manifest;

  const victim = path.join(source, "dir3", "sub1", "file0150.bin");
  fs.writeFileSync(victim, crypto.randomBytes(KB));
  const after = build(source, out);

  const changed = names(after.manifest).filter((name) => !names(before).includes(name));
  assert.equal(changed.length, 1);
  assert.equal(after.written, 1);
  assert.equal(after.removed, 1);
  assert.equal(fs.readdirSync(out).filter((name) => name.endsWith(".data")).length, after.manifest.buckets.length);
});

test("adding a file leaves most buckets untouched", () => {
  const source = tempDir("mu-src-");
  makeTree(source, 400);
  const out = tempDir("mu-out-");
  const before = build(source, out).manifest;

  fs.writeFileSync(path.join(source, "dir2", "sub0", "file0100a.bin"), crypto.randomBytes(3 * KB));
  const after = build(source, out).manifest;

  const kept = names(after).filter((name) => names(before).includes(name));
  assert.ok(
    kept.length >= before.buckets.length - 3,
    `only ${kept.length} of ${before.buckets.length} buckets kept`,
  );
});

test("a file bigger than the maximum gets a bucket of its own", () => {
  const source = tempDir("mu-src-");
  makeTree(source, 50);
  fs.writeFileSync(path.join(source, "dir0", "big.bin"), crypto.randomBytes(200 * KB));
  const { manifest } = build(source, tempDir("mu-out-"));
  const big = manifest.buckets.find((bucket) => bucket.files.some(([name]) => name === "/Data/dir0/big.bin"));
  assert.equal(big.files.length, 1);
  assert.equal(big.bytes, 200 * KB);
});

// Runs public/mu-data-loader.js against a fake Emscripten Module.
async function runLoader(out, { failFirst = new Set() } = {}) {
  const fsFiles = new Map();
  const dirs = new Set();
  const dependencies = new Set();
  const statuses = [];
  const requests = [];
  let released;
  const done = new Promise((resolve) => (released = resolve));

  const Module = {
    setStatus: (text) => statuses.push(text),
    FS_createPath: (parent, rel) => dirs.add(`${parent}${rel}`),
    FS_createDataFile: (filePath, name, data) => {
      assert.ok(dirs.has(filePath.slice(0, filePath.lastIndexOf("/"))), `no dir for ${filePath}`);
      fsFiles.set(filePath, Buffer.from(data));
    },
    addRunDependency: (id) => dependencies.add(id),
    removeRunDependency: (id) => {
      dependencies.delete(id);
      released();
    },
  };

  async function fakeFetch(url) {
    requests.push(url);
    const file = path.join(out, url.replace(/^assets\//, ""));
    if (failFirst.has(url)) {
      failFirst.delete(url);
      throw new TypeError("Failed to fetch");
    }
    if (!fs.existsSync(file)) return new Response("Not found", { status: 404 });
    return new Response(fs.readFileSync(file));
  }

  const context = {
    Module,
    fetch: fakeFetch,
    AbortController,
    Response,
    Promise,
    Uint8Array,
    Object,
    Math,
    Error,
    TypeError,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 10)),
    clearTimeout,
    performance,
    crypto: globalThis.crypto,
    console: { log() {}, warn() {}, error() {} },
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(LOADER, "utf8"), context);

  assert.equal(Module.preRun.length, 1);
  Module.preRun[0](Module);
  assert.ok(dependencies.has("mu-data-buckets") || fsFiles.size > 0);
  await Promise.race([
    done,
    new Promise((_, reject) => setTimeout(() => reject(new Error("dependency never released")), 10000)),
  ]);
  return { fsFiles, dependencies, statuses, requests };
}

test("the loader mounts every bucket before releasing the run dependency", async () => {
  const source = tempDir("mu-src-");
  makeTree(source, 300);
  const out = tempDir("mu-out-");
  const { manifest } = build(source, out);
  const firstBucket = `assets/${manifest.buckets[0].file}`;

  const result = await runLoader(out, { failFirst: new Set([firstBucket]) });

  assert.equal(result.dependencies.size, 0);
  const expected = sourceFiles(source);
  assert.equal(result.fsFiles.size, expected.size);
  for (const [filePath, bytes] of expected) {
    assert.ok(result.fsFiles.get(filePath).equals(bytes), filePath);
  }
  assert.equal(result.requests.filter((url) => url === firstBucket).length, 2, "failed bucket retried");
  assert.equal(result.statuses.at(-1), `Downloading data... (${manifest.total_bytes}/${manifest.total_bytes})`);
});

test("without a manifest the loader steps aside", async () => {
  const result = await runLoader(tempDir("mu-empty-"));
  assert.equal(result.dependencies.size, 0);
  assert.equal(result.fsFiles.size, 0);
});

test("the manifest name is stable", () => {
  assert.equal(MANIFEST_NAME, "data-manifest.json");
});
