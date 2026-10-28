const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

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
  console.log('Launching Edge for 1024x768 Valhalla test...');
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--window-size=1024,768',
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

  let serverListReceived = false;
  const logs = [];

  ws.addEventListener('open', async () => {
    await sendCmd('Runtime.enable');
    await sendCmd('Page.enable');
    await sendCmd('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sendCmd('Page.navigate', { url: 'http://localhost:8085' });
  });

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
        if (!args.includes('Downloading data')) {
          console.log(`[CONSOLE ${type.toUpperCase()}]`, args);
          logs.push(args);
        }
        if (args.includes('Success Receive Server List')) {
          serverListReceived = true;
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[EXCEPTION]', msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
      }
    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  // Wait for server list received or up to 60s
  for (let s = 0; s < 60; s++) {
    await sleep(1000);
    if (serverListReceived) break;
  }

  if (!serverListReceived) {
    console.error('Timeout waiting for server list');
    edge.kill();
    process.exit(1);
  }

  console.log('Server list received! Waiting 2s for stabilization...');
  await sleep(2000);

  // Capture step 1 screenshot
  const shot1 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shot1?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step1_serverlist.png', Buffer.from(shot1.data, 'base64'));
    console.log('Saved step1_serverlist.png');
  }

  // Get canvas position and dimensions from DOM
  const evalRes = await sendCmd('Runtime.evaluate', {
    expression: `(() => {
      const c = document.getElementById('canvas');
      const r = c.getBoundingClientRect();
      return JSON.stringify({
        left: r.left, top: r.top, width: r.width, height: r.height,
        bufWidth: c.width, bufHeight: c.height,
        winW: window.innerWidth, winH: window.innerHeight
      });
    })()`
  });
  console.log('DOM Canvas info:', evalRes?.result?.value);

  // Click on the Valhalla button
  // Let's click at (373, 384) which is the button center in 1024x768
  const clickX = 373;
  const clickY = 384;
  console.log(`Dispatching mouse click at (${clickX}, ${clickY})...`);

  await sendCmd('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: clickX,
    y: clickY
  });
  await sleep(100);
  await sendCmd('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: clickX,
    y: clickY,
    button: 'left',
    clickCount: 1
  });
  await sleep(100);
  await sendCmd('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: clickX,
    y: clickY,
    button: 'left',
    clickCount: 1
  });

  console.log('Waiting 3s after click on Valhalla...');
  await sleep(3000);

  const shot2 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (shot2?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\.gemini\\antigravity\\brain\\d9f85c3b-b987-4fd6-bf80-1860dd74ac21\\step2_after_click.png', Buffer.from(shot2.data, 'base64'));
    console.log('Saved step2_after_click.png');
  }

  edge.kill();
  console.log('Test completed.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
