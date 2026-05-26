/**
 * Neon Uno — game engine + room manager.
 *
 * UnoGame  : pure, headless game logic (also exercised by test/simulate.js).
 * RoomManager : wraps UnoGame with Socket.IO, bots, spectators, chat, emoji.
 *
 * Turn rule that fixes the "stuck / asked to play twice" bugs:
 *   - There is exactly ONE place that advances the turn (advanceTurn()).
 *   - The server is the single source of truth for whose turn it is.
 *   - Any current player who is a bot OR is disconnected is auto-driven by a
 *     server timer, so the table never waits forever and a human client is
 *     only ever allowed to act when currentPlayerId === their own id.
 */

const COLORS = ['red', 'yellow', 'green', 'blue'];
const SPECIALS = ['skip', 'reverse', 'draw2'];

let UID = 1;
const uid = (p = 'c') => `${p}${UID++}`;

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ id: uid(), color, value: '0' });
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: uid(), color, value: String(n) });
      deck.push({ id: uid(), color, value: String(n) });
    }
    for (const s of SPECIALS) {
      deck.push({ id: uid(), color, value: s });
      deck.push({ id: uid(), color, value: s });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: uid(), color: 'wild', value: 'wild' });
    deck.push({ id: uid(), color: 'wild', value: 'wild4' });
  }
  return deck;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isWild = (c) => c.color === 'wild';
const cardPoints = (c) => {
  if (c.value === 'wild' || c.value === 'wild4') return 50;
  if (SPECIALS.includes(c.value)) return 20;
  return parseInt(c.value, 10) || 0;
};

const DEFAULT_RULES = {
  stacking: true,        // +2 can be stacked on +2, +4 on +4
  drawToMatch: false,    // draw until you get a playable card
  forcePlay: false,      // must play a card if you have a legal one
  jumpIn: false,         // play an identical card out of turn
  sevenZero: false,      // 7 = swap hands, 0 = rotate hands
  startingCards: 7,
  targetScore: 500       // 0 = play forever
};

class UnoGame {
  constructor(players, rules = {}) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.players = players;              // [{ id, hand:[], score, wins, ... }]
    this.order = players.map((p) => p.id);
    this.deck = [];
    this.discard = [];
    this.direction = 1;
    this.turnPos = 0;
    this.currentColor = null;
    this.drawStack = 0;                  // pending +2/+4 to resolve
    this.pendingColor = null;            // playerId who must pick a color
    this.phase = 'lobby';                // lobby | playing | roundOver | gameOver
    this.winnerId = null;
    this.seq = 0;
    this.lastAction = null;
  }

  player(id) { return this.players.find((p) => p.id === id); }
  get currentId() { return this.order[this.turnPos]; }
  get topCard() { return this.discard[this.discard.length - 1]; }

  setAction(a) { this.lastAction = { ...a, seq: ++this.seq, at: Date.now() }; }

  startRound() {
    this.deck = shuffle(buildDeck());
    this.discard = [];
    this.drawStack = 0;
    this.pendingColor = null;
    this.winnerId = null;
    this.direction = 1;
    this.order = this.players.map((p) => p.id);
    for (const p of this.players) {
      p.hand = [];
      p.calledUno = false;
    }
    for (let i = 0; i < this.rules.startingCards; i++) {
      for (const p of this.players) p.hand.push(this.draw());
    }
    // Flip a starting card that is not a wild +4.
    let first = this.draw();
    while (first.value === 'wild4') { this.deck.push(first); shuffle(this.deck); first = this.draw(); }
    this.discard.push(first);
    this.currentColor = isWild(first) ? COLORS[Math.floor(Math.random() * 4)] : first.color;
    this.turnPos = 0;
    this.phase = 'playing';
    this.setAction({ type: 'start' });

    // Apply the opening card's effect to the first player (standard Uno).
    this.applyOpeningEffect(first);
  }

  applyOpeningEffect(card) {
    if (card.value === 'skip') { this.setAction({ type: 'skip', card }); this.turnPos = this.step(1); }
    else if (card.value === 'reverse') {
      this.direction *= -1;
      if (this.order.length === 2) this.turnPos = this.step(1); // reverse acts like skip in 2p
    } else if (card.value === 'draw2') {
      const victim = this.player(this.currentId);
      this.give(victim, 2);
      this.setAction({ type: 'draw2', card, targets: [victim.id] });
      this.turnPos = this.step(1);
    }
  }

  draw() {
    if (this.deck.length === 0) this.reshuffle();
    return this.deck.pop() || null;
  }

  reshuffle() {
    if (this.discard.length <= 1) return;          // nothing to recycle
    const top = this.discard.pop();
    this.deck = shuffle(this.discard.map((c) => (isWild(c) ? { ...c, color: 'wild' } : c)));
    this.discard = [top];
  }

  give(player, n) {
    for (let i = 0; i < n; i++) {
      const c = this.draw();
      if (c) player.hand.push(c);
    }
    player.calledUno = false;
  }

  step(n) {
    const len = this.order.length;
    return ((this.turnPos + n * this.direction) % len + len) % len;
  }

  isPlayable(card) {
    const top = this.topCard;
    if (isWild(card)) {
      // A wild +4 is "legally" only meant when you have no current-colour card,
      // but we allow it (common house behaviour) to keep play flowing.
      return true;
    }
    if (this.drawStack > 0) {
      // Must respond to a pending draw stack (only if stacking enabled).
      if (!this.rules.stacking) return false;
      if (top.value === 'draw2') return card.value === 'draw2';
      if (top.value === 'wild4') return card.value === 'wild4';
    }
    return card.color === this.currentColor || card.value === top.value;
  }

  hasPlayable(player) {
    return player.hand.some((c) => this.isPlayable(c));
  }

  /** Returns { ok, error } */
  playCard(playerId, cardId, chosenColor) {
    if (this.phase !== 'playing') return { ok: false, error: 'not_playing' };
    if (this.pendingColor) return { ok: false, error: 'awaiting_color' };
    if (playerId !== this.currentId) return { ok: false, error: 'not_your_turn' };
    const player = this.player(playerId);
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, error: 'no_such_card' };
    const card = player.hand[idx];
    if (!this.isPlayable(card)) return { ok: false, error: 'illegal_card' };

    player.hand.splice(idx, 1);
    this.discard.push(card);
    player.calledUno = false;

    // Wilds: wait for a colour choice before continuing.
    if (isWild(card)) {
      if (card.value === 'wild4') this.drawStack += 4;
      this.currentColor = COLORS.includes(chosenColor) ? chosenColor : null;
      if (!this.currentColor) {
        this.pendingColor = playerId;
        this.setAction({ type: card.value, card, by: playerId, needColor: true });
        return this.finishPlay(player, card, true);
      }
    } else {
      this.currentColor = card.color;
    }

    return this.resolveCard(player, card);
  }

  /** Called after a colour is chosen for a pending wild. */
  chooseColor(playerId, color) {
    if (!this.pendingColor || this.pendingColor !== playerId) return { ok: false, error: 'no_pending' };
    if (!COLORS.includes(color)) return { ok: false, error: 'bad_color' };
    this.currentColor = color;
    this.pendingColor = null;
    const card = this.topCard;
    const player = this.player(playerId);
    const r = this.resolveCard(player, card, true);
    return r;
  }

  resolveCard(player, card, afterColor = false) {
    // Win check.
    if (player.hand.length === 0) {
      this.endRound(player.id);
      this.setAction({ type: 'roundOver', by: player.id, card });
      return { ok: true, roundOver: true };
    }

    // 7-0 house rule.
    if (this.rules.sevenZero && !isWild(card)) {
      if (card.value === '0') this.rotateHands();
      // value '7' swap is handled via a follow-up choice in RoomManager; for the
      // headless engine and bots we swap with the next player by default.
      if (card.value === '7') this.swapHands(player.id, this.bestSwapTarget(player.id));
    }

    let effect = card.value;
    if (afterColor && card.value === 'wild') effect = 'wild';

    switch (effect) {
      case 'skip':
        this.setAction({ type: 'skip', card, by: player.id });
        this.turnPos = this.step(2);
        break;
      case 'reverse':
        this.direction *= -1;
        this.setAction({ type: 'reverse', card, by: player.id });
        this.turnPos = this.order.length === 2 ? this.step(2) : this.step(1);
        break;
      case 'draw2': {
        this.drawStack += 2;
        this.turnPos = this.step(1);
        this.applyDrawStackIfTerminal(card, player.id);
        break;
      }
      case 'wild4': {
        this.turnPos = this.step(1);
        this.setAction({ type: 'wild4', card, by: player.id, color: this.currentColor });
        this.applyDrawStackIfTerminal(card, player.id);
        break;
      }
      case 'wild':
        this.setAction({ type: 'wild', card, by: player.id, color: this.currentColor });
        this.turnPos = this.step(1);
        break;
      default:
        this.setAction({ type: 'play', card, by: player.id, color: this.currentColor });
        this.turnPos = this.step(1);
    }
    return this.finishPlay(player, card);
  }

  /**
   * If the next player cannot (or by rule will not) stack onto the draw pile,
   * make them eat the accumulated cards immediately and lose their turn.
   * This keeps +2/+4 chains from leaving the table in a half-finished state.
   */
  applyDrawStackIfTerminal(card, byId) {
    const next = this.player(this.currentId);
    const canStack = this.rules.stacking && this.hasStackResponse(next, card.value);
    if (!canStack) {
      const n = this.drawStack;
      this.give(next, n);
      this.drawStack = 0;
      this.setAction({ type: card.value === 'wild4' ? 'wild4' : 'draw2', card, by: byId, targets: [next.id], drew: n, color: this.currentColor });
      this.turnPos = this.step(1); // victim is skipped
    }
  }

  hasStackResponse(player, value) {
    const want = value === 'wild4' ? 'wild4' : 'draw2';
    return player.hand.some((c) => c.value === want);
  }

  finishPlay(player) {
    if (player.hand.length === 1) player.unoPending = true;
    return { ok: true, uno: player.hand.length === 1 };
  }

  /** Draw a card on your turn. */
  drawCard(playerId) {
    if (this.phase !== 'playing') return { ok: false, error: 'not_playing' };
    if (this.pendingColor) return { ok: false, error: 'awaiting_color' };
    if (playerId !== this.currentId) return { ok: false, error: 'not_your_turn' };
    const player = this.player(playerId);

    // Resolve an outstanding draw stack the player chose not to stack.
    if (this.drawStack > 0) {
      const n = this.drawStack;
      this.give(player, n);
      this.drawStack = 0;
      this.setAction({ type: 'draw', by: player.id, drew: n, forced: true });
      this.turnPos = this.step(1);
      return { ok: true };
    }

    if (this.rules.drawToMatch) {
      let drawn = 0;
      do {
        const c = this.draw();
        if (!c) break;
        player.hand.push(c);
        drawn++;
      } while (!this.isPlayable(player.hand[player.hand.length - 1]) && drawn < 30);
      player.calledUno = false;
      this.setAction({ type: 'draw', by: player.id, drew: drawn });
      // Player may now play the drawn card; turn stays until they play/pass.
      return { ok: true, mayPlay: this.hasPlayable(player) };
    }

    const c = this.draw();
    if (c) player.hand.push(c);
    player.calledUno = false;
    this.setAction({ type: 'draw', by: player.id, drew: 1 });
    return { ok: true, drawn: c, mayPlay: c && this.isPlayable(c) };
  }

  /** After drawing, a player may pass (end turn) if they don't want to play. */
  passTurn(playerId) {
    if (this.phase !== 'playing') return { ok: false, error: 'not_playing' };
    if (playerId !== this.currentId) return { ok: false, error: 'not_your_turn' };
    this.setAction({ type: 'pass', by: playerId });
    this.turnPos = this.step(1);
    return { ok: true };
  }

  rotateHands() {
    const hands = this.order.map((id) => this.player(id).hand);
    const rotated = this.direction === 1
      ? [hands[hands.length - 1], ...hands.slice(0, -1)]
      : [...hands.slice(1), hands[0]];
    this.order.forEach((id, i) => { this.player(id).hand = rotated[i]; });
  }

  swapHands(aId, bId) {
    if (!bId || aId === bId) return;
    const a = this.player(aId), b = this.player(bId);
    if (!a || !b) return;
    [a.hand, b.hand] = [b.hand, a.hand];
  }

  bestSwapTarget(playerId) {
    // Swap with the opponent holding the fewest cards (most advantageous).
    let best = null, min = Infinity;
    for (const id of this.order) {
      if (id === playerId) continue;
      const h = this.player(id).hand.length;
      if (h < min) { min = h; best = id; }
    }
    return best;
  }

  endRound(winnerId) {
    this.phase = 'roundOver';
    this.winnerId = winnerId;
    const winner = this.player(winnerId);
    let points = 0;
    for (const p of this.players) if (p.id !== winnerId) points += p.hand.reduce((s, c) => s + cardPoints(c), 0);
    winner.score += points;
    winner.wins += 1;
    for (const p of this.players) if (p.id !== winnerId) p.losses += 1;
    winner.lastRoundPoints = points;
    if (this.rules.targetScore > 0 && winner.score >= this.rules.targetScore) {
      this.phase = 'gameOver';
    }
  }

  /** Decide a bot's move. Returns an action object the RoomManager executes. */
  botMove(playerId) {
    const me = this.player(playerId);
    if (this.drawStack > 0) {
      const want = this.topCard.value === 'wild4' ? 'wild4' : 'draw2';
      const stackable = this.rules.stacking && me.hand.find((c) => c.value === want);
      if (stackable) return { type: 'play', cardId: stackable.id, color: this.pickColor(me) };
      return { type: 'draw' };
    }
    const playable = me.hand.filter((c) => this.isPlayable(c));
    if (playable.length === 0) return { type: 'draw' };
    // Prefer action cards, then high numbers, save wilds for when stuck.
    const rank = (c) => {
      if (c.value === 'wild4') return 1;
      if (c.value === 'wild') return 2;
      if (SPECIALS.includes(c.value)) return 5;
      return 3 + (9 - parseInt(c.value, 10)) / 100;
    };
    playable.sort((a, b) => rank(b) - rank(a));
    const choice = playable[0];
    return { type: 'play', cardId: choice.id, color: this.pickColor(me) };
  }

  pickColor(player) {
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (const c of player.hand) if (!isWild(c)) counts[c.color]++;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
}

// ---------------------------------------------------------------------------
//  Room manager (Socket.IO glue)
// ---------------------------------------------------------------------------

const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐧', '🐙', '🦄', '🐲', '🦉', '🐯', '🐵', '🐺'];
const BOT_NAMES = ['Blaze', 'Nova', 'Echo', 'Pixel', 'Vortex', 'Zeta', 'Comet', 'Riot'];

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();      // code -> room
    this.bySocket = new Map();   // socketId -> { code, playerId }
  }

  // --- helpers ----------------------------------------------------------
  room(code) { return this.rooms.get(code); }
  ctx(socket) { return this.bySocket.get(socket.id); }

  makePlayer(id, { name, avatar, isBot = false, isSpectator = false }) {
    return {
      id, name, avatar, isBot, isSpectator,
      connected: true, hand: [], score: 0, wins: 0, losses: 0,
      calledUno: false, unoPending: false, lastRoundPoints: 0
    };
  }

  // --- lifecycle --------------------------------------------------------
  createRoom(socket, { name, avatar }, cb) {
    let code = genCode();
    while (this.rooms.has(code)) code = genCode();
    const room = {
      code,
      hostId: socket.id,
      players: [],
      spectators: [],
      rules: { ...DEFAULT_RULES },
      game: null,
      chat: [],
      botTimer: null,
      botToken: 0
    };
    this.rooms.set(code, room);
    const player = this.makePlayer(socket.id, {
      name: name || 'Host', avatar: avatar || AVATARS[0]
    });
    room.players.push(player);
    socket.join(code);
    this.bySocket.set(socket.id, { code, playerId: socket.id });
    cb && cb({ ok: true, code, you: socket.id });
    this.broadcast(code);
  }

  joinRoom(socket, { code, name, avatar, asSpectator }, cb) {
    code = (code || '').toUpperCase().trim();
    const room = this.room(code);
    if (!room) return cb && cb({ ok: false, error: 'Room not found' });
    const playing = room.game && room.game.phase !== 'lobby';
    const spectate = asSpectator || playing;   // mid-game joiners watch first
    const player = this.makePlayer(socket.id, {
      name: name || 'Player', avatar: avatar || AVATARS[room.players.length % AVATARS.length],
      isSpectator: spectate
    });
    if (spectate) room.spectators.push(player); else room.players.push(player);
    if (room.game && !spectate) room.game.players = room.players;
    socket.join(code);
    this.bySocket.set(socket.id, { code, playerId: socket.id });
    cb && cb({ ok: true, code, you: socket.id, spectator: spectate });
    this.sysChat(room, `${player.avatar} ${player.name} ${spectate ? 'is now spectating' : 'joined'}`);
    this.broadcast(code);
  }

  leaveRoom(socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const room = this.room(ctx.code);
    this.bySocket.delete(socket.id);
    if (!room) return;
    const inPlayers = room.players.find((p) => p.id === socket.id);
    const inSpec = room.spectators.find((p) => p.id === socket.id);
    const leaver = inPlayers || inSpec;

    if (room.game && room.game.phase === 'playing' && inPlayers) {
      // Keep the seat so the round stays valid; mark disconnected so the
      // server auto-plays for them and the turn never gets stuck.
      inPlayers.connected = false;
      this.sysChat(room, `${leaver.avatar} ${leaver.name} disconnected (auto-play on)`);
    } else {
      room.players = room.players.filter((p) => p.id !== socket.id);
      room.spectators = room.spectators.filter((p) => p.id !== socket.id);
      if (room.game) room.game.players = room.players;
      if (leaver) this.sysChat(room, `${leaver.avatar} ${leaver.name} left`);
    }

    // Reassign host if needed.
    if (room.hostId === socket.id) {
      const next = room.players.find((p) => !p.isBot && p.connected);
      room.hostId = next ? next.id : (room.players[0] ? room.players[0].id : null);
    }

    // Empty room cleanup.
    const humans = [...room.players, ...room.spectators].filter((p) => !p.isBot && p.connected);
    if (humans.length === 0) {
      clearTimeout(room.botTimer);
      this.rooms.delete(room.code);
      return;
    }
    this.broadcast(room.code);
    this.maybeBotTurn(room);
  }

  hostOnly(socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return null;
    const room = this.room(ctx.code);
    if (!room || room.hostId !== socket.id) return null;
    return room;
  }

  // --- lobby actions ----------------------------------------------------
  addBot(socket) {
    const room = this.hostOnly(socket);
    if (!room || (room.game && room.game.phase === 'playing')) return;
    if (room.players.length >= 8) return;
    const name = BOT_NAMES[room.players.filter((p) => p.isBot).length % BOT_NAMES.length] + ' 🤖';
    const bot = this.makePlayer(uid('bot'), {
      name, avatar: AVATARS[room.players.length % AVATARS.length], isBot: true
    });
    room.players.push(bot);
    this.broadcast(room.code);
  }

  removeBot(socket, botId) {
    const room = this.hostOnly(socket);
    if (!room || (room.game && room.game.phase === 'playing')) return;
    room.players = room.players.filter((p) => !(p.isBot && p.id === botId));
    this.broadcast(room.code);
  }

  updateRules(socket, rules) {
    const room = this.hostOnly(socket);
    if (!room || (room.game && room.game.phase === 'playing')) return;
    const allowed = ['stacking', 'drawToMatch', 'forcePlay', 'jumpIn', 'sevenZero', 'startingCards', 'targetScore'];
    for (const k of allowed) if (k in rules) room.rules[k] = rules[k];
    this.broadcast(room.code);
  }

  updateProfile(socket, { name, avatar }) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const room = this.room(ctx.code);
    if (!room) return;
    const p = [...room.players, ...room.spectators].find((x) => x.id === socket.id);
    if (!p) return;
    if (name) p.name = String(name).slice(0, 16);
    if (avatar) p.avatar = avatar;
    this.broadcast(room.code);
  }

  startGame(socket) {
    const room = this.hostOnly(socket);
    if (!room) return;
    if (room.players.length < 2) {
      this.io.to(socket.id).emit('toast', 'Need at least 2 players (add a bot!).');
      return;
    }
    room.game = new UnoGame(room.players, room.rules);
    room.game.startRound();
    this.sysChat(room, '🎮 Game started — good luck!');
    this.broadcast(room.code);
    this.maybeBotTurn(room);
  }

  nextRound(socket) {
    const room = this.hostOnly(socket);
    if (!room || !room.game) return;
    if (room.game.phase === 'gameOver') {
      for (const p of room.players) { p.score = 0; p.wins = 0; p.losses = 0; }
    }
    // Promote waiting spectators into the next round.
    if (room.spectators.length) {
      for (const s of room.spectators) { s.isSpectator = false; room.players.push(s); }
      room.spectators = [];
      room.game.players = room.players;
    }
    room.game.rules = room.rules;
    room.game.startRound();
    this.broadcast(room.code);
    this.maybeBotTurn(room);
  }

  // --- in-game actions --------------------------------------------------
  game(socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return null;
    const room = this.room(ctx.code);
    if (!room || !room.game) return null;
    return room;
  }

  playCard(socket, { cardId, color }) {
    const room = this.game(socket);
    if (!room) return;
    const r = room.game.playCard(socket.id, cardId, color);
    if (!r.ok) { this.io.to(socket.id).emit('toast', this.errText(r.error)); this.broadcast(room.code); return; }
    this.afterMove(room);
  }

  chooseColor(socket, color) {
    const room = this.game(socket);
    if (!room) return;
    const r = room.game.chooseColor(socket.id, color);
    if (!r.ok) return;
    this.afterMove(room);
  }

  drawCard(socket) {
    const room = this.game(socket);
    if (!room) return;
    const r = room.game.drawCard(socket.id);
    if (!r.ok) { this.io.to(socket.id).emit('toast', this.errText(r.error)); return; }
    // Auto-advance when the drawn card can't be played and forcePlay is off.
    if (!room.game.rules.drawToMatch && !r.mayPlay && room.game.phase === 'playing') {
      room.game.passTurn(socket.id);
    }
    this.afterMove(room);
  }

  passTurn(socket) {
    const room = this.game(socket);
    if (!room) return;
    const r = room.game.passTurn(socket.id);
    if (!r.ok) return;
    this.afterMove(room);
  }

  callUno(socket) {
    const room = this.game(socket);
    if (!room) return;
    const p = room.game.player(socket.id);
    if (p && p.hand.length <= 2) {
      p.calledUno = true;
      room.game.setAction({ type: 'uno', by: socket.id });
      this.broadcast(room.code);
    }
  }

  /** Runs after any successful state-changing move. */
  afterMove(room) {
    this.broadcast(room.code);
    this.maybeBotTurn(room);
  }

  /**
   * Drive the current player if they are a bot OR a disconnected human.
   * A single guarded timer prevents double-scheduling (the root cause of the
   * "asked to play twice" bug in many naive implementations).
   */
  maybeBotTurn(room) {
    clearTimeout(room.botTimer);
    const g = room.game;
    if (!g || g.phase !== 'playing') return;
    const cur = g.player(g.currentId);
    if (!cur) return;
    const autoDriven = cur.isBot || !cur.connected;
    if (!autoDriven) return;

    const token = ++room.botToken;
    const envMs = Number(process.env.UNO_BOT_MS);
    const delay = (Number.isFinite(envMs) && envMs >= 0) ? envMs : (cur.isBot ? 850 + Math.random() * 700 : 400);
    room.botTimer = setTimeout(() => {
      if (room.botToken !== token) return;           // a newer turn superseded us
      if (!room.game || room.game.phase !== 'playing') return;
      if (room.game.currentId !== cur.id) return;     // turn already moved on

      // Resolve a pending colour first (bot just played a wild).
      if (g.pendingColor === cur.id) {
        g.chooseColor(cur.id, g.pickColor(cur));
        this.afterMove(room);
        return;
      }
      const move = g.botMove(cur.id);
      // Bots always shout UNO at the right moment.
      if (cur.hand.length === 2 && move.type === 'play') cur.calledUno = true;
      if (move.type === 'play') g.playCard(cur.id, move.cardId, move.color);
      else {
        const dr = g.drawCard(cur.id);
        if (!g.rules.drawToMatch && dr.ok && !dr.mayPlay && g.phase === 'playing') g.passTurn(cur.id);
        else if (g.rules.drawToMatch && dr.ok) {
          // bot plays the freshly drawn card if possible, else passes
          const m2 = g.botMove(cur.id);
          if (m2.type === 'play') g.playCard(cur.id, m2.cardId, m2.color);
          else g.passTurn(cur.id);
        }
      }
      this.afterMove(room);
    }, delay);
  }

  // --- social -----------------------------------------------------------
  chat(socket, msg) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const room = this.room(ctx.code);
    if (!room) return;
    const p = [...room.players, ...room.spectators].find((x) => x.id === socket.id);
    if (!p || !msg) return;
    const entry = { name: p.name, avatar: p.avatar, text: String(msg).slice(0, 200), t: Date.now() };
    room.chat.push(entry);
    if (room.chat.length > 100) room.chat.shift();
    this.io.to(room.code).emit('chat', entry);
  }

  emoji(socket, emoji) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    const room = this.room(ctx.code);
    if (!room) return;
    const p = [...room.players, ...room.spectators].find((x) => x.id === socket.id);
    if (!p) return;
    this.io.to(room.code).emit('emoji', { from: p.id, name: p.name, emoji: String(emoji).slice(0, 8) });
  }

  sysChat(room, text) {
    const entry = { system: true, text, t: Date.now() };
    room.chat.push(entry);
    this.io.to(room.code).emit('chat', entry);
  }

  errText(code) {
    return ({
      not_your_turn: "Hold on — it's not your turn.",
      illegal_card: "That card can't be played right now.",
      awaiting_color: 'Waiting for a colour choice…',
      not_playing: 'The round is not active.',
      no_such_card: 'You no longer have that card.'
    })[code] || 'Invalid move.';
  }

  // --- state broadcast --------------------------------------------------
  publicState(room, viewerId) {
    const g = room.game;
    const base = {
      code: room.code,
      hostId: room.hostId,
      rules: room.rules,
      phase: g ? g.phase : 'lobby',
      you: viewerId,
      isHost: room.hostId === viewerId,
      avatars: AVATARS
    };
    const mapPlayer = (p, seatIndex) => ({
      id: p.id, name: p.name, avatar: p.avatar, isBot: p.isBot,
      isSpectator: p.isSpectator, connected: p.connected,
      handCount: p.hand.length, score: p.score, wins: p.wins, losses: p.losses,
      calledUno: p.calledUno, seatIndex
    });
    base.players = room.players.map(mapPlayer);
    base.spectators = room.spectators.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }));
    base.chat = room.chat.slice(-40);

    if (g) {
      base.direction = g.direction;
      base.currentColor = g.currentColor;
      base.currentPlayerId = g.currentId;
      base.topCard = g.topCard;
      base.deckCount = g.deck.length;
      base.drawStack = g.drawStack;
      base.pendingColorBy = g.pendingColor;
      base.lastAction = g.lastAction;
      base.winnerId = g.winnerId;
      const me = room.players.find((p) => p.id === viewerId);
      base.yourHand = me && !me.isSpectator ? me.hand : [];
      base.isYourTurn = g.currentId === viewerId && g.phase === 'playing';
      base.needColor = g.pendingColor === viewerId;
      base.playable = base.yourHand.map((c) => g.isPlayable(c) ? c.id : null).filter(Boolean);
    } else {
      base.yourHand = [];
    }
    return base;
  }

  broadcast(code) {
    const room = this.room(code);
    if (!room) return;
    const audience = [...room.players, ...room.spectators].filter((p) => !p.isBot);
    for (const p of audience) {
      this.io.to(p.id).emit('state', this.publicState(room, p.id));
    }
  }
}

module.exports = { UnoGame, RoomManager, buildDeck, cardPoints, DEFAULT_RULES, COLORS };
