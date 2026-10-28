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
  console.log('Launching Edge for interactive test...');
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

  let serverListReceived = false;

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
  }

  console.log('Waiting 3s for scene stabilization after server list...');
  await sleep(3000);

  // Capture screenshot of login scene
  const initialShot = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (initialShot?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\Documents\\openmu-browser-stack\\public\\shot_tour.png', Buffer.from(initialShot.data, 'base64'));
    console.log('Saved shot_tour.png');
  }

  // Dispatch mouse click at (640, 360)
  console.log('Dispatching mouse click at (640, 360)...');
  await sendCmd('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 640,
    y: 360,
    button: 'left',
    clickCount: 1
  });
  await sleep(100);
  await sendCmd('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 640,
    y: 360,
    button: 'left',
    clickCount: 1
  });

  console.log('Waiting 3s after mouse click...');
  await sleep(3000);

  const clickShot = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (clickShot?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\Documents\\openmu-browser-stack\\public\\shot_after_click.png', Buffer.from(clickShot.data, 'base64'));
    console.log('Saved shot_after_click.png');
  }

  // Dispatch key press (Space and Enter)
  console.log('Dispatching key press Space...');
  await sendCmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(100);
  await sendCmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });

  await sleep(1000);

  console.log('Dispatching key press Enter...');
  await sendCmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(100);
  await sendCmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

  await sleep(3000);

  const keyShot = await sendCmd('Page.captureScreenshot', { format: 'png' });
  if (keyShot?.data) {
    fs.writeFileSync('C:\\Users\\Poisson\\Documents\\openmu-browser-stack\\public\\shot_after_key.png', Buffer.from(keyShot.data, 'base64'));
    console.log('Saved shot_after_key.png');
  }

  edge.kill();
  console.log('Interactive test completed.');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
