const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDeck, createRoom, startRound, playCard, drawForTurn } = require("./server");

function setupRoom() {
  const room = createRoom("Ava");
  room.players.push({ id: "bot", name: "Bot", type: "bot", score: 0, hand: [], spectator: false });
  startRound(room);
  return room;
}

test("deck contains expected 108 cards", () => {
  assert.equal(makeDeck().length, 108);
});

test("playing a normal card advances exactly one turn", () => {
  const room = setupRoom();
  room.players[0].hand = [{ id: "r5", color: "red", rank: "5" }, { id: "r6", color: "red", rank: "6" }];
  room.players[1].hand = [{ id: "b7", color: "blue", rank: "7" }];
  room.discard = [{ id: "r2", color: "red", rank: "2" }];
  room.currentColor = "red";
  room.currentPlayerIndex = 0;
  playCard(room, room.players[0].id, "r5");
  assert.equal(room.currentPlayerIndex, 1);
});

test("draw action clears pending penalty and advances turn", () => {
  const room = setupRoom();
  room.pendingDraw = 4;
  room.currentPlayerIndex = 1;
  const before = room.players[1].hand.length;
  drawForTurn(room, room.players[1].id);
  assert.equal(room.pendingDraw, 0);
  assert.equal(room.players[1].hand.length, before + 4);
  assert.equal(room.currentPlayerIndex, 0);
});

test("skip card jumps over the next player", () => {
  const room = createRoom("Ava");
  room.players.push({ id: "b", name: "Ben", type: "human", score: 0, hand: [], spectator: false });
  room.players.push({ id: "c", name: "Cam", type: "human", score: 0, hand: [], spectator: false });
  startRound(room);
  room.players[0].hand = [{ id: "skip", color: "green", rank: "skip" }, { id: "x", color: "red", rank: "1" }];
  room.discard = [{ id: "g1", color: "green", rank: "1" }];
  room.currentColor = "green";
  room.currentPlayerIndex = 0;
  playCard(room, room.players[0].id, "skip");
  assert.equal(room.currentPlayerIndex, 2);
});
