// SETUP (initial run): pull every result for the last N months (default 24) for each league,
// then run the backtest and a first normal update so the site has predictions straight away.
import { fetchLeague, asResult } from './lib/bbc.mjs';
import { config, today, addMonths, loadResults, saveResults, mergeResults, log } from './lib/util.mjs';
import { runBacktest } from './backtest.mjs';
import { runUpdate } from './update.mjs';

const T = today();
const from = addMonths(T, -config.historyMonths); // 1st of the month, N months ago
log(`Setup: fetching results ${from} → ${T} for ${config.leagues.length} leagues\n`);

let total = 0;
for (const lg of config.leagues) {
  const results = loadResults(lg.key);
  try {
    const matches = await fetchLeague(lg, from, T);
    const added = mergeResults(results, matches.filter(m => m.kind === 'result').map(asResult));
    saveResults(lg.key, results);
    total += results.length;
    log(`${lg.name.padEnd(32)} ${String(results.length).padStart(5)} results (+${added})`);
  } catch (e) {
    log(`${lg.name.padEnd(32)} FAILED: ${e.message}`);
  }
}
log(`\n${total} results stored.\n`);

runBacktest();
await runUpdate();
