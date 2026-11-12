#!/usr/bin/env node
// Packs game asset trees into content-addressed buckets plus a manifest.
//
//   node scripts/build-data-buckets.js --out public/assets \
//     --add path/to/src/bin/Data@/Data --add path/to/src/bin/fonts@/fonts
//
// Each bucket is the plain concatenation of the files it holds, written as
// data-<sha256 prefix>.data. data-manifest.json lists every bucket with its
// full SHA256 and its file table; public/mu-data-loader.js mounts them into
// the Emscripten FS at the given paths.
//
// Bucket boundaries are content-defined at file granularity: files are sorted
// by path, and a bucket is closed after a file whose path hash hits a fixed
// pattern (once the bucket has reached --min-mb), or before it would exceed
// --max-mb. Editing a file therefore changes its own bucket; adding or
// resizing a file can also move the next boundary, but the split realigns at
// the following hash cut instead of shifting every later bucket.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MANIFEST_NAME = "data-manifest.json";
const BUCKET_PATTERN = /^data-[0-9a-f]{20}\.data$/;
const MB = 1024 * 1024;
const DEFAULTS = { minBytes: 20 * MB, maxBytes: 32 * MB, cutModulus: 64 };

function parseArgs(argv) {
  const options = { sources: [], out: null, minMb: null, maxMb: null, prune: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === "--add") {
      const value = next();
      const at = value.lastIndexOf("@");
      if (at <= 0) throw new Error(`--add expects <dir>@<mount>, got ${value}`);
      options.sources.push({ dir: value.slice(0, at), mount: value.slice(at + 1) });
    } else if (arg === "--out") {
      options.out = next();
    } else if (arg === "--min-mb") {
      options.minMb = Number(next());
    } else if (arg === "--max-mb") {
      options.maxMb = Number(next());
    } else if (arg === "--no-prune") {
      options.prune = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.out || options.sources.length === 0) {
    throw new Error("Usage: build-data-buckets.js --out <dir> --add <dir>@<mount> [--add ...] [--min-mb 20] [--max-mb 32] [--no-prune]");
  }
  return options;
}

function normalizeMount(mount) {
  const clean = "/" + mount.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return clean === "/" ? "" : clean;
}

// Every regular file under the sources, as { source, target, size }.
function collectFiles(sources) {
  const files = [];
  const seen = new Map();
  for (const { dir, mount } of sources) {
    const root = path.resolve(dir);
    if (!fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
    const base = normalizeMount(mount);
    const walk = (current, rel) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(full, relPath);
        } else if (entry.isFile()) {
          const target = `${base}/${relPath}`;
          if (seen.has(target)) {
            throw new Error(`Two sources map to ${target}: ${seen.get(target)} and ${full}`);
          }
          seen.set(target, full);
          files.push({ source: full, target, size: fs.statSync(full).size });
        }
      }
    };
    walk(root, "");
  }
  files.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return files;
}

function pathHash(target) {
  return crypto.createHash("sha256").update(target).digest().readUInt32BE(0);
}

// Groups sorted files into buckets. Pure: depends only on paths and sizes.
function planBuckets(files, { minBytes, maxBytes, cutModulus } = DEFAULTS) {
  const buckets = [];
  let current = [];
  let size = 0;
  const close = () => {
    if (current.length) buckets.push(current);
    current = [];
    size = 0;
  };
  for (const file of files) {
    if (current.length && size + file.size > maxBytes) close();
    current.push(file);
    size += file.size;
    if (size >= maxBytes || (size >= minBytes && pathHash(file.target) % cutModulus === 0)) {
      close();
    }
  }
  close();
  return buckets;
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function buildBuckets(options) {
  const minBytes = options.minMb != null ? options.minMb * MB : DEFAULTS.minBytes;
  const maxBytes = options.maxMb != null ? options.maxMb * MB : DEFAULTS.maxBytes;
  if (!(minBytes > 0 && maxBytes >= minBytes)) throw new Error("Need 0 < --min-mb <= --max-mb");

  const outDir = path.resolve(options.out);
  fs.mkdirSync(outDir, { recursive: true });

  const files = collectFiles(options.sources);
  const cutModulus = options.cutModulus || DEFAULTS.cutModulus;
  const plan = planBuckets(files, { minBytes, maxBytes, cutModulus });
  const manifest = { format: 1, total_bytes: 0, file_count: files.length, buckets: [] };
  let written = 0;

  for (const group of plan) {
    const data = Buffer.concat(group.map((file) => {
      const bytes = fs.readFileSync(file.source);
      if (bytes.length !== file.size) throw new Error(`File changed while packing: ${file.source}`);
      return bytes;
    }));
    const sha256 = crypto.createHash("sha256").update(data).digest("hex");
    const name = `data-${sha256.slice(0, 20)}.data`;
    const target = path.join(outDir, name);
    // Content-addressed: an existing file with this name already holds these
    // bytes. Leaving it untouched keeps its mtime, and so its ETag, stable.
    if (!fs.existsSync(target) || fs.statSync(target).size !== data.length) {
      writeAtomic(target, data);
      written++;
    }
    manifest.buckets.push({
      file: name,
      sha256,
      bytes: data.length,
      files: group.map((file) => [file.target, file.size]),
    });
    manifest.total_bytes += data.length;
  }

  writeAtomic(path.join(outDir, MANIFEST_NAME), JSON.stringify(manifest));

  let removed = 0;
  if (options.prune) {
    const keep = new Set(manifest.buckets.map((bucket) => bucket.file));
    for (const entry of fs.readdirSync(outDir)) {
      if (BUCKET_PATTERN.test(entry) && !keep.has(entry)) {
        fs.unlinkSync(path.join(outDir, entry));
        removed++;
      }
    }
  }

  return { manifest, written, removed, outDir };
}

if (require.main === module) {
  try {
    const started = Date.now();
    const { manifest, written, removed, outDir } = buildBuckets(parseArgs(process.argv.slice(2)));
    const sizes = manifest.buckets.map((bucket) => bucket.bytes);
    console.log(
      `[buckets] ${manifest.file_count} files -> ${manifest.buckets.length} buckets, ` +
        `${(manifest.total_bytes / MB).toFixed(1)} MB ` +
        `(largest ${(Math.max(0, ...sizes) / MB).toFixed(1)} MB) in ${outDir}`,
    );
    console.log(
      `[buckets] ${written} written, ${manifest.buckets.length - written} unchanged, ` +
        `${removed} stale removed, ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  } catch (error) {
    console.error(`[buckets] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildBuckets, collectFiles, planBuckets, parseArgs, MANIFEST_NAME, DEFAULTS };
