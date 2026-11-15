// Replay tab: re-runs the prediction model in the browser for any past date, using only
// results from before each kick-off, and compares it with what actually happened.
import { setConfig, buildContext, predict, grade, accuracy } from './scripts/lib/model.mjs';

let ctx = null, allResults = null, loading = null;
const el = document.getElementById('replay');
const ymd = d => d.toISOString().slice(0, 10);
const ukDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); };
let chosen = location.hash.match(/replay=(\d{4}-\d{2}-\d{2})/)?.[1] || yesterday();

async function loadAll() {
  const cfg = await (await fetch(`config.json?v=${Date.now()}`)).json();
  setConfig(cfg);
  const byLeague = {};
  await Promise.all(cfg.leagues.map(async lg => {
    const r = await fetch(`data/results/${lg.key}.json?v=${Date.now()}`);
    byLeague[lg.key] = r.ok ? await r.json() : [];
  }));
  allResults = byLeague;
  ctx = buildContext(byLeague);
}

function shell(body) {
  el.innerHTML = `<h2>Replay a date</h2>
  <p class="muted">Pick a past date. The model predicts every match that day using only results from before kick-off, then compares with what actually happened.</p>
  <div class="row"><input type="date" id="replay-date" value="${chosen}" max="${yesterday()}">
    <button id="replay-prev" class="btn">◀ Day before</button><button id="replay-next" class="btn">Day after ▶</button></div>${body}`;
}

window.renderReplay = async function () {
  if (document.getElementById('replay').classList.contains('on')) history.replaceState(null, '', '#replay=' + chosen);
  if (!ctx) {
    shell('<div class="empty">Loading results…</div>');
    try { await (loading ??= loadAll()); } catch { return shell('<div class="empty">No results stored yet. Run the Setup workflow first.</div>'); }
  }
  const graded = [];
  for (const [lg, list] of Object.entries(allResults))
    for (const m of list) {
      const day = ukDay(m.ko);
      if (day !== chosen) continue;
      graded.push(grade(predict(ctx, { id: m.id, lg, ko: m.ko, day, h: m.h, a: m.a, hn: m.hn, an: m.an }), m.hs, m.as));
    }
  const list = filterPreds(graded).sort((a, b) => a.lg.localeCompare(b.lg) || a.ko.localeCompare(b.ko));
  if (!list.length) return shell(`<div class="empty">No results stored for ${fmtDay(chosen)}${state.league || state.q ? ' with this filter' : ''}.</div>`);
  const a = accuracy(list).overall;
  let html = `<div class="stats">
    <div class="stat"><b>${a.pct}%</b><span>results correct (${a.correct}/${a.n})</span></div>
    <div class="stat"><b>${a.ouPct}%</b><span>over/under correct (${a.ouCorrect}/${a.ouN})</span></div></div>`;
  let lg = '';
  for (const p of list) {
    if (p.lg !== lg) { lg = p.lg; html += `<div class="lgname">${esc(LG[lg]?.name || lg)}</div>`; }
    html += matchCard(p);
  }
  shell(html);
};

el.addEventListener('change', e => { if (e.target.id === 'replay-date' && e.target.value) { chosen = e.target.value; renderReplay(); } });
el.addEventListener('click', e => {
  const step = e.target.id === 'replay-prev' ? -1 : e.target.id === 'replay-next' ? 1 : 0;
  if (!step) return;
  const d = new Date(chosen + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + step);
  if (ymd(d) <= yesterday()) { chosen = ymd(d); renderReplay(); }
});

// Only start downloading results when the tab is opened.
document.querySelector('#tabs button[data-tab="replay"]').addEventListener('click', () => renderReplay());
if (location.hash.startsWith('#replay')) renderReplay();
