/* Neon Uno — sound engine. All SFX are synthesised with the Web Audio API,
   so there are no audio files to ship or host. Each card type has its own
   sound, and special cards get richer, distinct effects. */
(function () {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let musicTimer = null;
  const state = { sfx: true, music: false, volume: 0.6 };

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = state.volume;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(master);
  }

  function resume() { ensure(); if (ctx.state === 'suspended') ctx.resume(); }

  // A single shaped oscillator note.
  function note(freq, t0, dur, type = 'sine', peak = 0.4, glideTo = null) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(t0, dur, peak = 0.25) {
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = peak;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1200;
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(t0);
  }

  const SFX = {
    click() { const t = ctx.currentTime; note(660, t, 0.06, 'triangle', 0.18); },
    hover() { const t = ctx.currentTime; note(880, t, 0.03, 'sine', 0.08); },
    deal()  { const t = ctx.currentTime; noiseBurst(t, 0.09, 0.18); note(420, t, 0.08, 'triangle', 0.12); },
    turn()  { const t = ctx.currentTime; note(523, t, 0.12, 'sine', 0.18); note(784, t + 0.06, 0.12, 'sine', 0.14); },
    // Normal number card — soft pluck.
    play()  { const t = ctx.currentTime; note(523, t, 0.14, 'triangle', 0.32, 392); noiseBurst(t, 0.05, 0.1); },
    draw()  { const t = ctx.currentTime; note(300, t, 0.16, 'sawtooth', 0.18, 180); noiseBurst(t, 0.12, 0.12); },
    // Special cards — distinct signatures.
    skip()    { const t = ctx.currentTime; note(880, t, 0.1, 'square', 0.28, 220); note(220, t + 0.08, 0.12, 'square', 0.22); },
    reverse() { const t = ctx.currentTime; note(330, t, 0.14, 'sawtooth', 0.26, 880); note(880, t + 0.12, 0.14, 'sawtooth', 0.22, 330); },
    draw2()   { const t = ctx.currentTime; [0, 0.09].forEach((d, i) => note(180 + i * 40, t + d, 0.12, 'square', 0.3, 90)); noiseBurst(t, 0.18, 0.2); },
    wild()    { const t = ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => note(f, t + i * 0.05, 0.18, 'triangle', 0.26)); },
    wild4()   { const t = ctx.currentTime; [392, 523, 659, 784, 1047].forEach((f, i) => note(f, t + i * 0.05, 0.22, 'sawtooth', 0.28)); noiseBurst(t + 0.05, 0.25, 0.18); },
    uno()     { const t = ctx.currentTime; [659, 988, 1319].forEach((f, i) => note(f, t + i * 0.08, 0.2, 'square', 0.32)); },
    win()     { const t = ctx.currentTime; [523, 659, 784, 1047, 1319].forEach((f, i) => note(f, t + i * 0.11, 0.3, 'triangle', 0.34)); },
    lose()    { const t = ctx.currentTime; [440, 392, 330, 262].forEach((f, i) => note(f, t + i * 0.12, 0.25, 'sine', 0.24)); },
    error()   { const t = ctx.currentTime; note(160, t, 0.18, 'square', 0.22); },
    emoji()   { const t = ctx.currentTime; note(1047, t, 0.08, 'sine', 0.2, 1568); },
    join()    { const t = ctx.currentTime; note(523, t, 0.1, 'sine', 0.2); note(784, t + 0.08, 0.12, 'sine', 0.2); }
  };

  // Map an in-game action to a sound.
  function forAction(type) {
    switch (type) {
      case 'skip': return 'skip';
      case 'reverse': return 'reverse';
      case 'draw2': return 'draw2';
      case 'wild': return 'wild';
      case 'wild4': return 'wild4';
      case 'draw': return 'draw';
      case 'uno': return 'uno';
      case 'finish': return 'uno';
      case 'roundOver': return 'win';
      case 'pass': return 'click';
      default: return 'play';
    }
  }

  // Background music — gentle chord-progression loop (audible).
  const PROG = [
    [220.00, 261.63, 329.63],   // Am
    [174.61, 220.00, 261.63],   // F
    [261.63, 329.63, 392.00],   // C
    [196.00, 246.94, 293.66]    // G
  ];
  let musicStep = 0;
  function padNote(freq, t0, dur, type, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.35);
    g.gain.setValueAtTime(peak, t0 + dur - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function musicNote(freq, t0, dur, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(musicGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function scheduleMusic() {
    if (!state.music || !ctx) return;
    const t = ctx.currentTime;
    const chord = PROG[musicStep % PROG.length];
    chord.forEach((freq) => padNote(freq, t, 1.9, 'sine', 0.16));
    padNote(chord[0] / 2, t, 1.9, 'triangle', 0.22);          // bass
    musicNote(chord[musicStep % chord.length] * 2, t + 0.05, 0.55, 0.14);
    musicNote(chord[(musicStep + 2) % chord.length] * 2, t + 0.95, 0.55, 0.12);
    musicStep++;
    musicTimer = setTimeout(scheduleMusic, 1850);
  }

  window.Sound = {
    unlock() { resume(); },
    play(name) {
      if (!state.sfx) return;
      resume();
      try { (SFX[name] || SFX.play)(); } catch (e) {}
    },
    action(type) { this.play(forAction(type)); },
    setSfx(on) { state.sfx = on; },
    setMusic(on) {
      state.music = on;
      ensure(); resume();
      if (musicGain) musicGain.gain.setTargetAtTime(on ? 0.9 : 0.0, ctx.currentTime, 0.4);
      clearTimeout(musicTimer);
      if (on) { musicStep = 0; scheduleMusic(); }
    },
    setVolume(v) { state.volume = v; if (master) master.gain.value = v; },
    state
  };
})();
