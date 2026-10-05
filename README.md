# Password Battle Royale — No Twitch Edition

A small multiplayer web version of the **Password Battle Royale** concept, designed so friends can join and submit passwords directly on the webpage. No Twitch account, Twitch token, Python, or local game-manager script is needed.

This project is a streamlined reimplementation inspired by DougDoug's open-source Password Battle Royale project. DougDoug's original repository is MIT-licensed: https://github.com/DougDougGithub/Password-Battle-Royale

## What players do

1. Open the normal site URL.
2. Enter a nickname and click **Join**.
3. When the host starts a round, enter a password that passes every active rule.
4. You can replace your answer until the timer reaches zero.
5. The host closes the round. Invalid, missing, and later duplicate submissions are eliminated.
6. A new rule is added each round until one player remains or all rules are completed.

## What the host does

Open the same site with `?host=1` at the end of the URL, for example:

`https://your-site.vercel.app/?host=1`

Enter the `HOST_KEY` you configured in Vercel. The host can set the timer, start the game, close rounds, begin the next round, and reset the game.

---

# Fastest deployment (recommended)

You only need **GitHub + Vercel**. Upstash Redis can be added inside Vercel.

## 1. Put this folder on GitHub

Create a new empty GitHub repository, then upload the contents of this folder. If you use GitHub Desktop, choose **Add existing repository**, then publish it.

## 2. Import the repository into Vercel

In Vercel, create a new project and import your GitHub repository. Vercel should detect Vite automatically.

## 3. Add Upstash Redis

In the Vercel Marketplace/Integrations area, add **Upstash Redis** and connect the database to this project. The integration should add Redis environment variables automatically.

The app accepts either of these variable pairs:

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL` + `KV_REST_API_TOKEN`

## 4. Add one secret

In **Vercel → Project → Settings → Environment Variables**, add:

`HOST_KEY = your-own-long-secret`

Use something you won't accidentally share with players.

## 5. Redeploy

Redeploy once after adding Redis and `HOST_KEY`.

Then share the normal Vercel URL with players. Keep the `?host=1` URL for yourself.

---

## Local testing (optional)

Copy `.env.example` to `.env.local`, fill in the values, then run:

```bash
npm install
npm run dev
```

`npm run dev` uses the Vercel CLI so the `/api/game` serverless endpoint works locally.

## Notes

- The game is intentionally simple and private-friend oriented.
- Passwords are stored only in Redis for the duration of the game and are never returned in the public game-state API.
- Pressing **Reset entire game** removes the current player list and game state.
- This edition uses a compact set of 11 cumulative password rules. The rules can be edited in `api/_lib/game.js`.

## Latest 13-rule update
The game now has 13 rounds, including the animal image challenge at round 6, the supplied childhood-photo year challenge at round 7, and a Mesternes mester initials challenge at round 10. Marie has a neon/sakura player theme with positive between-round messages.
