// Audio: every sound is synthesized with WebAudio — no audio files. A short
// noise burst through a low-pass filter is a gunshot; a sine sweep is a
// beep; filtered noise with a long decay is an explosion.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBurst(duration, filterFreq, gain) {
    if (!ensure()) return;
    const len = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start();
  }

  function tone(freq, duration, gain, type = 'sine', slideTo = null) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  return {
    unlock() { ensure(); },
    shot(isRifle) { noiseBurst(0.09, isRifle ? 2400 : 1800, 0.5); tone(160, 0.07, 0.25, 'square', 60); },
    enemyShot() { noiseBurst(0.08, 1400, 0.28); },
    dryFire() { tone(1200, 0.03, 0.15, 'square'); },
    reload() { tone(900, 0.05, 0.2, 'square'); setTimeout(() => tone(700, 0.05, 0.2, 'square'), 260); },
    hit() { tone(1800, 0.05, 0.25, 'sine'); },
    kill() { tone(660, 0.09, 0.3, 'sine'); setTimeout(() => tone(990, 0.12, 0.3, 'sine'), 90); },
    hurt() { noiseBurst(0.12, 700, 0.4); },
    // A footstep: a short soft tap. Loud steps (running) carry; quiet ones
    // (walking, crouching) are barely there.
    step(loud) { noiseBurst(0.05, loud ? 900 : 500, loud ? 0.22 : 0.07); },
    // Squad acknowledgement: two short blips, like a radio click.
    ack() { tone(880, 0.06, 0.22, 'sine'); setTimeout(() => tone(1174, 0.08, 0.22, 'sine'), 90); },
    ping() { tone(1568, 0.07, 0.22, 'sine'); setTimeout(() => tone(1568, 0.07, 0.18, 'sine'), 120); },
    plant() { tone(880, 0.08, 0.25, 'sine'); },
    beep() { tone(1200, 0.06, 0.2, 'sine'); },
    explosion() { noiseBurst(0.9, 300, 0.9); tone(70, 0.8, 0.6, 'sine', 30); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.25, 'sine'), i * 130)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.25, 'sine'), i * 150)); },
    buy() { tone(1046, 0.08, 0.25, 'sine'); },
  };
}
