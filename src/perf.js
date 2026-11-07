import { cheaperQuality, normalizeQuality, qualityFor } from './config.js';

/**
 * Keeps Codex responsive when the wallpaper is too expensive for the machine.
 *
 * Rules:
 *  - only downgrades, never upgrades (an automatic upgrade would oscillate)
 *  - ignores the first few seconds: shader warm-up / first paint is always slow
 *  - looks at the 95th percentile frame time in a rolling window, so a single
 *    GC pause or window drag cannot trigger a downgrade
 *  - scales the failure line to the tier's own target instead of a fixed 45
 *    FPS, otherwise a 30 FPS tier looks permanently broken
 *  - one downgrade per session unless the caller resets the governor
 */
const DEFAULT_WINDOW = 12;
const DEFAULT_LOW_RATIO = 0.6;
const PCT95_SLACK = 1.35;

export class PerfGovernor {
  constructor(options = {}) {
    const threshold = Number(options.threshold);
    const samplesNeeded = Number(options.samplesNeeded);
    const warmupMs = Number(options.warmupMs);
    const windowSize = Number(options.windowSize);
    const lowRatio = Number(options.lowRatio);
    this.threshold = Number.isFinite(threshold) ? threshold : 45;
    this.samplesNeeded = Number.isFinite(samplesNeeded) && samplesNeeded > 0 ? samplesNeeded : 6;
    this.warmupMs = Number.isFinite(warmupMs) ? Math.max(0, warmupMs) : 3000;
    this.windowSize = Number.isFinite(windowSize)
      ? Math.min(60, Math.max(4, Math.round(windowSize)))
      : DEFAULT_WINDOW;
    this.lowRatio =
      Number.isFinite(lowRatio) && lowRatio > 0 && lowRatio < 1 ? lowRatio : DEFAULT_LOW_RATIO;
    this.onDowngrade = options.onDowngrade || (() => {});
    this.reset();
  }

  reset() {
    this.startedAt = now();
    this.samples = 0;
    this.low = 0;
    this.applied = false;
    this.lastFps = 0;
    this.frameSamples = [];
    this.lastDowngrade = null;
    this.p95FrameMs = 0;
  }

  /** FPS below this line counts as a bad sample for the current tier. */
  lowLine(tier) {
    const target = qualityFor(tier).fps || 60;
    return Math.min(this.threshold, target * this.lowRatio);
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
    this.frameSamples.push(1000 / fps);
    if (this.frameSamples.length > this.windowSize) this.frameSamples.shift();

    const line = this.lowLine(tier);
    if (fps < line) this.low += 1;
    else this.low = 0;

    if (this.samples < this.samplesNeeded) return null;
    if (this.low < this.samplesNeeded) return null;

    // p95 frame time vs the budget of the failure line: reject a window where
    // most frames are fine but one spike dragged the average down.
    this.p95FrameMs = percentile(this.frameSamples, 0.95);
    const budgetMs = 1000 / Math.max(1, line);
    if (this.p95FrameMs <= budgetMs * PCT95_SLACK) {
      this.low = 0;
      return null;
    }

    const next = cheaperQuality(tier);
    this.applied = true;
    if (!next) {
      this.lastDowngrade = null;
      return null;
    }
    this.lastDowngrade = next;
    this.onDowngrade(next, { from: normalizeQuality(tier), fps, p95: this.p95FrameMs });
    return next;
  }

  describe(tier) {
    const preset = qualityFor(tier);
    return {
      tier: normalizeQuality(tier),
      label: preset.label,
      fps: this.lastFps,
      p95FrameMs: Number(this.p95FrameMs.toFixed(1)),
      downgraded: Boolean(this.lastDowngrade),
    };
  }
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
