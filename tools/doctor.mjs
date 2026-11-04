import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUNDLE = join(ROOT, 'dist-embed', 'codex-dynamic-bg.iife.js');
const ASSETS = join(ROOT, 'public', 'assets');
const VENDOR = join(ROOT, 'public', 'vendor');
const STATE = join(ROOT, '.cxd-inject.json');

const checks = [];
function add(level, label, detail = '') {
  checks.push({ level, label, detail });
}

function sizeOf(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function firstExisting(relativePaths) {
  for (const relative of relativePaths) {
    const file = join(ASSETS, relative);
    if (existsSync(file)) return { relative, file, size: sizeOf(file) };
  }
  return null;
}

function summarizeProcesses(names) {
  const counts = new Map();
  for (const name of names.filter(Boolean)) {
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .slice(0, 5)
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
}

function findProcesses() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      const names = out
        .split(/\r?\n/)
        .filter((line) => /codex|chatgpt/i.test(line))
        .map((line) => line.split('","')[0].replace(/^"/, ''));
      return summarizeProcesses(names);
    }
    const out = execFileSync('ps', ['-eo', 'comm='], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return summarizeProcesses(out
      .split(/\r?\n/)
      .filter((line) => /codex|chatgpt/i.test(line)));
  } catch {
    return [];
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

async function probeControl(port) {
  if (!Number.isInteger(port) || port <= 0) return { ok: false };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(900),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const payload = await response.json();
    return payload?.ok
      ? { ok: true, payload }
      : { ok: false, error: payload?.error || 'invalid status payload' };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function parseArgs(argv) {
  const options = { port: 9222, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port') {
      index += 1;
      options.port = Number(argv[index]);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error('--port must be a positive integer');
  }
  return options;
}

function printHelp() {
  console.log(`
Codex Dynamic Background doctor

Usage:
  npm run doctor -- [--port 9222]

Checks the local build, decoders, background assets, injection state and
Chromium remote-debugging endpoint.
`);
}

async function probeCdp(port) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const version = await fetch(`${base}/json/version`, {
      signal: AbortSignal.timeout(1800),
    });
    if (!version.ok) return { ok: false, error: `HTTP ${version.status}` };
    const info = await version.json();
    const list = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(1800) });
    const targets = list.ok ? await list.json() : [];
    const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    const codex = pages.find((target) => /codex|chatgpt/i.test(`${target.title} ${target.url}`));
    return { ok: true, info, pages, codex: codex || pages[0] || null };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(
    nodeMajor >= 22 ? 'ok' : 'fail',
    'Node.js',
    `v${process.versions.node}${nodeMajor >= 22 ? '' : '（需要 >= 22）'}`,
  );

  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  add('ok', '项目', `${packageJson.name}@${packageJson.version}`);

  if (!existsSync(BUNDLE)) {
    add('fail', '注入 bundle', '缺失；运行 npm run embed');
  } else {
    const bundleSource = readFileSync(BUNDLE, 'utf8');
    const size = sizeOf(BUNDLE);
    const fresh = bundleSource.includes('cxd-ui-layer') && bundleSource.includes('cxd-theme-chip');
    add(
      fresh ? 'ok' : 'fail',
      '注入 bundle',
      `${formatBytes(size)}${fresh ? '' : '；缺少新面板标记，运行 npm run build:all'}`,
    );
  }

  const decoders = [
    'draco/draco_decoder.js',
    'draco/draco_decoder.wasm',
    'draco/draco_wasm_wrapper.js',
    'basis/basis_transcoder.js',
    'basis/basis_transcoder.wasm',
  ];
  const present = decoders.filter((file) => existsSync(join(VENDOR, file))).length;
  add(
    present === decoders.length ? 'ok' : 'warn',
    'Draco / Basis 解码器',
    `${present}/${decoders.length}${present === decoders.length ? '' : '；运行 npm run sync:decoders'}`,
  );

  const video = firstExisting(['background.mp4', 'background.webm']);
  const scene = firstExisting(['wallpaper/scene.json']);
  const image = firstExisting([
    'background.webp',
    'background.png',
    'background.jpg',
    'background.jpeg',
    'background.avif',
  ]);
  const model = firstExisting(['model.glb', 'model.gltf']);

  const background = video
    ? `视频 ${video.relative} (${formatBytes(video.size)})`
    : scene
      ? `场景 ${scene.relative}`
      : image
        ? `图片 ${image.relative} (${formatBytes(image.size)})`
        : '程序化背景（未找到素材）';
  add(video || scene || image ? 'ok' : 'warn', '当前背景', background);
  add(
    model ? 'ok' : 'warn',
    '当前模型',
    model ? `${model.relative} (${formatBytes(model.size)})` : '占位水晶（未找到 model.glb）',
  );

  if (existsSync(join(ASSETS, 'wallpaper'))) {
    const files = readdirSync(join(ASSETS, 'wallpaper')).slice(0, 6);
    add('info', 'wallpaper 目录', files.join(', ') || '空');
  }

  if (existsSync(STATE)) {
    try {
      const state = JSON.parse(readFileSync(STATE, 'utf8'));
      add(
        'info',
        '上次注入',
        `port ${state.port} · ${state.targetTitle || state.targetUrl || state.targetId || 'unknown'} · ${
          state.injectedAt || ''
        }`,
      );
      const alive = isProcessAlive(Number(state.pid));
      const control = await probeControl(Number(state.controlPort));
      if (alive && control.ok) {
        add(
          'ok',
          '常驻注入器',
          `pid ${state.pid} · control :${state.controlPort} · ${
            control.payload.target || state.targetTitle || 'target unknown'
          }`,
        );
      } else if (control.ok) {
        add(
          'warn',
          '常驻注入器',
          `control :${state.controlPort} 可达，但记录的 pid ${state.pid} 不存活；运行 npm run restore 后重新注入`,
        );
      } else if (!state.controlPort) {
        add(
          'warn',
          '注入状态',
          '--once 或已是过期状态；刷新页面后注入会失效，需要重新运行 npm run inject',
        );
      } else {
        add(
          'warn',
          '注入状态已过期',
          `pid ${state.pid} 不存活或 control :${state.controlPort} 不可达；运行 npm run restore 清理，或重新 npm run inject`,
        );
      }
    } catch {
      add('warn', '注入状态文件', '.cxd-inject.json 无法解析');
    }
  } else {
    add('info', '注入状态', '未注入（npm run inject 会写入 .cxd-inject.json）');
  }

  const cdp = await probeCdp(options.port);
  if (cdp.ok) {
    add('ok', `CDP :${options.port}`, cdp.info.Browser || 'Chromium');
    add(
      cdp.codex ? 'ok' : 'warn',
      'Codex 页面',
      cdp.codex
        ? `${cdp.codex.title || '(no title)'} · ${cdp.codex.url || ''}`
        : `未找到 page target（共 ${cdp.pages.length} 个）`,
    );
  } else {
    add('warn', `CDP :${options.port}`, `不可用：${cdp.error}`);
    add('info', '启动建议', '先退出 Codex，再运行 npm start（或 npm run launch:codex）');
  }

  if (!cdp.ok) {
    const processes = findProcesses();
    add(
      processes.length ? 'info' : 'warn',
      'Codex 进程',
      processes.length ? processes.join(' | ') : '未检测到（或进程名不匹配）',
    );
  }

  try {
    const dev = await fetch('http://127.0.0.1:5273/', { signal: AbortSignal.timeout(800) });
    add(dev.ok ? 'info' : 'warn', '预览站', dev.ok ? 'http://127.0.0.1:5273/ 正在运行' : `HTTP ${dev.status}`);
  } catch {
    add('info', '预览站', '未运行（npm run dev）');
  }

  const icons = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', info: 'INFO' };
  console.log('\nCodex Dynamic Background · doctor\n');
  for (const check of checks) {
    console.log(`[${icons[check.level]}] ${check.label.padEnd(18)} ${check.detail}`);
  }

  const failures = checks.filter((check) => check.level === 'fail').length;
  const warnings = checks.filter((check) => check.level === 'warn').length;
  console.log(`\n${failures} fail · ${warnings} warn · ${checks.length} checks`);
  if (failures) {
    console.log('先修复 FAIL 项。典型顺序：npm install → npm run build:all → npm start');
    process.exitCode = 1;
  } else {
    console.log('核心检查通过。一键注入：npm start（已带 CDP 时用 npm start -- --no-launch）。');
  }
}

main().catch((error) => {
  console.error(`[cxd] doctor failed: ${error.message}`);
  process.exitCode = 1;
});
