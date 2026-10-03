// Meine Kunden: Betriebe, die ein Vertriebler anspricht. Jede Abfrage traegt
// die Benutzer-ID, niemand sieht fremde Eintraege.

import type { Db } from './db.ts';

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
  notiz: string;
  erstellt_am: string | Date;
  geaendert_am: string | Date;
}

const FELDER = 'id, benutzer_id, name, ort, ansprechpartner, telefon, status, status_seit, termin_datum, notiz, erstellt_am, geaendert_am';

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
    notiz: z.notiz,
    erstelltAm: new Date(z.erstellt_am),
    geaendertAm: new Date(z.geaendert_am),
  };
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

  return {
    wert: {
      name,
      ort: text(eingabe.ort, 120),
      ansprechpartner: text(eingabe.ansprechpartner, 120),
      telefon: text(eingabe.telefon, 40),
      status: status as Status,
      terminDatum,
      notiz: text(eingabe.notiz, 2000),
    },
    fehler,
  };
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
    `INSERT INTO kunden (benutzer_id, name, ort, ansprechpartner, telefon, status, status_seit, termin_datum, notiz)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${FELDER}`,
    [benutzerId, daten.name, daten.ort, daten.ansprechpartner, daten.telefon, daten.status, heute, daten.terminDatum, daten.notiz],
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
         termin_datum = $9, notiz = $10, geaendert_am = now()
     WHERE id = $1 AND benutzer_id = $2
     RETURNING ${FELDER}`,
    [id, benutzerId, daten.name, daten.ort, daten.ansprechpartner, daten.telefon, daten.status, statusSeit, daten.terminDatum, daten.notiz],
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
            k.notiz, k.erstellt_am, k.geaendert_am, b.name AS vertriebler_name
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
