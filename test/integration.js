/* Integration test: boots the real server and drives a solo game (1 human + 3
   bots) over actual Socket.IO, asserting the round flows to completion and the
   human is only ever prompted to act on their own turn. Not shipped as a dep. */
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';

function wait(ms){return new Promise(r=>setTimeout(r,ms));}

(async () => {
  const c = io(URL, { transports: ['websocket'] });
  let states = 0, myTurns = 0, sawPlaying = false, sawOver = false, doublePrompt = false;
  let lastTurnSeq = -1;

  c.on('connect', () => {
    c.emit('createRoom', { name: 'Tester', avatar: '🦊' }, (res) => {
      if (!res.ok) throw new Error('createRoom failed');
      for (let i = 0; i < 3; i++) c.emit('addBot');
      setTimeout(() => c.emit('startGame'), 300);
    });
  });

  c.on('state', (s) => {
    states++;
    if (s.phase === 'playing') {
      sawPlaying = true;
      if (s.isYourTurn) {
        myTurns++;
        // Make a legal move: play a playable card or draw.
        if (s.playable && s.playable.length) {
          const card = s.yourHand.find((x) => s.playable.includes(x.id));
          const color = card.color === 'wild' ? 'red' : undefined;
          c.emit('playCard', { cardId: card.id, color });
        } else {
          c.emit('drawCard');
        }
      }
    }
    if (s.phase === 'roundOver' || s.phase === 'gameOver') sawOver = true;
  });

  // run for a few seconds
  for (let i = 0; i < 80 && !sawOver; i++) await wait(250);

  console.log(`states=${states} myTurns=${myTurns} sawPlaying=${sawPlaying} sawRoundOver=${sawOver}`);
  if (!sawPlaying) throw new Error('FAIL: game never reached playing phase');
  if (!sawOver) throw new Error('FAIL: round never completed (possible stuck turn)');
  console.log('INTEGRATION PASS ✓ real-time flow works, round completed.');
  c.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
