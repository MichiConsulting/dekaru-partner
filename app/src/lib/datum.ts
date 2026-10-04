// Kalenderdaten ohne Uhrzeit, immer als Text JJJJ-MM-TT. Gerechnet wird in
// UTC, damit Sommerzeit und Serverzeitzone nichts verschieben; "heute" kommt
// aus Europe/Berlin, denn der Server auf Vercel laeuft in UTC und laege sonst
// zwischen 22 und 24 Uhr einen Tag zurueck.

export const ZEITZONE = 'Europe/Berlin';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const BERLIN = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZEITZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Das heutige Datum in Europe/Berlin. */
export function heuteBerlin(jetzt = new Date()): string {
  // en-CA liefert genau JJJJ-MM-TT.
  return BERLIN.format(jetzt);
}

export function istIsoDatum(wert: unknown): wert is string {
  if (typeof wert !== 'string' || !ISO.test(wert)) return false;
  const [j, m, t] = wert.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

function zuUtc(iso: string): Date {
  const [j, m, t] = iso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t));
}

function zuIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function plusTage(iso: string, tage: number): string {
  const d = zuUtc(iso);
  d.setUTCDate(d.getUTCDate() + tage);
  return zuIso(d);
}

/** Tage von a bis b, negativ wenn b vor a liegt. */
export function tageZwischen(a: string, b: string): number {
  return Math.round((zuUtc(b).getTime() - zuUtc(a).getTime()) / 86400000);
}

/** 1 = Montag ... 7 = Sonntag. */
export function wochentag(iso: string): number {
  const tag = zuUtc(iso).getUTCDay();
  return tag === 0 ? 7 : tag;
}

export interface Bereich {
  /** Erster Tag, einschliesslich. */
  von: string;
  /** Letzter Tag, einschliesslich. */
  bis: string;
}

/** Montag bis Sonntag der Woche, in der das Datum liegt. */
export function woche(iso: string): Bereich {
  const von = plusTage(iso, 1 - wochentag(iso));
  return { von, bis: plusTage(von, 6) };
}

/** Erster und letzter Tag des Monats JJJJ-MM. */
export function monat(jjjjmm: string): Bereich {
  const [j, m] = jjjjmm.split('-').map(Number);
  const von = `${j}-${String(m).padStart(2, '0')}-01`;
  const letzter = new Date(Date.UTC(j, m, 0));
  return { von, bis: zuIso(letzter) };
}

export function istMonat(wert: unknown): wert is string {
  return typeof wert === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(wert);
}

export function monatVon(iso: string): string {
  return iso.slice(0, 7);
}

export function monatPlus(jjjjmm: string, schritte: number): string {
  const [j, m] = jjjjmm.split('-').map(Number);
  const index = j * 12 + (m - 1) + schritte;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Quartal des Monats: erster und letzter Monat als JJJJ-MM. */
export function quartal(jjjjmm: string): { von: string; bis: string; nummer: number; jahr: number } {
  const [j, m] = jjjjmm.split('-').map(Number);
  const nummer = Math.floor((m - 1) / 3) + 1;
  const erster = (nummer - 1) * 3 + 1;
  return {
    von: `${j}-${String(erster).padStart(2, '0')}`,
    bis: `${j}-${String(erster + 2).padStart(2, '0')}`,
    nummer,
    jahr: j,
  };
}

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export function wochentagName(iso: string, kurz = false): string {
  return (kurz ? WOCHENTAGE_KURZ : WOCHENTAGE)[wochentag(iso) - 1];
}

/** "Mo, 05.10." fuer Listen, mit Jahr wenn gewuenscht. */
export function datumKurz(iso: string, mitJahr = false): string {
  const t = ISO.exec(iso);
  if (!t) return iso;
  return `${wochentagName(iso, true)}, ${t[3]}.${t[2]}.${mitJahr ? t[1] : ''}`;
}

/** Zeitstempel fuer ICS in UTC: 20261004T160000Z */
export function icsZeitstempel(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Datum fuer ICS ohne Uhrzeit: 20261005 */
export function icsDatum(iso: string): string {
  return iso.replace(/-/g, '');
}
