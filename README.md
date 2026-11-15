# Football Predictor (English & Scottish leagues)

A static GitHub Pages site plus GitHub Actions jobs. The jobs pull scores and fixtures from BBC Sport's feed, predict upcoming games with a points model, grade the predictions once results are in, and commit everything to `data/`. The site only reads those JSON files.

> A browser page on GitHub Pages can't read BBC Sport directly (the browser blocks cross-site requests), so the fetching runs in GitHub Actions and the page shows what the runs saved.

## Leagues
- **England:** Premier League, Championship, League One, League Two, National League, National League North/South
- **Scotland:** Premiership, Championship, League One, League Two
- **Europe:** German Bundesliga, Italian Serie A, Spanish La Liga, Portuguese Primeira Liga. BBC doesn't have the second tiers for these countries.

If you add a league to `config.json`, the next Update run pulls its 2 years of history by itself. Edit `config.json` to add or remove any (the `slug` is the part of the BBC URL, e.g. `bbc.co.uk/sport/football/<slug>/scores-fixtures`).

## Getting started
1. Create a new GitHub repo and push these files to it.
2. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`.
3. **Settings → Actions → General → Workflow permissions**: *Read and write*.
4. **Actions → Setup (initial run) → Run workflow**. It takes about 2–4 minutes: it pulls 24 months of results, runs the backtest, and makes the first predictions.
5. After that, **Update (frequent run)** runs on its own at 07:23 and 22:47 UTC every day. You can also start it by hand.

## The runs
| Run | Script | What it does |
|---|---|---|
| Setup | `scripts/setup.mjs` | Pulls all results for the last `historyMonths` (24), then runs the backtest and an update |
| Update | `scripts/update.mjs` | Pulls only the new results since the last stored one, grades past predictions, predicts fixtures for today + the next `daysAhead` (3) days, and writes the 7-day review, accuracy, tables and a run log |
| Replay | `scripts/replay.mjs [date] [days]` | Shows what the model would have predicted on a past date (using only earlier results) vs what happened. The site's **Replay a date** tab does the same in the browser |
| Backtest | `scripts/backtest.mjs` | Replays the model over the last `backtestMonths` (12) of results, using only data from before each kick-off. Runs on its own when `config.json` changes |

## The model (`scripts/lib/model.mjs`)
Each side gets points. More points = predicted winner. A gap of `drawMargin` (1) or less = draw.
- **+1** for each win in the last 10 league games
- **+1** for each win in the last 10 games at the same venue (home wins for the home side, away wins for the away side). Set `venueFormMode: "withinLastN"` to count only home/away wins *within* the last 10 games overall.
- **+1** for each league place above the opponent (this season's table, worked out from results)
- **+1** for each previous win against this opponent (in the stored 2 years)

**Goals:** expected goals per side = (its average scored + opponent's average conceded) ÷ 2, over the last 10 games. If the total is above 2.5, the prediction is "Over".

Each factor has a weight in `config.json`, so you can tune them and check the backtest.

## Tuned model and Bankers
Two extra predictions are made for every fixture next to the original rules:
- **Tuned model**: the same factors, with weights picked by testing every combination against a year of results. It counts wins in the last 5 games, half a point per league place above the opponent and a +3 home bonus, and it never predicts a draw. Backtest: 47.6% vs 45% for the original rules.
- **★ Bankers**: games where the tuned model's points gap is 8 or more. The call is "favourite wins *or draws*". About 1 game in 5 qualifies, and these were right 81.6% of the time in the backtest (825 games).

All three are tracked separately on the Accuracy, Backtest, Last 7 days and Replay tabs. The settings are under `tuned` and `bankers` in `config.json`.

## Data files (`data/`)
- `results/<league>.json`: every stored result, one per line
- `predictions/<season>.json`: the predictions ledger. Each fixture keeps its last prediction made before kick-off, and the result and grade are added once it's played
- `accuracy.json`: live accuracy overall, by league, by team, by points margin and by week
- `backtest.json`: the same breakdowns from the backtest
- `latest.json`: the upcoming predictions and the last-7-days review, for the site
- `tables.json`: current league tables
- `runs/<date>.json` + `runs/index.json`: the log of each run

## Run locally
```
node scripts/setup.mjs     # first time
node scripts/update.mjs    # any time after
npx serve .                # view the site
```
Offline test against a simulated BBC feed:
`TODAY=2026-11-06 REQUEST_DELAY_MS=0 node --import ./test/mock-bbc.mjs scripts/setup.mjs`

## Not yet included
- Recent news (injuries, manager changes), planned as a later AI step
- Points deductions in the league tables
- Cup games (league games only)
