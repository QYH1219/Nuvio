import fs from 'node:fs';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';

async function listTargets() {
  const response = await fetch(`${CDP}/json/list`);
  if (!response.ok) throw new Error(`CDP list failed: ${response.status}`);
  return response.json();
}

async function pickTarget(match = 'app://-/index.html') {
  const targets = await listTargets();
  return targets.find((target) => target.type === 'page' && target.url.includes(match)) || targets.find((target) => target.type === 'page');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        close() { socket.close(); }
      });
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const { res, rej } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) rej(new Error(`${message.error.message} (${JSON.stringify(message.error.data ?? '')})`));
      else res(message.result);
    });
    socket.addEventListener('error', () => reject(new Error('CDP socket error')));
  });
}

async function evaluate(client, expression, awaitPromise = true) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    throw new Error(detail.exception?.description || detail.text || 'evaluation failed');
  }
  return result.result?.value;
}

async function screenshot(client, outPath) {
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 82,
    fromSurface: true,
    captureBeyondViewport: false
  });
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  return outPath;
}

const [command, ...args] = process.argv.slice(2);
const client = await connect(
  (
    await pickTarget(
      args.includes('--spotlight') ? 'spotlight' : 'app://-/index.html',
    )
  ).webSocketDebuggerUrl,
);

try {
  if (command === 'eval') {
    const expression = args.filter((arg) => !arg.startsWith('--')).join(' ');
    const value = await evaluate(client, expression);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } else if (command === 'shot') {
    const outPath = args[0] || 'docs/cdp-shot.jpg';
    await screenshot(client, outPath);
    console.log(outPath);
  } else {
    console.error('usage: node tools/cdp.mjs eval <expression> | shot <out.jpg>');
    process.exitCode = 1;
  }
} finally {
  client.close();
}
