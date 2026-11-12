// Loads the game data buckets listed in assets/data-manifest.json and mounts
// their files into the Emscripten FS before the client starts.
//
// Load this script before Main.data.js and Main.js. It reads and extends the
// global `Module`: a preRun hook holds a run dependency until every bucket is
// mounted, so the game never runs against missing assets. Progress goes
// through Module.setStatus("Downloading data... (loaded/total)") together
// with Main.data.js, so the existing loader UI keeps working.
//
// Bucket files are content-addressed (data-<sha256>.data) and served as
// immutable, so a reload reuses every unchanged bucket from the HTTP cache.
// Without a manifest (404) this script does nothing and Main.data alone is
// used, as in older builds.
(function () {
  "use strict";

  var MANIFEST_URL = "assets/data-manifest.json";
  var BUCKET_BASE = "assets/";
  var DEPENDENCY = "mu-data-buckets";
  var STALL_MS = 30000;
  var ATTEMPTS = 5;
  var CONCURRENCY = 3;

  var Module = (window.Module = window.Module || {});
  Module.dataFileDownloads = Module.dataFileDownloads || {};
  Module.expectedDataFileDownloads = (Module.expectedDataFileDownloads || 0) + 1;

  function reportProgress() {
    var loaded = 0;
    var total = 0;
    var downloads = Module.dataFileDownloads;
    for (var key in downloads) {
      if (!Object.prototype.hasOwnProperty.call(downloads, key)) continue;
      loaded += downloads[key].loaded;
      total += downloads[key].total;
    }
    if (Module.setStatus) {
      Module.setStatus("Downloading data... (" + loaded + "/" + total + ")");
    }
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function toHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    }
    return out;
  }

  // crypto.subtle exists only in secure contexts (HTTPS, localhost); the
  // client needs one anyway for WebGPU.
  async function verify(bucket, data) {
    if (!window.crypto || !window.crypto.subtle) return true;
    var digest = await window.crypto.subtle.digest("SHA-256", data);
    return toHex(digest) === bucket.sha256;
  }

  // One attempt: stream the body into a buffer of the manifest size, aborting
  // when no bytes arrive for STALL_MS (slow but progressing is fine).
  async function fetchOnce(bucket, url, cacheMode) {
    var progress = Module.dataFileDownloads[bucket.file];
    progress.loaded = 0;
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, STALL_MS);
    function touch() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        controller.abort();
      }, STALL_MS);
    }

    try {
      var response = await fetch(url, { signal: controller.signal, cache: cacheMode });
      if (!response.ok) throw new Error(response.status + " " + url);
      var data = new Uint8Array(bucket.bytes);
      var offset = 0;
      var reader = response.body.getReader();
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        touch();
        if (offset + chunk.value.length > data.length) {
          throw new Error("bucket larger than the manifest says: " + url);
        }
        data.set(chunk.value, offset);
        offset += chunk.value.length;
        progress.loaded = offset;
        reportProgress();
      }
      if (offset !== data.length) {
        throw new Error("bucket truncated (" + offset + "/" + data.length + "): " + url);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchBucket(bucket) {
    var url = BUCKET_BASE + bucket.file;
    var cacheMode = "default";
    var lastError = null;
    for (var attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        var data = await fetchOnce(bucket, url, cacheMode);
        if (await verify(bucket, data)) return data;
        // A corrupt cached copy must not be served again: bypass the cache.
        lastError = new Error("checksum mismatch: " + url);
        cacheMode = "reload";
      } catch (error) {
        lastError = error;
      }
      Module.dataFileDownloads[bucket.file].loaded = 0;
      reportProgress();
      if (attempt < ATTEMPTS) {
        console.warn("[data] retrying " + bucket.file + " (" + attempt + "): " + lastError.message);
        await wait(Math.min(8000, 1000 * Math.pow(2, attempt - 1)));
      }
    }
    throw lastError;
  }

  var fsReady = false;
  var pending = [];
  var createdDirs = Object.create(null);

  function mountBucket(bucket, data) {
    var offset = 0;
    for (var i = 0; i < bucket.files.length; i++) {
      var filePath = bucket.files[i][0];
      var size = bucket.files[i][1];
      var slash = filePath.lastIndexOf("/");
      var dir = filePath.slice(0, slash);
      if (dir && !createdDirs[dir]) {
        Module.FS_createPath("/", dir.slice(1), true, true);
        createdDirs[dir] = true;
      }
      // canOwn: the file keeps a view into the bucket buffer, no copy.
      Module.FS_createDataFile(filePath, null, data.subarray(offset, offset + size), true, true, true);
      offset += size;
    }
  }

  function mountOrQueue(bucket, data) {
    if (fsReady) {
      mountBucket(bucket, data);
    } else {
      pending.push([bucket, data]);
    }
  }

  async function loadAll(manifest) {
    var buckets = manifest.buckets;
    for (var i = 0; i < buckets.length; i++) {
      Module.dataFileDownloads[buckets[i].file] = { loaded: 0, total: buckets[i].bytes };
    }
    reportProgress();

    var next = 0;
    async function worker() {
      while (next < buckets.length) {
        var bucket = buckets[next++];
        mountOrQueue(bucket, await fetchBucket(bucket));
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(CONCURRENCY, buckets.length); w++) workers.push(worker());
    await Promise.all(workers);
  }

  var manifestPromise = fetch(MANIFEST_URL, { cache: "no-cache" }).then(function (response) {
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("data manifest: " + response.status);
    return response.json();
  });

  // Downloads start now, in parallel with Main.data and Main.wasm; files are
  // mounted once the runtime has created the FS.
  var loadPromise = manifestPromise.then(function (manifest) {
    if (!manifest) {
      console.log("[data] no bucket manifest, using Main.data only");
      return null;
    }
    if (manifest.format !== 1 || !Array.isArray(manifest.buckets)) {
      throw new Error("unsupported data manifest");
    }
    var started = performance.now();
    return loadAll(manifest).then(function () {
      console.log(
        "[data] " + manifest.buckets.length + " buckets, " + manifest.file_count + " files, " +
          (manifest.total_bytes / 1048576).toFixed(1) + " MB in " +
          ((performance.now() - started) / 1000).toFixed(1) + "s",
      );
      return manifest;
    });
  });
  // Surface failures from preRun; keep the early promise from being reported
  // as unhandled before the runtime picks it up.
  loadPromise.catch(function () {});

  function runWithFS() {
    Module.addRunDependency(DEPENDENCY);
    fsReady = true;
    for (var i = 0; i < pending.length; i++) mountBucket(pending[i][0], pending[i][1]);
    pending = [];
    loadPromise.then(
      function () {
        Module.removeRunDependency(DEPENDENCY);
      },
      function (error) {
        console.error("[data] bucket load failed:", error);
        if (Module.setStatus) {
          Module.setStatus("Data download failed: " + (error && error.message));
        }
      },
    );
  }

  if (Module.calledRun) {
    runWithFS();
  } else {
    (Module.preRun = Module.preRun || []).push(runWithFS);
  }
})();
