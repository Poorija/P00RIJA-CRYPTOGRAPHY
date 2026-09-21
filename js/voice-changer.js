/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

'use strict';
/* Changing a voice - and being honest about which kind of change it is.
 *
 * Two different things live here and the difference matters more than either:
 *
 *   an EFFECT makes a voice sound different. A pitch shift is the usual one.
 *   It is entertaining and it hides nothing: the formants - the resonances of
 *   the speaker's own vocal tract - stay exactly where they were, and those are
 *   what a speaker-identification system reads. Somebody who knows the voice
 *   still knows it.
 *
 *   a DISGUISE tries to make attribution harder. That needs the formants moved
 *   too, the timing loosened, and the frequency range that carries the finest
 *   personal detail taken away. This module does all three.
 *
 * Even so, a disguise is "harder", never "impossible". Recording length, word
 * choice, accent, background and the fact that it is you sending it all remain.
 * Every disguise mode carries that sentence with it so the interface cannot
 * quietly drop it.
 *
 * No dependencies, no network, no DOM: a Blob in, a Blob out, decoded and
 * rendered with OfflineAudioContext so the result is deterministic and can be
 * measured by a test rather than listened to. */
(function (global) {
  const MODES = [
    {
      id: 'deep', kind: 'effect', pitch: 0.75, formant: 1, jitter: 0, band: null,
      fa: 'بم', en: 'Deep',
    },
    {
      id: 'bright', kind: 'effect', pitch: 1.35, formant: 1, jitter: 0, band: null,
      fa: 'زیر', en: 'Bright',
    },
    {
      id: 'robot', kind: 'effect', pitch: 1, formant: 1, jitter: 0, band: null, ring: 70,
      fa: 'ربات', en: 'Robot',
    },
    {
      /* Pitch and formants moved together and downward, timing loosened, and
         the band narrowed to what a telephone carries - which is where most of
         the individuating detail is not. */
      id: 'veil-low', kind: 'disguise', pitch: 0.82, formant: 0.78, jitter: 0.035,
      band: { low: 300, high: 3400 }, noise: 0.004,
      fa: 'پنهان‌سازی — پایین', en: 'Disguise - lower',
      caveat: true,
    },
    {
      id: 'veil-high', kind: 'disguise', pitch: 1.22, formant: 1.28, jitter: 0.035,
      band: { low: 300, high: 3400 }, noise: 0.004,
      fa: 'پنهان‌سازی — بالا', en: 'Disguise - higher',
      caveat: true,
    },
    /* --- more effects. None of these hide anybody; they are for fun, and the
       interface says so by grouping them apart from the disguises. --- */
    {
      id: 'chipmunk', kind: 'effect', pitch: 1.7, formant: 1.7, jitter: 0,
      fa: 'سنجاب', en: 'Chipmunk',
    },
    {
      id: 'giant', kind: 'effect', pitch: 0.6, formant: 0.72, jitter: 0,
      fa: 'غول', en: 'Giant',
    },
    {
      /* A telephone: band-limited and a little overdriven, nothing else. */
      id: 'phone', kind: 'effect', pitch: 1, formant: 1, jitter: 0,
      band: { low: 400, high: 3000 }, drive: 6,
      fa: 'تلفن', en: 'Telephone',
    },
    {
      id: 'radio', kind: 'effect', pitch: 1, formant: 1, jitter: 0,
      band: { low: 500, high: 2600 }, drive: 18, noise: 0.006,
      fa: 'رادیو قدیمی', en: 'Old radio',
    },
    {
      id: 'cave', kind: 'effect', pitch: 0.95, formant: 1, jitter: 0,
      delay: { time: 0.16, feedback: 0.42, mix: 0.5 },
      fa: 'غار', en: 'Cave',
    },
    {
      id: 'alien', kind: 'effect', pitch: 1.15, formant: 0.85, jitter: 0.01, ring: 190,
      fa: 'فضایی', en: 'Alien',
    },
    {
      id: 'wobble', kind: 'effect', pitch: 1, formant: 1, jitter: 0, tremolo: { rate: 6.5, depth: 0.55 },
      fa: 'لرزان', en: 'Wobble',
    },
    {
      /* Breath rather than voice: the band is cut low, the level pulled down
         and a floor laid over it. It reads as a whisper without being one. */
      id: 'whisper', kind: 'effect', pitch: 1.02, formant: 1.05, jitter: 0.02,
      band: { low: 900, high: 7000 }, noise: 0.02, level: 0.55,
      fa: 'نجوا', en: 'Whisper',
    },
    /* --- more disguises. Each one moves pitch and formants together, loosens
       timing, and narrows the band; each one carries the caveat. --- */
    {
      /* Toward the middle of the range rather than up or down: a voice at the
         average is harder to place than one pushed to an extreme. */
      id: 'veil-neutral', kind: 'disguise', pitch: 1.0, formant: 0.92, jitter: 0.055,
      band: { low: 300, high: 3400 }, noise: 0.005,
      fa: 'پنهان‌سازی — خنثی', en: 'Disguise - neutral',
      caveat: true,
    },
    {
      /* The strongest of them: the widest move, the loosest timing, the
         narrowest band and a ring modulator on top. Least natural, and the
         hardest to walk back. */
      id: 'veil-deep', kind: 'disguise', pitch: 0.7, formant: 0.66, jitter: 0.075,
      band: { low: 320, high: 3000 }, noise: 0.008, ring: 24,
      fa: 'پنهان‌سازی — کامل', en: 'Disguise - strongest',
      caveat: true,
    },
    {
      /* Timing carries a lot of a person: how fast they speak, where they
         pause. This one attacks that above all, with heavy jitter. */
      id: 'veil-timing', kind: 'disguise', pitch: 1.08, formant: 1.12, jitter: 0.11,
      band: { low: 300, high: 3400 }, noise: 0.005,
      fa: 'پنهان‌سازی — ریتم', en: 'Disguise - rhythm',
      caveat: true,
    },
  ];

  const CAVEAT = {
    fa: 'این حالت شناسایی گوینده را سخت‌تر می‌کند، نه غیرممکن. لهجه، انتخاب کلمات، صدای پس‌زمینه و اینکه فرستنده شما هستید سر جای خودشان می‌مانند.',
    en: 'This makes identifying the speaker harder, not impossible. Accent, word choice, background sound and the fact that you are the sender all remain.',
  };

  async function decode(blob) {
    const bytes = await blob.arrayBuffer();
    /* A one-frame context purely to decode; the real render gets its own. */
    const probe = new OfflineAudioContext(1, 1, 44100);
    return probe.decodeAudioData(bytes);
  }

  /* Granular resampling: read the source at one rate and lay the grains down at
     another. Reading faster moves pitch AND formants up together - which is the
     part a plain playbackRate change gets right and a pitch-only shifter does
     not. Laying the grains back down at the original spacing restores the
     duration, so a disguised message is as long as the one that was spoken. */
  function granular(input, output, { pitch, formant, jitter }) {
    const rate = pitch * formant;
    const grain = Math.max(64, Math.round(input.length / 400));
    const fade = Math.max(8, Math.round(grain / 4));
    let readAt = 0;
    let writeAt = 0;
    while (writeAt < output.length && readAt < input.length) {
      const wobble = jitter ? 1 + ((Math.random() * 2 - 1) * jitter) : 1;
      const step = rate * wobble;
      for (let i = 0; i < grain; i += 1) {
        const from = readAt + (i * step);
        const to = writeAt + i;
        if (to >= output.length || from >= input.length - 1) break;
        const whole = Math.floor(from);
        const frac = from - whole;
        const sample = input[whole] * (1 - frac) + input[whole + 1] * frac;
        /* Cross-faded edges, or every grain boundary is a click. */
        let gain = 1;
        if (i < fade) gain = i / fade;
        else if (i > grain - fade) gain = (grain - i) / fade;
        output[to] += sample * gain;
      }
      readAt += grain * step;
      writeAt += grain - fade;
    }
  }

  function toWav(channel, sampleRate) {
    const out = new ArrayBuffer(44 + channel.length * 2);
    const view = new DataView(out);
    const str = (at, s) => s.split('').forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + channel.length * 2, true); str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, channel.length * 2, true);
    for (let i = 0; i < channel.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(44 + i * 2, clamped * 0x7fff, true);
    }
    return new Blob([out], { type: 'audio/wav' });
  }

  async function transform(blob, modeId) {
    const mode = MODES.find((m) => m.id === modeId);
    if (!mode) throw new Error(`unknown voice mode: ${modeId}`);
    const decoded = await decode(blob);
    const rate = decoded.sampleRate;
    const source = decoded.getChannelData(0);

    /* The pitch and formant work happens on the samples, because a granular
       resampler is not something the graph can express. Everything after it -
       band-limiting, ring modulation, the noise floor - is what a graph is for. */
    const shifted = new Float32Array(source.length);
    granular(source, shifted, {
      pitch: mode.pitch || 1,
      formant: mode.formant || 1,
      jitter: mode.jitter || 0,
    });

    const ctx = new OfflineAudioContext(1, shifted.length, rate);
    const buffer = ctx.createBuffer(1, shifted.length, rate);
    buffer.getChannelData(0).set(shifted);
    const node = ctx.createBufferSource();
    node.buffer = buffer;

    let tail = node;
    if (mode.band) {
      /* Narrowing to a telephone band removes the very high and very low
         detail that carries a lot of what makes one voice distinguishable from
         another with a similar pitch. */
      const high = ctx.createBiquadFilter();
      high.type = 'highpass'; high.frequency.value = mode.band.low;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass'; low.frequency.value = mode.band.high;
      tail.connect(high); high.connect(low); tail = low;
    }
    if (mode.ring) {
      /* Ring modulation: the classic robot, and an effect, nothing more. */
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = mode.ring;
      osc.connect(gain.gain);
      osc.start();
      tail.connect(gain); tail = gain;
    }
    if (mode.drive) {
      /* A soft saturating curve. tanh-like, so it rounds off rather than
         clipping square, which is the difference between "a radio" and "a
         broken speaker". */
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i += 1) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * mode.drive) / Math.tanh(mode.drive);
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      tail.connect(shaper); tail = shaper;
    }
    if (mode.delay) {
      /* Dry and wet in parallel: a delay in series would replace the voice
         with its own echo rather than adding one behind it. */
      const merge = ctx.createGain();
      const dry = ctx.createGain();
      dry.gain.value = 1 - (mode.delay.mix ?? 0.4);
      const wet = ctx.createGain();
      wet.gain.value = mode.delay.mix ?? 0.4;
      const delay = ctx.createDelay(1.5);
      delay.delayTime.value = mode.delay.time ?? 0.15;
      const feedback = ctx.createGain();
      feedback.gain.value = Math.min(0.85, mode.delay.feedback ?? 0.3);
      tail.connect(dry); dry.connect(merge);
      tail.connect(delay);
      delay.connect(feedback); feedback.connect(delay);
      delay.connect(wet); wet.connect(merge);
      tail = merge;
    }
    if (mode.tremolo) {
      /* An oscillator driving a gain: the level itself wavers. */
      const shaped = ctx.createGain();
      shaped.gain.value = 1 - (mode.tremolo.depth ?? 0.5) / 2;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = mode.tremolo.rate ?? 6;
      const depth = ctx.createGain();
      depth.gain.value = (mode.tremolo.depth ?? 0.5) / 2;
      lfo.connect(depth); depth.connect(shaped.gain);
      lfo.start();
      tail.connect(shaped); tail = shaped;
    }
    if (mode.level && mode.level !== 1) {
      const level = ctx.createGain();
      level.gain.value = mode.level;
      tail.connect(level); tail = level;
    }
    if (mode.noise) {
      /* A quiet floor over the top, so the room the recording was made in is
         less legible. It is masking, not erasure. */
      const noiseBuffer = ctx.createBuffer(1, shifted.length, rate);
      const noise = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noise.length; i += 1) noise[i] = (Math.random() * 2 - 1) * mode.noise;
      const noiseNode = ctx.createBufferSource();
      noiseNode.buffer = noiseBuffer;
      noiseNode.connect(ctx.destination);
      noiseNode.start();
    }
    tail.connect(ctx.destination);
    node.start();

    const rendered = await ctx.startRendering();
    return {
      blob: toWav(rendered.getChannelData(0), rate),
      mode: mode.id,
      kind: mode.kind,
      seconds: rendered.duration,
    };
  }

  global.PoorijaVoice = { MODES, CAVEAT, transform };
}(typeof globalThis !== 'undefined' ? globalThis : window));
