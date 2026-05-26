# 🎴 Neon Uno

A fully responsive, real-time online Uno game you can play with friends in the browser. Built with Node.js, Express and Socket.IO — deploys to Render as a single web service.

## Features

- **Real-time multiplayer** with private **room codes** + shareable invite links
- **AI bots** for practice (Quick Practice button, or add bots to any room)
- **Score tracking across multiple rounds** with a running leaderboard
- **Custom card themes** (Neon Glow, Classic, Candy Pop, Midnight, Sunset, Mono Ink) — switch live
- **Spectator mode** — late joiners watch the current round and auto-join the next one
- **Sound effects** for every card, with **distinct sounds for each special card** (Skip / Reverse / +2 / Wild / +4 / UNO / win) plus optional background music — all synthesised in-browser, no audio files needed
- **Emoji reactions** that float across the table
- **In-game chat** + **player avatars & nicknames**
- **House rules**: stacking (+2/+4), draw-to-match, 7-0 swap, starting hand size, target score
- **Fully animated** UI: card deal/play/draw animations, neon glow, turn pulse, big action announcements, animated background
- **Robust turn engine** — the server is the single source of truth for whose turn it is, and bots *and* disconnected players are auto-driven, so turns never get stuck and you're never asked to play out of turn

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

To test the game logic (plays thousands of bot games and checks for stuck turns / card leaks):

```bash
npm test
```

## Deploy with GitHub + Render

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Neon Uno"
   git branch -M main
   git remote add origin https://github.com/<you>/neon-uno.git
   git push -u origin main
   ```

2. **Create the service on Render**
   - Go to [render.com](https://render.com) → **New** → **Web Service** → connect your GitHub repo.
   - Render auto-detects `render.yaml`. If asked manually:
     - **Build command:** `npm install`
     - **Start command:** `npm start`
     - **Health check path:** `/healthz`
   - Click **Create Web Service**. First build takes a couple of minutes.

3. **Play** — open the Render URL, create a room, and share the invite link (or 4-letter code) with your friends.

> Note: Render's free tier sleeps after inactivity, so the first load after a while may take ~30s to wake.

## How to play

Create a room (or hit **Quick Practice vs Bots**), share the code, add bots if you want, set house rules, and **Start Game**. Tap a glowing card to play it; tap the deck to draw. Wild cards open a colour picker. Hit **UNO!** when you're down to one card. First to empty their hand wins the round; play continues until someone hits the target score.

## Project structure

```
server.js          Express + Socket.IO entry point
src/game.js        Authoritative game engine + room manager
test/simulate.js   Headless stress test
public/
  index.html       Markup for all screens
  styles.css       Neon theme + animations
  app.js           Client logic, rendering, animations
  audio.js         Web Audio sound engine
  themes.js        Card themes
render.yaml         Render deploy config
```

MIT licensed. Built for playing with friends. 🎉
