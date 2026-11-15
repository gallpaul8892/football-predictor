// Shared helpers: dates (UK time), JSON storage, config.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = path.join(ROOT, 'data');

export const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// ---------- dates ----------
const ukFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' in UK time for a Date / ISO string. */
export function ukDate(d = new Date()) {
  return ukFmt.format(typeof d === 'string' ? new Date(d) : d);
}

/** Today's UK date, overridable with TODAY=YYYY-MM-DD for testing. */
export function today() {
  return process.env.TODAY || ukDate(new Date());
}

export function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMonths(ymd, n) {
  const d = new Date(ymd.slice(0, 7) + '-01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(ymd) {
  const d = new Date(ymd.slice(0, 7) + '-01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Split [start, end] into chunks that never cross a month boundary (the BBC feed needs this). */
export function monthChunks(start, end) {
  const out = [];
  let s = start;
  while (s <= end) {
    const e = lastDayOfMonth(s) < end ? lastDayOfMonth(s) : end;
    out.push([s, e]);
    s = addDays(e, 1);
  }
  return out;
}

/** Football season a date belongs to: seasons start 1 July. Returns e.g. '2025-26'. */
export function seasonOf(isoOrYmd) {
  const ymd = isoOrYmd.slice(0, 10);
  const y = +ymd.slice(0, 4);
  const startYear = +ymd.slice(5, 7) >= 7 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function seasonStart(isoOrYmd) {
  return seasonOf(isoOrYmd).slice(0, 4) + '-07-01';
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- storage ----------
export function readJSON(rel, fallback) {
  const p = path.join(DATA, rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Arrays of records are written one record per line so git diffs stay readable. */
export function writeJSON(rel, value) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let text;
  if (Array.isArray(value)) {
    text = value.length ? '[\n' + value.map(v => JSON.stringify(v)).join(',\n') + '\n]\n' : '[]\n';
  } else {
    text = JSON.stringify(value, null, 1) + '\n';
  }
  fs.writeFileSync(p, text);
}

export function listData(relDir) {
  const p = path.join(DATA, relDir);
  return fs.existsSync(p) ? fs.readdirSync(p).sort() : [];
}

// ---------- results store ----------
export function loadResults(leagueKey) {
  return readJSON(`results/${leagueKey}.json`, []);
}

export function saveResults(leagueKey, list) {
  list.sort((a, b) => a.ko.localeCompare(b.ko) || a.id.localeCompare(b.id));
  writeJSON(`results/${leagueKey}.json`, list);
}

/** Merge new results into an existing list by match id. Returns number of genuinely new matches. */
export function mergeResults(existing, incoming) {
  const byId = new Map(existing.map(m => [m.id, m]));
  let added = 0;
  for (const m of incoming) {
    if (!byId.has(m.id)) added++;
    byId.set(m.id, m);
  }
  existing.length = 0;
  existing.push(...byId.values());
  return added;
}

export function log(...a) { console.log(...a); }
