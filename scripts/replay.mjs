// REPLAY a past date: what would the model have predicted (using only results from
// before kick-off) vs what actually happened?
// Usage: node scripts/replay.mjs [YYYY-MM-DD] [days]   (default: yesterday, 1 day)
import { buildContext, predict, grade, accuracyAll } from './lib/model.mjs';
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
  const tl = p.tuned ? (p.tuned.pick === 'H' ? 'Home' : p.tuned.pick === 'A' ? 'Away' : 'Draw') : '-';
  const bk = p.banker ? `  BANKER ${p.banker.side === 'H' ? 'home' : 'away'} win/draw ${p.banker.correct ? '✓' : '✗'}` : '';
  console.log(`  ${(p.home.name + ' v ' + p.away.name).padEnd(44)} ${p.result[0]}-${p.result[1]}  original ${label(p).padEnd(4)} ${p.correct ? '✓' : '✗'}  tuned ${tl.padEnd(4)} ${p.tuned?.correct ? '✓' : '✗'}  O/U ${p.ouCorrect ? '✓' : '✗'}${bk}`);
}
const all = accuracyAll(graded), a = all.overall, t = all.tuned.overall, b = all.bankers.overall;
console.log(`\n${from}${days > 1 ? ' → ' + to : ''}:`);
console.log(`  original rules  ${a.correct}/${a.n} (${a.pct}%)`);
console.log(`  tuned model     ${t.correct}/${t.n} (${t.pct}%)`);
console.log(`  bankers         ${b.correct}/${b.n} (${b.pct ?? '–'}%)  [favourite wins or draws]`);
console.log(`  over/under      ${a.ouCorrect}/${a.ouN} (${a.ouPct}%)`);
