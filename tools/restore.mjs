import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCleanupExpression } from './cleanup-expression.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STATE_FILE = join(ROOT, '.cxd-inject.json');

function parseArgs(argv) {
  const options = {
    port: null,
    target: '',
    keepConfig: false,
    reload: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[index];
    };
    if (arg === '--port') options.port = Number(next());
    else if (arg === '--target') options.target = next();
    else if (arg === '--keep-config') options.keepConfig = true;
    else if (arg === '--reload') options.reload = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (options.port !== null && (!Number.isInteger(options.port) || options.port <= 0)) {
    throw new Error('--port must be a positive integer');
  }
  return options;
}

function printHelp() {
  console.log(`
Nuvio restore

Usage:
  npm run restore -- [options]

Options:
  --port 9222       Chromium remote debugging port (defaults to last injection)
  --target TEXT     page target id/title/url substring
  --keep-config     keep localStorage settings, only remove the background layer
  --reload          reload the page after the scheduled script is removed
  -h, --help        show this help

The injector records its Page.addScriptToEvaluateOnNewDocument identifier in
.cxd-inject.json. Restore removes that script, disposes the live layer, removes
the injected styles and clears the saved config.
`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
  }

  static async connect(url) {
    if (typeof WebSocket === 'undefined') {
      throw new Error('This Node build has no global WebSocket. Use Node.js 22 or newer.');
    }
    const ws = new WebSocket(url);
    const client = new CdpClient(ws);
    ws.addEventListener('message', (event) => client.onMessage(event.data));
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket timeout')), 10000);
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolvePromise();
        },
        { once: true },
      );
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('CDP WebSocket connection failed'));
        },
        { once: true },
      );
    });
    return client;
  }

  onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP error'));
      else pending.resolve(message.result || {});
      return;
    }
    const listeners = this.events.get(message.method);
    if (!listeners?.length) return;
    this.events.delete(message.method);
    for (const listener of listeners) listener(message.params || {});
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeoutMs = 20000) {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP event timeout: ${method}`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        resolvePromise(params);
      };
      const listeners = this.events.get(method) || [];
      listeners.push(listener);
      this.events.set(method, listeners);
    });
  }

  close() {
    wsClose(this.ws);
  }
}

function wsClose(ws) {
  try {
    ws.close();
  } catch {
    /* ignore */
  }
}

async function getTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1800),
  });
  if (!response.ok) throw new Error(`CDP target list failed: HTTP ${response.status}`);
  return response.json();
}

function selectTarget(targets, filter) {
  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('No page targets found. Is Codex running with --remote-debugging-port?');
  if (!filter) return pages[0];
  const needle = filter.toLowerCase();
  const match = pages.find((target) =>
      [target.id, target.title, target.url]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle)),
  );
  if (match) return match;
  console.warn(`[nuvio] target "${filter}" not found; falling back to the first page target`);
  return pages[0];
}

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function requestControlRestore(state, options) {
  if (!state?.controlPort || !state?.token) return null;
  const endpoint = `http://127.0.0.1:${state.controlPort}/restore`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cxd-token': state.token,
      },
      body: JSON.stringify({
        keepConfig: options.keepConfig,
        reload: options.reload,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      console.warn(
        `[nuvio] resident injector rejected restore: ${payload.error || `HTTP ${response.status}`}`,
      );
      return null;
    }
    return payload;
  } catch (error) {
    console.warn(`[nuvio] resident injector is not reachable: ${error.message}`);
    return null;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const state = readState();
  const port = options.port ?? state?.port ?? 9222;
  const filter = options.target || state?.targetId || '';

  console.log(`[nuvio] restore · CDP port ${port}`);
  if (state) {
    console.log(
      `[nuvio] last injection: ${state.targetTitle || state.targetUrl || state.targetId || 'unknown'} · ${
        state.injectedAt || ''
      }`,
    );
  } else {
    console.log('[nuvio] no .cxd-inject.json; cleaning the current page only');
  }

  const daemonAlive = isProcessAlive(state?.pid);
  const residentResult = await requestControlRestore(state, options);
  if (residentResult) {
    console.log(
      `[nuvio] resident injector restored: scriptRemoved=${Boolean(
        residentResult.scriptRemoved,
      )} reload=${Boolean(residentResult.reload)}`,
    );
    console.log(
      options.keepConfig ? '[nuvio] kept localStorage config' : '[nuvio] cleared localStorage config',
    );
    try {
      unlinkSync(STATE_FILE);
    } catch {
      /* ignore */
    }
    console.log('[nuvio] restore done. The resident injector has exited.');
    return;
  }

  let targets;
  try {
    targets = await getTargets(port);
  } catch (error) {
    console.error(`[nuvio] cannot reach CDP on 127.0.0.1:${port}: ${error.message}`);
    console.error('[nuvio] quit Codex completely to remove the injection, then start it normally.');
    process.exitCode = 1;
    return;
  }

  const target = selectTarget(targets, filter);
  console.log(`[nuvio] target: ${target.title || target.url}`);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  let scriptRemoved = false;

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    if (state?.identifier) {
      try {
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: state.identifier,
        });
        scriptRemoved = true;
        console.log(`[nuvio] removed scheduled script ${state.identifier}`);
      } catch (error) {
        if (/not found/i.test(error.message) && !daemonAlive) {
          scriptRemoved = true;
          console.warn('[nuvio] scheduled script was already gone; continuing with page cleanup');
        } else {
          console.warn(`[nuvio] scheduled script removal failed: ${error.message}`);
        }
      }
    } else {
      scriptRemoved = true;
    }

    const cleanup = await cdp.send('Runtime.evaluate', {
      expression: buildCleanupExpression({ keepConfig: options.keepConfig }),
      returnByValue: true,
    });
    const result = cleanup.result?.value || {};
    console.log(
      `[nuvio] page cleaned: disposed=${Boolean(result.disposed)} roots=${result.roots || 0} styles=${
        result.styles || 0
      } uiHosts=${result.uiHosts || 0}`,
    );
    console.log(
      options.keepConfig
        ? '[nuvio] kept localStorage config'
        : '[nuvio] cleared localStorage config codex-dynamic-bg:v2',
    );

    if (options.reload) {
      if (state?.identifier && !scriptRemoved) {
        console.warn('[nuvio] skip reload: scheduled script is still registered; restart Codex first');
      } else {
        const loaded = cdp.waitFor('Page.loadEventFired', 20000);
        await cdp.send('Page.reload', { ignoreCache: true });
        await loaded;
        await sleep(800);
        console.log('[nuvio] page reloaded');
      }
    }

    if (scriptRemoved) {
      try {
        unlinkSync(STATE_FILE);
      } catch {
        /* ignore */
      }
    }
    console.log('[nuvio] restore done. If the layer still appears, restart Codex completely.');
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(`[nuvio] restore failed: ${error.message}`);
  process.exitCode = 1;
});
