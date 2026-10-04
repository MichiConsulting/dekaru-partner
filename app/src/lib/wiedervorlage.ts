// Wiedervorlage: ein Datum und ein kurzer Grund je Kunde, dazu "erledigt".
// Liegt in Spalten der Tabelle kunden (Migration 005). Jede Abfrage traegt
// die Benutzer-ID, niemand sieht oder aendert fremde Eintraege.

import type { Db } from './db.ts';
import { isoDatum, istUuid, type Status } from './kunden.ts';
import { heuteBerlin, istIsoDatum, tageZwischen, woche } from './datum.ts';

export const GRUND_MAX = 200;

export interface WiedervorlageEingabe {
  datum: string;
  grund: string;
}

export interface Wiedervorlage {
  kundeId: string;
  kundeName: string;
  ort: string;
  status: Status;
  datum: string;
  grund: string;
  erledigtAm: Date | null;
  geaendertAm: Date;
}

interface Zeile {
  id: string;
  name: string;
  ort: string;
  status: Status;
  wiedervorlage_am: string | Date | null;
  wiedervorlage_grund: string;
  wiedervorlage_erledigt_am: string | Date | null;
  geaendert_am: string | Date;
}

const FELDER = 'id, name, ort, status, wiedervorlage_am, wiedervorlage_grund, wiedervorlage_erledigt_am, geaendert_am';

function zuWiedervorlage(z: Zeile): Wiedervorlage | null {
  const datum = isoDatum(z.wiedervorlage_am);
  if (!datum) return null;
  return {
    kundeId: z.id,
    kundeName: z.name,
    ort: z.ort,
    status: z.status,
    datum,
    grund: z.wiedervorlage_grund ?? '',
    erledigtAm: z.wiedervorlage_erledigt_am ? new Date(z.wiedervorlage_erledigt_am) : null,
    geaendertAm: new Date(z.geaendert_am),
  };
}

/** Prueft das Formular. Datum Pflicht, Grund optional und kurz. */
export function pruefeWiedervorlage(eingabe: Record<string, unknown>): { wert: WiedervorlageEingabe; fehler: string[] } {
  const fehler: string[] = [];
  const datum = String(eingabe.datum ?? '').trim().slice(0, 10);
  if (!datum) fehler.push('Das Datum der Wiedervorlage fehlt.');
  else if (!istIsoDatum(datum)) fehler.push('Das Datum muss im Format JJJJ-MM-TT vorliegen.');
  const grund = String(eingabe.grund ?? '').replace(/\s+/g, ' ').trim().slice(0, GRUND_MAX);
  return { wert: { datum, grund }, fehler };
}

/** Setzt oder aendert die Wiedervorlage eines eigenen Kunden. Eine neue gilt wieder als offen. */
export async function setzeWiedervorlage(
  db: Db,
  benutzerId: string,
  kundeId: string,
  daten: WiedervorlageEingabe,
): Promise<Wiedervorlage | null> {
  if (!istUuid(kundeId)) return null;
  const zeilen = await db.query<Zeile>(
    `UPDATE kunden
     SET wiedervorlage_am = $3::date, wiedervorlage_grund = $4, wiedervorlage_erledigt_am = NULL, geaendert_am = now()
     WHERE id = $1 AND benutzer_id = $2
     RETURNING ${FELDER}`,
    [kundeId, benutzerId, daten.datum, daten.grund],
  );
  return zeilen[0] ? zuWiedervorlage(zeilen[0]) : null;
}

/** Markiert die offene Wiedervorlage eines eigenen Kunden als erledigt. */
export async function erledigeWiedervorlage(db: Db, benutzerId: string, kundeId: string, jetzt = new Date()): Promise<boolean> {
  if (!istUuid(kundeId)) return false;
  const zeilen = await db.query<{ id: string }>(
    `UPDATE kunden SET wiedervorlage_erledigt_am = $3, geaendert_am = now()
     WHERE id = $1 AND benutzer_id = $2 AND wiedervorlage_am IS NOT NULL AND wiedervorlage_erledigt_am IS NULL
     RETURNING id`,
    [kundeId, benutzerId, jetzt],
  );
  return zeilen.length > 0;
}

/** Entfernt die Wiedervorlage ganz, etwa wenn sie versehentlich gesetzt wurde. */
export async function entferneWiedervorlage(db: Db, benutzerId: string, kundeId: string): Promise<boolean> {
  if (!istUuid(kundeId)) return false;
  const zeilen = await db.query<{ id: string }>(
    `UPDATE kunden SET wiedervorlage_am = NULL, wiedervorlage_grund = '', wiedervorlage_erledigt_am = NULL, geaendert_am = now()
     WHERE id = $1 AND benutzer_id = $2 AND wiedervorlage_am IS NOT NULL
     RETURNING id`,
    [kundeId, benutzerId],
  );
  return zeilen.length > 0;
}

/** Die Wiedervorlage eines eigenen Kunden, offen oder erledigt, oder null. */
export async function holeWiedervorlage(db: Db, benutzerId: string, kundeId: string): Promise<Wiedervorlage | null> {
  if (!istUuid(kundeId)) return null;
  const zeilen = await db.query<Zeile>(`SELECT ${FELDER} FROM kunden WHERE id = $1 AND benutzer_id = $2`, [kundeId, benutzerId]);
  return zeilen[0] ? zuWiedervorlage(zeilen[0]) : null;
}

/** Alle offenen Wiedervorlagen eines Vertrieblers, frueheste zuerst. */
export async function offeneWiedervorlagen(db: Db, benutzerId: string): Promise<Wiedervorlage[]> {
  const zeilen = await db.query<Zeile>(
    `SELECT ${FELDER} FROM kunden
     WHERE benutzer_id = $1 AND wiedervorlage_am IS NOT NULL AND wiedervorlage_erledigt_am IS NULL
     ORDER BY wiedervorlage_am, name`,
    [benutzerId],
  );
  return zeilen.map(zuWiedervorlage).filter((w): w is Wiedervorlage => w !== null);
}

/** Offene Wiedervorlagen eines Vertrieblers in einem Zeitraum, fuer den Kalender. */
export async function wiedervorlagenImZeitraum(db: Db, benutzerId: string, von: string, bis: string): Promise<Wiedervorlage[]> {
  const zeilen = await db.query<Zeile>(
    `SELECT ${FELDER} FROM kunden
     WHERE benutzer_id = $1 AND wiedervorlage_erledigt_am IS NULL
       AND wiedervorlage_am >= $2::date AND wiedervorlage_am <= $3::date
     ORDER BY wiedervorlage_am, name`,
    [benutzerId, von, bis],
  );
  return zeilen.map(zuWiedervorlage).filter((w): w is Wiedervorlage => w !== null);
}

export type Faelligkeit = 'ueberfaellig' | 'heute' | 'woche' | 'spaeter';

/** Ordnet eine Wiedervorlage relativ zu heute ein. "woche" heisst: noch in dieser Kalenderwoche. */
export function faelligkeit(datum: string, heute = heuteBerlin()): Faelligkeit {
  const abstand = tageZwischen(heute, datum);
  if (abstand < 0) return 'ueberfaellig';
  if (abstand === 0) return 'heute';
  if (datum <= woche(heute).bis) return 'woche';
  return 'spaeter';
}

export interface Gruppen {
  ueberfaellig: Wiedervorlage[];
  heute: Wiedervorlage[];
  woche: Wiedervorlage[];
  spaeter: Wiedervorlage[];
}

export function gruppiere(liste: Wiedervorlage[], heute = heuteBerlin()): Gruppen {
  const g: Gruppen = { ueberfaellig: [], heute: [], woche: [], spaeter: [] };
  for (const w of liste) g[faelligkeit(w.datum, heute)].push(w);
  return g;
}

/** Faellig heisst: heute oder ueberfaellig. */
export function anzahlFaellig(liste: Wiedervorlage[], heute = heuteBerlin()): number {
  return liste.filter((w) => w.datum <= heute).length;
}

/** Nur fuer den Admin: offene Wiedervorlagen aller Vertriebler, faellige getrennt gezaehlt. */
export async function wiedervorlagenAlle(db: Db, heute = heuteBerlin()): Promise<{ offen: number; faellig: number }> {
  const zeilen = await db.query<{ offen: string; faellig: string }>(
    `SELECT COUNT(*) AS offen, COUNT(*) FILTER (WHERE wiedervorlage_am <= $1::date) AS faellig
     FROM kunden WHERE wiedervorlage_am IS NOT NULL AND wiedervorlage_erledigt_am IS NULL`,
    [heute],
  );
  return { offen: Number(zeilen[0]?.offen ?? 0), faellig: Number(zeilen[0]?.faellig ?? 0) };
}
