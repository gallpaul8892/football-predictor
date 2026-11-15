// BACKTEST: replay the model over past results (each match predicted using only data
// from before kick-off) to see straight away whether it works, and for which teams.
import { pathToFileURL } from 'node:url';
import { buildContext, predict, grade, accuracyAll } from './lib/model.mjs';
import { config, today, addMonths, ukDate, writeJSON, loadResults, log } from './lib/util.mjs';

export function runBacktest() {
  const resultsByLeague = {};
  for (const lg of config.leagues) resultsByLeague[lg.key] = loadResults(lg.key);
  const ctx = buildContext(resultsByLeague);
  const from = addMonths(today(), -config.backtestMonths);

  const graded = [];
  for (const [lg, list] of Object.entries(resultsByLeague)) {
    for (const m of list) {
      if (m.ko.slice(0, 10) < from) continue;
      const p = predict(ctx, { id: m.id, lg, ko: m.ko, day: ukDate(m.ko), h: m.h, a: m.a, hn: m.hn, an: m.an });
      graded.push(grade(p, m.hs, m.as));
    }
  }
  const acc = accuracyAll(graded);
  acc.from = from;
  acc.to = today();
  acc.generatedAt = new Date().toISOString();
  acc.settings = { formGames: config.formGames, venueFormMode: config.venueFormMode, drawMargin: config.drawMargin, weights: config.weights, tuned: config.tuned, bankers: config.bankers };
  writeJSON('backtest.json', acc);
  log(`Backtest ${from} → ${today()}: original ${acc.overall.pct}% (${acc.overall.n}), tuned ${acc.tuned.overall.pct}%, bankers ${acc.bankers.overall.pct}% (${acc.bankers.overall.n}), over/under ${acc.overall.ouPct}%`);
  return acc;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runBacktest();
