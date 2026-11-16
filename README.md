# Ground Up: DFW

A single-player real estate development game set in Dallas-Fort Worth: find land, win approvals, raise money, build, lease, sell, and pay your investors.

Built with TypeScript, React, three.js and Vite. Hosted on Firebase (Hosting, Authentication, Firestore). Every push to `main` is tested, built and published automatically by GitHub Actions.

## Where things live

| Path | What it is |
|---|---|
| `src/engine/` | The simulation: deals, finance, waterfall, market, milestones, scoring. No UI code. |
| `src/content/` | Sites, people, tenants, events, glossary, tutorial, milestones. |
| `src/render/` | The 3D map (`map3d.ts`, `sites3d.ts`, `atmos.ts`) and the simple 2D fallback (`map.ts`). |
| `src/ui/` | Screens and panels. |
| `src/services/` | Saves, high score boards, and the Firebase connection. |
| `src/firebase-config.ts` | Your Firebase web app settings. While it is `null` the game runs on each device only. |
| `firestore.rules` | Who may read and write high scores and saves. |
| `firestore.indexes.json` | Database indexes the high score boards need. |
| `.github/workflows/deploy.yml` | The automatic deploy. Needs the `FIREBASE_SERVICE_ACCOUNT` secret. |
| `tests/` | Engine tests (`npm test`). |

## How the world is built

- `src/render/layout.ts` holds the hand-drawn geography: highways, rail, rivers, lakes, airports, cities. Every highway must end at another highway or the map edge; a test checks it.
- `src/content/roads.ts` builds the street grid from that: arterials on every fourth grid line, sections filled in by density, no dead ends. It also works out each site's frontage, corner and drive to the freeway.
- `src/content/sitegen.ts` places the rule-built sites and buildings. `src/content/sitedata.ts` gives each site its numbers for each property type and prices land at its highest and best use.
- `src/engine/market.ts` is the market for each property type. `src/engine/rivals.ts` runs the six rival firms and the league table.
- If you move a highway or change how sites are placed, raise `MAP_REV` in `src/content/world.ts` so saved games pick up the new map.

## One-time setup

1. **Firebase web app.** Firebase console > Project settings > General > Your apps > add a Web app (`</>`). Copy the `firebaseConfig` values into `src/firebase-config.ts`, and put the project ID in `.firebaserc`.
2. **Sign-in.** Authentication > Get started > Sign-in method: turn on **Google** and **Email/Password**.
3. **Database.** Firestore Database > Create database > Production mode > a US location (for example `nam5`).
4. **Hosting.** Hosting > Get started, then click through; the deploy handles the rest.
5. **Deploy permission (keyless).** GitHub signs in to Google through Workload Identity Federation, so there is no key file. In the Google Cloud console for this project, open Cloud Shell and run `setup/keyless-deploy.sh` (paste its contents). It enables the needed APIs, creates the `github-deploy` service account with the Firebase Admin, Service Usage Consumer and API Keys Viewer roles, and lets only this repository act as that account.

After that, every push to `main` goes live at `https://<project-id>.web.app` in a few minutes. Watch progress in the repo's **Actions** tab, or re-run a deploy there with **Run workflow**.

## Running it on your own computer (optional)

Needs Node.js 22 or later.

```
npm install
npm run dev      # play locally at http://localhost:5173
npm test         # run the engine tests
npm run build    # production build into dist/
```

`SINGLE=1 npx vite build` makes a one-file version (`dist-single/index.html`) without Firebase, used for the shareable preview.

## Costs

The Firebase free (Spark) plan covers family and small-group play: 10 GB of hosting storage, about 360 MB of downloads a day (a first visit downloads about 0.7 MB, later visits use the cache), and 50,000 database reads and 20,000 writes a day. GitHub Actions is free for this amount of use.
