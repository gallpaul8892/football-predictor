// The prediction model: a points system built from recent form, venue form,
// league position and head-to-head record. Pure functions over stored results.
// No imports so the same file runs in Node and in the browser (Replay tab).
let config;
export function setConfig(c) { config = c; }
export function getConfig() { return config; }

function seasonStart(isoOrYmd) {
  const y = +isoOrYmd.slice(0, 4), m = +isoOrYmd.slice(5, 7);
  return `${m >= 7 ? y : y - 1}-07-01`;
}

/** Build lookup structures from { leagueKey: [results] }. */
export function buildContext(resultsByLeague) {
  const byTeam = new Map();
  const byLeague = new Map();
  const names = new Map();
  const push = (team, row) => {
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(row);
  };
  for (const [lg, list] of Object.entries(resultsByLeague)) {
    const sorted = [...list].sort((a, b) => a.ko.localeCompare(b.ko));
    byLeague.set(lg, sorted);
    for (const m of sorted) {
      names.set(m.h, m.hn); names.set(m.a, m.an);
      push(m.h, { ko: m.ko, lg, venue: 'H', opp: m.a, gf: m.hs, ga: m.as });
      push(m.a, { ko: m.ko, lg, venue: 'A', opp: m.h, gf: m.as, ga: m.hs });
    }
  }
  for (const arr of byTeam.values()) arr.sort((a, b) => a.ko.localeCompare(b.ko));
  return { byTeam, byLeague, names, tableCache: new Map() };
}

/** Index of the first element with ko >= iso (i.e. count of matches strictly before). */
function countBefore(arr, iso) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ko < iso) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function history(ctx, team, beforeIso) {
  const arr = ctx.byTeam.get(team) || [];
  return arr.slice(0, countBefore(arr, beforeIso));
}

const won = r => r.gf > r.ga;

/**
 * League table for a league's season, using results before `beforeIso`.
 * Teams are split into divisions by who has played whom, so combined feeds
 * (e.g. National League North + South) produce separate tables.
 * Returns Map team -> { pos, divisionSize, P, W, D, L, GF, GA, GD, Pts, div }.
 */
export function leagueTable(ctx, lg, beforeIso) {
  const start = seasonStart(beforeIso);
  const key = `${lg}|${beforeIso.slice(0, 10)}`;
  if (ctx.tableCache.has(key)) return ctx.tableCache.get(key);

  const all = ctx.byLeague.get(lg) || [];
  const games = all.slice(countBefore(all, start + 'T00:00:00Z'), countBefore(all, beforeIso.slice(0, 10) + 'T00:00:00Z'));
  const rows = new Map();
  const parent = new Map();
  const find = t => { while (parent.get(t) !== t) { parent.set(t, parent.get(parent.get(t))); t = parent.get(t); } return t; };
  const row = t => {
    if (!rows.has(t)) { rows.set(t, { team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0 }); parent.set(t, t); }
    return rows.get(t);
  };
  for (const m of games) {
    const h = row(m.h), a = row(m.a);
    parent.set(find(m.h), find(m.a));
    h.P++; a.P++; h.GF += m.hs; h.GA += m.as; a.GF += m.as; a.GA += m.hs;
    if (m.hs > m.as) { h.W++; a.L++; } else if (m.hs < m.as) { a.W++; h.L++; } else { h.D++; a.D++; }
  }
  const divisions = new Map();
  for (const r of rows.values()) {
    r.GD = r.GF - r.GA; r.Pts = r.W * 3 + r.D;
    const d = find(r.team);
    if (!divisions.has(d)) divisions.set(d, []);
    divisions.get(d).push(r);
  }
  const table = new Map();
  let divNo = 0;
  for (const list of [...divisions.values()].sort((a, b) => b.length - a.length)) {
    divNo++;
    list.sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || ctx.names.get(a.team)?.localeCompare(ctx.names.get(b.team)));
    list.forEach((r, i) => table.set(r.team, { ...r, pos: i + 1, divisionSize: list.length, div: divNo }));
  }
  ctx.tableCache.set(key, table);
  return table;
}

function goalStats(recent) {
  if (!recent.length) return { avgFor: 0, avgAgainst: 0 };
  const f = recent.reduce((s, r) => s + r.gf, 0), a = recent.reduce((s, r) => s + r.ga, 0);
  return { avgFor: f / recent.length, avgAgainst: a / recent.length };
}

const formString = recent => recent.map(r => (r.gf > r.ga ? 'W' : r.gf < r.ga ? 'L' : 'D')).join('');

/** Score one side of a fixture. venue = 'H' | 'A'. */
function scoreSide(ctx, team, opp, venue, lg, ko) {
  const N = config.formGames, w = config.weights;
  const past = history(ctx, team, ko);
  const recent = past.slice(-N);

  // 1. +1 per win in the last N games
  const formWins = recent.filter(won).length;

  // 2. +1 per win at this venue (home wins if at home, away wins if away)
  const venueGames = config.venueFormMode === 'withinLastN'
    ? recent.filter(r => r.venue === venue)
    : past.filter(r => r.venue === venue).slice(-N);
  const venueWins = venueGames.filter(won).length;

  // 3. +1 per league place above the opponent
  const table = leagueTable(ctx, lg, ko);
  const me = table.get(team), them = table.get(opp);
  const sameDiv = me && them && me.div === them.div;
  const placesAbove = sameDiv ? Math.max(0, them.pos - me.pos) : 0;

  // 4. +1 per previous win against this opponent
  const h2h = past.filter(r => r.opp === opp);
  const h2hWins = h2h.filter(won).length;

  const breakdown = { form: formWins, venueForm: venueWins, position: placesAbove, h2h: h2hWins };
  const points = breakdown.form * w.form + breakdown.venueForm * w.venueForm + breakdown.position * w.position + breakdown.h2h * w.h2h;

  return {
    id: team,
    name: ctx.names.get(team),
    points,
    breakdown,
    form: formString(recent),
    venueRecord: formString(venueGames),
    pos: me ? me.pos : null,
    h2hPlayed: h2h.length,
    goals: goalStats(recent),
    gamesUsed: recent.length,
  };
}

/** Predict a fixture { id, lg, ko, h, a, hn, an }. */
export function predict(ctx, fx) {
  if (fx.hn) ctx.names.set(fx.h, fx.hn);
  if (fx.an) ctx.names.set(fx.a, fx.an);
  const home = scoreSide(ctx, fx.h, fx.a, 'H', fx.lg, fx.ko);
  const away = scoreSide(ctx, fx.a, fx.h, 'A', fx.lg, fx.ko);
  const diff = home.points - away.points;
  const m = config.drawMargin;
  const pick = diff > m ? 'H' : diff < -m ? 'A' : 'D';

  // Goals: blend each side's scoring rate with the other side's conceding rate.
  const xgH = (home.goals.avgFor + away.goals.avgAgainst) / 2;
  const xgA = (away.goals.avgFor + home.goals.avgAgainst) / 2;
  const total = xgH + xgA;

  const r2 = x => Math.round(x * 100) / 100;
  return {
    id: fx.id, lg: fx.lg, ko: fx.ko, day: fx.day,
    home: { id: home.id, name: home.name, pts: home.points, br: home.breakdown, form: home.form, venue: home.venueRecord, pos: home.pos, gf: r2(home.goals.avgFor), ga: r2(home.goals.avgAgainst) },
    away: { id: away.id, name: away.name, pts: away.points, br: away.breakdown, form: away.form, venue: away.venueRecord, pos: away.pos, gf: r2(away.goals.avgFor), ga: r2(away.goals.avgAgainst) },
    h2hPlayed: home.h2hPlayed,
    pick,
    margin: Math.abs(diff),
    xg: [r2(xgH), r2(xgA)],
    goals: r2(total),
    over: total > config.overUnderLine,
    thin: Math.min(home.gamesUsed, away.gamesUsed) < Math.min(5, config.formGames),
  };
}

/** Attach an actual result to a prediction. */
export function grade(pred, hs, as) {
  const outcome = hs > as ? 'H' : hs < as ? 'A' : 'D';
  return { ...pred, result: [hs, as], outcome, correct: pred.pick === outcome, ouCorrect: (hs + as > config.overUnderLine) === pred.over };
}

// ---------- accuracy ----------
const bandOf = m => (m <= 1 ? '0-1' : m <= 3 ? '2-3' : m <= 6 ? '4-6' : m <= 10 ? '7-10' : '11+');

function tally() { return { n: 0, correct: 0, ouN: 0, ouCorrect: 0 }; }
function add(t, p) { t.n++; if (p.correct) t.correct++; t.ouN++; if (p.ouCorrect) t.ouCorrect++; }
function finish(t) { t.pct = t.n ? Math.round((t.correct / t.n) * 1000) / 10 : null; t.ouPct = t.ouN ? Math.round((t.ouCorrect / t.ouN) * 1000) / 10 : null; return t; }

function weekStart(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
}

/** Aggregate graded predictions into overall / league / team / pick / margin / weekly accuracy. */
export function accuracy(graded) {
  const overall = tally(), byLeague = {}, byPick = {}, byMargin = {}, byWeek = {}, byTeam = {};
  const actualDist = { H: 0, D: 0, A: 0 };
  for (const p of graded) {
    add(overall, p);
    actualDist[p.outcome]++;
    add(byLeague[p.lg] ??= tally(), p);
    add(byPick[p.pick] ??= tally(), p);
    add(byMargin[bandOf(p.margin)] ??= tally(), p);
    add(byWeek[weekStart(p.day || p.ko.slice(0, 10))] ??= tally(), p);
    for (const side of ['home', 'away']) {
      const s = p[side];
      const t = (byTeam[s.id] ??= { ...tally(), name: s.name, lg: p.lg, backedN: 0, backedCorrect: 0 });
      t.name = s.name; t.lg = p.lg;
      add(t, p);
      const backed = (side === 'home' && p.pick === 'H') || (side === 'away' && p.pick === 'A');
      if (backed) { t.backedN++; if (p.correct) t.backedCorrect++; }
    }
  }
  const fin = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, finish(v)]));
  const teams = fin(byTeam);
  for (const t of Object.values(teams)) t.backedPct = t.backedN ? Math.round((t.backedCorrect / t.backedN) * 1000) / 10 : null;
  return {
    overall: finish(overall),
    actualDist,
    byLeague: fin(byLeague),
    byPick: fin(byPick),
    byMargin: fin(byMargin),
    byWeek: Object.entries(fin(byWeek)).sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v })),
    byTeam: teams,
  };
}
