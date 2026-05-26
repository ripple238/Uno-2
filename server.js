const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const COLORS = ["red", "yellow", "green", "blue"];
const RANKS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2"];
const SPECIAL_RANKS = new Set(["skip", "reverse", "draw2", "wild", "wild4"]);
const rooms = new Map();

function id(size = 12) {
  return crypto.randomBytes(size).toString("base64url");
}

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < 5; i += 1) value += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(value) ? roomCode() : value;
}

function makeDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push(card(color, "0"));
    for (const rank of RANKS.slice(1)) {
      deck.push(card(color, rank));
      deck.push(card(color, rank));
    }
  }
  for (let i = 0; i < 4; i += 1) {
    deck.push(card("wild", "wild"));
    deck.push(card("wild", "wild4"));
  }
  return shuffle(deck);
}

function card(color, rank) {
  return { id: id(8), color, rank };
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cardPoints(cardValue) {
  if (["skip", "reverse", "draw2"].includes(cardValue.rank)) return 20;
  if (["wild", "wild4"].includes(cardValue.rank)) return 50;
  return Number(cardValue.rank) || 0;
}

function visibleCard(cardValue) {
  return cardValue ? { id: cardValue.id, color: cardValue.color, rank: cardValue.rank } : null;
}

function createRoom(name) {
  const code = roomCode();
  const room = {
    code,
    createdAt: Date.now(),
    hostId: null,
    status: "lobby",
    theme: "neon",
    round: 0,
    targetScore: 250,
    players: [],
    spectators: [],
    deck: [],
    discard: [],
    currentColor: null,
    currentPlayerIndex: 0,
    direction: 1,
    pendingDraw: 0,
    turnStartedAt: Date.now(),
    log: [],
    lastEventId: 0,
    lastEvent: null,
    reactions: []
  };
  rooms.set(code, room);
  addPerson(room, name, false, true);
  return room;
}

function addPerson(room, name, spectator = false, host = false) {
  const player = {
    id: id(10),
    name: cleanName(name),
    type: "human",
    score: 0,
    hand: [],
    connectedAt: Date.now(),
    spectator
  };
  if (spectator) room.spectators.push(player);
  else room.players.push(player);
  if (host || !room.hostId) room.hostId = player.id;
  event(room, "join", `${player.name} joined ${spectator ? "as spectator" : "the table"}.`);
  return player;
}

function cleanName(name) {
  const value = String(name || "").trim().replace(/\s+/g, " ").slice(0, 18);
  return value || `Player ${Math.floor(Math.random() * 900 + 100)}`;
}

function publicState(room, viewerId) {
  const viewer = findPerson(room, viewerId);
  const active = room.players[room.currentPlayerIndex] || null;
  return {
    code: room.code,
    status: room.status,
    theme: room.theme,
    round: room.round,
    targetScore: room.targetScore,
    hostId: room.hostId,
    viewerId,
    viewerRole: viewer?.spectator ? "spectator" : "player",
    currentPlayerId: active?.id || null,
    currentPlayerName: active?.name || null,
    currentColor: room.currentColor,
    direction: room.direction,
    pendingDraw: room.pendingDraw,
    deckCount: room.deck.length,
    topCard: visibleCard(room.discard.at(-1)),
    lastEvent: room.lastEvent,
    reactions: room.reactions.filter((item) => Date.now() - item.at < 5000),
    players: room.players.map((player, index) => ({
      id: player.id,
      name: player.name,
      type: player.type,
      score: player.score,
      cardCount: player.hand.length,
      isHost: player.id === room.hostId,
      isCurrent: index === room.currentPlayerIndex,
      hand: player.id === viewerId ? player.hand.map(visibleCard) : undefined
    })),
    spectators: room.spectators.map((person) => ({
      id: person.id,
      name: person.name,
      isHost: person.id === room.hostId
    })),
    log: room.log.slice(-16)
  };
}

function findPerson(room, personId) {
  return room.players.find((player) => player.id === personId) || room.spectators.find((person) => person.id === personId);
}

function findPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function startRound(room) {
  if (room.players.length < 2) throw httpError(400, "Need at least two players or bots.");
  room.round += 1;
  room.status = "playing";
  room.deck = makeDeck();
  room.discard = [];
  room.direction = 1;
  room.pendingDraw = 0;
  room.currentPlayerIndex = Math.floor(Math.random() * room.players.length);
  for (const player of room.players) player.hand = [];
  for (let i = 0; i < 7; i += 1) {
    for (const player of room.players) player.hand.push(drawOne(room));
  }
  let first = drawOne(room);
  while (first.color === "wild" || SPECIAL_RANKS.has(first.rank)) {
    room.deck.unshift(first);
    room.deck = shuffle(room.deck);
    first = drawOne(room);
  }
  room.discard.push(first);
  room.currentColor = first.color;
  room.turnStartedAt = Date.now();
  event(room, "round", `Round ${room.round} started.`);
  scheduleBots(room);
}

function drawOne(room) {
  if (!room.deck.length) recycleDiscard(room);
  const next = room.deck.pop();
  if (!next) throw httpError(409, "No cards left to draw.");
  return next;
}

function recycleDiscard(room) {
  const top = room.discard.pop();
  room.deck = shuffle(room.discard.map((item) => ({ ...item, id: id(8) })));
  room.discard = top ? [top] : [];
}

function canPlay(cardValue, room) {
  const top = room.discard.at(-1);
  if (!top) return true;
  if (cardValue.color === "wild") return true;
  return cardValue.color === room.currentColor || cardValue.rank === top.rank;
}

function playCard(room, playerId, cardId, chosenColor) {
  if (room.status !== "playing") throw httpError(409, "The round is not active.");
  const player = room.players[room.currentPlayerIndex];
  if (!player || player.id !== playerId) throw httpError(403, "It is not your turn.");
  const index = player.hand.findIndex((item) => item.id === cardId);
  if (index < 0) throw httpError(404, "That card is not in your hand.");
  const selected = player.hand[index];
  if (room.pendingDraw && !["draw2", "wild4"].includes(selected.rank)) {
    throw httpError(409, `Draw ${room.pendingDraw} before playing.`);
  }
  if (!canPlay(selected, room)) throw httpError(409, "That card does not match.");
  if (selected.color === "wild" && !COLORS.includes(chosenColor)) throw httpError(400, "Choose a color for the wild card.");

  player.hand.splice(index, 1);
  room.discard.push(selected);
  room.currentColor = selected.color === "wild" ? chosenColor : selected.color;
  event(room, SPECIAL_RANKS.has(selected.rank) ? "special" : "play", `${player.name} played ${labelCard(selected)}.`);
  applyCardEffect(room, selected);

  if (player.hand.length === 1) event(room, "uno", `${player.name} has UNO.`);
  if (player.hand.length === 0) {
    endRound(room, player);
  } else {
    room.turnStartedAt = Date.now();
    scheduleBots(room);
  }
}

function applyCardEffect(room, played) {
  if (played.rank === "reverse") {
    room.direction *= -1;
    if (room.players.length === 2) advance(room, 2);
    else advance(room, 1);
    return;
  }
  if (played.rank === "skip") {
    advance(room, 2);
    return;
  }
  if (played.rank === "draw2") {
    room.pendingDraw += 2;
    advance(room, 1);
    return;
  }
  if (played.rank === "wild4") {
    room.pendingDraw += 4;
    advance(room, 1);
    return;
  }
  advance(room, 1);
}

function advance(room, steps) {
  const length = room.players.length;
  room.currentPlayerIndex = ((room.currentPlayerIndex + steps * room.direction) % length + length) % length;
}

function drawForTurn(room, playerId) {
  if (room.status !== "playing") throw httpError(409, "The round is not active.");
  const player = room.players[room.currentPlayerIndex];
  if (!player || player.id !== playerId) throw httpError(403, "It is not your turn.");
  const count = room.pendingDraw || 1;
  for (let i = 0; i < count; i += 1) player.hand.push(drawOne(room));
  const message = room.pendingDraw ? `${player.name} drew ${count} penalty cards.` : `${player.name} drew a card.`;
  room.pendingDraw = 0;
  event(room, "draw", message);
  advance(room, 1);
  room.turnStartedAt = Date.now();
  scheduleBots(room);
}

function endRound(room, winner) {
  const points = room.players.reduce((sum, player) => {
    if (player.id === winner.id) return sum;
    return sum + player.hand.reduce((subtotal, item) => subtotal + cardPoints(item), 0);
  }, 0);
  winner.score += points;
  room.status = "roundOver";
  event(room, "win", `${winner.name} won the round and gained ${points} points.`);
  if (winner.score >= room.targetScore) {
    room.status = "gameOver";
    event(room, "game", `${winner.name} won the game.`);
  }
}

function addBot(room) {
  if (room.status !== "lobby") throw httpError(409, "Bots can only be added in the lobby.");
  if (room.players.length >= 8) throw httpError(409, "The table is full.");
  const names = ["Nova", "Pixel", "Juno", "Echo", "Blitz", "Mango"];
  const bot = {
    id: id(10),
    name: names[Math.floor(Math.random() * names.length)],
    type: "bot",
    score: 0,
    hand: [],
    connectedAt: Date.now(),
    spectator: false
  };
  room.players.push(bot);
  event(room, "join", `${bot.name} bot joined for practice.`);
  return bot;
}

function botMove(room) {
  if (room.status !== "playing") return;
  const bot = room.players[room.currentPlayerIndex];
  if (!bot || bot.type !== "bot") return;
  const playable = bot.hand.find((item) => {
    if (room.pendingDraw && !["draw2", "wild4"].includes(item.rank)) return false;
    return canPlay(item, room);
  });
  if (playable) {
    const color = playable.color === "wild" ? bestColor(bot.hand) : undefined;
    playCard(room, bot.id, playable.id, color);
  } else {
    drawForTurn(room, bot.id);
  }
}

function bestColor(hand) {
  const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
  for (const item of hand) if (counts[item.color] !== undefined) counts[item.color] += 1;
  return COLORS.sort((a, b) => counts[b] - counts[a])[0];
}

function scheduleBots(room) {
  const bot = room.players[room.currentPlayerIndex];
  if (room.status === "playing" && bot?.type === "bot") {
    setTimeout(() => {
      const latest = rooms.get(room.code);
      if (latest) botMove(latest);
    }, 900 + Math.floor(Math.random() * 900));
  }
}

function event(room, type, message) {
  room.lastEvent = { id: ++room.lastEventId, type, message, at: Date.now() };
  room.log.push(room.lastEvent);
  if (room.log.length > 60) room.log.shift();
}

function labelCard(cardValue) {
  const rank = cardValue.rank.replace("draw2", "+2").replace("wild4", "+4");
  return cardValue.color === "wild" ? rank.toUpperCase() : `${cardValue.color} ${rank}`.toUpperCase();
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw httpError(404, "Room not found.");
  return room;
}

async function api(req, res, pathname) {
  const body = await readJson(req);
  if (req.method === "POST" && pathname === "/api/rooms") {
    const room = createRoom(body.name);
    return send(res, 200, { room: publicState(room, room.hostId), playerId: room.hostId });
  }
  if (req.method === "POST" && pathname.match(/^\/api\/rooms\/[^/]+\/join$/)) {
    const room = getRoom(pathname.split("/")[3]);
    if (!body.spectator && room.players.length >= 8) throw httpError(409, "The table is full.");
    if (!body.spectator && room.status !== "lobby") throw httpError(409, "Join as spectator while a round is active.");
    const person = addPerson(room, body.name, Boolean(body.spectator));
    return send(res, 200, { room: publicState(room, person.id), playerId: person.id });
  }
  if (req.method === "GET" && pathname.match(/^\/api\/rooms\/[^/]+$/)) {
    const room = getRoom(pathname.split("/")[3]);
    return send(res, 200, { room: publicState(room, new URL(req.url, "http://local").searchParams.get("playerId")) });
  }
  if (req.method === "POST" && pathname.match(/^\/api\/rooms\/[^/]+\/theme$/)) {
    const room = getRoom(pathname.split("/")[3]);
    if (body.playerId !== room.hostId) throw httpError(403, "Only the host can change the theme.");
    room.theme = ["neon", "classic", "candy", "midnight"].includes(body.theme) ? body.theme : room.theme;
    event(room, "theme", `Theme changed to ${room.theme}.`);
    return send(res, 200, { room: publicState(room, body.playerId) });
  }
  if (req.method === "POST" && pathname.match(/^\/api\/rooms\/[^/]+\/bots$/)) {
    const room = getRoom(pathname.split("/")[3]);
    if (body.playerId !== room.hostId) throw httpError(403, "Only the host can add bots.");
    addBot(room);
    return send(res, 200, { room: publicState(room, body.playerId) });
  }
  if (req.method === "POST" && pathname.match(/^\/api\/rooms\/[^/]+\/start$/)) {
    const room = getRoom(pathname.split("/")[3]);
    if (body.playerId !== room.hostId) throw httpError(403, "Only the host can start.");
    startRound(room);
    return send(res, 200, { room: publicState(room, body.playerId) });
  }
  if (req.method === "POST" && pathname.match(/^\/api\/rooms\/[^/]+\/play$/)) {
    const room = getRoom(pathname.split("/")[3]);
    playCard(room, body.playerId, body.cardId, body.color);
    return send(res, 200, { room: publicState(room, body.playerId) });
  }
  if (req.method === "POST" && pathname.match(/^\/api\/rooms\/[^/]+\/draw$/)) {
    const room = getRoom(pathname.split("/")[3]);
    drawForTurn(room, body.playerId);
    return send(res, 200, { room: publicState(room, body.playerId) });
  }
  if (req.method === "POST" && pathname.match(/^\/api\/rooms\/[^/]+\/reaction$/)) {
    const room = getRoom(pathname.split("/")[3]);
    const person = findPerson(room, body.playerId);
    if (!person) throw httpError(403, "Join the room first.");
    const emoji = String(body.emoji || "").slice(0, 4);
    room.reactions.push({ id: id(6), emoji, name: person.name, at: Date.now() });
    event(room, "reaction", `${person.name} reacted ${emoji}.`);
    return send(res, 200, { room: publicState(room, body.playerId) });
  }
  throw httpError(404, "Not found.");
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
        } else {
          res.writeHead(200, { "content-type": types[".html"] });
          res.end(fallback);
        }
      });
      return;
    }
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname);
    serveStatic(req, res, url.pathname);
  } catch (error) {
    send(res, error.status || 500, { error: error.message || "Server error" });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`UNO Friends Online running on http://localhost:${PORT}`);
  });
}

module.exports = { makeDeck, canPlay, createRoom, startRound, playCard, drawForTurn, rooms };
