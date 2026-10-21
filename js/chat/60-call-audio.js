/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* ============================================================================
   The voice in a call: full band, and the room left out.
   ============================================================================

   The microphone is asked for at 48 kHz in one channel with echo cancellation
   and automatic gain, and Opus is told to carry it at full band without
   dropping the pauses (tuneOpus, 31-file-transfer-3.js).

   Background noise — a fan, traffic, a keyboard, a café — is taken out by
   RNNoise, the recurrent-network suppressor from Xiph (the people behind
   Opus), running on this device in an AudioWorklet: the published
   @sapphi-red/web-noise-suppressor worklet over @shiguredo/rnnoise-wasm,
   vendored unchanged in vendor/noise-suppressor/ with their licences. Nothing
   leaves the device for it and nothing is downloaded at call time; the files
   are part of the app.

   The microphone track goes in, a cleaned track comes out, and the cleaned
   one is what the call sends. While RNNoise is doing the work, the browser's
   own (much simpler) suppression is asked to stay out of the way, so the
   voice is not processed twice. Wherever RNNoise cannot run — no AudioWorklet,
   an audio engine that will not run at 48 kHz, an audio context the system
   suspended — the call carries on with the plain microphone and the browser's
   own suppression, never with silence.

   It is on by default and is a switch in Settings and in the call's own
   settings panel; switched during a call, the microphone is taken again with
   the new setting.
   ============================================================================ */

const NOISE_WORKLET_URL = 'vendor/noise-suppressor/rnnoise-worklet.js';
const NOISE_WASM_URL = 'vendor/noise-suppressor/rnnoise.wasm';
const NOISE_WASM_SIMD_URL = 'vendor/noise-suppressor/rnnoise_simd.wasm';
const NOISE_PROCESSOR_NAME = '@sapphi-red/web-noise-suppressor/rnnoise';
const noiseSuppressor = { wasm: null, failed: false, loading: null, active: new Set() };

function callNoiseSuppressionEnabled() {
  return chatState.prefs?.callNoiseSuppression !== false;
}
function noiseSuppressorUsable() {
  return typeof AudioWorkletNode === 'function' && typeof window.AudioContext === 'function'
    && typeof WebAssembly === 'object' && !noiseSuppressor.failed;
}

/* The same WebAssembly feature probe the package uses: SIMD where the engine
   has it, which is most of today's engines and roughly twice as fast. */
function wasmSimdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch (_error) {
    return false;
  }
}

/* Loaded once, before the microphone is opened, so the constraints can say
   whether the browser's own suppression is needed. */
function prepareNoiseSuppressor() {
  if (!callNoiseSuppressionEnabled() || !noiseSuppressorUsable()) return Promise.resolve(false);
  if (noiseSuppressor.wasm) return Promise.resolve(true);
  if (!noiseSuppressor.loading) {
    noiseSuppressor.loading = (async () => {
      try {
        const response = await fetch(wasmSimdSupported() ? NOISE_WASM_SIMD_URL : NOISE_WASM_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        noiseSuppressor.wasm = await response.arrayBuffer();
        return true;
      } catch (error) {
        console.warn('[Call] the noise suppressor could not be loaded:', error?.message || error);
        noiseSuppressor.failed = true;
        return false;
      } finally {
        noiseSuppressor.loading = null;
      }
    })();
  }
  return noiseSuppressor.loading;
}

/* What every call asks of the microphone. */
function callAudioConstraints(extra = {}) {
  const ours = callNoiseSuppressionEnabled() && Boolean(noiseSuppressor.wasm) && noiseSuppressorUsable();
  return {
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: !ours,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
    ...extra,
  };
}

/* The microphone in, a cleaned microphone out. The returned stream carries the
   cleaned track in place of the raw one (and any video track as it was);
   stopping the cleaned track stops the microphone and the audio engine with
   it, so every path that ends a call ends this too. */
async function denoiseCallStream(stream) {
  const raw = stream?.getAudioTracks?.()[0];
  if (!raw || !callNoiseSuppressionEnabled() || !noiseSuppressor.wasm || !noiseSuppressorUsable()) return stream;
  let context = null;
  try {
    context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    /* RNNoise works on 48 kHz frames; an engine that will not run at 48 kHz
       keeps the plain microphone. */
    if (context.sampleRate !== 48000) throw new Error(`audio engine at ${context.sampleRate} Hz`);
    await context.audioWorklet.addModule(NOISE_WORKLET_URL);
    if (context.state !== 'running') {
      await Promise.race([context.resume(), new Promise((resolve) => window.setTimeout(resolve, 500))]);
    }
    if (context.state !== 'running') throw new Error(`audio engine ${context.state}`);
    const source = context.createMediaStreamSource(new MediaStream([raw]));
    const node = new AudioWorkletNode(context, NOISE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      outputChannelCount: [1],
      processorOptions: { wasmBinary: noiseSuppressor.wasm.slice(0), maxChannels: 1 },
    });
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 1;
    source.connect(node).connect(destination);
    const cleaned = destination.stream.getAudioTracks()[0];
    if (!cleaned) throw new Error('no cleaned track');
    try { cleaned.contentHint = 'speech'; } catch (_error) { /* not taken */ }

    const pipeline = { context, source, node, destination, raw, cleaned, closed: false };
    const close = () => {
      if (pipeline.closed) return;
      pipeline.closed = true;
      noiseSuppressor.active.delete(pipeline);
      try { source.disconnect(); } catch (_error) { /* gone */ }
      try { node.port.postMessage('destroy'); node.disconnect(); } catch (_error) { /* gone */ }
      try { raw.stop(); } catch (_error) { /* gone */ }
      context.close().catch(() => {});
    };
    pipeline.close = close;
    const stopCleaned = cleaned.stop.bind(cleaned);
    cleaned.stop = () => { stopCleaned(); close(); };
    raw.addEventListener('ended', () => { try { stopCleaned(); } catch (_error) { /* gone */ } close(); });
    /* A system that suspends the audio engine mid-call (a phone call coming
       in, the app sent to the background) gets one attempt to resume it; if
       it stays suspended, the call goes back to the plain microphone rather
       than sending silence. */
    context.addEventListener('statechange', () => {
      if (pipeline.closed || context.state === 'running') return;
      context.resume().catch(() => {}).finally(() => {
        window.setTimeout(() => {
          if (!pipeline.closed && context.state !== 'running') fallBackToRawMicrophone(pipeline);
        }, 800);
      });
    });
    noiseSuppressor.active.add(pipeline);
    const out = new MediaStream([cleaned, ...stream.getVideoTracks()]);
    return out;
  } catch (error) {
    console.warn('[Call] the call goes without the noise suppressor:', error?.message || error);
    try { context?.close(); } catch (_error) { /* not open */ }
    return stream;
  }
}

/* The plain microphone back on whatever is sending the cleaned one. */
async function fallBackToRawMicrophone(pipeline) {
  const { raw, cleaned } = pipeline;
  if (raw.readyState !== 'live') return;
  const senders = [
    ...(chatState.currentCall?.peerConnection?.getSenders?.() || []),
    ...(typeof groupCallLegs === 'function' ? groupCallLegs().flatMap((call) => call.peerConnection?.getSenders?.() || []) : []),
  ];
  for (const sender of senders) {
    if (sender.track === cleaned) await sender.replaceTrack(raw).catch(() => {});
  }
  for (const stream of [chatState.localStream, chatState.groupCall?.localStream]) {
    if (!stream?.getAudioTracks?.().includes(cleaned)) continue;
    raw.enabled = cleaned.enabled;
    stream.removeTrack(cleaned);
    stream.addTrack(raw);
  }
  pipeline.closed = true;
  noiseSuppressor.active.delete(pipeline);
  try { pipeline.node.port.postMessage('destroy'); } catch (_error) { /* gone */ }
  pipeline.context.close().catch(() => {});
  console.warn('[Call] the audio engine was suspended; the call carries on with the plain microphone');
}

function setCallNoiseSuppression(enabled) {
  chatState.prefs = { ...(chatState.prefs || {}), callNoiseSuppression: Boolean(enabled) };
  if (enabled) noiseSuppressor.failed = false;
  if (typeof saveChatPrefs === 'function') saveChatPrefs();
  syncNoiseSuppressionToggles();
  /* In a call: the microphone again, with the new setting. */
  const track = chatState.localStream?.getAudioTracks?.()[0];
  const pipeline = [...noiseSuppressor.active].find((item) => item.cleaned === track);
  const deviceId = (pipeline?.raw || track)?.getSettings?.().deviceId || '';
  if (chatState.currentCall && deviceId && typeof switchCallMediaDevice === 'function') {
    switchCallMediaDevice('audioinput', deviceId).catch(() => {});
  }
}
function syncNoiseSuppressionToggles() {
  document.querySelectorAll('[data-call-noise-toggle]').forEach((input) => {
    input.checked = callNoiseSuppressionEnabled();
    input.disabled = !noiseSuppressorUsable() && !callNoiseSuppressionEnabled();
  });
  if (typeof syncChatToggleStates === 'function') syncChatToggleStates();
}
document.addEventListener('change', (event) => {
  const input = event.target.closest?.('[data-call-noise-toggle]');
  if (input) setCallNoiseSuppression(input.checked);
});

window.__callAudioProbe = {
  enabled: () => callNoiseSuppressionEnabled(),
  prepare: () => prepareNoiseSuppressor(),
  constraints: () => callAudioConstraints(),
  active: () => [...noiseSuppressor.active].map((pipeline) => ({ state: pipeline.context.state, raw: pipeline.raw.readyState, cleaned: pipeline.cleaned.readyState })),
  denoise: (stream) => denoiseCallStream(stream),
};
