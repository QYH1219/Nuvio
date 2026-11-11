import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** One bounded, hidden preflight shared by shortcuts, npm start and restart. */
export async function runMagpiePreflight({
  launch = true,
  platform = process.platform,
  env = process.env,
  spawnProcess = spawn,
  log = (message) => console.log(message),
  timeoutMs = 100000,
} = {}) {
  if (platform !== 'win32' || !launch || env.NUVIO_SKIP_MAGPIE === '1') return 'skipped';
  const script = fileURLToPath(new URL('./compat/magpie-ultra.ps1', import.meta.url));
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result !== 'ok') log(`[nuvio] Magpie preflight ${result}; see %TEMP%/nuvio/magpie-ultra.log`);
      resolve(result);
    };
    try {
      child = spawnProcess('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      ], { windowsHide: true, stdio: 'ignore', env });
    } catch {
      finish('unavailable');
      return;
    }
    timer = setTimeout(() => {
      // Bound a stuck CLI child as well as the PowerShell wrapper. Target
      // this preflight PID only, never every Magpie process on the machine.
      if (child.pid) {
        try {
          const killer = spawnProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true, stdio: 'ignore',
          });
          killer.on('error', () => {});
        } catch { /* process already gone */ }
      }
      finish('timed out');
    }, timeoutMs);
    child.once('error', () => finish('unavailable'));
    child.once('exit', (code) => finish(code === 0 ? 'ok' : 'failed'));
  });
}

/**
 * Codex starts a few seconds after the synchronous preflight returns, and
 * Magpie's own autostart attaches to it and rewrites config.toml again. Keep a
 * short-lived hidden reconciler alive so "ultra" survives that second write.
 *
 * Detached on purpose: the launcher prints its result and exits while Codex
 * keeps running. The reconciler only reads a small TOML file once a second and
 * exits on its own, so it costs no measurable battery or CPU.
 */
export function startMagpieWatch({
  platform = process.platform,
  env = process.env,
  spawnProcess = spawn,
  seconds = 30,
} = {}) {
  if (platform !== 'win32' || env.NUVIO_SKIP_MAGPIE === '1') return false;
  const script = fileURLToPath(new URL('./compat/magpie-ultra.ps1', import.meta.url));
  try {
    const child = spawnProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', script, '-Watch', '-Quiet', '-WatchSeconds', String(Math.max(0, Number(seconds) || 0)),
    ], { windowsHide: true, stdio: 'ignore', detached: true, env });
    // spawn reports ENOENT/EACCES asynchronously; try/catch alone cannot keep
    // an optional reconciler from crashing the launcher.
    child.once?.('error', () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
