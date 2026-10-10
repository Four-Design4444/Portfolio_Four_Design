// Canvas playback of a raw H.264 (Annex-B) stream through the WebCodecs API.
//
// Why this exists: WeChat's XWeb kernel refuses programmatic <video>.play()
// without a real user gesture, so the hero would stay black until the visitor
// taps. WebCodecs decodes frames and paints them onto a <canvas> instead — no
// media element involved, so the autoplay policy never applies.
//
// Compared with the JSMpeg/MPEG-1 path this is both smaller (H.264 packs far
// better than MPEG-1) and lossless (the stream is what the encoder produced,
// no second-generation MPEG-1 quantisation), and on WeChat's XWeb 146 the
// decoder really uses the hardware block (verified on a real device).
//
// The source clip is re-encoded with `-bf 0` on purpose: without B-frames the
// decode order equals the presentation order, so frame timestamps can simply
// be derived as index / fps and no PTS table has to be shipped alongside.
//
// Playback is *streaming*: the fetch body is read chunk by chunk and fed to the
// decoder as soon as the first key frame plus a handful of slices have arrived.
// First paint used to wait for the whole file (2.6 MB at 1440x2560); now it
// only waits for the opening frames, so raising the resolution no longer costs
// extra time before the animation starts.

const COMBOS = [
  { mode: 'annexb', hw: 'prefer-hardware' },   // proven on WeChat XWeb 146
  { mode: 'annexb', hw: 'no-preference' },
  { mode: 'avcc', hw: 'prefer-hardware' },
  { mode: 'avcc', hw: 'no-preference' }
];

// Frames needed before the decoder can be probed: one key frame plus a few
// deltas. Kept small so first paint is not gated on the whole clip.
const MIN_START_FRAMES = 4;

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Index of the next `00 00 01` start code at or after `from`, else -1. */
function findStartCode(u8, from) {
  for (let i = from; i + 2 < u8.length; i += 1) {
    if (u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1) return i;
  }
  return -1;
}

/** Split an Annex-B buffer into NAL units, remembering each payload's bounds. */
function splitNAL(buffer) {
  const u8 = new Uint8Array(buffer);
  const starts = [];
  for (let i = 0; i + 2 < u8.length; i += 1) {
    if (u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1) {
      starts.push(i);
      i += 2;
    }
  }
  const nals = [];
  for (let j = 0; j < starts.length; j += 1) {
    const s = starts[j] + 3;
    let e = j + 1 < starts.length ? starts[j + 1] : u8.length;
    // The next start code may be 4 bytes long (00 00 00 01); its leading zero
    // bytes belong to the delimiter, not to this NAL's payload.
    while (e > s && u8[e - 1] === 0) e -= 1;
    if (e > s) nals.push({ type: u8[s] & 31, data: u8.subarray(s, e) });
  }
  return nals;
}

/**
 * Incremental Annex-B parser: push downloaded chunks in, get every NAL whose
 * end has been seen so far out. The trailing partial NAL is kept until more
 * bytes arrive, so nothing is emitted twice and nothing is dropped.
 */
function createStreamParser() {
  let buf = new Uint8Array(0);
  let scan = 0;
  return {
    push(chunk) {
      buf = buf.length ? concatBytes(buf, chunk) : chunk;
      const out = [];
      for (;;) {
        const s = findStartCode(buf, scan);
        if (s < 0) break;
        const payloadStart = s + 3;
        const next = findStartCode(buf, payloadStart);
        if (next < 0) break;                    // this NAL is still incomplete
        let e = next;
        while (e > payloadStart && buf[e - 1] === 0) e -= 1;
        if (e > payloadStart) {
          out.push({ type: buf[payloadStart] & 31, data: buf.subarray(payloadStart, e) });
        }
        scan = next;
      }
      if (scan > 0) {
        buf = buf.subarray(scan);
        scan = 0;
      }
      return out;
    }
  };
}

/** Build an avcC box body (SPS/PPS in length-prefixed form) for AVCC chunks. */
function makeAvcC(sps, pps) {
  const out = new Uint8Array(11 + sps.length + pps.length);
  out[0] = 1;
  out[1] = sps[1];
  out[2] = sps[2];
  out[3] = sps[3];
  out[4] = 0xff;
  out[5] = 0xe1;
  out[6] = (sps.length >> 8) & 0xff;
  out[7] = sps.length & 0xff;
  out.set(sps, 8);
  const p = 8 + sps.length;
  out[p] = 1;
  out[p + 1] = (pps.length >> 8) & 0xff;
  out[p + 2] = pps.length & 0xff;
  out.set(pps, p + 3);
  return out;
}

function toAnnexB(parts) {
  let total = 0;
  for (let i = 0; i < parts.length; i += 1) total += parts[i].length + 4;
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i < parts.length; i += 1) {
    out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 1;
    o += 4;
    out.set(parts[i], o);
    o += parts[i].length;
  }
  return out;
}

function toLengthPrefixed(parts) {
  let total = 0;
  for (let i = 0; i < parts.length; i += 1) total += parts[i].length + 4;
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const n = parts[i].length;
    out[o] = (n >> 24) & 0xff; out[o + 1] = (n >> 16) & 0xff;
    out[o + 2] = (n >> 8) & 0xff; out[o + 3] = n & 0xff;
    o += 4;
    out.set(parts[i], o);
    o += n;
  }
  return out;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/**
 * Decode `src` and paint it onto `canvas`, looping forever.
 *
 * Resolves as soon as the first frame has been painted; rejects when WebCodecs
 * is missing, no decoder configuration works, or no frame arrives — the caller
 * then falls back to the JSMpeg / native video path.
 */
export async function createWebCodecsPlayer({
  canvas,
  src,
  width,
  height,
  fps = 24,
  codec = 'avc1.640028',
  onFirstFrame,
  timeoutMs = 12000
}) {
  if (typeof window === 'undefined' || typeof window.VideoDecoder !== 'function') {
    throw new Error('no VideoDecoder');
  }
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('no 2d context');

  const frameMs = 1000 / fps;
  let destroyed = false;
  let decoder = null;
  let rafId = 0;
  let pending = [];
  let feedIdx = 0;
  let outIdx = 0;
  let shownIdx = 0;
  let startTime = 0;
  let painted = false;

  // Decoded frames are kept for looping. At 1440x2560 a frame is ~5.5 MB of
  // YUV, so the queue is tighter than it was for the 810-wide clip.
  const maxPending = width * height > 2000000 ? 6 : 10;

  // Everything the download has produced so far.
  const frames = [];
  let sps = null;
  let pps = null;
  let started = false;          // set once the first key frame has been seen
  let downloadDone = false;
  let readerRef = null;

  let signalReady = null;
  const readyPromise = new Promise((resolve) => { signalReady = resolve; });
  let readySignalled = false;

  const ingest = (nal) => {
    if (nal.type === 7 && !sps) sps = nal.data;
    else if (nal.type === 8 && !pps) pps = nal.data;
    else if (nal.type === 1 || nal.type === 5) {
      // Anything before the first key frame is undecodable — skip it.
      if (!started && nal.type !== 5) return;
      started = true;
      frames.push(nal);
    }
    if (!readySignalled && sps && pps && frames.length >= MIN_START_FRAMES) {
      readySignalled = true;
      signalReady();
    }
  };

  const cleanup = () => {
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    for (let i = 0; i < pending.length; i += 1) {
      try { pending[i].frame.close(); } catch (_) { /* already closed */ }
    }
    pending = [];
    for (let i = 0; i < frames.length; i += 1) frames[i].chunkData = null;
    if (readerRef) {
      try { readerRef.cancel(); } catch (_) { /* stream already closed */ }
      readerRef = null;
    }
    if (decoder) {
      try { decoder.close(); } catch (_) { /* already closed */ }
      decoder = null;
    }
  };

  const res = await withTimeout(fetch(src), 15000, 'fetch');
  if (!res.ok) throw new Error(`fetch ${res.status}`);

  const canStream = res.body && typeof res.body.getReader === 'function';
  if (canStream) {
    // Deliberately not awaited: playback starts on the leading frames while the
    // rest of the clip keeps arriving in the background.
    (async () => {
      const reader = res.body.getReader();
      readerRef = reader;
      const parser = createStreamParser();
      try {
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (done) break;
          if (destroyed) return;
          const produced = parser.push(value);
          for (let i = 0; i < produced.length; i += 1) ingest(produced[i]);
        }
      } catch (_) {
        // Network hiccup mid-clip: keep whatever already arrived playable.
      }
      downloadDone = true;
    })();
  } else {
    // Old kernels without a readable body: one-shot download, same behaviour
    // as before (first paint waits for the whole file).
    const buffer = await res.arrayBuffer();
    const all = splitNAL(buffer);
    for (let i = 0; i < all.length; i += 1) ingest(all[i]);
    downloadDone = true;
  }

  // Wait only for the opening frames, not for the whole download.
  await withTimeout(readyPromise, 15000, 'stream start');
  if (!sps || !pps || !frames.length) throw new Error('no SPS/PPS/slice');

  canvas.width = width;
  canvas.height = height;

  const feed = (i) => {
    const frame = frames[i];
    if (!frame.chunkData) {
      const parts = [];
      if (decoder && decoder.__mode === 'annexb' && i === 0) {
        parts.push(sps);
        parts.push(pps);
      }
      parts.push(frame.data);
      frame.chunkData = decoder.__mode === 'annexb' ? toAnnexB(parts) : toLengthPrefixed(parts);
      frame.data = null;
    }
    decoder.decode(new window.EncodedVideoChunk({
      type: frames[i].type === 5 ? 'key' : 'delta',
      timestamp: Math.round((i * 1000000) / fps),
      data: frame.chunkData
    }));
  };

  // Try each (chunk format × hardware preference) pair until one actually
  // yields frames. `isConfigSupported` alone is not trustworthy: XWeb reports
  // YES for configurations whose decoder never emits anything.
  let ready = null;
  for (let c = 0; c < COMBOS.length; c += 1) {
    const combo = COMBOS[c];
    const probeFrames = [];
    let probe = null;
    try {
      probe = new window.VideoDecoder({
        output: (f) => probeFrames.push(f),
        error: () => {}
      });
      const cfg = {
        codec,
        codedWidth: width,
        codedHeight: height,
        optimizeForLatency: true,
        hardwareAcceleration: combo.hw
      };
      if (combo.mode === 'avcc') cfg.description = makeAvcC(sps, pps);
      probe.configure(cfg);
      probe.__mode = combo.mode;
      for (let k = 0; k < Math.min(4, frames.length); k += 1) {
        const parts = [];
        if (combo.mode === 'annexb' && k === 0) { parts.push(sps); parts.push(pps); }
        parts.push(frames[k].data);
        probe.decode(new window.EncodedVideoChunk({
          type: frames[k].type === 5 ? 'key' : 'delta',
          timestamp: Math.round((k * 1000000) / fps),
          data: combo.mode === 'annexb' ? toAnnexB(parts) : toLengthPrefixed(parts)
        }));
      }
      const deadline = Date.now() + 2500;
      while (probeFrames.length === 0 && Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 60));
      }
      if (probeFrames.length > 0) {
        for (let q = 0; q < probeFrames.length; q += 1) probeFrames[q].close();
        try { probe.close(); } catch (_) { /* already closed */ }
        ready = combo;
        break;
      }
    } catch (_) { /* this combination is unusable, try the next one */ }
    if (probe) { try { probe.close(); } catch (_) { /* already closed */ } }
    for (let q = 0; q < probeFrames.length; q += 1) {
      try { probeFrames[q].close(); } catch (_) { /* already closed */ }
    }
  }
  if (!ready) throw new Error('no working decoder configuration');

  decoder = new window.VideoDecoder({
    output: (frame) => {
      if (destroyed) { try { frame.close(); } catch (_) { /* ignore */ } return; }
      pending.push({ idx: outIdx, frame });
      outIdx += 1;
      if (!painted) {
        painted = true;
        if (onFirstFrame) onFirstFrame();
      }
    },
    error: () => {}
  });
  const config = {
    codec,
    codedWidth: width,
    codedHeight: height,
    optimizeForLatency: true,
    hardwareAcceleration: ready.hw
  };
  if (ready.mode === 'avcc') config.description = makeAvcC(sps, pps);
  decoder.configure(config);
  decoder.__mode = ready.mode;

  const drainPending = () => {
    for (let i = 0; i < pending.length; i += 1) {
      try { pending[i].frame.close(); } catch (_) { /* ignore */ }
    }
    pending = [];
  };

  const tick = (now) => {
    if (destroyed) return;
    if (!startTime) startTime = now;
    // Keep the decoder fed but bounded: a deep queue wastes memory and a deep
    // pending list means frames sit around holding decoded buffers. Feeding
    // stops at `frames.length` while the download is still in flight, so a slow
    // network just makes playback wait for the next chunk.
    while (decoder.decodeQueueSize < 4 && feedIdx < frames.length && pending.length < maxPending) {
      feed(feedIdx);
      feedIdx += 1;
    }
    while (pending.length && now - startTime >= shownIdx * frameMs) {
      const item = pending.shift();
      try {
        ctx.drawImage(item.frame, 0, 0, canvas.width, canvas.height);
      } catch (_) { /* frame already invalidated */ }
      try { item.frame.close(); } catch (_) { /* already closed */ }
      shownIdx += 1;
    }
    // Only loop once the whole clip is in memory; otherwise we would restart
    // from a partial stream.
    if (feedIdx >= frames.length && pending.length === 0 && downloadDone) {
      feedIdx = 0;
      outIdx = 0;
      shownIdx = 0;
      startTime = now;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  // Safety net: if nothing was painted within `timeoutMs`, hand control back so
  // the caller can fall back instead of leaving an empty hero.
  const bail = setTimeout(() => {
    if (!painted && !destroyed) {
      drainPending();
      cleanup();
      if (onFirstFrame) onFirstFrame(new Error('first frame timeout'));
    }
  }, timeoutMs);

  return {
    destroy: () => { clearTimeout(bail); cleanup(); },
    // Exposed for diagnostics from the console / probe scripts.
    get painted() { return painted; },
    get mode() { return `${ready.mode}/${ready.hw}`; },
    get frames() { return frames.length; },
    get complete() { return downloadDone; }
  };
}
