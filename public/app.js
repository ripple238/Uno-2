/* ===================== Neon Uno — client ===================== */
const socket = io({ transports: ['websocket', 'polling'] });
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const profile = {
  name: localStorage.getItem('uno_name') || 'Player' + Math.floor(Math.random() * 900 + 100),
  avatar: localStorage.getItem('uno_avatar') || '🦊',
  theme: localStorage.getItem('uno_theme') || 'neon'
};
let STATE = null;       // latest server state
let lastSeq = 0;        // last animated action
let prevHandIds = [];   // for deal-in animation
let soloMode = false;
let pendingStartBots = 0;
let justDrew = false;   // true between drawing and ending your turn

// ---- boot ----
applyTheme(profile.theme);
$('#name-input').value = profile.name;
$('#avatar-pick').textContent = profile.avatar;
buildThemeGrid();
buildAvatarGrid();
Sound.setSfx(true);

// pre-fill room code from invite link
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('#join-code').value = urlRoom.toUpperCase();

// unlock audio on first interaction
['click', 'touchstart', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, () => Sound.unlock(), { once: true }));

// ---- screen helpers ----
function show(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function announce(text, cls) {
  const a = $('#announce'); a.textContent = text;
  a.style.color = cls || '#fff';
  a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
}

// ---- card rendering ----
const VAL_LABEL = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' };
function cardLabel(c) { return VAL_LABEL[c.value] ?? c.value; }
function colorClass(c) { return 'c-' + (c.color === 'wild' ? 'wild' : c.color); }

function renderCard(c, { playable = false, disabled = false } = {}) {
  const el = document.createElement('div');
  el.className = `card ${colorClass(c)}`;
  el.dataset.id = c.id;
  if (playable) el.classList.add('playable', 'glow');
  if (disabled) el.classList.add('disabled');
  const colorVar = c.color === 'wild' ? 'var(--accent)' : `var(--card-${c.color})`;
  el.style.setProperty('--c-glow', colorVar);
  const lbl = cardLabel(c);
  el.innerHTML = `<div class="oval"></div>
    <span class="corner tl">${lbl}</span>
    <span class="pip">${lbl}</span>
    <span class="corner br">${lbl}</span>`;
  return el;
}

// ===================== HOME =====================
$('#btn-create').onclick = () => {
  Sound.play('click'); soloMode = false;
  saveProfile();
  socket.emit('createRoom', { name: profile.name, avatar: profile.avatar }, (res) => {
    if (res && res.ok) show('screen-lobby');
  });
};
$('#btn-join').onclick = doJoin;
$('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
function doJoin() {
  const code = $('#join-code').value.trim().toUpperCase();
  if (code.length < 3) return toast('Enter a room code');
  Sound.play('click'); saveProfile();
  socket.emit('joinRoom', { code, name: profile.name, avatar: profile.avatar }, (res) => {
    if (!res || !res.ok) return toast(res?.error || 'Could not join');
    show('screen-lobby');
  });
}
$('#btn-solo').onclick = () => {
  Sound.play('click'); soloMode = true; saveProfile();
  socket.emit('createRoom', { name: profile.name, avatar: profile.avatar }, (res) => {
    if (!res || !res.ok) return;
    pendingStartBots = 3;
    for (let i = 0; i < 3; i++) socket.emit('addBot');
    // start once bots registered
    setTimeout(() => socket.emit('startGame'), 400);
  });
};
$('#name-input').addEventListener('change', () => { profile.name = $('#name-input').value || profile.name; saveProfile(); });

function saveProfile() {
  profile.name = ($('#name-input').value || profile.name).slice(0, 16);
  localStorage.setItem('uno_name', profile.name);
  localStorage.setItem('uno_avatar', profile.avatar);
  socket.emit('updateProfile', { name: profile.name, avatar: profile.avatar });
}

// ===================== LOBBY =====================
const RULE_DEFS = [
  ['stacking', 'Stacking', 'Pile +2 on +2 and +4 on +4'],
  ['drawToMatch', 'Draw to match', 'Keep drawing until you can play'],
  ['sevenZero', '7-0 swap', '7 = swap hands · 0 = rotate hands']
];
function buildRulesBox() {
  const box = $('#rules-box'); box.innerHTML = '';
  const isHost = STATE?.isHost;
  for (const [key, label, desc] of RULE_DEFS) {
    const on = STATE?.rules?.[key];
    const row = document.createElement('label');
    row.className = 'rule-row';
    row.innerHTML = `<span>${label}<br><small>${desc}</small></span>
      <span class="switch"><input type="checkbox" ${on ? 'checked' : ''} ${isHost ? '' : 'disabled'} data-rule="${key}"><i></i></span>`;
    box.appendChild(row);
  }
  box.querySelectorAll('input[data-rule]').forEach((inp) => {
    inp.onchange = () => { Sound.play('click'); socket.emit('updateRules', { [inp.dataset.rule]: inp.checked }); };
  });
  $('#rule-startingCards').disabled = !isHost;
  $('#rule-targetScore').disabled = !isHost;
}
$('#rule-startingCards').onchange = (e) => socket.emit('updateRules', { startingCards: Math.max(5, Math.min(10, +e.target.value)) });
$('#rule-targetScore').onchange = (e) => socket.emit('updateRules', { targetScore: Math.max(0, +e.target.value) });

$('#add-bot').onclick = () => { Sound.play('click'); socket.emit('addBot'); };
$('#start-game').onclick = () => { Sound.play('click'); socket.emit('startGame'); };
$('#leave-lobby').onclick = leaveToHome;
$('#game-leave').onclick = leaveToHome;
$('#back-home').onclick = leaveToHome;
function leaveToHome() { socket.emit('leaveRoom'); STATE = null; show('screen-home'); }

$('#copy-code').onclick = () => {
  const link = `${location.origin}${location.pathname}?room=${STATE.code}`;
  navigator.clipboard?.writeText(link).then(() => toast('Invite link copied!'), () => toast(STATE.code));
  Sound.play('click');
};

function renderLobby() {
  $('#room-code').textContent = STATE.code;
  $('#player-count').textContent = STATE.players.length;
  const list = $('#lobby-list'); list.innerHTML = '';
  for (const p of STATE.players) {
    const li = document.createElement('li');
    const tags = [];
    if (p.id === STATE.hostId) tags.push('host');
    if (p.isBot) tags.push('bot');
    if (p.id === STATE.you) tags.push('you');
    li.innerHTML = `<span class="pav">${p.avatar}</span>
      <span class="pname">${esc(p.name)}</span>
      <span class="ptag">${tags.join(' · ')}</span>`;
    if (p.isBot && STATE.isHost) {
      const rm = document.createElement('button');
      rm.className = 'mini-btn'; rm.textContent = '✕'; rm.title = 'Remove bot';
      rm.onclick = () => socket.emit('removeBot', p.id);
      li.appendChild(rm);
    }
    list.appendChild(li);
  }
  buildRulesBox();
  $('#start-game').style.display = STATE.isHost ? '' : 'none';
  $('#add-bot').style.display = STATE.isHost ? '' : 'none';
  $('#lobby-hint').textContent = STATE.isHost
    ? 'Share the code/link with friends, add bots, then Start.'
    : 'Waiting for the host to start…';
}

// ===================== GAME =====================
function renderGame() {
  const s = STATE;
  $('#spectator-tag').classList.toggle('hidden', !isSpectator());

  // direction + colour + turn
  $('#dir-indicator').classList.toggle('rev', s.direction === -1);
  const dot = $('#color-indicator');
  dot.style.background = s.currentColor ? `var(--card-${s.currentColor})` : '#555';
  dot.style.color = s.currentColor ? `var(--card-${s.currentColor})` : '#555';

  const curName = playerName(s.currentPlayerId);
  const banner = $('#turn-banner');
  if (s.isYourTurn) { banner.textContent = '🎯 Your turn!'; banner.classList.add('your-turn'); }
  else { banner.textContent = `${curName}'s turn`; banner.classList.remove('your-turn'); }

  // draw stack badge
  const dsb = $('#draw-stack-badge');
  dsb.classList.toggle('hidden', !(s.drawStack > 0));
  dsb.textContent = '+' + s.drawStack;

  renderOpponents();
  renderTableCenter();
  renderHand();
}

function renderOpponents() {
  const wrap = $('#opponents'); wrap.innerHTML = '';
  const others = STATE.players.filter((p) => p.id !== STATE.you);
  for (const p of others) {
    const el = document.createElement('div');
    el.className = 'opp' + (p.id === STATE.currentPlayerId ? ' active' : '') + (p.connected ? '' : ' offline');
    const backs = Array.from({ length: Math.min(p.handCount, 7) }, () => '<span class="mini-card"></span>').join('');
    el.innerHTML = `${p.calledUno && p.handCount === 1 ? '<span class="uno-flag">UNO</span>' : ''}
      <span class="oav">${p.avatar}</span>
      <span class="oname">${esc(p.name)}${p.connected ? '' : ' 💤'}</span>
      <span class="ocards">${backs}</span>
      <span class="ocount">${p.handCount} cards · ${p.score}pts</span>`;
    wrap.appendChild(el);
  }
}

function renderTableCenter() {
  const dp = $('#discard-pile'); dp.innerHTML = '';
  if (STATE.topCard) {
    const top = renderCard(STATE.topCard);
    // recolour wild top to the chosen colour border
    if (STATE.topCard.color === 'wild' && STATE.currentColor) {
      top.style.boxShadow = `0 0 26px var(--card-${STATE.currentColor}),0 8px 22px rgba(0,0,0,.5)`;
    }
    dp.appendChild(top);
  }
  $('#deck-count').textContent = STATE.deckCount;
  $('#deck-pile').classList.toggle('drawable', STATE.isYourTurn);
}

function renderHand() {
  const hand = $('#hand');
  if (isSpectator()) { hand.innerHTML = '<div class="muted">👁 Spectating — you\'ll join the next round.</div>';
    $('.hand-actions').style.display = 'none'; $('#you-tag').textContent = ''; return; }
  $('.hand-actions').style.display = '';
  const playableSet = new Set(STATE.playable || []);
  const myTurn = STATE.isYourTurn;
  const newIds = STATE.yourHand.map((c) => c.id);
  hand.innerHTML = '';
  STATE.yourHand.forEach((c) => {
    const playable = myTurn && playableSet.has(c.id);
    const el = renderCard(c, { playable, disabled: myTurn && !playable });
    if (!prevHandIds.includes(c.id)) el.classList.add('deal-in');
    el.onclick = () => onCardClick(c, playable);
    hand.appendChild(el);
  });
  prevHandIds = newIds;

  if (!myTurn) justDrew = false;            // reset once the turn leaves us
  $('#you-tag').textContent = `${profile.avatar} You — ${STATE.yourHand.length} cards`;
  const canDraw = myTurn && !STATE.needColor && !justDrew;
  $('#btn-draw').disabled = !canDraw;
  $('#btn-draw').style.opacity = canDraw ? 1 : .4;
  // After drawing, you may end your turn (play the drawn card or pass).
  $('#btn-pass').classList.toggle('hidden', !(myTurn && justDrew));
  $('#btn-uno').classList.toggle('hidden', STATE.yourHand.length > 2);
}

function onCardClick(card, playable) {
  if (!STATE.isYourTurn) return toast("It's not your turn yet.");
  if (!playable) { Sound.play('error'); toast("That card can't be played now."); return; }
  if (card.color === 'wild') { pendingWild = card; openColorPicker(); return; }
  socket.emit('playCard', { cardId: card.id });
}

let pendingWild = null;
function openColorPicker() { $('#color-picker').classList.remove('hidden'); }
$$('#color-picker .swatch').forEach((b) => b.onclick = () => {
  $('#color-picker').classList.add('hidden');
  Sound.play('click');
  if (pendingWild) { socket.emit('playCard', { cardId: pendingWild.id, color: b.dataset.c }); pendingWild = null; }
  else if (STATE.needColor) socket.emit('chooseColor', b.dataset.c);
});

$('#btn-draw').onclick = () => { if (STATE?.isYourTurn && !justDrew) { justDrew = true; Sound.play('click'); socket.emit('drawCard'); } };
$('#deck-pile').onclick = () => { if (STATE?.isYourTurn && !STATE.needColor && !justDrew) { justDrew = true; socket.emit('drawCard'); } };
$('#btn-pass').onclick = () => { justDrew = false; Sound.play('click'); socket.emit('passTurn'); };
$('#btn-uno').onclick = () => { Sound.play('uno'); socket.emit('callUno'); announce('UNO!', 'var(--danger)'); };

// emoji reactions
$$('#emoji-bar button').forEach((b) => b.onclick = () => {
  socket.emit('emoji', b.dataset.e); Sound.play('emoji');
});

// ===================== SCORE =====================
function renderScore() {
  const over = STATE.phase === 'gameOver';
  $('#score-title').textContent = over ? '🏆 Game Over' : 'Round Over';
  const ranked = [...STATE.players].sort((a, b) => b.score - a.score);
  const winner = STATE.players.find((p) => p.id === STATE.winnerId);
  const champ = over ? ranked[0] : winner;
  $('#winner-badge').innerHTML = champ
    ? `<span class="crown">👑</span>${esc(champ.name)} ${over ? 'wins the game!' : 'won the round!'}`
    : '';
  const body = $('#score-body'); body.innerHTML = '';
  ranked.forEach((p, i) => {
    const tr = document.createElement('tr');
    if (p.id === STATE.winnerId) tr.className = 'win';
    tr.innerHTML = `<td>${i + 1}</td><td>${p.avatar} ${esc(p.name)}</td>
      <td>${p.id === STATE.winnerId ? '+' + (p.score) : ''}</td>
      <td>${p.score}</td><td>${p.wins}</td>`;
    body.appendChild(tr);
  });
  $('#next-round').style.display = STATE.isHost ? '' : 'none';
  $('#next-round').textContent = over ? 'Play Again' : 'Next Round';
  $('#score-hint').textContent = STATE.isHost ? '' : 'Waiting for host to continue…';
}
$('#next-round').onclick = () => { Sound.play('click'); socket.emit('nextRound'); };

// ===================== SOCKET EVENTS =====================
socket.on('state', (s) => {
  const prevPhase = STATE?.phase;
  STATE = s;
  // route to the right screen
  if (s.phase === 'lobby') { if (!isGameScreen()) show('screen-lobby'); renderLobby(); }
  else if (s.phase === 'playing') {
    if (prevPhase !== 'playing') prevHandIds = []; // fresh deal animation
    show('screen-game'); renderGame();
  }
  else if (s.phase === 'roundOver' || s.phase === 'gameOver') { renderScore(); show('screen-score'); }
  handleAction(s);
});

socket.on('toast', toast);
socket.on('chat', addChat);
socket.on('emoji', floatEmoji);
socket.on('connect_error', () => toast('Connection issue — retrying…'));
socket.on('disconnect', () => toast('Disconnected from server'));

function isGameScreen() { return $('#screen-game').classList.contains('active'); }
function isSpectator() { return STATE?.spectators?.some((x) => x.id === STATE.you); }

// sound + announce for the latest action
function handleAction(s) {
  if (!s.lastAction || s.lastAction.seq <= lastSeq) return;
  lastSeq = s.lastAction.seq;
  const a = s.lastAction;
  Sound.action(a.type);
  const byName = playerName(a.by);
  const map = {
    skip: () => announce('SKIP! ⊘', 'var(--card-yellow)'),
    reverse: () => announce('REVERSE ⇄', 'var(--card-green)'),
    draw2: () => a.targets && announce(`+${a.drew || 2}!`, 'var(--card-red)'),
    wild4: () => announce('WILD +4!', 'var(--accent)'),
    wild: () => {},
    uno: () => announce('UNO!', 'var(--danger)'),
    roundOver: () => { announce('🎉 ' + byName + ' wins!', 'var(--accent2)'); Sound.play(a.by === s.you ? 'win' : 'lose'); }
  };
  (map[a.type] || (() => {}))();
}

// ===================== CHAT =====================
let chatUnread = 0;
$('#chat-toggle').onclick = () => {
  const p = $('#chat-panel'); p.classList.toggle('open');
  if (p.classList.contains('open')) { chatUnread = 0; $('#chat-badge').classList.add('hidden'); $('#chat-input').focus(); }
};
$('#chat-close').onclick = () => $('#chat-panel').classList.remove('open');
$('#chat-form').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chat-input').value.trim();
  if (v) socket.emit('chat', v);
  $('#chat-input').value = '';
};
function addChat(m) {
  const log = $('#chat-log');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (m.system ? ' sys' : '');
  div.innerHTML = m.system ? esc(m.text)
    : `<span class="who">${m.avatar || ''} ${esc(m.name)}:</span> ${esc(m.text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  if (!$('#chat-panel').classList.contains('open') && !m.system) {
    chatUnread++; const b = $('#chat-badge'); b.textContent = chatUnread; b.classList.remove('hidden');
  }
}

// ===================== EMOJI FLOAT =====================
function floatEmoji({ emoji }) {
  const layer = $('#emoji-layer');
  const e = document.createElement('div');
  e.className = 'float-emoji'; e.textContent = emoji;
  e.style.left = (20 + Math.random() * 60) + '%';
  e.style.bottom = (20 + Math.random() * 20) + '%';
  layer.appendChild(e);
  setTimeout(() => e.remove(), 2200);
}

// ===================== SETTINGS / THEME / AVATAR =====================
$('#home-settings').onclick = $('#game-settings').onclick = () => $('#settings-modal').classList.remove('hidden');
$('#settings-close').onclick = () => $('#settings-modal').classList.add('hidden');
$('#set-sfx').onchange = (e) => Sound.setSfx(e.target.checked);
$('#set-music').onchange = (e) => { Sound.setMusic(e.target.checked); };
$('#set-vol').oninput = (e) => Sound.setVolume(+e.target.value);

function buildThemeGrid() {
  const grid = $('#theme-grid'); grid.innerHTML = '';
  for (const [key, t] of Object.entries(THEMES)) {
    const chip = document.createElement('div');
    chip.className = 'theme-chip' + (key === profile.theme ? ' sel' : '');
    chip.innerHTML = `<div class="dots">
      <span style="background:${t.colors.red}"></span><span style="background:${t.colors.yellow}"></span>
      <span style="background:${t.colors.green}"></span><span style="background:${t.colors.blue}"></span>
      </div>${t.label}`;
    chip.onclick = () => {
      profile.theme = key; localStorage.setItem('uno_theme', key); applyTheme(key);
      Sound.play('click'); buildThemeGrid();
      if (STATE && STATE.phase === 'playing') renderGame();
    };
    grid.appendChild(chip);
  }
}
function buildAvatarGrid() {
  const list = ['🦊','🐼','🐸','🦁','🐧','🐙','🦄','🐲','🦉','🐯','🐵','🐺','🐱','🐰','🐨','🦈','👾','🤖'];
  const grid = $('#avatar-grid'); grid.innerHTML = '';
  list.forEach((a) => {
    const b = document.createElement('button'); b.textContent = a;
    b.onclick = () => { profile.avatar = a; $('#avatar-pick').textContent = a; localStorage.setItem('uno_avatar', a);
      $('#avatar-modal').classList.add('hidden'); saveProfile(); Sound.play('click'); };
    grid.appendChild(b);
  });
}
$('#avatar-pick').onclick = () => $('#avatar-modal').classList.remove('hidden');
$('#avatar-close').onclick = () => $('#avatar-modal').classList.add('hidden');

// ===================== utils =====================
function playerName(id) {
  if (id === STATE?.you) return 'You';
  const p = STATE?.players.find((x) => x.id === id);
  return p ? p.name : '…';
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
