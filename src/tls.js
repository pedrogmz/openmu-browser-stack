const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");

// TLS is optional. When TLS_CERT_PATH and TLS_KEY_PATH are set, both the web
// server and the WebSocket proxy switch to HTTPS/WSS.
//
// This is not just polish: WebGPU (and therefore the WASM client) is only
// exposed in secure contexts. Browsers consider localhost secure, but a LAN
// address such as http://192.168.1.106 is not, so playing from another device
// requires HTTPS.
function loadTlsConfig(env = process.env) {
  const certPath = (env.TLS_CERT_PATH || "").trim();
  const keyPath = (env.TLS_KEY_PATH || "").trim();

  if (!certPath && !keyPath) {
    return null;
  }

  if (!certPath || !keyPath) {
    throw new Error(
      "TLS_CERT_PATH and TLS_KEY_PATH must be set together (or both left empty)",
    );
  }

  const certFile = path.resolve(ROOT_DIR, certPath);
  const keyFile = path.resolve(ROOT_DIR, keyPath);

  for (const file of [certFile, keyFile]) {
    if (!fs.existsSync(file)) {
      throw new Error(`TLS file not found: ${file}`);
    }
  }

  return {
    cert: fs.readFileSync(certFile),
    key: fs.readFileSync(keyFile),
    certFile,
    keyFile,
  };
}

module.exports = { loadTlsConfig };
