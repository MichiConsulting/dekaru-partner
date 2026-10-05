// Kalender: Termine (termin_datum der Kunden) und offene Wiedervorlagen als
// eine Liste, dazu die Ausgabe als iCalendar (RFC 5545). Termine koennen eine
// Uhrzeit (Wanduhrzeit Europe/Berlin) und eine Dauer haben, ohne Uhrzeit sind
// sie ganztaegig; Wiedervorlagen sind immer ganztaegig. Fuer den Abo-Link
// gelten die Datenschutz-Grenzen aus dem Briefing: nur Betriebsname, Status,
// Datum und Uhrzeit, keine Telefonnummern, keine Notizen, kein Grund der
// Wiedervorlage.

import type { Db } from './db.ts';
import { STANDARD_DAUER, isoDatum, istUuid, statusLabel, uhrzeit, type Status } from './kunden.ts';
import { ZEITZONE, icsDatum, icsZeitstempel, plusTage } from './datum.ts';
import { wiedervorlagenImZeitraum } from './wiedervorlage.ts';

export type EintragTyp = 'termin' | 'wiedervorlage';

export interface KalenderEintrag {
  typ: EintragTyp;
  datum: string;
  /** HH:MM in Europe/Berlin, null bei ganztaegigen Eintraegen. */
  beginn: string | null;
  /** Dauer in Minuten, nur mit beginn. */
  dauerMinuten: number | null;
  kundeId: string;
  kundeName: string;
  ort: string;
  status: Status;
  /** Nur bei Wiedervorlagen, nur fuer die Anzeige im Portal. */
  grund: string;
  /** Letzte Aenderung am Kunden, fuer SEQUENCE und DTSTAMP. */
  geaendertAm: Date;
}

interface TerminZeile {
  id: string;
  name: string;
  ort: string;
  status: Status;
  termin_datum: string | Date;
  termin_beginn: string | null;
  termin_dauer_minuten: number | string | null;
  geaendert_am: string | Date;
}

function zeitAus(z: Pick<TerminZeile, 'termin_beginn' | 'termin_dauer_minuten'>): { beginn: string | null; dauerMinuten: number | null } {
  const beginn = uhrzeit(z.termin_beginn);
  return { beginn, dauerMinuten: beginn ? Number(z.termin_dauer_minuten ?? STANDARD_DAUER) : null };
}

/** Innerhalb eines Tages: ganztaegige zuerst (Termine vor Wiedervorlagen), dann nach Uhrzeit. */
export function vergleicheEintraege(a: KalenderEintrag, b: KalenderEintrag): number {
  return (
    a.datum.localeCompare(b.datum) ||
    Number(a.beginn !== null) - Number(b.beginn !== null) ||
    (a.beginn ?? '').localeCompare(b.beginn ?? '') ||
    a.typ.localeCompare(b.typ) ||
    a.kundeName.localeCompare(b.kundeName, 'de')
  );
}

/** Termine eines Vertrieblers in einem Zeitraum (beide Grenzen einschliesslich). */
export async function termineImZeitraum(db: Db, benutzerId: string, von: string, bis: string): Promise<KalenderEintrag[]> {
  const zeilen = await db.query<TerminZeile>(
    `SELECT id, name, ort, status, termin_datum, termin_beginn, termin_dauer_minuten, geaendert_am FROM kunden
     WHERE benutzer_id = $1 AND termin_datum IS NOT NULL AND termin_datum >= $2::date AND termin_datum <= $3::date
     ORDER BY termin_datum, termin_beginn NULLS FIRST, name`,
    [benutzerId, von, bis],
  );
  return zeilen.map((z) => ({
    typ: 'termin',
    datum: isoDatum(z.termin_datum) ?? '',
    ...zeitAus(z),
    kundeId: z.id,
    kundeName: z.name,
    ort: z.ort,
    status: z.status,
    grund: '',
    geaendertAm: new Date(z.geaendert_am),
  }));
}

/** Termine und offene Wiedervorlagen zusammen, nach Datum sortiert. */
export async function eintraegeImZeitraum(db: Db, benutzerId: string, von: string, bis: string): Promise<KalenderEintrag[]> {
  const termine = await termineImZeitraum(db, benutzerId, von, bis);
  const wiedervorlagen = await wiedervorlagenImZeitraum(db, benutzerId, von, bis);
  const alle: KalenderEintrag[] = [
    ...termine,
    ...wiedervorlagen.map<KalenderEintrag>((w) => ({
      typ: 'wiedervorlage',
      datum: w.datum,
      beginn: null,
      dauerMinuten: null,
      kundeId: w.kundeId,
      kundeName: w.kundeName,
      ort: w.ort,
      status: w.status,
      grund: w.grund,
      geaendertAm: w.geaendertAm,
    })),
  ];
  return alle.sort(vergleicheEintraege);
}

/** Ein einzelner Eintrag eines eigenen Kunden, fuer den Download einer .ics-Datei. */
export async function holeEintrag(db: Db, benutzerId: string, typ: string, kundeId: string): Promise<KalenderEintrag | null> {
  if (!istUuid(kundeId) || (typ !== 'termin' && typ !== 'wiedervorlage')) return null;
  const zeilen = await db.query<TerminZeile & { wiedervorlage_am: string | Date | null; wiedervorlage_grund: string; wiedervorlage_erledigt_am: string | Date | null }>(
    `SELECT id, name, ort, status, termin_datum, termin_beginn, termin_dauer_minuten, geaendert_am, wiedervorlage_am, wiedervorlage_grund, wiedervorlage_erledigt_am
     FROM kunden WHERE id = $1 AND benutzer_id = $2`,
    [kundeId, benutzerId],
  );
  const z = zeilen[0];
  if (!z) return null;
  const datum = typ === 'termin' ? isoDatum(z.termin_datum) : z.wiedervorlage_erledigt_am ? null : isoDatum(z.wiedervorlage_am);
  if (!datum) return null;
  return {
    typ,
    datum,
    ...(typ === 'termin' ? zeitAus(z) : { beginn: null, dauerMinuten: null }),
    kundeId: z.id,
    kundeName: z.name,
    ort: z.ort,
    status: z.status,
    grund: typ === 'wiedervorlage' ? z.wiedervorlage_grund ?? '' : '',
    geaendertAm: new Date(z.geaendert_am),
  };
}

/** Eintraege nach Tag gruppiert, nur Tage mit Eintraegen, in Reihenfolge. */
export function nachTag(eintraege: KalenderEintrag[]): { datum: string; eintraege: KalenderEintrag[] }[] {
  const tage = new Map<string, KalenderEintrag[]>();
  for (const e of eintraege) {
    const liste = tage.get(e.datum) ?? [];
    liste.push(e);
    tage.set(e.datum, liste);
  }
  return [...tage.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([datum, liste]) => ({ datum, eintraege: liste }));
}

// ---------------------------------------------------------------------------
// iCalendar

export const ICS_DOMAIN = 'partner.dekaru.de';
const PRODID = '-//dekaru//Partner-Portal//DE';

/**
 * Maskiert Text nach RFC 5545, Abschnitt 3.3.11: Backslash, Semikolon und
 * Komma bekommen einen Backslash, Zeilenumbrueche werden zu \n.
 * Steuerzeichen fliegen heraus.
 */
export function icsText(wert: string): string {
  return String(wert ?? '')
    .replace(/\r\n|\r|\n/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Faltet eine Zeile auf hoechstens 75 Oktette (RFC 5545, 3.1). Gezaehlt
 * werden Bytes in UTF-8, nicht Zeichen, damit Umlaute die Grenze nicht
 * sprengen; getrennt wird nie mitten in einem Mehrbyte-Zeichen.
 */
export function icsFalten(zeile: string): string {
  const MAX = 75;
  const teile: string[] = [];
  let aktuell = '';
  let bytes = 0;
  let grenze = MAX;
  for (const zeichen of zeile) {
    const laenge = Buffer.byteLength(zeichen, 'utf8');
    if (bytes + laenge > grenze) {
      teile.push(aktuell);
      aktuell = ' ';
      bytes = 1;
      grenze = MAX;
    }
    aktuell += zeichen;
    bytes += laenge;
  }
  teile.push(aktuell);
  return teile.join('\r\n');
}

/** Stabile Kennung je Eintrag, damit Kalender-Apps Aenderungen als Update erkennen. */
export function icsUid(e: Pick<KalenderEintrag, 'typ' | 'kundeId'>): string {
  return `${e.typ}-${e.kundeId}@${ICS_DOMAIN}`;
}

function summary(e: KalenderEintrag): string {
  const status = statusLabel(e.status);
  return e.typ === 'termin' ? `Termin: ${e.kundeName} (${status})` : `Wiedervorlage: ${e.kundeName} (${status})`;
}

/**
 * Ende eines Termins als Wanduhrzeit: Datum und HH:MM, ueber Mitternacht
 * hinaus auf den Folgetag. Gerechnet wird in lokaler Zeit, so wie Kalender-
 * Apps DTSTART und DTEND mit TZID lesen.
 */
export function terminEnde(datum: string, beginn: string, dauerMinuten: number): { datum: string; zeit: string } {
  const [h, m] = beginn.split(':').map(Number);
  const gesamt = h * 60 + m + dauerMinuten;
  const tage = Math.floor(gesamt / 1440);
  const rest = gesamt - tage * 1440;
  return {
    datum: plusTage(datum, tage),
    zeit: `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`,
  };
}

/** Lokale Zeit fuer ICS: 20261007T143000 (ohne Z, die Zeitzone steht im TZID-Parameter). */
function icsLokal(datum: string, zeit: string): string {
  return `${icsDatum(datum)}T${zeit.replace(':', '')}00`;
}

function vevent(e: KalenderEintrag, jetzt: Date): string[] {
  const sequence = Math.max(0, Math.floor(e.geaendertAm.getTime() / 1000));
  let zeit: string[];
  if (e.beginn) {
    // Mit Uhrzeit: lokale Zeit mit TZID=Europe/Berlin, die VTIMEZONE dazu
    // steht einmal im Kalender (RFC 5545, 3.2.19 und 3.6.5). Der Termin
    // belegt die Zeit, darum OPAQUE.
    const ende = terminEnde(e.datum, e.beginn, e.dauerMinuten ?? STANDARD_DAUER);
    zeit = [
      `DTSTART;TZID=${ZEITZONE}:${icsLokal(e.datum, e.beginn)}`,
      `DTEND;TZID=${ZEITZONE}:${icsLokal(ende.datum, ende.zeit)}`,
    ];
  } else {
    // Ganztaegig: DTEND ist der Folgetag, ausschliesslich. Mit VALUE=DATE gibt
    // es keine TZID, der Tag gilt in jeder Zeitzone als derselbe Kalendertag.
    zeit = [`DTSTART;VALUE=DATE:${icsDatum(e.datum)}`, `DTEND;VALUE=DATE:${icsDatum(plusTage(e.datum, 1))}`];
  }
  return [
    'BEGIN:VEVENT',
    `UID:${icsUid(e)}`,
    `DTSTAMP:${icsZeitstempel(jetzt)}`,
    ...zeit,
    `SUMMARY:${icsText(summary(e))}`,
    `CATEGORIES:${e.typ === 'termin' ? 'Termin' : 'Wiedervorlage'}`,
    `SEQUENCE:${sequence}`,
    `TRANSP:${e.beginn ? 'OPAQUE' : 'TRANSPARENT'}`,
    'END:VEVENT',
  ];
}

// Europe/Berlin nach RFC 5545, Abschnitt 3.6.5, mit den beiden
// Umstellungsregeln seit 1996. Termine mit Uhrzeit verweisen per TZID darauf,
// ganztaegige Eintraege brauchen sie nicht.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${ZEITZONE}`,
  'X-LIC-LOCATION:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/** Erzeugt einen vollstaendigen Kalender. Zeilen enden mit CRLF, lange Zeilen sind gefaltet. */
export function erzeugeIcs(eintraege: KalenderEintrag[], name: string, jetzt = new Date()): string {
  const zeilen = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`,
    `X-WR-TIMEZONE:${ZEITZONE}`,
    // Kalender-Apps duerfen das Abo stuendlich neu laden.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...VTIMEZONE,
    ...eintraege.flatMap((e) => vevent(e, jetzt)),
    'END:VCALENDAR',
  ];
  return zeilen.map(icsFalten).join('\r\n') + '\r\n';
}

/** Dateiname ohne Sonderzeichen, fuer Content-Disposition. */
export function icsDateiname(e: KalenderEintrag): string {
  const name = e.kundeName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `${e.typ}-${e.datum}${name ? `-${name}` : ''}.ics`;
}
