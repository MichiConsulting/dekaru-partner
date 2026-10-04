// Stufe je Vertriebler nach § 1 Absatz 5 und 6 des Vertriebspartnervertrags.
//
// Stufe 1: die ersten fuenf Zweittermine gemeinsam mit Michi, die einzige
// Preisangabe ist "ab 600 Euro". Stufe 2: der Vertriebler nennt Paketpreis
// und Bausteine aus dem Preisrechner selbst. Der Vertrag verlangt, dass der
// Beginn von Stufe 2 in Textform bestaetigt wird; dieses Datum wird hier
// mit protokolliert. Standard fuer jeden neuen Zugang ist Stufe 1.
//
// Die Stufe steht bewusst nicht im Sitzungsobjekt (auth.ts), sondern wird
// auf den Seiten geladen, die sie brauchen. So bleibt auth.ts unberuehrt.

import type { Benutzer } from './auth.ts';
import type { Db } from './db.ts';
import { isoDatum, istUuid } from './kunden.ts';

export type Stufe = 1 | 2;

export interface StufenStand {
  stufe: Stufe;
  /** Ab wann die Stufe gilt, JJJJ-MM-TT. */
  seit: string | null;
  /** Wann die Bestaetigung in Textform an den Vertriebler ging. */
  bestaetigtAm: string | null;
}

export const STUFE_HINWEIS =
  'Der Vertriebspartnervertrag (§ 1 Absatz 6) verlangt, dass der Beginn von Stufe 2 dem Vertriebler in Textform bestätigt wird, zum Beispiel per E-Mail. Erst bestätigen, dann hier eintragen. Das Datum der Bestätigung wird protokolliert.';

export function zuStufe(wert: unknown): Stufe {
  return Number(wert) === 2 ? 2 : 1;
}

export async function ladeStufe(db: Db, benutzerId: string): Promise<StufenStand> {
  if (!istUuid(benutzerId)) return { stufe: 1, seit: null, bestaetigtAm: null };
  const zeilen = await db.query<{ stufe: number; stufe_seit: string | Date | null; stufe_bestaetigt_am: string | Date | null }>(
    'SELECT stufe, stufe_seit, stufe_bestaetigt_am FROM benutzer WHERE id = $1',
    [benutzerId],
  );
  const z = zeilen[0];
  if (!z) return { stufe: 1, seit: null, bestaetigtAm: null };
  return { stufe: zuStufe(z.stufe), seit: isoDatum(z.stufe_seit), bestaetigtAm: isoDatum(z.stufe_bestaetigt_am) };
}

/** Stufe aller Vertriebler auf einmal, fuer Listen im Admin. */
export async function stufenAller(db: Db): Promise<Map<string, StufenStand>> {
  const zeilen = await db.query<{ id: string; stufe: number; stufe_seit: string | Date | null; stufe_bestaetigt_am: string | Date | null }>(
    'SELECT id, stufe, stufe_seit, stufe_bestaetigt_am FROM benutzer',
  );
  return new Map(zeilen.map((z) => [z.id, { stufe: zuStufe(z.stufe), seit: isoDatum(z.stufe_seit), bestaetigtAm: isoDatum(z.stufe_bestaetigt_am) }]));
}

/**
 * Darf diese Person Preise im Preisrechner sehen? Admin immer, Vertriebler
 * nur in Stufe 2. Stufe 1 sieht nur "ab 600 Euro".
 */
export function darfPreiseSehen(benutzer: Pick<Benutzer, 'rolle'> | null, stand: Pick<StufenStand, 'stufe'> | null): boolean {
  if (!benutzer) return false;
  if (benutzer.rolle === 'admin') return true;
  return stand?.stufe === 2;
}

export interface StufeEingabe {
  stufe: unknown;
  seit: unknown;
  bestaetigtAm: unknown;
}

function datum(wert: unknown): string | null {
  const text = String(wert ?? '').trim().slice(0, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T12:00:00Z`).getTime())) return null;
  return text;
}

/** Prueft das Admin-Formular. Stufe 2 braucht Datum und Bestaetigung in Textform. */
export function pruefeStufe(eingabe: StufeEingabe): { wert: StufenStand; fehler: string[] } {
  const fehler: string[] = [];
  const stufe = zuStufe(eingabe.stufe);
  const seit = datum(eingabe.seit);
  const bestaetigtAm = datum(eingabe.bestaetigtAm);
  if (String(eingabe.seit ?? '').trim() && !seit) fehler.push('Das Datum "gilt ab" muss im Format JJJJ-MM-TT vorliegen.');
  if (String(eingabe.bestaetigtAm ?? '').trim() && !bestaetigtAm) fehler.push('Das Datum der Bestätigung muss im Format JJJJ-MM-TT vorliegen.');
  if (stufe === 2) {
    if (!seit) fehler.push('Stufe 2 braucht ein Datum, ab dem sie gilt.');
    if (!bestaetigtAm) fehler.push('Stufe 2 braucht das Datum der Bestätigung in Textform (§ 1 Absatz 6 des Vertrags).');
  }
  return { wert: { stufe, seit, bestaetigtAm }, fehler };
}

/** Setzt die Stufe und schreibt einen Protokolleintrag. */
export async function setzeStufe(db: Db, benutzerId: string, stand: StufenStand, gesetztVon: string | null): Promise<void> {
  if (!istUuid(benutzerId)) throw new Error('Unbekannter Benutzer.');
  const seit = stand.seit ?? isoDatum(new Date());
  await db.query('UPDATE benutzer SET stufe = $2, stufe_seit = $3, stufe_bestaetigt_am = $4 WHERE id = $1', [
    benutzerId,
    stand.stufe,
    seit,
    stand.bestaetigtAm,
  ]);
  await db.query(
    'INSERT INTO stufen_protokoll (benutzer_id, stufe, seit, bestaetigt_am, gesetzt_von) VALUES ($1, $2, $3, $4, $5)',
    [benutzerId, stand.stufe, seit, stand.bestaetigtAm, gesetztVon && istUuid(gesetztVon) ? gesetztVon : null],
  );
}

export interface ProtokollEintrag {
  stufe: Stufe;
  seit: string;
  bestaetigtAm: string | null;
  gesetztVon: string | null;
  gesetztAm: Date;
}

export async function ladeProtokoll(db: Db, benutzerId: string): Promise<ProtokollEintrag[]> {
  if (!istUuid(benutzerId)) return [];
  const zeilen = await db.query<{
    stufe: number;
    seit: string | Date;
    bestaetigt_am: string | Date | null;
    gesetzt_von_name: string | null;
    gesetzt_am: string | Date;
  }>(
    `SELECT p.stufe, p.seit, p.bestaetigt_am, b.name AS gesetzt_von_name, p.gesetzt_am
     FROM stufen_protokoll p LEFT JOIN benutzer b ON b.id = p.gesetzt_von
     WHERE p.benutzer_id = $1 ORDER BY p.gesetzt_am DESC`,
    [benutzerId],
  );
  return zeilen.map((z) => ({
    stufe: zuStufe(z.stufe),
    seit: isoDatum(z.seit) ?? '',
    bestaetigtAm: isoDatum(z.bestaetigt_am),
    gesetztVon: z.gesetzt_von_name,
    gesetztAm: new Date(z.gesetzt_am),
  }));
}
