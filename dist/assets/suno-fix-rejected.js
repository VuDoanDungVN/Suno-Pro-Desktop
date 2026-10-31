/*
 * Split + insert noise fix for Suno-rejected clips.
 *
 * Algorithm (generalized, not hardcoded to any specific duration):
 *   fixRejectedSegment(seg):
 *     if seg.duration < MIN_SPLITTABLE_SEC: return seg unresolved (too short to split further)
 *     mid = seg.duration / 2
 *     partA = cut(seg, 0, mid); partB = cut(seg, mid, seg.duration)
 *     noise = generateNoise(NOISE_DURATION_SEC)
 *     candidate = concat(partA, noise, partB)
 *     if passesQA(candidate): return candidate
 *     else: return concat(fixRejectedSegment(partA), noise, fixRejectedSegment(partB))
 *
 * Guards against runaway recursion / file bloat on short clips:
 *   - MAX_RECURSION_DEPTH: stop recursing past this many split levels
 *   - MAX_NOISE_INSERTS: stop once this many noise blocks have been inserted
 *     into the segment's lineage (each recursion level can insert one)
 * When a guard trips, the smallest still-rejected leaf is returned as-is and
 * the overall result is flagged `unresolved: true` so the caller can log/skip it
 * instead of silently shipping a broken clip.
 *
 * Buffers here use the same plain-object shape the rest of the app already
 * uses for decoded audio (see dist/assets/main-*.js / docs/variable-split-shrink.md):
 *   { numberOfChannels, sampleRate, length, duration, getChannelData(ch) -> Float32Array }
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    minSplittableSec: 0.6,   // below this, a half/half split is meaningless
    maxRecursionDepth: 3,    // hard ceiling independent of duration
    maxNoiseInserts: 2,      // hard ceiling on total noise blocks per original segment
    noiseDurationSec: 1.0,
    noiseLevelDbfs: -40,     // quiet filler noise, not audible spam
  };

  function makeBuffer(channelArrays, sampleRate, length) {
    return {
      numberOfChannels: channelArrays.length,
      sampleRate,
      length,
      duration: length / sampleRate,
      getChannelData: (i) => channelArrays[i],
    };
  }

  /** Cut [startSec, endSec) out of a buffer-like object. */
  function sunoSliceBuffer(buf, startSec, endSec) {
    const sr = buf.sampleRate;
    const startFrame = Math.max(0, Math.min(buf.length, Math.round(startSec * sr)));
    const endFrame = Math.max(startFrame, Math.min(buf.length, Math.round(endSec * sr)));
    const frameCount = endFrame - startFrame;
    const channels = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      channels.push(buf.getChannelData(c).slice(startFrame, endFrame));
    }
    return makeBuffer(channels, sr, frameCount);
  }

  /** Generate `durationSec` of quiet white noise matching a segment's format. */
  function sunoGenerateNoiseBuffer(durationSec, sampleRate, numberOfChannels, levelDbfs) {
    const level = levelDbfs == null ? DEFAULTS.noiseLevelDbfs : levelDbfs;
    const amp = Math.pow(10, level / 20);
    const length = Math.round(durationSec * sampleRate);
    const channels = [];
    for (let c = 0; c < numberOfChannels; c++) {
      const arr = new Float32Array(length);
      for (let i = 0; i < length; i++) arr[i] = (Math.random() * 2 - 1) * amp;
      channels.push(arr);
    }
    return makeBuffer(channels, sampleRate, length);
  }

  /** Concatenate several buffer-like objects (same sampleRate) into one. */
  function sunoConcatBuffers(buffers) {
    const parts = buffers.filter((b) => b && b.length > 0);
    if (!parts.length) return makeBuffer([new Float32Array(0)], buffers[0] ? buffers[0].sampleRate : 48000, 0);
    const sampleRate = parts[0].sampleRate;
    const numberOfChannels = Math.max(...parts.map((b) => b.numberOfChannels));
    const totalLength = parts.reduce((sum, b) => sum + b.length, 0);
    const channels = [];
    for (let c = 0; c < numberOfChannels; c++) {
      const arr = new Float32Array(totalLength);
      let offset = 0;
      for (const b of parts) {
        const src = c < b.numberOfChannels ? b.getChannelData(c) : b.getChannelData(0);
        arr.set(src, offset);
        offset += b.length;
      }
      channels.push(arr);
    }
    return makeBuffer(channels, sampleRate, totalLength);
  }

  /**
   * Recursively fix a rejected segment by splitting it in half and inserting
   * a short noise block at the seam, re-checking QA, and recursing into the
   * two halves only if the first attempt is still rejected.
   *
   * @param {object} segment - buffer-like object to fix
   * @param {(candidate: object) => Promise<boolean>} qaCheck - returns true if candidate passes (e.g. re-upload to Suno and see if it's accepted)
   * @param {object} [opts] - overrides for DEFAULTS, plus onNote(msg) for logging
   * @returns {Promise<{buffer: object, unresolved: boolean, noiseInserted: number, attempts: number}>}
   */
  async function sunoFixRejectedSegment(segment, qaCheck, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const onNote = cfg.onNote || (() => {});
    const state = { noiseCount: 0, unresolved: false, attempts: 0 };

    const buffer = await recurse(segment, 0);
    return {
      buffer,
      unresolved: state.unresolved,
      noiseInserted: state.noiseCount,
      attempts: state.attempts,
    };

    async function recurse(seg, depth) {
      if (seg.duration < cfg.minSplittableSec) {
        onNote(`[fixRejected] segment too short to split (${seg.duration.toFixed(2)}s < ${cfg.minSplittableSec}s) — leaving as-is, unresolved`);
        state.unresolved = true;
        return seg;
      }
      if (depth >= cfg.maxRecursionDepth) {
        onNote(`[fixRejected] max recursion depth (${cfg.maxRecursionDepth}) reached at ${seg.duration.toFixed(2)}s — leaving as-is, unresolved`);
        state.unresolved = true;
        return seg;
      }
      if (state.noiseCount >= cfg.maxNoiseInserts) {
        onNote(`[fixRejected] noise-insert budget (${cfg.maxNoiseInserts}) exhausted at ${seg.duration.toFixed(2)}s — leaving as-is, unresolved`);
        state.unresolved = true;
        return seg;
      }

      const mid = seg.duration / 2;
      const partA = sunoSliceBuffer(seg, 0, mid);
      const partB = sunoSliceBuffer(seg, mid, seg.duration);
      const noise = sunoGenerateNoiseBuffer(cfg.noiseDurationSec, seg.sampleRate, seg.numberOfChannels, cfg.noiseLevelDbfs);

      const candidate = sunoConcatBuffers([partA, noise, partB]);
      state.noiseCount += 1;
      state.attempts += 1;

      const ok = await qaCheck(candidate);
      if (ok) return candidate;

      onNote(`[fixRejected] split+noise still rejected at depth ${depth} (orig ${seg.duration.toFixed(2)}s) — recursing into halves`);
      const fixedA = await recurse(partA, depth + 1);
      const fixedB = await recurse(partB, depth + 1);
      return sunoConcatBuffers([fixedA, noise, fixedB]);
    }
  }

  /**
   * Convenience QA predicate: encode a candidate buffer to WAV (reusing the
   * app's existing PCM->WAV encoder) and run it through a real upload attempt.
   * Returns true if the upload does NOT come back as a Suno rejection.
   *
   * @param {object} candidate - buffer-like object
   * @param {(wavBytes: Uint8Array) => Promise<any>} uploadFn - e.g. a thin wrapper around window.electronAPI.sunoUpload
   */
  async function sunoQaCheckViaUpload(candidate, uploadFn) {
    if (typeof global.sunoPcmSliceToWav !== 'function') {
      throw new Error('sunoQaCheckViaUpload: sunoPcmSliceToWav is not loaded (load after main bundle)');
    }
    const wavBytes = global.sunoPcmSliceToWav(candidate, 0, candidate.length);
    try {
      await uploadFn(wavBytes);
      return true;
    } catch (err) {
      const msg = String((err && err.message) || err);
      const nonShrinkable = /429|rate.?limited|too many requests|401|unauthorized/i.test(msg);
      if (nonShrinkable) throw err; // not a content rejection, bubble up untouched
      const rejected = /suno_rejected|upload_failure|từ chối/i.test(msg);
      if (rejected) return false;
      throw err; // unknown error, don't silently treat as pass/fail
    }
  }

  global.sunoSliceBuffer = sunoSliceBuffer;
  global.sunoGenerateNoiseBuffer = sunoGenerateNoiseBuffer;
  global.sunoConcatBuffers = sunoConcatBuffers;
  global.sunoFixRejectedSegment = sunoFixRejectedSegment;
  global.sunoQaCheckViaUpload = sunoQaCheckViaUpload;
})(window);
