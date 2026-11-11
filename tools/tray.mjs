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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'tools', 'tray', 'tray.cs');
const STATE_FILE = join(ROOT, '.cxd-inject.json');
const ICON = join(ROOT, 'public', 'icon.ico');
const OUTPUT_DIR = join(ROOT, '.nuvio');
const HEARTBEAT = join(OUTPUT_DIR, 'tray.heartbeat');
// Compile to a content-addressed name. Windows locks a running .exe, so
// overwriting nuvio-tray.exe during an update fails exactly when the old tray
// is still alive.
const VERSION = (() => {
  try {
    return createHash('sha1').update(readFileSync(SOURCE)).digest('hex').slice(0, 8);
  } catch {
    // The tray is optional; a trimmed install must not break the injector that
    // imports this module for supervision.
    return 'missing';
  }
})();
const EXE = join(OUTPUT_DIR, `nuvio-tray-${VERSION}.exe`);

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
  removeOldBuilds();
  return true;
}

/** Running .exe files cannot be deleted; best effort is enough. */
function removeOldBuilds() {
  try {
    for (const name of readdirSync(OUTPUT_DIR)) {
      if (!/^nuvio-tray(?:-[0-9a-f]{8})?\.exe$/i.test(name)) continue;
      if (name === basename(EXE)) continue;
      try {
        unlinkSync(join(OUTPUT_DIR, name));
      } catch {
        /* still running */
      }
    }
  } catch {
    /* directory vanished */
  }
}

/** `<pid> <build> <unix-ms>`; tolerant of a half-written file. */
export function parseHeartbeat(text) {
  const [pid, version, at] = String(text ?? '').trim().split(/\s+/);
  return { pid: Number(pid), version: String(version || ''), at: Number(at) };
}

export function heartbeatFresh(beat, now = Date.now()) {
  return Boolean(
    beat &&
      Number.isInteger(beat.pid) &&
      beat.pid > 0 &&
      Number.isFinite(beat.at) &&
      now - beat.at < 12000,
  );
}

function readHeartbeat() {
  try {
    return parseHeartbeat(readFileSync(HEARTBEAT, 'utf8'));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A fresh file is not enough: the helper may have been killed a tick ago. */
export function trayAlive(now = Date.now()) {
  const beat = readHeartbeat();
  return heartbeatFresh(beat, now) && beat.version === VERSION && pidAlive(beat.pid);
}

/** Kill only a pid that still belongs to a tray helper. */
function stopTray(pid, verified = false) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (!verified) {
    const list = spawnSync(
      'tasklist.exe',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true, timeout: 4000 },
    );
    if (!/nuvio-tray/i.test(String(list.stdout || ''))) return;
  }
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 4000,
  });
}

/**
 * Stop every running helper before starting this build. Older builds wrote no
 * heartbeat (or wrote it to the wrong path), so the process list is the only
 * reliable source; the image name keeps unrelated Node processes out.
 */
function stopOtherTrays() {
  const list = spawnSync(
    'tasklist.exe',
    ['/FO', 'CSV', '/NH'],
    { encoding: 'utf8', windowsHide: true, timeout: 4000 },
  );
  for (const line of String(list.stdout || '').split(/\r?\n/)) {
    const match = line.match(/^"nuvio-tray[^"]*\.exe","(\d+)"/i);
    if (match) stopTray(Number(match[1]), true);
  }
}

/**
 * Compile (if needed) and launch the tray helper. Safe to call repeatedly:
 * the helper holds a named mutex, so a duplicate exits on its own.
 */
export function ensureTray({ quiet = false } = {}) {
  if (process.platform !== 'win32') return false;
  if (VERSION === 'missing') return false;
  if (!existsSync(STATE_FILE) || !existsSync(ICON)) return false;

  if (trayAlive()) return true;
  // Replace a hung helper or one compiled from an older tray.cs. The new
  // process waits for the mutex, so a short overlap is safe.
  stopOtherTrays();

  const compiler = findCompiler();
  if (!compiler) {
    if (!quiet) console.warn('[nuvio] tray icon skipped: no .NET Framework 4.x compiler found');
    return false;
  }

  if (!existsSync(EXE) && !compile(compiler)) return false;

  try {
    const child = spawn(
      EXE,
      ['--state', STATE_FILE, '--icon', ICON, '--root', ROOT, '--version', VERSION],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export { EXE as TRAY_EXE, HEARTBEAT as TRAY_HEARTBEAT, VERSION as TRAY_VERSION };
