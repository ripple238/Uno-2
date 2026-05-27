/* Neon Uno — custom card themes. Each theme defines the four suit colours
   plus the card face/border styling. Switchable live from the settings panel. */
window.THEMES = {
  neon: {
    label: 'Neon Glow',
    colors: { red: '#ff2e63', yellow: '#ffd23f', green: '#1be7a8', blue: '#2e8bff' },
    glow: true, face: '#0e0e1a', text: '#ffffff', radius: 16
  },
  classic: {
    label: 'Classic Uno',
    colors: { red: '#e0392b', yellow: '#f4c20d', green: '#2aa84a', blue: '#1e6fd9' },
    glow: false, face: '#111', text: '#fff', radius: 14
  },
  candy: {
    label: 'Candy Pop',
    colors: { red: '#ff5d8f', yellow: '#ffd166', green: '#06d6a0', blue: '#4cc9f0' },
    glow: true, face: '#1a1030', text: '#fff', radius: 22
  },
  midnight: {
    label: 'Midnight',
    colors: { red: '#c1121f', yellow: '#e9c46a', green: '#2a9d8f', blue: '#457b9d' },
    glow: false, face: '#05080f', text: '#e7ecf5', radius: 12
  },
  sunset: {
    label: 'Sunset',
    colors: { red: '#ff6b35', yellow: '#ffd166', green: '#7ae582', blue: '#9b5de5' },
    glow: true, face: '#1b0f1f', text: '#fff', radius: 18
  },
  mono: {
    label: 'Mono Ink',
    colors: { red: '#ef476f', yellow: '#b8c0ff', green: '#a0c4ff', blue: '#8d99ae' },
    glow: false, face: '#0a0a0a', text: '#fff', radius: 10
  }
};

window.applyTheme = function (key) {
  const t = window.THEMES[key] || window.THEMES.neon;
  const r = document.documentElement.style;
  r.setProperty('--card-red', t.colors.red);
  r.setProperty('--card-yellow', t.colors.yellow);
  r.setProperty('--card-green', t.colors.green);
  r.setProperty('--card-blue', t.colors.blue);
  r.setProperty('--card-face', t.face);
  r.setProperty('--card-text', t.text);
  r.setProperty('--card-radius', t.radius + 'px');
  r.setProperty('--card-glow', t.glow ? '1' : '0');
  document.body.dataset.theme = key;
  return t;
};
