// Uebungsstand der Pflichtsaetze je Vertriebler. Ein Satz "sitzt", wenn der
// letzte Versuch richtig war. Tabelle pflichtsatz_antworten, Migration 002.

import type { Db } from './db.ts';
import type { Modus, UebungsAntwort } from './gespraech.ts';

export interface PflichtsatzStand {
  satzId: string;
  modus: Modus;
  sitzt: boolean;
  jeRichtig: boolean;
  antwort: UebungsAntwort | null;
  versuche: number;
  zuletzt: Date;
}

interface Zeile {
  satz_id: string;
  modus: Modus;
  richtig: boolean;
  je_richtig: boolean;
  antwort: UebungsAntwort | string | null;
  versuche: number | string;
  zuletzt: Date | string;
}

function zuStand(z: Zeile): PflichtsatzStand {
  return {
    satzId: z.satz_id,
    modus: z.modus,
    sitzt: z.richtig,
    jeRichtig: z.je_richtig,
    antwort: typeof z.antwort === 'string' ? (JSON.parse(z.antwort) as UebungsAntwort) : z.antwort,
    versuche: Number(z.versuche),
    zuletzt: new Date(z.zuletzt),
  };
}

export async function speichereUebung(
  db: Db,
  benutzerId: string,
  satzId: string,
  modus: Modus,
  richtig: boolean,
  antwort: UebungsAntwort,
): Promise<void> {
  await db.query(
    `INSERT INTO pflichtsatz_antworten (benutzer_id, satz_id, modus, richtig, je_richtig, antwort, versuche, zuletzt)
     VALUES ($1, $2, $3, $4, $4, $5::jsonb, 1, now())
     ON CONFLICT (benutzer_id, satz_id) DO UPDATE
       SET modus = EXCLUDED.modus,
           richtig = EXCLUDED.richtig,
           je_richtig = pflichtsatz_antworten.je_richtig OR EXCLUDED.richtig,
           antwort = EXCLUDED.antwort,
           versuche = pflichtsatz_antworten.versuche + 1,
           zuletzt = now()`,
    [benutzerId, satzId, modus, richtig, JSON.stringify(antwort)],
  );
}

export async function ladeUebungsstand(db: Db, benutzerId: string): Promise<Map<string, PflichtsatzStand>> {
  const zeilen = await db.query<Zeile>('SELECT * FROM pflichtsatz_antworten WHERE benutzer_id = $1', [benutzerId]);
  return new Map(zeilen.map((z) => [z.satz_id, zuStand(z)]));
}

/** Wie viele der genannten Saetze sitzen. */
export function anzahlSitzt(stand: Map<string, PflichtsatzStand>, satzIds: string[]): number {
  return satzIds.filter((id) => stand.get(id)?.sitzt).length;
}

/** Nur fuer den Admin: je Vertriebler, wie viele der Pflichtsaetze sitzen. */
export async function pflichtsaetzeAller(db: Db, satzIds: string[]): Promise<Map<string, number>> {
  if (satzIds.length === 0) return new Map();
  const zeilen = await db.query<{ benutzer_id: string; sitzen: string | number }>(
    `SELECT benutzer_id, COUNT(*) AS sitzen
     FROM pflichtsatz_antworten
     WHERE richtig AND satz_id = ANY($1::text[])
     GROUP BY benutzer_id`,
    [satzIds],
  );
  return new Map(zeilen.map((z) => [z.benutzer_id, Number(z.sitzen)]));
}
