// Fetches scores & fixtures from the JSON feed that powers
// https://www.bbc.co.uk/sport/football/<league>/scores-fixtures/<YYYY-MM>
import { config, monthChunks, sleep, today, ukDate } from './util.mjs';

const BASE = 'https://web-cdn.api.bbci.co.uk/wc-poll-data/container/sport-data-scores-fixtures';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function feedUrl(slug, start, end) {
  const urn = `urn:bbc:sportsdata:football:tournament:${slug}`;
  return `${BASE}?selectedEndDate=${end}&selectedStartDate=${start}&todayDate=${today()}&urn=${encodeURIComponent(urn)}&useSdApi=false`;
}

async function getJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 404) return { eventGroups: [] };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${e.message} for ${url}`);
      await sleep(1500 * i);
    }
  }
}

/** Raw BBC events for one league between two dates (any span; split by month internally). */
export async function fetchEvents(slug, start, end) {
  const events = [];
  for (const [s, e] of monthChunks(start, end)) {
    const json = await getJSON(feedUrl(slug, s, e));
    for (const g of json.eventGroups || [])
      for (const sg of g.secondaryGroups || [])
        events.push(...(sg.events || []));
    await sleep(+(process.env.REQUEST_DELAY_MS ?? config.requestDelayMs));
  }
  return events;
}

const teamId = side => (side?.urn || '').split(':').pop() || side?.id;
const toInt = v => (v === undefined || v === null || v === '' || isNaN(+v) ? null : +v);

/**
 * Normalise a BBC event into our compact shape.
 * kind: 'result' | 'fixture' | 'live' | 'off' (postponed/abandoned/cancelled)
 */
export function normalise(ev, leagueKey) {
  const comment = ev.statusComment?.value || ev.periodLabel?.value || '';
  const hs = toInt(ev.home?.score ?? ev.participants?.find(p => p.alignment === 'home')?.score);
  const as = toInt(ev.away?.score ?? ev.participants?.find(p => p.alignment === 'away')?.score);
  let kind;
  if (/postp|abandon|cancel|suspend|void|awarded/i.test(comment)) kind = 'off';
  else if (ev.status === 'PostEvent' && hs !== null && as !== null) kind = 'result';
  else if (ev.status === 'PreEvent') kind = 'fixture';
  else if (ev.status === 'MidEvent') kind = 'live';
  else kind = 'off';
  const ko = ev.startDateTime || ev.date?.iso;
  return {
    id: ev.id,
    lg: leagueKey,
    ko,
    day: ukDate(ko),
    h: teamId(ev.home), hn: ev.home?.fullName || ev.home?.shortName,
    a: teamId(ev.away), an: ev.away?.fullName || ev.away?.shortName,
    hs, as,
    kind,
    note: kind === 'off' ? comment : undefined,
  };
}

/** Results + fixtures for a league in a date range, already normalised. */
export async function fetchLeague(league, start, end) {
  const raw = await fetchEvents(league.slug, start, end);
  const seen = new Set();
  const out = [];
  for (const ev of raw) {
    if (!ev?.id || seen.has(ev.id)) continue;
    seen.add(ev.id);
    const m = normalise(ev, league.key);
    if (m.h && m.a && m.ko) out.push(m);
  }
  return out;
}

/** Strip a normalised match down to what we store as a result. */
export function asResult(m) {
  return { id: m.id, ko: m.ko, h: m.h, hn: m.hn, a: m.a, an: m.an, hs: m.hs, as: m.as };
}
