let audio: AudioContext | undefined;
let lastSound = 0;
let generation = 0;
const playing = new Set<AudioScheduledSourceNode>();

/** Call from a tap before asynchronous saves/room commands lose user activation. */
export async function unlockAudio(): Promise<AudioContext | undefined> {
  try {
    const Audio =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    if (!audio || audio.state === 'closed') audio = new Audio({ latencyHint: 'interactive' });
    // Mobile browsers can suspend or interrupt a context after backgrounding.
    if (audio.state !== 'running') await audio.resume();
    return audio.state === 'running' ? audio : undefined;
  } catch {
    return undefined;
  }
}
export function stopSounds() {
  generation++;
  for (const source of playing) {
    try {
      source.stop();
    } catch {
      /* Already finished. */
    }
  }
  playing.clear();
}
function connect(context: AudioContext, source: AudioScheduledSourceNode, gain: GainNode) {
  source.connect(gain);
  gain.connect(context.destination);
  playing.add(source);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    playing.delete(source);
  };
}
function knock(context: AudioContext, index: number) {
  const length = Math.ceil(context.sampleRate * 0.11);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 7919 + index * 271;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const t = i / context.sampleRate;
    const attack = Math.min(1, t / 0.0015);
    samples[i] =
      attack *
      ((seed / 2147483648 - 1) * Math.exp(-t * 95) * 0.6 +
        Math.sin(t * Math.PI * 2 * (1250 + index * 73)) * Math.exp(-t * 52) * 0.3 +
        Math.sin(t * Math.PI * 2 * 420) * Math.exp(-t * 65) * 0.2);
  }
  return buffer;
}
/** Sound each strike of a thrown die when it happens, louder for harder hits. */
export function playImpacts(impacts: readonly { time: number; speed: number }[]) {
  const current = generation;
  // Corners that land together are one knock; keep the hardest of a busy roll.
  const strikes: { time: number; speed: number }[] = [];
  for (const impact of impacts) {
    const last = strikes[strikes.length - 1];
    if (last && impact.time - last.time < 0.02) last.speed = Math.max(last.speed, impact.speed);
    else strikes.push({ ...impact });
  }
  const loudest = [...strikes].sort((a, b) => b.speed - a.speed).slice(0, 28);
  void unlockAudio()
    .then((context) => {
      if (!context || current !== generation) return;
      const voices = Array.from({ length: 5 }, (_, index) => knock(context, index));
      const start = context.currentTime + 0.01;
      loudest.forEach((strike, index) => {
        const source = context.createBufferSource(),
          gain = context.createGain();
        source.buffer = voices[index % voices.length];
        gain.gain.value = 0.5 * Math.min(1, Math.pow(strike.speed / 11, 0.8));
        connect(context, source, gain);
        source.start(start + strike.time);
      });
    })
    .catch(() => {
      /* Optional audio never blocks gameplay. */
    });
}
/** Synthesized ivory-on-table impacts; no downloads or microphone access. */
export function playCue(kind: 'up' | 'down' | 'roll' = 'up', duration = 2.25) {
  if (Date.now() - lastSound < 90) return;
  lastSound = Date.now();
  const current = generation;
  void unlockAudio()
    .then((context) => {
      if (!context || current !== generation) return;
      if (kind === 'roll') {
        const times = duration < 0.3 ? [0] : [0, 0.09, 0.22, 0.38, 0.62, 0.91, 1.28, 1.77, 2.15];
        times.forEach((offset, index) => {
          const source = context.createBufferSource(),
            gain = context.createGain();
          source.buffer = knock(context, index);
          gain.gain.value = 0.48 * (1 - index * 0.065);
          connect(context, source, gain);
          source.start(context.currentTime + 0.01 + (offset * duration) / 2.25);
        });
      } else {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        const at = context.currentTime + 0.01;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(kind === 'down' ? 310 : 620, at);
        oscillator.frequency.exponentialRampToValueAtTime(kind === 'down' ? 230 : 880, at + 0.07);
        gain.gain.setValueAtTime(0.06, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
        connect(context, oscillator, gain);
        oscillator.start(at);
        oscillator.stop(at + 0.11);
      }
    })
    .catch(() => {
      /* Optional audio never blocks gameplay. */
    });
}
