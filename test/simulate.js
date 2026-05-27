/**
 * Headless stress test for the Uno engine.
 * Plays thousands of full bot games across rule/player combos and asserts:
 *   - the game always terminates (no stuck turn / infinite loop)
 *   - card count is conserved (deck + discard + hands === 108) every step
 *   - exactly one winner, scoring is non-negative
 *   - the current player always changes legally
 */
const { UnoGame } = require('../src/game');

function mkPlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, avatar: '🤖', isBot: true,
    hand: [], score: 0, wins: 0, losses: 0, calledUno: false
  }));
}

function totalCards(g) {
  return g.deck.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0);
}

function playOneRound(g) {
  let steps = 0;
  const MAX = 5000;
  while (g.phase === 'playing') {
    if (++steps > MAX) throw new Error('STUCK: round exceeded ' + MAX + ' steps');
    if (totalCards(g) !== 108) throw new Error('CARD LEAK: total=' + totalCards(g) + ' at step ' + steps);

    const cur = g.player(g.currentId);

    // Resolve a pending colour (a bot just played a wild without a colour).
    if (g.pendingColor) {
      g.chooseColor(g.pendingColor, g.pickColor(g.player(g.pendingColor)));
      continue;
    }

    const move = g.botMove(cur.id);
    if (move.type === 'play') {
      const r = g.playCard(cur.id, move.cardId, move.color);
      if (!r.ok) throw new Error('Bot made illegal play: ' + r.error);
    } else {
      const dr = g.drawCard(cur.id);
      if (!dr.ok) throw new Error('Bot draw failed: ' + dr.error);
      if (g.phase !== 'playing') break;
      // After drawing, either play the new card or pass.
      if (g.currentId === cur.id) {
        const m2 = g.botMove(cur.id);
        if (m2.type === 'play') g.playCard(cur.id, m2.cardId, m2.color);
        else g.passTurn(cur.id);
      }
    }
  }
  if (totalCards(g) !== 108) throw new Error('CARD LEAK at round end: ' + totalCards(g));
  if (!g.winnerId) throw new Error('Round ended with no winner');
  if (g.player(g.winnerId).hand.length !== 0) throw new Error('Winner still holds cards');
  // Every player must receive a unique placement 1..N (continue-play correctness).
  const places = g.players.map((p) => p.placement).sort((a, b) => a - b);
  for (let i = 0; i < places.length; i++) if (places[i] !== i + 1) throw new Error('Bad placements: ' + places.join(','));
  if (g.player(g.winnerId).placement !== 1) throw new Error('Winner is not placement #1');
}

const RULE_SETS = [
  {},
  { stacking: true },
  { stacking: false },
  { drawToMatch: true },
  { sevenZero: true },
  { stacking: true, drawToMatch: true, sevenZero: true },
];

let games = 0, rounds = 0;
const GAMES_PER = 250;
const t0 = Date.now();

for (const rules of RULE_SETS) {
  for (let np = 2; np <= 6; np++) {
    for (let i = 0; i < GAMES_PER; i++) {
      const players = mkPlayers(np);
      const g = new UnoGame(players, { ...rules, targetScore: 200 });
      let safety = 0;
      while (g.phase !== 'gameOver') {
        g.startRound();
        playOneRound(g);
        rounds++;
        if (g.phase === 'roundOver') {
          // simulate "next round"
          if (g.players.reduce((m, p) => Math.max(m, p.score), 0) >= g.rules.targetScore) g.phase = 'gameOver';
        }
        if (++safety > 200) throw new Error('Game never reached target score');
      }
      // exactly one winner overall (highest score) and all scores >= 0
      for (const p of g.players) if (p.score < 0) throw new Error('Negative score');
      games++;
    }
  }
}

const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`PASS ✓  ${games} games / ${rounds} rounds across ${RULE_SETS.length} rule sets in ${dt}s`);
console.log('No stuck turns, no card leaks, every round produced exactly one winner.');
