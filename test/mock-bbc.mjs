// Test harness: replaces fetch() with a fake BBC feed (same JSON shape as the real one)
// so the pipeline can be exercised offline.  Usage: node --import ./test/mock-bbc.mjs scripts/setup.mjs
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const poisson = l => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= rand(); } while (p > L); return k - 1; };

const TODAY = process.env.TODAY;
const leagues = {};
function league(slug) {
  if (leagues[slug]) return leagues[slug];
  const divs = slug === 'national-league-north' ? [24, 24] : [slug.startsWith('scottish') && slug !== 'scottish-premiership' ? 10 : 20];
  const events = [];
  let n = 0;
  divs.forEach((size, di) => {
    const teams = Array.from({ length: size }, (_, i) => ({ id: `${slug}-${di}-t${i}`, name: `${slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')} ${di ? 'S' : ''}FC ${i + 1}`, str: 0.6 + rand() * 1.2 }));
    for (const startYear of [2024, 2025, 2026]) {
      // double round robin, one round per Saturday from early August
      const rounds = [];
      const ids = teams.map((_, i) => i);
      for (let r = 0; r < size - 1; r++) {
        const pairs = [];
        for (let i = 0; i < size / 2; i++) pairs.push([ids[i], ids[size - 1 - i]]);
        rounds.push(pairs);
        ids.splice(1, 0, ids.pop());
      }
      const all = [...rounds, ...rounds.map(p => p.map(([a, b]) => [b, a]))];
      all.forEach((pairs, r) => {
        const d = new Date(Date.UTC(startYear, 7, 2 + r * 7, 14));
        for (const [hi, ai] of pairs) {
          const h = teams[hi], a = teams[ai];
          const iso = d.toISOString().replace('.000', '');
          const ymd = iso.slice(0, 10);
          const played = ymd < TODAY;
          const hs = poisson(1.45 * h.str / a.str ** 0.5), as = poisson(1.1 * a.str / h.str ** 0.5);
          const postponed = played && rand() < 0.01;
          const side = (t, s) => ({ id: 'x' + t.id, fullName: t.name, shortName: t.name, urn: `urn:bbc:sportsdata:football:team:${t.id}`, score: played && !postponed ? String(s) : undefined });
          events.push({
            id: `s-${slug}-${n++}`,
            startDateTime: iso,
            status: played ? 'PostEvent' : 'PreEvent',
            statusComment: { value: postponed ? 'Postponed' : played ? 'FT' : 'Scheduled' },
            home: side(h, hs), away: side(a, as),
          });
        }
      });
    }
  });
  return (leagues[slug] = events);
}

globalThis.fetch = async url => {
  const u = new URL(url);
  const slug = u.searchParams.get('urn').split(':').pop();
  const s = u.searchParams.get('selectedStartDate'), e = u.searchParams.get('selectedEndDate');
  const evs = league(slug).filter(ev => ev.startDateTime.slice(0, 10) >= s && ev.startDateTime.slice(0, 10) <= e);
  const body = { eventGroups: [{ displayLabel: 'x', secondaryGroups: [{ displayLabel: 'y', events: evs }] }] };
  return { ok: true, status: 200, json: async () => body };
};
