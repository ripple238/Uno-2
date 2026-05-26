# UNO Friends Online

A responsive online UNO-style browser game for private friend rooms. It includes:

- Online room codes for friends
- Player and spectator join modes
- AI bots for practice
- Score tracking across rounds
- Custom card themes
- Animated card play and responsive table layout
- Sound effects, special-card sounds, background music, and emoji reactions
- Server-side turn validation so players cannot play out of turn

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Deploy On Render

1. Push this folder to GitHub.
2. Create a new Render Web Service from the repository.
3. Use:
   - Build command: `npm install`
   - Start command: `npm start`
4. Render will also detect `render.yaml` if you use blueprint deployment.

## Notes

The app uses built-in Node.js APIs and stores active rooms in memory. That is good for a lightweight friend game on one Render instance. If you later need permanent accounts, saved history, or multiple server instances, add a database such as Redis or Postgres.
