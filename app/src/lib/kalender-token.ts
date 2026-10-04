// Persoenlicher Abo-Link fuer den Kalender. Ein zufaelliges Token je
// Benutzer, in der Datenbank nur sein SHA-256 (Tabelle kalender_token,
// Migration 005). Der Abo-Endpunkt ist ohne Login erreichbar, deshalb ist
// das Token der einzige Schutz: 32 Zufallsbytes, widerrufbar, neu erzeugbar,
// und jede Anfrage laeuft durch eine Ratenbegrenzung je IP-Adresse.

import { randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { tokenHash } from './auth.ts';
import { begrenze, type Begrenzung } from './rate.ts';

/** base64url aus 32 Bytes: 43 Zeichen aus [A-Za-z0-9_-]. */
export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43}$/;

// Fehlversuche (unbekanntes Token): wie beim Login fuenf in 15 Minuten.
export const ABO_FEHL_GRENZEN = { max: 5, fensterMinuten: 15, sperreMinuten: 15 };
// Alle Abrufe einer Adresse, auch gueltige: 60 in 15 Minuten reichen fuer
// jede Kalender-App und bremsen das Durchprobieren zusaetzlich.
export const ABO_GRENZEN = { max: 60, fensterMinuten: 15, sperreMinuten: 15 };

export interface TokenStand {
  erstelltAm: Date;
  zuletztAbgerufen: Date | null;
}

export function istTokenFormat(wert: unknown): wert is string {
  return typeof wert === 'string' && TOKEN_MUSTER.test(wert);
}

/** Erzeugt ein neues Token und ersetzt ein vorhandenes. Das Token selbst gibt es nur hier, einmal. */
export async function erzeugeKalenderToken(db: Db, benutzerId: string, jetzt = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO kalender_token (benutzer_id, token_hash, erstellt_am, zuletzt_abgerufen)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (benutzer_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, erstellt_am = EXCLUDED.erstellt_am, zuletzt_abgerufen = NULL`,
    [benutzerId, tokenHash(token), jetzt],
  );
  return token;
}

export async function widerrufeKalenderToken(db: Db, benutzerId: string): Promise<boolean> {
  const zeilen = await db.query<{ benutzer_id: string }>('DELETE FROM kalender_token WHERE benutzer_id = $1 RETURNING benutzer_id', [
    benutzerId,
  ]);
  return zeilen.length > 0;
}

export async function kalenderTokenStand(db: Db, benutzerId: string): Promise<TokenStand | null> {
  const zeilen = await db.query<{ erstellt_am: Date | string; zuletzt_abgerufen: Date | string | null }>(
    'SELECT erstellt_am, zuletzt_abgerufen FROM kalender_token WHERE benutzer_id = $1',
    [benutzerId],
  );
  const z = zeilen[0];
  if (!z) return null;
  return { erstelltAm: new Date(z.erstellt_am), zuletztAbgerufen: z.zuletzt_abgerufen ? new Date(z.zuletzt_abgerufen) : null };
}

export interface TokenBenutzer {
  id: string;
  name: string;
}

/**
 * Sucht den Benutzer zum Token. Nur aktive Zugaenge, deaktivierte liefern
 * nichts, als gaebe es das Token nicht. Merkt sich den Abruf.
 */
export async function benutzerZuKalenderToken(db: Db, token: string, jetzt = new Date()): Promise<TokenBenutzer | null> {
  if (!istTokenFormat(token)) return null;
  const zeilen = await db.query<{ id: string; name: string }>(
    `SELECT b.id, b.name FROM kalender_token t JOIN benutzer b ON b.id = t.benutzer_id
     WHERE t.token_hash = $1 AND b.aktiv`,
    [tokenHash(token)],
  );
  const z = zeilen[0];
  if (!z) return null;
  await db.query('UPDATE kalender_token SET zuletzt_abgerufen = $2 WHERE benutzer_id = $1', [z.id, jetzt]);
  return { id: z.id, name: z.name };
}

export type AboErgebnis =
  | { ok: true; benutzer: TokenBenutzer }
  | { ok: false; grund: 'gesperrt'; wartenSekunden: number }
  | { ok: false; grund: 'unbekannt' };

/**
 * Der ganze Pruefweg des Abo-Endpunkts: erst die Adresse zaehlen, dann das
 * Token suchen, Fehlversuche getrennt zaehlen. Eine Sperre antwortet immer
 * gleich, egal ob das Token stimmen wuerde.
 */
export async function pruefeAboAnfrage(db: Db, token: string, ip: string, jetzt = new Date()): Promise<AboErgebnis> {
  const adresse = ip || 'unbekannt';
  const gesamt = await begrenze(db, `ics:${adresse}`, ABO_GRENZEN, jetzt);
  if (gesamt.gesperrt) return { ok: false, grund: 'gesperrt', wartenSekunden: gesamt.wartenSekunden };
  const sperre = await sperreFuer(db, `ics-fehl:${adresse}`, jetzt);
  if (sperre) return { ok: false, grund: 'gesperrt', wartenSekunden: sperre };

  const benutzer = await benutzerZuKalenderToken(db, token, jetzt);
  if (benutzer) return { ok: true, benutzer };

  const fehl = await begrenze(db, `ics-fehl:${adresse}`, ABO_FEHL_GRENZEN, jetzt);
  if (fehl.gesperrt) return { ok: false, grund: 'gesperrt', wartenSekunden: fehl.wartenSekunden };
  return { ok: false, grund: 'unbekannt' };
}

/** Liest nur, ob dieser Schluessel gerade gesperrt ist, ohne zu zaehlen. */
async function sperreFuer(db: Db, schluessel: string, jetzt: Date): Promise<number> {
  const zeilen = await db.query<{ gesperrt_bis: Date | string | null }>('SELECT gesperrt_bis FROM login_versuche WHERE schluessel = $1', [
    schluessel,
  ]);
  const bis = zeilen[0]?.gesperrt_bis ? new Date(zeilen[0].gesperrt_bis) : null;
  return bis && bis.getTime() > jetzt.getTime() ? Math.ceil((bis.getTime() - jetzt.getTime()) / 1000) : 0;
}

export type { Begrenzung };
