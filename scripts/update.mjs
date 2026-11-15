// FREQUENT RUN
// 1. Pull results since the last stored result (the "diff") and fixtures for the next few days.
// 2. Grade earlier predictions against the new results.
// 3. Predict the upcoming fixtures.
// 4. Write the weekly review, per-team accuracy, league tables and a run log into data/.
import { pathToFileURL } from 'node:url';
import { fetchLeague, asResult } from './lib/bbc.mjs';
import { buildContext, predict, grade, accuracyAll, leagueTable } from './lib/model.mjs';
import { config, today, addDays, addMonths, seasonOf, readJSON, writeJSON, listData, loadResults, saveResults, mergeResults, log } from './lib/util.mjs';

const ledgerFile = season => `predictions/${season}.json`;

function loadLedgers() {
  const ledgers = new Map(); // season -> Map(id -> pred)
  for (const f of listData('predictions')) {
    if (!f.endsWith('.json')) continue;
    ledgers.set(f.replace('.json', ''), new Map(readJSON(`predictions/${f}`, []).map(p => [p.id, p])));
  }
  return ledgers;
}

function saveLedgers(ledgers) {
  for (const [season, map] of ledgers) {
    writeJSON(ledgerFile(season), [...map.values()].sort((a, b) => a.ko.localeCompare(b.ko) || a.id.localeCompare(b.id)));
  }
}

export async function runUpdate({ skipFetch = false } = {}) {
  const T = today();
  const windowEnd = addDays(T, config.daysAhead);
  const ledgers = loadLedgers();
  const allPreds = () => [...ledgers.values()].flatMap(m => [...m.values()]);

  const resultsByLeague = {};
  const fixtures = [];
  const offIds = new Map();
  let newResults = 0;

  for (const lg of config.leagues) {
    const results = loadResults(lg.key);
    resultsByLeague[lg.key] = results;
    if (skipFetch) continue;

    // Fetch from a week before the last stored result (catches late corrections) or the
    // oldest ungraded prediction, whichever is earlier — capped at 60 days back.
    let from;
    if (!results.length) {
      // Newly added league: backfill the full history window first.
      from = addMonths(T, -config.historyMonths);
      log(`${lg.name}: new league — backfilling ${config.historyMonths} months`);
    } else {
      const lastDay = results.at(-1).ko.slice(0, 10);
      const pending = allPreds().filter(p => p.lg === lg.key && !p.result && !p.void).map(p => p.day);
      from = [addDays(lastDay, -7), ...pending].sort()[0];
      if (from < addDays(T, -60)) from = addDays(T, -60);
    }

    log(`${lg.name}: fetching ${from} → ${windowEnd}`);
    let matches;
    try {
      matches = await fetchLeague(lg, from, windowEnd);
    } catch (e) {
      log(`  ! fetch failed: ${e.message}`);
      continue;
    }
    const res = matches.filter(m => m.kind === 'result').map(asResult);
    const added = mergeResults(results, res);
    newResults += added;
    saveResults(lg.key, results);
    for (const m of matches) {
      if (m.kind === 'fixture' && m.day >= T && m.day <= windowEnd) fixtures.push(m);
      if (m.kind === 'off') offIds.set(m.id, m.note || 'Postponed');
    }
    log(`  +${added} new results, ${matches.filter(m => m.kind === 'fixture' && m.day >= T && m.day <= windowEnd).length} upcoming fixtures`);
  }

  // ---- grade earlier predictions ----
  const resultById = new Map();
  for (const list of Object.values(resultsByLeague)) for (const r of list) resultById.set(r.id, r);
  let graded = 0;
  for (const map of ledgers.values()) {
    for (const [id, p] of map) {
      if (p.result) continue;
      const r = resultById.get(id);
      if (r) { map.set(id, grade(p, r.hs, r.as)); graded++; }
      else if (offIds.has(id)) map.set(id, { ...p, void: offIds.get(id) });
    }
  }

  // ---- predict upcoming fixtures ----
  const ctx = buildContext(resultsByLeague);
  const upcoming = [];
  for (const fx of fixtures.sort((a, b) => a.ko.localeCompare(b.ko))) {
    const pred = { ...predict(ctx, fx), madeAt: new Date().toISOString() };
    const season = seasonOf(fx.ko);
    if (!ledgers.has(season)) ledgers.set(season, new Map());
    const existing = ledgers.get(season).get(fx.id);
    if (existing?.result) continue;
    ledgers.get(season).set(fx.id, pred); // latest pre-kick-off prediction wins
    upcoming.push(pred);
  }
  saveLedgers(ledgers);

  // ---- accuracy ----
  const gradedAll = allPreds().filter(p => p.result && !p.void);
  const acc = accuracyAll(gradedAll);
  acc.generatedAt = new Date().toISOString();
  writeJSON('accuracy.json', acc);

  // ---- review of the previous 7 days ----
  const from7 = addDays(T, -7), to7 = addDays(T, -1);
  const week = gradedAll.filter(p => p.day >= from7 && p.day <= to7).sort((a, b) => a.ko.localeCompare(b.ko));
  const weekAcc = accuracyAll(week);
  const review = {
    from: from7, to: to7,
    summary: weekAcc.overall,
    tuned: weekAcc.tuned.overall,
    bankers: weekAcc.bankers.overall,
    byLeague: weekAcc.byLeague,
    matches: week.map(p => ({ id: p.id, lg: p.lg, day: p.day, home: p.home.name, away: p.away.name, pick: p.pick, margin: p.margin, result: p.result, outcome: p.outcome, correct: p.correct, over: p.over, ouCorrect: p.ouCorrect, tuned: p.tuned && { pick: p.tuned.pick, margin: p.tuned.margin, correct: p.tuned.correct }, banker: p.banker })),
  };

  // ---- current league tables ----
  const tables = {};
  for (const lg of config.leagues) {
    const t = leagueTable(ctx, lg.key, addDays(T, 1) + 'T00:00:00Z');
    tables[lg.key] = [...t.values()].sort((a, b) => a.div - b.div || a.pos - b.pos).map(r => ({ ...r, name: ctx.names.get(r.team) }));
  }
  writeJSON('tables.json', { season: seasonOf(T), generatedAt: new Date().toISOString(), tables });

  // ---- latest snapshot for the website ----
  const allUpcoming = allPreds().filter(p => !p.result && !p.void && p.day >= T && p.day <= windowEnd).sort((a, b) => a.ko.localeCompare(b.ko));
  writeJSON('latest.json', {
    generatedAt: new Date().toISOString(),
    today: T,
    window: [T, windowEnd],
    leagues: config.leagues.map(({ key, name, country }) => ({ key, name, country })),
    settings: { formGames: config.formGames, venueFormMode: config.venueFormMode, drawMargin: config.drawMargin, weights: config.weights, overUnderLine: config.overUnderLine, tuned: config.tuned, bankers: config.bankers },
    upcoming: allUpcoming,
    review,
    overall: acc.overall,
    overallTuned: acc.tuned.overall,
    overallBankers: acc.bankers.overall,
  });

  // ---- run log (checked into the repo) ----
  const run = {
    date: T, at: new Date().toISOString(),
    newResults, graded, predicted: upcoming.length,
    totalResults: Object.values(resultsByLeague).reduce((s, l) => s + l.length, 0),
    week: { n: review.summary.n, correct: review.summary.correct, pct: review.summary.pct, ouPct: review.summary.ouPct, tunedPct: review.tuned.pct, bankersN: review.bankers.n, bankersPct: review.bankers.pct },
    overall: { n: acc.overall.n, pct: acc.overall.pct, ouPct: acc.overall.ouPct, tunedPct: acc.tuned.overall.pct, bankersN: acc.bankers.overall.n, bankersPct: acc.bankers.overall.pct },
  };
  writeJSON(`runs/${T}.json`, { ...run, review, predictions: upcoming });
  const index = readJSON('runs/index.json', []).filter(r => r.date !== T);
  index.push(run);
  index.sort((a, b) => a.date.localeCompare(b.date));
  writeJSON('runs/index.json', index);

  log(`\nRun ${T}: ${newResults} new results, ${graded} predictions graded, ${upcoming.length} fixtures predicted.`);
  log(`Last 7 days: original ${review.summary.pct ?? '–'}% (${review.summary.n}), tuned ${review.tuned.pct ?? '–'}%, bankers ${review.bankers.pct ?? '–'}% (${review.bankers.n}).`);
  log(`All-time:    original ${acc.overall.pct ?? '–'}% (${acc.overall.n}), tuned ${acc.tuned.overall.pct ?? '–'}%, bankers ${acc.bankers.overall.pct ?? '–'}% (${acc.bankers.overall.n}).`);
  return run;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runUpdate({ skipFetch: process.argv.includes('--offline') }).catch(e => { console.error(e); process.exit(1); });
}
