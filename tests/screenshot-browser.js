const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json/list', res => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
      });
      if (data && data.length > 0) {
        const page = data.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await sleep(500);
  }
  return null;
}

async function main() {
  console.log('Launching Edge for screenshot capture...');
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--window-size=1280,720',
    '--enable-unsafe-webgpu',
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--no-sandbox',
    'about:blank'
  ], { stdio: 'ignore' });

  const wsUrl = await getWsUrl();
  if (!wsUrl) {
    console.error('Failed to get WebSocket debugger URL from Edge');
    edge.kill();
    process.exit(1);
  }

  console.log('Connected to CDP at', wsUrl);
  const ws = new WebSocket(wsUrl);

  let nextId = 1;
  const pending = new Map();

  function sendCmd(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.addEventListener('open', async () => {
    await sendCmd('Runtime.enable');
    await sendCmd('Page.enable');
    await sendCmd('Page.navigate', { url: 'http://localhost:8085' });
  });

  let initialized = false;

  ws.addEventListener('message', async event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const type = msg.params.type;
        const args = msg.params.args.map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
        console.log(`[CONSOLE ${type.toUpperCase()}]`, args);
        if (args.includes('Running...')) {
          initialized = true;
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[EXCEPTION]', msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
      }
    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  // Wait for Running status or up to 90s
  for (let s = 0; s < 90; s++) {
    await sleep(1000);
    if (initialized) {
      console.log('Game is running! Monitoring progression...');
      for (let w = 1; w <= 20; w++) {
        await sleep(1000);
        if (w === 5 || w === 10 || w === 15 || w === 20) {
          try {
            const result = await sendCmd('Page.captureScreenshot', { format: 'png' });
            if (result && result.data) {
              const buf = Buffer.from(result.data, 'base64');
              const outPath = path.join(__dirname, `public/screenshot-${w}s.png`);
              fs.writeFileSync(outPath, buf);
              console.log(`Saved screenshot at ${w}s: ${outPath} (${buf.length} bytes)`);
            }
          } catch(e) {}
        }
      }
      break;
    }
  }

  try {
    console.log('Capturing final screenshot via CDP...');
    const result = await sendCmd('Page.captureScreenshot', { format: 'png' });
    if (result && result.data) {
      const buf = Buffer.from(result.data, 'base64');
      const outPath = path.join(__dirname, 'public/screenshot.png');
      fs.writeFileSync(outPath, buf);
      console.log(`Final screenshot successfully saved to ${outPath} (${buf.length} bytes)`);
    } else {
      console.error('No screenshot data returned');
    }
  } catch (e) {
    console.error('Screenshot capture failed:', e);
  }

  edge.kill();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
