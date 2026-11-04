import { randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCleanupExpression } from './cleanup-expression.mjs';
import {
  applyLibraryEntry,
  deleteLibraryEntry,
  entryDir,
  importWorkshopEntry,
  jobState,
  listWorkshop,
} from './library.mjs';
import { selectTarget } from './target-score.mjs';
import { findEntry } from './workshop-scan.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_BUNDLE = join(ROOT, 'dist-embed', 'codex-dynamic-bg.iife.js');
const STATE_FILE = join(ROOT, '.cxd-inject.json');

const MIME = {
  '.avif': 'image/avif',
  '.bin': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
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
  '.webp': 'image/webp',
};

function parseArgs(argv) {
  const options = {
    port: 9222,
    assetPort: 5275,
    controlPort: 5276,
    assets: join(ROOT, 'public', 'assets'),
    vendor: join(ROOT, 'public', 'vendor'),
    bundle: DEFAULT_BUNDLE,
    target: '',
    image: '',
    video: '',
    scene: '',
    model: '',
    surface: null,
    dim: null,
    assetBase: '',
    reload: true,
    serve: true,
    wait: 0,
    once: false,
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
    else if (arg === '--control-port') options.controlPort = Number(next());
    else if (arg === '--assets') options.assets = resolve(next());
    else if (arg === '--vendor') options.vendor = resolve(next());
    else if (arg === '--bundle') options.bundle = resolve(next());
    else if (arg === '--target') options.target = next();
    else if (arg === '--image') options.image = next();
    else if (arg === '--video') options.video = next();
    else if (arg === '--scene') options.scene = next();
    else if (arg === '--model') options.model = next();
    else if (arg === '--surface') options.surface = Number(next());
    else if (arg === '--dim') options.dim = Number(next());
    else if (arg === '--asset-base') options.assetBase = next();
    else if (arg === '--no-reload') options.reload = false;
    else if (arg === '--no-serve') options.serve = false;
    else if (arg === '--wait') {
      const value = Number(next());
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('--wait expects a non-negative number of seconds');
      }
      options.wait = value;
    }
    else if (arg === '--once') options.once = true;
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
  --control-port 5276  local restore-control port (falls forward if busy)
  --assets PATH        directory mapped to /assets/ (default: public/assets)
  --vendor PATH        directory mapped to /vendor/ (default: public/vendor)
  --bundle PATH        embedded IIFE bundle (default: dist-embed/codex-dynamic-bg.iife.js)
  --target TEXT        page target id/title/url substring
  --image URL          explicit background URL or /assets/... path
  --video URL          explicit video background URL or /assets/... path
  --scene URL          explicit scene.json URL or /assets/... path
  --model URL          explicit GLB/glTF URL or /assets/... path
  --surface NUMBER     Codex panel opacity, 0..1 (default 0.22; lower = clearer background)
  --dim NUMBER         background dim, 0..1 (default 0.12)
  --asset-base URL     override the asset base URL
  --no-reload          inject into the current document without reloading
  --no-serve           do not start the local asset server
  --wait SECONDS       wait for the CDP port instead of failing immediately
  --once               exit after injecting instead of staying resident
  --list               list CDP page targets and exit
  -h, --help           show this help

Typical flow:
  npm run embed
  npm run launch:codex
  npm run inject

The injector stays resident so the CDP registration survives page reloads.
Press Ctrl+C to stop it, or run npm run restore in another terminal.
`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function contentType(file) {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

export function safeJoin(root, relative) {
  // Strip only leading separators so an absolute URL pathname cannot replace
  // the root, but keep ".." segments for the containment check below.
  const clean = normalize(relative).replace(/^[/\\]+/, '');
  const target = resolve(root, clean);
  const rootPath = resolve(root) + sep;
  if (target !== resolve(root) && !target.startsWith(rootPath)) return null;
  return target;
}

function startStaticServer(options) {
  if (!existsSync(options.assets)) {
    throw new Error(`missing asset directory: ${options.assets}`);
  }
  console.log(`[cxd] assets: ${options.assets}`);
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
        console.warn(`[cxd] 404 ${pathname} (base: ${base}, file: ${file || 'blocked'})`);
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

function readRequestBody(request, limit = 8192) {
  return new Promise((resolvePromise, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body.trim()) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(body));
      } catch {
        reject(new Error('request body is not valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function previewFile(id) {
  const dir = entryDir(id);
  if (dir) {
    try {
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
      if (meta?.preview) {
        const file = join(dir, String(meta.preview));
        if (existsSync(file) && statSync(file).isFile()) return file;
      }
    } catch {
      /* no imported preview */
    }
  }
  const entry = findEntry(id);
  const file = entry?.preview;
  if (file && existsSync(file) && statSync(file).isFile()) return file;
  return null;
}

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'content-type, x-cxd-token');
  response.setHeader('Access-Control-Max-Age', '600');
}

function startControlServer(options, token, hooks) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    setCors(response);

    const send = (status, payload) => {
      const body = `${JSON.stringify(payload)}\n`;
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      response.end(body);
    };
    const provided = String(
      request.headers['x-cxd-token'] || url.searchParams.get('token') || '',
    );
    const authorized = Boolean(token) && provided === token;

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      send(200, { ok: true, ...hooks.status() });
      return;
    }

    const previewMatch = /^\/workshop\/(\d{4,20})\/preview(?:\.[a-z0-9]+)?$/i.exec(
      url.pathname,
    );
    if (request.method === 'GET' && previewMatch) {
      if (!authorized) {
        send(403, { ok: false, error: 'invalid control token' });
        return;
      }
      const file = previewFile(previewMatch[1]);
      if (!file) {
        send(404, { ok: false, error: 'preview not found' });
        return;
      }
      const stat = statSync(file);
      response.writeHead(200, {
        'Content-Type': contentType(file),
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      createReadStream(file).pipe(response);
      return;
    }

    const isApi =
      url.pathname === '/restore' ||
      url.pathname.startsWith('/api/workshop/') ||
      url.pathname.startsWith('/api/library/');
    if (!isApi) {
      send(404, { ok: false, error: 'not found' });
      return;
    }
    if (!authorized) {
      send(403, { ok: false, error: 'invalid control token' });
      return;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/workshop/list') {
        send(200, { ok: true, ...listWorkshop() });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/workshop/progress') {
        const id = String(url.searchParams.get('id') || '');
        if (!/^\d{4,20}$/.test(id)) {
          send(400, { ok: false, error: 'invalid workshop id' });
          return;
        }
        send(200, { ok: true, ...jobState(id) });
        return;
      }

      if (request.method !== 'POST') {
        send(405, { ok: false, error: 'method not allowed' });
        return;
      }

      const payload = await readRequestBody(request);
      if (url.pathname === '/restore') {
        const result = await hooks.restore(payload);
        send(200, { ok: true, ...result });
        setTimeout(() => hooks.shutdown(), 200);
        return;
      }
      if (url.pathname === '/api/workshop/import') {
        const id = String(payload.id || '');
        if (!/^\d{4,20}$/.test(id)) {
          send(400, { ok: false, error: 'invalid workshop id' });
          return;
        }
        const job = importWorkshopEntry(id);
        send(200, { ok: true, job: { state: job.state, message: job.message } });
        return;
      }
      if (url.pathname === '/api/library/apply') {
        const id = String(payload.id || '');
        if (!/^\d{4,20}$/.test(id)) {
          send(400, { ok: false, error: 'invalid workshop id' });
          return;
        }
        send(200, { ok: true, active: applyLibraryEntry(id) });
        return;
      }
      if (url.pathname === '/api/library/delete') {
        const id = String(payload.id || '');
        if (!/^\d{4,20}$/.test(id)) {
          send(400, { ok: false, error: 'invalid workshop id' });
          return;
        }
        send(200, { ok: true, ...deleteLibraryEntry(id) });
        return;
      }
      send(404, { ok: false, error: 'not found' });
    } catch (error) {
      send(500, { ok: false, error: error?.message || String(error) });
    }
  });

  return new Promise((resolvePromise, reject) => {
    let port = options.controlPort;
    let attempts = 0;
    const listen = () => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && attempts < 20) {
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

async function waitForTargets(port, seconds) {
  const deadline = Date.now() + Math.max(0, seconds) * 1000;
  let announced = false;

  for (;;) {
    try {
      return await getTargets(port);
    } catch (error) {
      if (Date.now() >= deadline) {
        const reason = error?.message || String(error);
        throw new Error(
          `CDP is not ready on 127.0.0.1:${port} (${reason}).\n` +
            'Start Codex with the debugging port first: npm run launch:codex\n' +
            'Or retry with a wait window: npm run inject -- --wait 30',
        );
      }
      if (!announced) {
        console.log(`[cxd] waiting for CDP on 127.0.0.1:${port} ...`);
        announced = true;
      }
      await sleep(500);
    }
  }
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

function dataUrlForFile(file) {
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
}

/**
 * Codex runs from app:// and its CSP blocks fetch()/img loads against
 * http://127.0.0.1. Inline the default scene (artwork + shake masks) as data
 * URLs so the wallpaper renders without the page ever touching the local
 * asset server.
 */
export function inlineSceneAssets(assetsDir) {
  const sceneDir = join(assetsDir, 'wallpaper');
  const sceneFile = join(sceneDir, 'scene.json');
  if (!existsSync(sceneFile)) return null;

  let data;
  try {
    data = JSON.parse(readFileSync(sceneFile, 'utf8'));
  } catch {
    return null;
  }
  if (!data || !data.image) return null;

  const inlineOne = (value) => {
    if (!value || /^(https?:|data:|blob:)/i.test(value)) return value;
    const file = safeJoin(sceneDir, value);
    if (!file || !existsSync(file)) return value;
    return dataUrlForFile(file);
  };

  return {
    ...data,
    image: inlineOne(data.image),
    pipeline: Array.isArray(data.pipeline)
      ? data.pipeline.map((entry) =>
          entry && entry.mask ? { ...entry, mask: inlineOne(entry.mask) } : entry,
        )
      : data.pipeline,
    inline: true,
  };
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

  const targets = await waitForTargets(options.port, options.wait);
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
  // Only auto-inline the project wallpaper when the caller did not request an
  // explicit external source; explicit flags keep their normal URL semantics.
  const defaultScene =
    !options.image && !options.video && !options.scene
      ? inlineSceneAssets(options.assets)
      : null;
  const explicitAssets = {
    imageUrl: withAssetBase(options.image, assetBase),
    videoUrl: withAssetBase(options.video, assetBase),
    sceneUrl: withAssetBase(options.scene, assetBase),
    modelUrl: withAssetBase(options.model, assetBase),
    sceneData: defaultScene || undefined,
  };
  const overrides = {};
  if (Number.isFinite(options.surface)) {
    overrides.surfaceOpacity = Math.min(1, Math.max(0, options.surface));
  }
  if (Number.isFinite(options.dim)) {
    overrides.dim = Math.min(1, Math.max(0, options.dim));
  }
  function buildSource(controlBase, controlToken) {
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
  window.__CXD_CONTROL__ = ${JSON.stringify({ base: controlBase || '', token: controlToken || '' })};
  try {
    document.documentElement.dataset.cxdBackground = 'on';
  } catch {
    // At document-start documentElement may not exist yet; embed.js sets it on boot.
  }
})();
`;
    return `${prelude}\n${bundle}`;
  }

  let cdp;
  let controlServer = null;
  let registered = null;
  let shuttingDown = false;
  let stateWritten = false;
  const controlToken = randomUUID();
  let source = '';
  const injectedAt = new Date().toISOString();
  const controlStatus = {
    pid: process.pid,
    cdpPort: options.port,
    target: target.title || target.url,
    targetId: target.id,
    injectedAt,
  };

  async function performRestore(payload = {}) {
    const keepConfig = Boolean(payload.keepConfig);
    const reload = Boolean(payload.reload);
    let scriptRemoved = false;

    if (registered?.identifier) {
      try {
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: registered.identifier,
        });
        scriptRemoved = true;
        console.log(`[cxd] removed scheduled script ${registered.identifier}`);
      } catch (error) {
        if (/not found/i.test(error.message)) {
          scriptRemoved = true;
          console.warn('[cxd] scheduled script was already gone');
        } else {
          console.warn(`[cxd] scheduled script removal failed: ${error.message}`);
        }
      }
    } else {
      scriptRemoved = true;
    }

    const cleanup = await cdp.send('Runtime.evaluate', {
      expression: buildCleanupExpression({ keepConfig }),
      returnByValue: true,
    });
    const result = cleanup.result?.value || {};
    console.log(
      `[cxd] page cleaned: disposed=${Boolean(result.disposed)} roots=${result.roots || 0} styles=${
        result.styles || 0
      } uiHosts=${result.uiHosts || 0}`,
    );

    if (reload) {
      if (!scriptRemoved) {
        console.warn('[cxd] skip reload: scheduled script is still registered; restart Codex first');
      } else {
        const loaded = cdp.waitFor('Page.loadEventFired', 20000);
        await cdp.send('Page.reload', { ignoreCache: true });
        await loaded;
        await sleep(800);
        console.log('[cxd] page reloaded');
      }
    }

    return { scriptRemoved, reload, keepConfig, cleanup: result };
  }

  function closeResources() {
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    try {
      controlServer?.server.close();
    } catch {
      /* ignore */
    }
    try {
      assetServer?.server.close();
    } catch {
      /* ignore */
    }
  }

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    closeResources();
    if (stateWritten) {
      try {
        unlinkSync(STATE_FILE);
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => process.exit(0), 150).unref();
  }

  try {
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);

    if (!options.once) {
      controlServer = await startControlServer(options, controlToken, {
        status: () => ({ ...controlStatus, controlPort: controlServer?.port || null }),
        restore: (payload) => performRestore(payload),
        shutdown,
      });
      console.log(`[cxd] control: http://127.0.0.1:${controlServer.port}/status`);
    }
    source = buildSource(
      controlServer ? `http://127.0.0.1:${controlServer.port}` : '',
      controlServer ? controlToken : '',
    );

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // Codex ships a strict CSP on its app:// document. Data URLs in our
    // injected bundle and any optional local asset URLs need this bypass.
    try {
      await cdp.send('Page.setBypassCSP', { enabled: true });
      console.log('[cxd] CSP bypass enabled');
    } catch (error) {
      console.warn(`[cxd] Page.setBypassCSP unavailable: ${error.message}`);
    }
    registered = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });

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

    try {
      writeFileSync(
        STATE_FILE,
        `${JSON.stringify(
          {
            port: options.port,
            targetId: target.id,
            targetTitle: target.title || '',
            targetUrl: target.url || '',
            identifier: registered.identifier || '',
            controlPort: controlServer?.port || null,
            token: controlServer ? controlToken : '',
            pid: process.pid,
            injectedAt,
          },
          null,
          2,
        )}\n`,
      );
      stateWritten = true;
    } catch (error) {
      console.warn(`[cxd] could not write ${STATE_FILE}: ${error.message}`);
    }

    console.log('[cxd] injected.');
    if (options.once) {
      cdp.close();
      if (assetServer) assetServer.server.close();
      console.log('[cxd] --once: the layer stays until the page reloads.');
      return;
    }

    console.log('[cxd] resident injector running; keep this window open.');
    console.log('[cxd] stop and clean with: npm run restore');

    const onSignal = () => {
      performRestore({ keepConfig: true, reload: false })
        .catch((error) => console.warn(`[cxd] signal cleanup failed: ${error.message}`))
        .finally(shutdown);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  } catch (error) {
    closeResources();
    if (stateWritten) {
      try {
        unlinkSync(STATE_FILE);
      } catch {
        /* ignore */
      }
    }
    throw error;
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(`[cxd] ${error.message}`);
    process.exitCode = 1;
  });
}
