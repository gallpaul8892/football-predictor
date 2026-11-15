// Front end: reads the JSON files in data/ (written by the GitHub Actions runs) and renders them.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => (v === null || v === undefined ? '–' : `${v}%`);
const state = { league: '', q: '' };
let D = {};
let LG = {};

async function load(path) {
  try { const r = await fetch(`data/${path}?v=${Date.now()}`); return r.ok ? r.json() : null; } catch { return null; }
}

const fmtDay = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const pickLabel = (p) => (p.pick === 'H' ? `${p.home.name} win` : p.pick === 'A' ? `${p.away.name} win` : 'Draw');
const form = s => `<span class="form">${[...(s || '')].map(c => `<i class="${c}">${c}</i>`).join('')}</span>`;

function filterPreds(list) {
  const q = state.q.toLowerCase();
  return list.filter(p => (!state.league || p.lg === state.league) &&
    (!q || p.home.name?.toLowerCase().includes(q) || p.away.name?.toLowerCase().includes(q)));
}

// ---------------- Upcoming ----------------
function matchCard(p) {
  const br = (s) => `<table>
    <tr><td>Wins in last ${D.latest.settings.formGames}</td><td>${s.br.form}</td></tr>
    <tr><td>${s === p.home ? 'Home' : 'Away'} wins</td><td>${s.br.venueForm}</td></tr>
    <tr><td>Places above opponent</td><td>${s.br.position}</td></tr>
    <tr><td>Head-to-head wins</td><td>${s.br.h2h}</td></tr>
    <tr><td><b>Total points</b></td><td><b>${s.pts}</b></td></tr>
    <tr><td>Form (oldest → newest)</td><td>${form(s.form)}</td></tr>
    <tr><td>${s === p.home ? 'Home' : 'Away'} form</td><td>${form(s.venue)}</td></tr>
    <tr><td>Goals for / against per game</td><td>${s.gf} / ${s.ga}</td></tr>
  </table>`;
  return `<details class="match">
    <summary>
      <span class="time">${fmtTime(p.ko)}</span>
      <span class="team home ${p.pick === 'H' ? 'fav' : ''}"><span class="nm">${esc(p.home.name)}</span><small>${p.home.pos ? ordinal(p.home.pos) : ''} ${form(p.home.form.slice(-5))}</small></span>
      <span class="score"><span class="pts">${p.home.pts} – ${p.away.pts}</span><small>points</small></span>
      <span class="team ${p.pick === 'A' ? 'fav' : ''}"><span class="nm">${esc(p.away.name)}</span><small>${form(p.away.form.slice(-5))} ${p.away.pos ? ordinal(p.away.pos) : ''}</small></span>
      <span class="pick"><span class="badge ${p.pick}">${esc(pickLabel(p))}</span>${p.thin ? ' <span class="badge thin">little data</span>' : ''}
        <small>margin ${p.margin} · ${p.goals} goals exp. · ${p.over ? 'Over' : 'Under'} ${D.latest.settings.overUnderLine}</small></span>
    </summary>
    <div class="detail"><div><h3>${esc(p.home.name)} (home)</h3>${br(p.home)}</div><div><h3>${esc(p.away.name)} (away)</h3>${br(p.away)}</div>
    <div class="muted">Head-to-head meetings in data: ${p.h2hPlayed}. Expected goals ${p.xg[0]} – ${p.xg[1]}.</div></div>
  </details>`;
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

function renderUpcoming() {
  const el = $('#upcoming');
  if (!D.latest) return (el.innerHTML = `<div class="empty">No data yet. Run the <b>Setup</b> workflow in GitHub Actions first.</div>`);
  const list = filterPreds(D.latest.upcoming);
  const o = D.latest.overall, w = D.latest.review.summary;
  let html = `<div class="stats">
    <div class="stat"><b>${list.length}</b><span>fixtures, ${fmtDay(D.latest.window[0]).split(' ').slice(0, 1)} → ${fmtDay(D.latest.window[1]).split(' ')[0]}</span></div>
    <div class="stat"><b>${pct(w.pct)}</b><span>last 7 days (${w.correct}/${w.n})</span></div>
    <div class="stat"><b>${pct(o.pct)}</b><span>live all-time (${o.n} games)</span></div>
    <div class="stat"><b>${pct(D.backtest?.overall?.pct)}</b><span>backtest (${D.backtest?.overall?.n ?? 0} games)</span></div>
  </div>
  <p class="muted">Tap a match to see how the points were worked out. Higher points = predicted winner; a gap of ${D.latest.settings.drawMargin} or less = draw.</p>`;
  if (!list.length) html += `<div class="empty">No fixtures in this window${state.league || state.q ? ' for this filter' : ''}.</div>`;
  let day = '', lg = '';
  for (const p of list) {
    if (p.day !== day) { day = p.day; lg = ''; html += `<div class="day">${fmtDay(day)}</div>`; }
    if (p.lg !== lg) { lg = p.lg; html += `<div class="lgname">${esc(LG[lg]?.name || lg)}</div>`; }
    html += matchCard(p);
  }
  el.innerHTML = html;
}

// ---------------- Review ----------------
function renderReview() {
  const el = $('#review');
  if (!D.latest) return (el.innerHTML = '');
  const r = D.latest.review;
  const list = filterPreds(r.matches.map(m => ({ ...m, home: { name: m.home }, away: { name: m.away } })));
  const ok = list.filter(m => m.correct).length;
  let html = `<h2>Predictions vs results, ${fmtDay(r.from)} – ${fmtDay(r.to)}</h2>
  <div class="stats">
    <div class="stat"><b>${list.length ? Math.round((ok / list.length) * 1000) / 10 + '%' : '–'}</b><span>result correct (${ok}/${list.length})</span></div>
    <div class="stat"><b>${list.length ? Math.round((list.filter(m => m.ouCorrect).length / list.length) * 1000) / 10 + '%' : '–'}</b><span>over/under correct</span></div>
  </div>`;
  if (!list.length) return (el.innerHTML = html + `<div class="empty">No graded predictions in the last 7 days yet.</div>`);
  html += `<div class="tbl"><table><thead><tr><th class="l">Date</th><th class="l">League</th><th class="l">Match</th><th>Predicted</th><th>Score</th><th>Result</th><th>O/U</th></tr></thead><tbody>`;
  for (const m of list) {
    html += `<tr><td class="l">${m.day}</td><td class="l muted">${esc(LG[m.lg]?.name || m.lg)}</td><td class="l">${esc(m.home.name)} v ${esc(m.away.name)}</td>
      <td>${m.pick === 'H' ? 'Home' : m.pick === 'A' ? 'Away' : 'Draw'} <span class="muted">(${m.margin})</span></td>
      <td>${m.result[0]}–${m.result[1]}</td><td><span class="badge ${m.correct ? 'ok' : 'no'}">${m.correct ? '✓' : '✗'}</span></td>
      <td><span class="badge ${m.ouCorrect ? 'ok' : 'no'}">${m.over ? 'O' : 'U'}</span></td></tr>`;
  }
  el.innerHTML = html + '</tbody></table></div>';
}

// ---------------- Accuracy (live & backtest share this) ----------------
const sorts = {};
function sortableTable(id, cols, rows, defaultKey) {
  const s = (sorts[id] ??= { key: defaultKey, dir: -1 });
  rows.sort((a, b) => {
    const x = a[s.key], y = b[s.key];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * s.dir;
  });
  return `<div class="tbl" style="max-height:620px"><table data-sort="${id}"><thead><tr>${cols.map(c => `<th class="${c.l ? 'l' : ''}" data-key="${c.k}">${c.t}${s.key === c.k ? (s.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>
  ${rows.map(r => `<tr>${cols.map(c => `<td class="${c.l ? 'l' : ''}">${c.f ? c.f(r) : esc(r[c.k] ?? '–')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function accuracyView(acc, id, intro) {
  if (!acc || !acc.overall?.n) return `${intro}<div class="empty">Nothing graded yet — this fills in as results come in.</div>`;
  const o = acc.overall;
  const minN = +($(`#${id}-min`)?.value ?? 5);
  const dist = acc.actualDist;
  let html = `${intro}<div class="stats">
    <div class="stat"><b>${pct(o.pct)}</b><span>results correct (${o.correct}/${o.n})</span></div>
    <div class="stat"><b>${pct(o.ouPct)}</b><span>over/under correct</span></div>
    <div class="stat"><b>${Math.round((Math.max(dist.H, dist.D, dist.A) / o.n) * 1000) / 10}%</b><span>baseline: always pick ${dist.H >= dist.A && dist.H >= dist.D ? 'home' : dist.A >= dist.D ? 'away' : 'draw'}</span></div>
  </div>`;

  html += `<h3>By points margin — does a bigger gap mean a safer pick?</h3>` + simpleTable(
    ['0-1', '2-3', '4-6', '7-10', '11+'].filter(k => acc.byMargin[k]).map(k => ({ label: `Margin ${k}`, ...acc.byMargin[k] })));
  html += `<h3>By predicted outcome</h3>` + simpleTable(['H', 'D', 'A'].filter(k => acc.byPick[k]).map(k => ({ label: { H: 'Home win', D: 'Draw', A: 'Away win' }[k], ...acc.byPick[k] })));
  html += `<h3>By league</h3>` + simpleTable(Object.entries(acc.byLeague).map(([k, v]) => ({ label: LG[k]?.name || k, ...v })).sort((a, b) => b.pct - a.pct));

  const weeks = acc.byWeek.slice(-26);
  html += `<h3>Week by week</h3>` + simpleTable(weeks.map(w => ({ label: `w/c ${w.week}`, ...w })).reverse());

  const q = state.q.toLowerCase();
  const teams = Object.entries(acc.byTeam).map(([tid, t]) => ({ tid, ...t, lgName: LG[t.lg]?.name || t.lg }))
    .filter(t => t.n >= minN && (!state.league || t.lg === state.league) && (!q || t.name?.toLowerCase().includes(q)));
  html += `<h3>By team</h3><div class="row"><label>Min. games <input id="${id}-min" type="number" min="1" value="${minN}" style="width:70px"></label>
    <span class="muted">“Backed” = games where the model picked this team to win.</span></div>` +
    sortableTable(id, [
      { k: 'name', t: 'Team', l: 1 }, { k: 'lgName', t: 'League', l: 1 }, { k: 'n', t: 'Games' },
      { k: 'pct', t: 'Correct', f: r => `<span class="bar" style="width:${(r.pct || 0) * 0.6}px"></span> ${pct(r.pct)}` },
      { k: 'backedN', t: 'Backed' }, { k: 'backedPct', t: 'Backed correct', f: r => pct(r.backedPct) }, { k: 'ouPct', t: 'O/U', f: r => pct(r.ouPct) },
    ], teams, 'pct');
  return html;
}

function simpleTable(rows) {
  return `<div class="tbl"><table><thead><tr><th class="l"></th><th>Games</th><th>Correct</th><th>Hit rate</th><th>O/U</th></tr></thead><tbody>${rows.map(r =>
    `<tr><td class="l">${esc(r.label)}</td><td>${r.n}</td><td>${r.correct}</td><td><span class="bar" style="width:${(r.pct || 0) * 0.8}px"></span> ${pct(r.pct)}</td><td>${pct(r.ouPct)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderAccuracy() {
  $('#accuracy').innerHTML = accuracyView(D.accuracy, 'acc', `<h2>Live accuracy</h2><p class="muted">Every prediction the daily run made before kick-off, graded once the result came in.</p>`);
  const b = D.backtest;
  $('#backtest').innerHTML = accuracyView(b, 'bt', `<h2>Backtest</h2><p class="muted">The model replayed over ${b ? `${b.from} → ${b.to}` : 'past results'}, each match predicted using only data from before kick-off. Use this to judge the model before the live record builds up.</p>`);
}

// ---------------- Tables ----------------
function renderTables() {
  const el = $('#tables');
  if (!D.tables) return (el.innerHTML = '');
  let html = `<h2>League tables ${esc(D.tables.season)}</h2><p class="muted">Calculated from the stored results (points deductions aren't included).</p>`;
  for (const lg of D.latest.leagues) {
    if (state.league && lg.key !== state.league) continue;
    const rows = D.tables.tables[lg.key] || [];
    const divs = [...new Set(rows.map(r => r.div))];
    for (const d of divs) {
      const q = state.q.toLowerCase();
      html += `<h3>${esc(lg.name)}${divs.length > 1 ? ` — division ${d}` : ''}</h3><div class="tbl"><table><thead><tr><th>#</th><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>`;
      for (const r of rows.filter(r => r.div === d))
        html += `<tr style="${q && r.name?.toLowerCase().includes(q) ? 'background:var(--accent-soft)' : ''}"><td>${r.pos}</td><td class="l">${esc(r.name)}</td><td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td><td>${r.GF}</td><td>${r.GA}</td><td>${r.GD}</td><td><b>${r.Pts}</b></td></tr>`;
      html += `</tbody></table></div>`;
    }
  }
  el.innerHTML = html;
}

// ---------------- Runs ----------------
function renderRuns() {
  const runs = (D.runs || []).slice().reverse();
  $('#runs').innerHTML = `<h2>Run history</h2><p class="muted">Each run is saved in <code>data/runs/</code> and committed to the repo.</p>` + (runs.length ? `<div class="tbl"><table><thead><tr><th class="l">Run date</th><th>New results</th><th>Graded</th><th>Predicted</th><th>Last 7 days</th><th>All-time</th><th>Results stored</th></tr></thead><tbody>${runs.map(r =>
    `<tr><td class="l"><a href="data/runs/${r.date}.json">${r.date}</a></td><td>${r.newResults}</td><td>${r.graded}</td><td>${r.predicted}</td><td>${pct(r.week.pct)} <span class="muted">(${r.week.n})</span></td><td>${pct(r.overall.pct)} <span class="muted">(${r.overall.n})</span></td><td>${r.totalResults}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No runs yet.</div>');
}

// ---------------- About ----------------
function renderAbout() {
  const s = D.latest?.settings || {};
  $('#about').innerHTML = `<div class="about"><h2>How the prediction works</h2>
  <p>Each side of a fixture gets points; the side with more points is the predicted winner. If the gap is ${s.drawMargin ?? 1} or less, it's a draw.</p>
  <ul>
    <li><b>Form</b> — +1 for every win in the team's last ${s.formGames ?? 10} league games.</li>
    <li><b>Home / away form</b> — +1 for every win in the last ${s.formGames ?? 10} ${s.venueFormMode === 'withinLastN' ? 'games that came at the same venue' : 'games at the same venue'} (home wins for the home side, away wins for the away side).</li>
    <li><b>League position</b> — +1 for every place the team sits above its opponent.</li>
    <li><b>Head-to-head</b> — +1 for every previous win against this opponent in the stored data (up to 2 years).</li>
  </ul>
  <p><b>Goals:</b> expected goals for each side = (its average scored + opponent's average conceded) ÷ 2, over the last ${s.formGames ?? 10} games. Total above ${s.overUnderLine ?? 2.5} = “Over”.</p>
  <p>Weights for each factor, the number of games, and the draw margin live in <code>config.json</code>. Change them and re-run the Backtest workflow to see if accuracy improves.</p>
  <p class="muted">Not yet included: recent news (injuries, managers) — planned as a later AI step.</p></div>`;
}

function renderAll() { renderUpcoming(); renderReview(); renderAccuracy(); renderTables(); renderRuns(); renderAbout(); }

// ---------------- wiring ----------------
document.addEventListener('click', e => {
  const t = e.target.closest('#tabs button');
  if (t) {
    document.querySelectorAll('#tabs button, .tab').forEach(x => x.classList.remove('on'));
    t.classList.add('on'); $('#' + t.dataset.tab).classList.add('on');
    history.replaceState(null, '', '#' + t.dataset.tab);
  }
  const th = e.target.closest('th[data-key]');
  if (th) {
    const id = th.closest('table').dataset.sort, s = sorts[id];
    if (s.key === th.dataset.key) s.dir *= -1; else { s.key = th.dataset.key; s.dir = -1; }
    renderAccuracy();
  }
});
document.addEventListener('change', e => { if (e.target.matches('#acc-min, #bt-min')) renderAccuracy(); });
$('#league').addEventListener('change', e => { state.league = e.target.value; renderAll(); });
$('#search').addEventListener('input', e => { state.q = e.target.value; renderAll(); });

(async () => {
  const [latest, accuracy, backtest, tables, runs] = await Promise.all(['latest.json', 'accuracy.json', 'backtest.json', 'tables.json', 'runs/index.json'].map(load));
  D = { latest, accuracy, backtest, tables, runs };
  if (latest) {
    LG = Object.fromEntries(latest.leagues.map(l => [l.key, l]));
    $('#league').innerHTML += latest.leagues.map(l => `<option value="${l.key}">${esc(l.country)} · ${esc(l.name)}</option>`).join('');
    $('#meta').textContent = `English & Scottish leagues · updated ${new Date(latest.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`;
  } else $('#meta').textContent = 'No data yet';
  renderAll();
  const h = location.hash.slice(1);
  if (h && $(`#tabs button[data-tab="${h}"]`)) $(`#tabs button[data-tab="${h}"]`).click();
})();
