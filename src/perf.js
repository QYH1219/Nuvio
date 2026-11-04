import { cheaperQuality, normalizeQuality, qualityFor } from './config.js';

/**
 * Keeps Codex responsive when the wallpaper is too expensive for the machine.
 *
 * Rules:
 *  - only downgrades, never upgrades (an automatic upgrade would oscillate)
 *  - needs sustained low FPS, not one bad sample (window drag, GC, alt-tab)
 *  - one downgrade per session unless the caller resets the governor
 */
export class PerfGovernor {
  constructor(options = {}) {
    const threshold = Number(options.threshold);
    const samplesNeeded = Number(options.samplesNeeded);
    const warmupMs = Number(options.warmupMs);
    this.threshold = Number.isFinite(threshold) ? threshold : 45;
    this.samplesNeeded = Number.isFinite(samplesNeeded) && samplesNeeded > 0 ? samplesNeeded : 6;
    this.warmupMs = Number.isFinite(warmupMs) ? Math.max(0, warmupMs) : 2500;
    this.onDowngrade = options.onDowngrade || (() => {});
    this.reset();
  }

  reset() {
    this.startedAt = now();
    this.samples = 0;
    this.low = 0;
    this.applied = false;
    this.lastFps = 0;
  }

  /**
   * @param {number} fps measured frames per second
   * @param {string} tier current tier id
   * @param {boolean} enabled master switch (`config.autoQuality`)
   * @returns {string|null} the tier to switch to, when a downgrade is due
   */
  sample(fps, tier, enabled = true) {
    this.lastFps = fps;
    if (!enabled || this.applied) return null;
    if (now() - this.startedAt < this.warmupMs) return null;
    if (!Number.isFinite(fps) || fps <= 0) return null;

    this.samples += 1;
    // A 30 FPS tier can never reach the default 45 FPS threshold; scale the
    // failure line to the tier's own target so "balanced" is not instantly
    // treated as broken.
    const target = qualityFor(tier).fps || 60;
    const threshold = Math.min(this.threshold, target * 0.75);
    if (fps < threshold) this.low += 1;
    else this.low = 0;

    if (this.samples < this.samplesNeeded) return null;
    if (this.low < this.samplesNeeded) return null;

    const next = cheaperQuality(tier);
    if (!next) {
      this.applied = true;
      return null;
    }
    this.applied = true;
    this.onDowngrade(next, { from: normalizeQuality(tier), fps });
    return next;
  }

  describe(tier) {
    const preset = qualityFor(tier);
    return {
      tier: normalizeQuality(tier),
      label: preset.label,
      fps: this.lastFps,
      downgraded: this.applied && this.low >= this.samplesNeeded,
    };
  }
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
