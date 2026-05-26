const state = {
  room: null,
  playerId: localStorage.getItem("unoPlayerId") || "",
  code: localStorage.getItem("unoRoomCode") || "",
  selectedCardId: null,
  pendingWildCardId: null,
  lastEventId: 0,
  reactionsSeen: new Set(),
  pollTimer: null,
  soundOn: localStorage.getItem("unoSound") !== "off",
  musicOn: false,
  audio: null,
  musicNodes: null
};

const $ = (selector) => document.querySelector(selector);
const app = $("#app");

const api = async (path, body, method = "POST") => {
  const response = await fetch(path, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body || {}) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};

function boot() {
  bindHome();
  bindGame();
  if (state.code && state.playerId) {
    fetchRoom();
    startPolling();
  }
  app.classList.remove("shell-loading");
}

function bindHome() {
  $("#createRoom").addEventListener("click", async () => {
    try {
      unlockAudio();
      const data = await api("/api/rooms", { name: $("#playerName").value });
      enterRoom(data);
    } catch (error) {
      toast(error.message);
    }
  });
  $("#joinRoom").addEventListener("click", () => join(false));
  $("#spectateRoom").addEventListener("click", () => join(true));
  $("#soundToggle").addEventListener("click", toggleSound);
}

async function join(spectator) {
  try {
    unlockAudio();
    const code = $("#roomCode").value.trim().toUpperCase();
    const data = await api(`/api/rooms/${code}/join`, { name: $("#playerName").value, spectator });
    enterRoom(data);
  } catch (error) {
    toast(error.message);
  }
}

function bindGame() {
  $("#leaveRoom").addEventListener("click", () => {
    stopPolling();
    localStorage.removeItem("unoPlayerId");
    localStorage.removeItem("unoRoomCode");
    state.room = null;
    state.playerId = "";
    state.code = "";
    $("#table").classList.add("hidden");
    $("#home").classList.remove("hidden");
  });
  $("#copyCode").addEventListener("click", async () => {
    await navigator.clipboard?.writeText(state.code);
    toast("Room code copied.");
  });
  $("#startRound").addEventListener("click", () => roomAction("start", {}));
  $("#addBot").addEventListener("click", () => roomAction("bots", {}));
  $("#drawCard").addEventListener("click", () => roomAction("draw", {}, true));
  $("#themeSelect").addEventListener("change", (event) => roomAction("theme", { theme: event.target.value }));
  $("#musicToggle").addEventListener("click", toggleMusic);
  document.querySelectorAll(".wild-chooser button").forEach((button) => {
    button.addEventListener("click", () => playSelected(button.dataset.color));
  });
  document.querySelectorAll(".reactions button").forEach((button) => {
    button.addEventListener("click", () => roomAction("reaction", { emoji: button.textContent }, true));
  });
}

async function roomAction(action, extra, quiet = false) {
  try {
    unlockAudio();
    const data = await api(`/api/rooms/${state.code}/${action}`, { playerId: state.playerId, ...extra });
    applyRoom(data.room);
    if (["draw", "reaction"].includes(action)) playSound(action);
  } catch (error) {
    if (!quiet) toast(error.message);
    else toast(error.message);
  }
}

function enterRoom(data) {
  state.playerId = data.playerId;
  state.code = data.room.code;
  localStorage.setItem("unoPlayerId", state.playerId);
  localStorage.setItem("unoRoomCode", state.code);
  $("#home").classList.add("hidden");
  $("#table").classList.remove("hidden");
  applyRoom(data.room);
  startPolling();
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(fetchRoom, 900);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function fetchRoom() {
  if (!state.code || !state.playerId) return;
  try {
    const data = await api(`/api/rooms/${state.code}?playerId=${state.playerId}`, null, "GET");
    applyRoom(data.room);
  } catch (error) {
    stopPolling();
    localStorage.removeItem("unoRoomCode");
    toast(error.message);
  }
}

function applyRoom(room) {
  const previousEvent = state.room?.lastEvent?.id || 0;
  state.room = room;
  document.body.className = `theme-${room.theme}`;
  $("#home").classList.add("hidden");
  $("#table").classList.remove("hidden");
  $("#copyCode").textContent = room.code;
  $("#roundTitle").textContent = room.status === "lobby" ? "Lobby" : room.status === "gameOver" ? "Game Over" : `Round ${room.round}`;
  $("#directionBadge").textContent = room.direction > 0 ? "Clockwise" : "Counter-clockwise";
  $("#roleBadge").textContent = room.viewerRole === "spectator" ? "Spectator" : "Player";
  $("#themeSelect").value = room.theme;
  $("#deckCount").textContent = room.deckCount;
  $("#turnText").textContent = room.status === "playing" ? `${room.currentPlayerName}'s turn` : statusText(room.status);
  $("#colorText").textContent = room.currentColor ? `Current color: ${room.currentColor}` : "Choose a room";
  $("#startRound").disabled = room.hostId !== room.viewerId || !["lobby", "roundOver", "gameOver"].includes(room.status);
  $("#addBot").disabled = room.hostId !== room.viewerId || room.status !== "lobby";
  $("#themeSelect").disabled = room.hostId !== room.viewerId;
  $("#drawCard").disabled = !isMyTurn(room);
  renderPlayers(room);
  renderOpponents(room);
  renderDiscard(room.topCard);
  renderHand(room);
  renderLog(room);
  renderReactions(room);
  if (room.lastEvent && room.lastEvent.id > previousEvent) {
    playSound(room.lastEvent.type);
    pulseForEvent(room.lastEvent.type);
  }
}

function statusText(status) {
  if (status === "roundOver") return "Round finished. Start the next one.";
  if (status === "gameOver") return "Game finished. Start a new match.";
  return "Waiting for players.";
}

function isMyTurn(room) {
  return room.status === "playing" && room.currentPlayerId === room.viewerId && room.viewerRole === "player";
}

function renderPlayers(room) {
  $("#players").innerHTML = room.players.map((player) => `
    <div class="player-row ${player.isCurrent ? "current" : ""}">
      <div>
        <div class="player-name">${escapeHtml(player.name)}${player.type === "bot" ? " · AI" : ""}${player.isHost ? " · Host" : ""}</div>
        <div class="player-meta">${player.cardCount} cards</div>
      </div>
      <strong>${player.score}</strong>
    </div>
  `).join("");
  $("#spectators").textContent = room.spectators.length
    ? `Watching: ${room.spectators.map((person) => person.name).join(", ")}`
    : "No spectators yet.";
}

function renderOpponents(room) {
  $("#opponents").innerHTML = room.players
    .filter((player) => player.id !== room.viewerId)
    .map((player) => `
      <div class="opponent ${player.isCurrent ? "current" : ""}">
        <strong>${escapeHtml(player.name)}</strong>
        <div class="player-meta">${player.cardCount} cards</div>
        <div class="mini-cards">${Array.from({ length: Math.min(player.cardCount, 9) }, () => `<span class="mini-card"></span>`).join("")}</div>
      </div>
    `).join("");
}

function renderDiscard(card) {
  $("#discard").innerHTML = card ? cardMarkup(card, false) : "";
}

function renderHand(room) {
  const me = room.players.find((player) => player.id === room.viewerId);
  const hand = me?.hand || [];
  $("#hand").innerHTML = hand.map((card, index) => {
    const playable = isMyTurn(room) && canPlayLocal(card, room);
    const tilt = Math.max(-10, Math.min(10, (index - hand.length / 2) * 2));
    return cardMarkup(card, playable, tilt);
  }).join("");
  document.querySelectorAll("#hand .uno-card").forEach((button) => {
    button.addEventListener("click", () => selectCard(button.dataset.cardId));
  });
}

function cardMarkup(card, playable, tilt = 0) {
  const rank = card.rank.replace("draw2", "+2").replace("wild4", "+4");
  const color = card.color === "wild" ? "#111827" : `var(--card-${card.color})`;
  return `
    <button class="uno-card ${playable ? "playable" : ""}" data-card-id="${card.id}" style="--card-color:${color}; --tilt:${tilt}deg" aria-label="${card.color} ${card.rank}">
      <span class="card-corner top">${rank}</span>
      <span class="card-inner">${rank}</span>
      <span class="card-corner bottom">${rank}</span>
    </button>
  `;
}

function selectCard(cardId) {
  const room = state.room;
  if (!isMyTurn(room)) {
    toast(room.viewerRole === "spectator" ? "Spectators can react, not play cards." : "Wait for your turn.");
    return;
  }
  const me = room.players.find((player) => player.id === room.viewerId);
  const card = me?.hand?.find((item) => item.id === cardId);
  if (!card || !canPlayLocal(card, room)) {
    playSound("error");
    toast("That card cannot be played now.");
    return;
  }
  playSound("select");
  document.querySelectorAll(".uno-card").forEach((item) => item.classList.toggle("selected", item.dataset.cardId === cardId));
  state.selectedCardId = cardId;
  if (card.color === "wild") {
    state.pendingWildCardId = cardId;
    $("#wildChooser").classList.remove("hidden");
  } else {
    playSelected();
  }
}

async function playSelected(color) {
  const cardId = state.selectedCardId || state.pendingWildCardId;
  if (!cardId) return;
  try {
    $("#wildChooser").classList.add("hidden");
    const data = await api(`/api/rooms/${state.code}/play`, { playerId: state.playerId, cardId, color });
    state.selectedCardId = null;
    state.pendingWildCardId = null;
    applyRoom(data.room);
  } catch (error) {
    toast(error.message);
  }
}

function canPlayLocal(card, room) {
  if (room.pendingDraw && !["draw2", "wild4"].includes(card.rank)) return false;
  if (card.color === "wild") return true;
  return card.color === room.currentColor || card.rank === room.topCard?.rank;
}

function renderLog(room) {
  $("#eventLog").innerHTML = room.log.slice().reverse().map((item) => `<div class="event-item">${escapeHtml(item.message)}</div>`).join("");
}

function renderReactions(room) {
  for (const reaction of room.reactions) {
    if (state.reactionsSeen.has(reaction.id)) continue;
    state.reactionsSeen.add(reaction.id);
    const node = document.createElement("div");
    node.className = "floating-reaction";
    node.style.setProperty("--x", Math.random().toFixed(2));
    node.textContent = reaction.emoji;
    $("#reactionLayer").appendChild(node);
    setTimeout(() => node.remove(), 3000);
  }
}

function pulseForEvent(type) {
  const target = ["play", "special", "uno", "win"].includes(type) ? $("#discard") : $(".center-table");
  target?.classList.remove("pulse");
  requestAnimationFrame(() => target?.classList.add("pulse"));
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add("hidden"), 2500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function unlockAudio() {
  if (state.audio) return;
  state.audio = new (window.AudioContext || window.webkitAudioContext)();
}

function toggleSound() {
  state.soundOn = !state.soundOn;
  localStorage.setItem("unoSound", state.soundOn ? "on" : "off");
  $("#soundToggle").textContent = state.soundOn ? "♪" : "ø";
  if (state.soundOn) {
    unlockAudio();
    playSound("select");
  }
}

function playSound(type) {
  if (!state.soundOn) return;
  unlockAudio();
  const audio = state.audio;
  const now = audio.currentTime;
  const profile = {
    select: [460, 0.04, "sine"],
    play: [620, 0.08, "triangle"],
    special: [260, 0.2, "sawtooth"],
    draw: [180, 0.11, "square"],
    reaction: [760, 0.06, "sine"],
    uno: [880, 0.18, "triangle"],
    win: [520, 0.32, "triangle"],
    game: [420, 0.4, "sine"],
    error: [120, 0.12, "sawtooth"]
  }[type] || [360, 0.07, "sine"];
  const gain = audio.createGain();
  const osc = audio.createOscillator();
  osc.type = profile[2];
  osc.frequency.setValueAtTime(profile[0], now);
  if (["special", "win", "game"].includes(type)) osc.frequency.exponentialRampToValueAtTime(profile[0] * 1.8, now + profile[1]);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + profile[1]);
  osc.connect(gain).connect(audio.destination);
  osc.start(now);
  osc.stop(now + profile[1] + 0.02);
}

function toggleMusic() {
  unlockAudio();
  state.musicOn = !state.musicOn;
  $("#musicToggle").textContent = state.musicOn ? "♫" : "♩";
  if (state.musicOn) startMusic();
  else stopMusic();
}

function startMusic() {
  stopMusic();
  const audio = state.audio;
  const gain = audio.createGain();
  gain.gain.value = 0.035;
  const osc = audio.createOscillator();
  const lfo = audio.createOscillator();
  const lfoGain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = 110;
  lfo.frequency.value = 0.35;
  lfoGain.gain.value = 18;
  lfo.connect(lfoGain).connect(osc.frequency);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  lfo.start();
  state.musicNodes = [osc, lfo, gain];
}

function stopMusic() {
  if (!state.musicNodes) return;
  for (const node of state.musicNodes) {
    try {
      if (node.stop) node.stop();
      node.disconnect();
    } catch {
      node.disconnect?.();
    }
  }
  state.musicNodes = null;
}

boot();
