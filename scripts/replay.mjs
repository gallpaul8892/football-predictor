// REPLAY a past date: what would the model have predicted (using only results from
// before kick-off) vs what actually happened?
// Usage: node scripts/replay.mjs [YYYY-MM-DD] [days]   (default: yesterday, 1 day)
import { buildContext, predict, grade, accuracy } from './lib/model.mjs';
import { config, today, addDays, ukDate, loadResults } from './lib/util.mjs';

const from = process.argv[2] || addDays(today(), -1);
const days = +(process.argv[3] || 1);
const to = addDays(from, days - 1);

const resultsByLeague = {};
for (const lg of config.leagues) resultsByLeague[lg.key] = loadResults(lg.key);
const ctx = buildContext(resultsByLeague);
const names = Object.fromEntries(config.leagues.map(l => [l.key, l.name]));

const graded = [];
for (const [lg, list] of Object.entries(resultsByLeague))
  for (const m of list) {
    const day = ukDate(m.ko);
    if (day < from || day > to) continue;
    graded.push(grade(predict(ctx, { id: m.id, lg, ko: m.ko, day, h: m.h, a: m.a, hn: m.hn, an: m.an }), m.hs, m.as));
  }
graded.sort((a, b) => a.lg.localeCompare(b.lg) || a.ko.localeCompare(b.ko));

if (!graded.length) { console.log(`No results stored for ${from}${days > 1 ? ' → ' + to : ''}.`); process.exit(0); }
const label = p => (p.pick === 'H' ? 'Home' : p.pick === 'A' ? 'Away' : 'Draw');
let lg = '';
for (const p of graded) {
  if (p.lg !== lg) { lg = p.lg; console.log(`\n${names[lg]}`); }
  console.log(`  ${p.correct ? '✓' : '✗'} ${(p.home.name + ' v ' + p.away.name).padEnd(46)} pts ${String(p.home.pts).padStart(2)}-${String(p.away.pts).padEnd(2)}  pick ${label(p).padEnd(4)}  actual ${p.result[0]}-${p.result[1]}  ${p.ouCorrect ? 'O/U ✓' : 'O/U ✗'}`);
}
const a = accuracy(graded).overall;
console.log(`\n${from}${days > 1 ? ' → ' + to : ''}: ${a.correct}/${a.n} results correct (${a.pct}%), over/under ${a.ouCorrect}/${a.ouN} (${a.ouPct}%)`);
