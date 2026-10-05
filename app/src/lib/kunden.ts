// Meine Kunden: Betriebe, die ein Vertriebler anspricht. Jede Abfrage traegt
// die Benutzer-ID, niemand sieht fremde Eintraege.

import type { Db } from './db.ts';
import { istIsoDatum } from './datum.ts';

export const STATUS = [
  { wert: 'angerufen', label: 'Angerufen' },
  { wert: 'termin', label: 'Termin vereinbart' },
  { wert: 'zweittermin', label: 'Zweittermin' },
  { wert: 'angebot', label: 'Angebot' },
  { wert: 'abschluss', label: 'Abschluss' },
  { wert: 'absage', label: 'Absage' },
] as const;

export type Status = (typeof STATUS)[number]['wert'];

export const STATUS_WERTE: readonly Status[] = STATUS.map((s) => s.wert);

export function statusLabel(wert: string): string {
  return STATUS.find((s) => s.wert === wert)?.label ?? wert;
}

export interface KundeEingabe {
  name: string;
  ort: string;
  ansprechpartner: string;
  telefon: string;
  status: Status;
  terminDatum: string | null;
  /** Beginn als Wanduhrzeit in Europe/Berlin, HH:MM. Ohne Beginn ist der Termin ganztaegig. */
  terminBeginn?: string | null;
  /** Dauer in Minuten, nur zusammen mit terminBeginn. */
  terminDauer?: number | null;
  notiz: string;
}

export interface Kunde extends KundeEingabe {
  id: string;
  benutzerId: string;
  statusSeit: string;
  erstelltAm: Date;
  geaendertAm: Date;
}

interface KundeZeile {
  id: string;
  benutzer_id: string;
  name: string;
  ort: string;
  ansprechpartner: string;
  telefon: string;
  status: Status;
  status_seit: string | Date;
  termin_datum: string | Date | null;
  termin_beginn: string | null;
  termin_dauer_minuten: number | string | null;
  notiz: string;
  erstellt_am: string | Date;
  geaendert_am: string | Date;
}

const FELDER = 'id, benutzer_id, name, ort, ansprechpartner, telefon, status, status_seit, termin_datum, termin_beginn, termin_dauer_minuten, notiz, erstellt_am, geaendert_am';

/** Datumswerte kommen je nach Treiber als Date oder Text. Hier wird alles zu JJJJ-MM-TT. */
export function isoDatum(wert: string | Date | null | undefined): string | null {
  if (!wert) return null;
  if (wert instanceof Date) {
    const j = wert.getFullYear();
    const m = String(wert.getMonth() + 1).padStart(2, '0');
    const t = String(wert.getDate()).padStart(2, '0');
    return `${j}-${m}-${t}`;
  }
  return String(wert).slice(0, 10);
}

function zuKunde(z: KundeZeile): Kunde {
  return {
    id: z.id,
    benutzerId: z.benutzer_id,
    name: z.name,
    ort: z.ort,
    ansprechpartner: z.ansprechpartner,
    telefon: z.telefon,
    status: z.status,
    statusSeit: isoDatum(z.status_seit) ?? '',
    terminDatum: isoDatum(z.termin_datum),
    terminBeginn: uhrzeit(z.termin_beginn),
    terminDauer: z.termin_dauer_minuten == null ? null : Number(z.termin_dauer_minuten),
    notiz: z.notiz,
    erstelltAm: new Date(z.erstellt_am),
    geaendertAm: new Date(z.geaendert_am),
  };
}

/** Standarddauer eines Termins mit Uhrzeit, wenn keine angegeben ist. */
export const STANDARD_DAUER = 60;
export const DAUER_MIN = 5;
export const DAUER_MAX = 720;
/** Auswahl im Formular. Andere Werte aus der Datenbank bleiben erhalten. */
export const DAUER_AUSWAHL = [15, 30, 45, 60, 90, 120, 180, 240] as const;

/**
 * Uhrzeit aus Datenbank oder Formular als HH:MM. Beide Treiber liefern time
 * als HH:MM:SS, das Formular HH:MM. Alles andere ergibt null.
 */
export function uhrzeit(wert: unknown): string | null {
  const t = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(String(wert ?? '').trim());
  return t ? `${t[1]}:${t[2]}` : null;
}

/** "90 Min." wird "1 Std. 30 Min.", fuer die Anzeige. */
export function dauerText(minuten: number): string {
  const h = Math.floor(minuten / 60);
  const m = minuten % 60;
  if (h === 0) return `${m} Min.`;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

function text(wert: unknown, max: number): string {
  return String(wert ?? '').trim().slice(0, max);
}

/** Prueft ein Formular. Liefert die bereinigten Werte und eine Liste von Fehlern. */
export function pruefeKunde(eingabe: Record<string, unknown>): { wert: KundeEingabe; fehler: string[] } {
  const fehler: string[] = [];
  const name = text(eingabe.name, 120);
  if (!name) fehler.push('Der Name des Betriebs fehlt.');

  const status = String(eingabe.status ?? '');
  if (!STATUS_WERTE.includes(status as Status)) fehler.push('Der Status ist unbekannt.');

  let terminDatum: string | null = text(eingabe.terminDatum ?? eingabe.termin_datum, 10) || null;
  if (terminDatum && !/^\d{4}-\d{2}-\d{2}$/.test(terminDatum)) {
    fehler.push('Das Termin-Datum muss im Format JJJJ-MM-TT vorliegen.');
    terminDatum = null;
  } else if (terminDatum && Number.isNaN(new Date(`${terminDatum}T12:00:00Z`).getTime())) {
    fehler.push('Das Termin-Datum ist kein gültiges Datum.');
    terminDatum = null;
  }
  if ((status === 'termin' || status === 'zweittermin') && !terminDatum) {
    fehler.push('Zu einem Termin gehört ein Datum.');
  }

  const zeit = pruefeUhrzeit(eingabe, terminDatum);
  fehler.push(...zeit.fehler);

  return {
    wert: {
      name,
      ort: text(eingabe.ort, 120),
      ansprechpartner: text(eingabe.ansprechpartner, 120),
      telefon: text(eingabe.telefon, 40),
      status: status as Status,
      terminDatum,
      terminBeginn: zeit.beginn,
      terminDauer: zeit.dauer,
      notiz: text(eingabe.notiz, 2000),
    },
    fehler,
  };
}

/**
 * Uhrzeit und Dauer eines Termins. Ohne Datum gibt es keine Uhrzeit, ohne
 * Uhrzeit keine Dauer (das Auswahlfeld schickt immer eine mit, sie faellt
 * dann still weg). Fehlt die Dauer, gilt STANDARD_DAUER.
 */
export function pruefeUhrzeit(
  eingabe: Record<string, unknown>,
  terminDatum: string | null,
): { beginn: string | null; dauer: number | null; fehler: string[] } {
  const fehler: string[] = [];
  const roh = text(eingabe.terminBeginn ?? eingabe.termin_beginn, 12);
  let beginn = roh ? uhrzeit(roh) : null;
  if (roh && !beginn) fehler.push('Die Uhrzeit muss im Format HH:MM vorliegen, zum Beispiel 14:30.');
  if (beginn && !terminDatum) {
    fehler.push('Zu einer Uhrzeit gehört ein Datum.');
    beginn = null;
  }
  if (!beginn) return { beginn: null, dauer: null, fehler };

  const dauerRoh = text(eingabe.terminDauer ?? eingabe.termin_dauer_minuten, 6);
  let dauer = STANDARD_DAUER;
  if (dauerRoh) {
    const zahl = /^\d+$/.test(dauerRoh) ? Number(dauerRoh) : NaN;
    if (!Number.isInteger(zahl) || zahl < DAUER_MIN || zahl > DAUER_MAX) {
      fehler.push(`Die Dauer muss zwischen ${DAUER_MIN} Minuten und ${DAUER_MAX / 60} Stunden liegen.`);
    } else {
      dauer = zahl;
    }
  }
  return { beginn, dauer, fehler };
}

export interface KundenFilter {
  status?: string;
  suche?: string;
}

export async function listeKunden(db: Db, benutzerId: string, filter: KundenFilter = {}): Promise<Kunde[]> {
  const bedingungen = ['benutzer_id = $1'];
  const params: unknown[] = [benutzerId];
  if (filter.status && STATUS_WERTE.includes(filter.status as Status)) {
    params.push(filter.status);
    bedingungen.push(`status = $${params.length}`);
  }
  const suche = text(filter.suche, 100);
  if (suche) {
    params.push(`%${suche.replace(/[%_\\]/g, (z) => `\\${z}`)}%`);
    const n = params.length;
    bedingungen.push(`(name ILIKE $${n} OR ort ILIKE $${n} OR ansprechpartner ILIKE $${n})`);
  }
  const zeilen = await db.query<KundeZeile>(
    `SELECT ${FELDER} FROM kunden WHERE ${bedingungen.join(' AND ')} ORDER BY geaendert_am DESC, name`,
    params,
  );
  return zeilen.map(zuKunde);
}

export async function holeKunde(db: Db, benutzerId: string, id: string): Promise<Kunde | null> {
  if (!istUuid(id)) return null;
  const zeilen = await db.query<KundeZeile>(`SELECT ${FELDER} FROM kunden WHERE id = $1 AND benutzer_id = $2`, [
    id,
    benutzerId,
  ]);
  return zeilen[0] ? zuKunde(zeilen[0]) : null;
}

export async function erstelleKunde(db: Db, benutzerId: string, daten: KundeEingabe, heute = heuteIso()): Promise<Kunde> {
  const zeilen = await db.query<KundeZeile>(
    `INSERT INTO kunden (benutzer_id, name, ort, ansprechpartner, telefon, status, status_seit, termin_datum, notiz,
                         termin_beginn, termin_dauer_minuten)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${FELDER}`,
    [benutzerId, daten.name, daten.ort, daten.ansprechpartner, daten.telefon, daten.status, heute, daten.terminDatum, daten.notiz,
      ...zeitWerte(daten)],
  );
  return zuKunde(zeilen[0]);
}

/** Aendert nur einen eigenen Kunden. Ein neuer Status setzt status_seit auf heute. */
export async function aendereKunde(
  db: Db,
  benutzerId: string,
  id: string,
  daten: KundeEingabe,
  heute = heuteIso(),
): Promise<Kunde | null> {
  const alt = await holeKunde(db, benutzerId, id);
  if (!alt) return null;
  const statusSeit = alt.status === daten.status ? alt.statusSeit : heute;
  const zeilen = await db.query<KundeZeile>(
    `UPDATE kunden
     SET name = $3, ort = $4, ansprechpartner = $5, telefon = $6, status = $7, status_seit = $8,
         termin_datum = $9, notiz = $10, termin_beginn = $11, termin_dauer_minuten = $12, geaendert_am = now()
     WHERE id = $1 AND benutzer_id = $2
     RETURNING ${FELDER}`,
    [id, benutzerId, daten.name, daten.ort, daten.ansprechpartner, daten.telefon, daten.status, statusSeit, daten.terminDatum, daten.notiz,
      ...zeitWerte(daten)],
  );
  return zeilen[0] ? zuKunde(zeilen[0]) : null;
}

/** Beginn und Dauer fuer die Datenbank: nur mit Datum und Beginn, sonst beide NULL. */
function zeitWerte(daten: Pick<KundeEingabe, 'terminDatum' | 'terminBeginn' | 'terminDauer'>): [string | null, number | null] {
  const beginn = daten.terminDatum ? uhrzeit(daten.terminBeginn) : null;
  return [beginn, beginn ? (daten.terminDauer ?? STANDARD_DAUER) : null];
}

export interface TerminEingabe {
  kundeId: string;
  status: Status;
  datum: string;
  beginn: string | null;
  dauer: number | null;
}

/**
 * Prueft das Formular "Neuer Termin" im Kalender: ein eigener Betrieb, ein
 * Datum, wahlweise Uhrzeit und Dauer, dazu der Status. Der Status steht
 * ausdruecklich im Formular, weil ein Wechsel in die Monatszahlen eingeht.
 */
export function pruefeTermin(eingabe: Record<string, unknown>): { wert: TerminEingabe; fehler: string[] } {
  const fehler: string[] = [];
  const kundeId = text(eingabe.kundeId, 40);
  if (!istUuid(kundeId)) fehler.push('Bitte einen Betrieb auswählen.');
  const status = String(eingabe.status ?? '');
  if (!STATUS_WERTE.includes(status as Status)) fehler.push('Der Status ist unbekannt.');
  let datum: string | null = text(eingabe.terminDatum ?? eingabe.datum, 10);
  if (!istIsoDatum(datum)) {
    fehler.push('Das Datum fehlt oder ist ungültig.');
    datum = null;
  }
  const zeit = pruefeUhrzeit(eingabe, datum);
  fehler.push(...zeit.fehler);
  return {
    wert: { kundeId, status: status as Status, datum: datum ?? '', beginn: zeit.beginn, dauer: zeit.dauer },
    fehler,
  };
}

/**
 * Setzt den Termin eines eigenen Betriebs, ein vorhandener wird ersetzt.
 * Ein neuer Status setzt status_seit auf heute, wie beim Bearbeiten.
 */
export async function setzeTermin(db: Db, benutzerId: string, termin: TerminEingabe, heute = heuteIso()): Promise<Kunde | null> {
  const alt = await holeKunde(db, benutzerId, termin.kundeId);
  if (!alt) return null;
  const statusSeit = alt.status === termin.status ? alt.statusSeit : heute;
  const [beginn, dauer] = zeitWerte({ terminDatum: termin.datum, terminBeginn: termin.beginn, terminDauer: termin.dauer });
  const zeilen = await db.query<KundeZeile>(
    `UPDATE kunden
     SET status = $3, status_seit = $4, termin_datum = $5, termin_beginn = $6, termin_dauer_minuten = $7, geaendert_am = now()
     WHERE id = $1 AND benutzer_id = $2
     RETURNING ${FELDER}`,
    [termin.kundeId, benutzerId, termin.status, statusSeit, termin.datum, beginn, dauer],
  );
  return zeilen[0] ? zuKunde(zeilen[0]) : null;
}

export async function loescheKunde(db: Db, benutzerId: string, id: string): Promise<boolean> {
  if (!istUuid(id)) return false;
  const zeilen = await db.query<{ id: string }>('DELETE FROM kunden WHERE id = $1 AND benutzer_id = $2 RETURNING id', [
    id,
    benutzerId,
  ]);
  return zeilen.length > 0;
}

export interface Monatszahlen {
  termine: number;
  abschluesse: number;
  neue: number;
}

/** Termine und Abschluesse eines Monats (JJJJ-MM) fuer einen Vertriebler. */
export async function monatszahlen(db: Db, benutzerId: string, monat: string): Promise<Monatszahlen> {
  const von = `${monat}-01`;
  const bis = naechsterMonatErster(monat);
  const zeilen = await db.query<{ termine: string; abschluesse: string; neue: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE termin_datum >= $2::date AND termin_datum < $3::date) AS termine,
       COUNT(*) FILTER (WHERE status = 'abschluss' AND status_seit >= $2::date AND status_seit < $3::date) AS abschluesse,
       COUNT(*) FILTER (WHERE erstellt_am >= $2::date AND erstellt_am < $3::date) AS neue
     FROM kunden WHERE benutzer_id = $1`,
    [benutzerId, von, bis],
  );
  return {
    termine: Number(zeilen[0]?.termine ?? 0),
    abschluesse: Number(zeilen[0]?.abschluesse ?? 0),
    neue: Number(zeilen[0]?.neue ?? 0),
  };
}

export interface KundeMitVertriebler extends Kunde {
  vertrieblerName: string;
}

/** Nur fuer den Admin: alle Kunden aller Vertriebler. */
export async function alleKunden(db: Db, filter: KundenFilter & { benutzerId?: string } = {}): Promise<KundeMitVertriebler[]> {
  const bedingungen = ['TRUE'];
  const params: unknown[] = [];
  if (filter.benutzerId && istUuid(filter.benutzerId)) {
    params.push(filter.benutzerId);
    bedingungen.push(`k.benutzer_id = $${params.length}`);
  }
  if (filter.status && STATUS_WERTE.includes(filter.status as Status)) {
    params.push(filter.status);
    bedingungen.push(`k.status = $${params.length}`);
  }
  const zeilen = await db.query<KundeZeile & { vertriebler_name: string }>(
    `SELECT k.id, k.benutzer_id, k.name, k.ort, k.ansprechpartner, k.telefon, k.status, k.status_seit, k.termin_datum,
            k.termin_beginn, k.termin_dauer_minuten, k.notiz, k.erstellt_am, k.geaendert_am, b.name AS vertriebler_name
     FROM kunden k JOIN benutzer b ON b.id = k.benutzer_id
     WHERE ${bedingungen.join(' AND ')}
     ORDER BY k.geaendert_am DESC`,
    params,
  );
  return zeilen.map((z) => ({ ...zuKunde(z), vertrieblerName: z.vertriebler_name }));
}

export function istUuid(wert: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(wert ?? ''));
}

export function heuteIso(): string {
  return isoDatum(new Date()) ?? '';
}

export function aktuellerMonat(): string {
  return heuteIso().slice(0, 7);
}

function naechsterMonatErster(monat: string): string {
  const [jahr, mm] = monat.split('-').map(Number);
  const index = jahr * 12 + (mm - 1) + 1;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}
