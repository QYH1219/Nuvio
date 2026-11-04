import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_BUNDLE = join(ROOT, 'dist-embed', 'codex-dynamic-bg.iife.js');

const MIME = {
  '.bin': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ktx2': 'image/ktx2',
  '.m4v': 'video/mp4',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

function parseArgs(argv) {
  const options = {
    port: 9222,
    assetPort: 5275,
    assets: join(ROOT, 'public', 'assets'),
    vendor: join(ROOT, 'public', 'vendor'),
    bundle: DEFAULT_BUNDLE,
    target: '',
    image: '',
    model: '',
    surface: null,
    dim: null,
    assetBase: '',
    reload: true,
    serve: true,
    list: false,
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
    else if (arg === '--asset-port') options.assetPort = Number(next());
    else if (arg === '--assets') options.assets = resolve(next());
    else if (arg === '--vendor') options.vendor = resolve(next());
    else if (arg === '--bundle') options.bundle = resolve(next());
    else if (arg === '--target') options.target = next();
    else if (arg === '--image') options.image = next();
    else if (arg === '--model') options.model = next();
    else if (arg === '--surface') options.surface = Number(next());
    else if (arg === '--dim') options.dim = Number(next());
    else if (arg === '--asset-base') options.assetBase = next();
    else if (arg === '--no-reload') options.reload = false;
    else if (arg === '--no-serve') options.serve = false;
    else if (arg === '--list') options.list = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`
Codex dynamic background injector

Usage:
  npm run inject -- [options]

Options:
  --port 9222          Chromium remote debugging port
  --asset-port 5275    local asset server port
  --assets PATH        directory mapped to /assets/ (default: public/assets)
  --vendor PATH        directory mapped to /vendor/ (default: public/vendor)
  --bundle PATH        embedded IIFE bundle (default: dist-embed/codex-dynamic-bg.iife.js)
  --target TEXT        page target id/title/url substring
  --image URL          explicit background URL or /assets/... path
  --model URL          explicit GLB/glTF URL or /assets/... path
  --surface NUMBER     Codex panel opacity, 0..1 (default 0.22; lower = clearer background)
  --dim NUMBER         background dim, 0..1 (default 0.12)
  --asset-base URL     override the asset base URL
  --no-reload          inject into the current document without reloading
  --no-serve           do not start the local asset server
  --list               list CDP page targets and exit
  -h, --help           show this help

Typical flow:
  npm run embed
  npm run launch:codex
  npm run inject
`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function contentType(file) {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

function safeJoin(root, relative) {
  const target = resolve(root, `.${normalize(relative)}`);
  const rootPath = resolve(root) + sep;
  if (target !== resolve(root) && !target.startsWith(rootPath)) return null;
  return target;
}

function startStaticServer(options) {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      let base = null;

      if (pathname.startsWith('/assets/')) {
        base = options.assets;
        pathname = pathname.slice('/assets/'.length);
      } else if (pathname.startsWith('/vendor/')) {
        base = options.vendor;
        pathname = pathname.slice('/vendor/'.length);
      } else {
        response.writeHead(404);
        response.end('not found');
        return;
      }

      const file = safeJoin(base, pathname);
      if (!file || !existsSync(file) || !statSync(file).isFile()) {
        response.writeHead(404);
        response.end('not found');
        return;
      }

      const stat = statSync(file);
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', '*');
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Content-Type', contentType(file));
      response.setHeader('Content-Length', stat.size);

      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === 'HEAD') {
        response.writeHead(200);
        response.end();
        return;
      }

      response.writeHead(200);
      createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error?.message || error));
    }
  });

  return new Promise((resolvePromise, reject) => {
    let port = options.assetPort;
    let attempts = 0;
    const listen = () => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && attempts < 10) {
          attempts += 1;
          port += 1;
          setTimeout(listen, 30);
          return;
        }
        reject(error);
      });
      server.listen(port, '127.0.0.1', () => {
        resolvePromise({ server, port });
      });
    };
    listen();
  });
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
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolvePromise();
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket connection failed'));
      }, { once: true });
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
    this.ws.close();
  }
}

async function getTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed: HTTP ${response.status}`);
  return response.json();
}

function selectTarget(targets, filter) {
  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('No page targets found. Is Codex running with --remote-debugging-port?');
  if (!filter) return pages[0];
  const needle = filter.toLowerCase();
  return (
    pages.find((target) =>
      [target.id, target.title, target.url].filter(Boolean).some((value) => value.toLowerCase().includes(needle)),
    ) || pages[0]
  );
}

function publishedUrl(value) {
  if (!value) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function withAssetBase(value, base) {
  const url = publishedUrl(value);
  if (!url || /^(https?:|data:|blob:)/i.test(url) || base === './') return url;
  return `${base.replace(/\/+$/, '')}${url}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!existsSync(options.bundle)) {
    throw new Error(`missing bundle: ${options.bundle}\nRun: npm run embed`);
  }

  const targets = await getTargets(options.port);
  if (options.list) {
    for (const target of targets) {
      console.log(`${target.type}\t${target.id}\t${target.title || ''}\t${target.url || ''}`);
    }
    return;
  }

  const target = selectTarget(targets, options.target);
  console.log(`[cxd] target: ${target.title || target.url}`);

  let assetServer = null;
  let assetBase = options.assetBase;
  if (options.serve && !assetBase) {
    assetServer = await startStaticServer(options);
    assetBase = `http://127.0.0.1:${assetServer.port}/`;
    console.log(`[cxd] asset server: ${assetBase}`);
  }
  if (!assetBase) assetBase = './';

  const bundle = readFileSync(options.bundle, 'utf8');
  const explicitAssets = {
    imageUrl: withAssetBase(options.image, assetBase),
    modelUrl: withAssetBase(options.model, assetBase),
  };
  const overrides = {};
  if (Number.isFinite(options.surface)) {
    overrides.surfaceOpacity = Math.min(1, Math.max(0, options.surface));
  }
  if (Number.isFinite(options.dim)) {
    overrides.dim = Math.min(1, Math.max(0, options.dim));
  }
  const prelude = `
(() => {
  const overrides = ${JSON.stringify(overrides)};
  if (Object.keys(overrides).length) {
    const key = 'codex-dynamic-bg:v2';
    let config = {};
    try { config = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
    Object.assign(config, overrides);
    try { localStorage.setItem(key, JSON.stringify(config)); } catch {}
  }
  window.__CXD_ASSET_BASE__ = ${JSON.stringify(assetBase)};
  window.__CXD_ASSETS__ = ${JSON.stringify(explicitAssets)};
  document.documentElement.dataset.cxdBackground = 'on';
})();
`;
  const source = `${prelude}\n${bundle}`;

  let cdp;
  try {
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  } catch (error) {
    if (assetServer) assetServer.server.close();
    throw error;
  }
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });

    if (options.reload) {
      const loaded = cdp.waitFor('Page.loadEventFired', 20000);
      await cdp.send('Page.reload', { ignoreCache: true });
      await loaded;
      await sleep(1200);
    } else {
      await cdp.send('Runtime.evaluate', {
        expression: source,
        awaitPromise: false,
        returnByValue: true,
      });
      await sleep(600);
    }

    const check = await cdp.send('Runtime.evaluate', {
      expression: "Boolean(document.getElementById('cxd-bg-root'))",
      returnByValue: true,
    });
    if (!check.result?.value) {
      throw new Error('injection ran, but #cxd-bg-root was not created');
    }

    console.log('[cxd] injected. Press Ctrl+C to stop the asset server.');
    if (!assetServer) cdp.close();
  } catch (error) {
    cdp.close();
    if (assetServer) assetServer.server.close();
    throw error;
  }

  if (assetServer) {
    const shutdown = () => {
      try {
        cdp.close();
      } catch {
        /* ignore */
      }
      assetServer.server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
}

main().catch((error) => {
  console.error(`[cxd] ${error.message}`);
  process.exitCode = 1;
});
