import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * captureVideoThumb races a frame callback against a 1500 ms fallback timer.
 * The losing side must be cleaned up, otherwise every wallpaper switch leaks a
 * live timer (and, in older builds, a second draw of the video frame).
 */
test('captureVideoThumb clears its fallback timer when the frame wins', async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const realDocument = globalThis.document;
  const cleared = [];
  let armed = 0;

  globalThis.setTimeout = () => {
    armed += 1;
    return armed;
  };
  globalThis.clearTimeout = (id) => {
    cleared.push(id);
  };
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => 'data:image/jpeg;base64,AA==',
    }),
  };

  try {
    const { captureVideoThumb } = await import('../src/assets.js');
    const video = {
      videoWidth: 64,
      videoHeight: 36,
      requestVideoFrameCallback: (callback) => callback(),
    };

    const url = await captureVideoThumb(video);

    assert.equal(url, 'data:image/jpeg;base64,AA==');
    assert.equal(armed, 1, 'fallback timer should still be armed');
    assert.deepEqual(cleared, [1], 'fallback timer should be cleared');
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    if (realDocument === undefined) delete globalThis.document;
    else globalThis.document = realDocument;
  }
});
