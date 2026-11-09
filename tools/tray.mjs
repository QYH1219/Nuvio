/**
 * Notification-area icon for the resident injector.
 *
 * The injector is a detached process with no window, which is why Windows
 * never shows a taskbar button for Nuvio. A tray icon is the visible half of
 * that design: it proves the background is running and exposes reload / focus
 * / quit without adding a console window back.
 *
 * The helper is a small C# Win32 program compiled on demand with the csc.exe
 * that ships with .NET Framework 4.x. Nothing is committed as a binary, and on
 * a machine without that compiler Nuvio simply runs without the icon.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'tools', 'tray', 'tray.cs');
const STATE_FILE = join(ROOT, '.cxd-inject.json');
const ICON = join(ROOT, 'public', 'icon.ico');
const OUTPUT_DIR = join(ROOT, '.nuvio');
const EXE = join(OUTPUT_DIR, 'nuvio-tray.exe');

function findCompiler() {
  if (process.platform !== 'win32') return '';
  const root = process.env.SystemRoot || 'C:\\Windows';
  for (const folder of ['Framework64', 'Framework']) {
    const candidate = join(root, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe');
    if (existsSync(candidate)) return candidate;
  }
  return '';
}

function compile(compiler) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const result = spawnSync(
    compiler,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/codepage:65001',
      `/out:${EXE}`,
      '/r:System.dll',
      SOURCE,
    ],
    { stdio: 'pipe', windowsHide: true, encoding: 'utf8' },
  );
  if (result.status !== 0 || !existsSync(EXE)) {
    const message = String(result.stderr || result.stdout || '').trim();
    if (message) console.warn(`[nuvio] tray build failed: ${message.split('\n')[0]}`);
    return false;
  }
  return true;
}

function isStale() {
  try {
    return statSync(EXE).mtimeMs < statSync(SOURCE).mtimeMs;
  } catch {
    return true;
  }
}

/**
 * Compile (if needed) and launch the tray helper. Safe to call repeatedly:
 * the helper holds a named mutex and exits immediately when one is running.
 */
export function ensureTray({ quiet = false } = {}) {
  if (process.platform !== 'win32') return false;
  if (!existsSync(STATE_FILE) || !existsSync(ICON)) return false;

  const compiler = findCompiler();
  if (!compiler) {
    if (!quiet) console.warn('[nuvio] tray icon skipped: no .NET Framework 4.x compiler found');
    return false;
  }

  if (isStale() && !compile(compiler)) return false;

  const child = spawn(
    EXE,
    ['--state', STATE_FILE, '--icon', ICON, '--root', ROOT],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  return true;
}

export { EXE as TRAY_EXE };
