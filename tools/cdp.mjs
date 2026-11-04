import fs from 'node:fs';
import path from 'node:path';

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
    const failAll = (reason) => {
      for (const { rej } of pending.values()) rej(new Error(reason));
      pending.clear();
    };
    socket.addEventListener('open', () => {
      resolve({
        /**
         * Every CDP request is bounded. A renderer can stall (minimized window,
         * GPU reset, relaunch) and an unbounded await left this CLI hanging
         * forever with no output.
         */
        send(method, params = {}, timeoutMs = 20000) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
            }, timeoutMs);
            pending.set(id, {
              res: (value) => {
                clearTimeout(timer);
                res(value);
              },
              rej: (error) => {
                clearTimeout(timer);
                rej(error);
              },
            });
          });
        },
        close() {
          try {
            socket.close();
          } catch {
            /* ignore */
          }
        },
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
    socket.addEventListener('close', () => {
      failAll('CDP socket closed');
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
  const attempts = [
    { fromSurface: true, captureBeyondViewport: false },
    { fromSurface: false, captureBeyondViewport: false },
    { fromSurface: true, optimization: 'speed' },
  ];
  let lastError = null;
  for (const extra of attempts) {
    try {
      const { data } = await client.send(
        'Page.captureScreenshot',
        { format: 'jpeg', quality: 82, ...extra },
        15000,
      );
      if (!data) throw new Error('empty screenshot payload');
      fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
      fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
      return outPath;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
