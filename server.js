/**
 * Neon Uno — server entry point.
 * Express serves the static client; Socket.IO drives real-time multiplayer.
 * All game state lives on the server (authoritative) so turns can never get
 * stuck and a client can never be asked to play twice.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./src/game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.send('ok'));

const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  // --- Room lifecycle ---------------------------------------------------
  socket.on('createRoom', (payload, cb) => rooms.createRoom(socket, payload, cb));
  socket.on('joinRoom', (payload, cb) => rooms.joinRoom(socket, payload, cb));
  socket.on('leaveRoom', () => rooms.leaveRoom(socket));

  // --- Lobby actions ----------------------------------------------------
  socket.on('addBot', () => rooms.addBot(socket));
  socket.on('removeBot', (botId) => rooms.removeBot(socket, botId));
  socket.on('updateRules', (rules) => rooms.updateRules(socket, rules));
  socket.on('updateProfile', (p) => rooms.updateProfile(socket, p));
  socket.on('startGame', () => rooms.startGame(socket));
  socket.on('nextRound', () => rooms.nextRound(socket));

  // --- In-game actions --------------------------------------------------
  socket.on('playCard', (payload) => rooms.playCard(socket, payload));
  socket.on('drawCard', () => rooms.drawCard(socket));
  socket.on('passTurn', () => rooms.passTurn(socket));
  socket.on('callUno', () => rooms.callUno(socket));
  socket.on('chooseColor', (color) => rooms.chooseColor(socket, color));

  // --- Social -----------------------------------------------------------
  socket.on('chat', (msg) => rooms.chat(socket, msg));
  socket.on('emoji', (emoji) => rooms.emoji(socket, emoji));

  socket.on('disconnect', () => rooms.leaveRoom(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Neon Uno running on :${PORT}`));
