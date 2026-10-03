// Anmeldung, Sitzungen, CSRF-Token und Ratenbegrenzung.
//
// Sitzung: ein zufaelliges Token im httpOnly-Cookie, in der Datenbank nur
// sein SHA-256. Jede Sitzung traegt ihr eigenes CSRF-Token, das jedes Formular
// als verstecktes Feld mitschickt.

import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { hashPasswort, pruefePasswort } from './passwort.ts';

export const COOKIE_NAME = 'dp_sitzung';
// Abmeldung nach 60 Minuten ohne Aktivitaet. Jede Anfrage schiebt die Frist
// nach hinten, geschrieben wird hoechstens einmal pro Minute, damit nicht jede
// Anfrage die Datenbank beschreibt.
export const SITZUNG_INAKTIV_MINUTEN = 60;
export const SITZUNG_VERLAENGERN_NACH_MS = 60 * 1000;
const SITZUNG_MS = SITZUNG_INAKTIV_MINUTEN * 60 * 1000;

export const RATE_FENSTER_MINUTEN = 15;
export const RATE_MAX_FEHLVERSUCHE = 5;
export const RATE_SPERRE_MINUTEN = 15;

// Ein Einmal-Passwort aus der Einladung gilt nur eine begrenzte Zeit. Ohne
// Frist bliebe eine abgefangene Einladungsmail (Postfach, Chatverlauf,
// Zettel) dauerhaft ein gueltiger Zugang, auch Monate spaeter.
export const EINMAL_PASSWORT_GUELTIG_STUNDEN = 72;

export type Rolle = 'admin' | 'vertriebler';

export interface Benutzer {
  id: string;
  email: string;
  name: string;
  rolle: Rolle;
  vertrieblerSlug: string | null;
  passwortWechselNoetig: boolean;
  aktiv: boolean;
}

interface BenutzerZeile {
  id: string;
  email: string;
  name: string;
  rolle: Rolle;
  vertriebler_slug: string | null;
  passwort_hash: string;
  passwort_wechsel_noetig: boolean;
  aktiv: boolean;
}

function zuBenutzer(z: BenutzerZeile): Benutzer {
  return {
    id: z.id,
    email: z.email,
    name: z.name,
    rolle: z.rolle,
    vertrieblerSlug: z.vertriebler_slug,
    passwortWechselNoetig: z.passwort_wechsel_noetig,
    aktiv: z.aktiv,
  };
}

export function normalisiereEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Ratenbegrenzung

export interface RateStatus {
  gesperrt: boolean;
  /** Sekunden bis zum Ende der Sperre, 0 wenn nicht gesperrt. */
  wartenSekunden: number;
}

/**
 * Zaehlt einen Versuch und sagt, ob dieser Schluessel jetzt gesperrt ist.
 * Eine Sperre folgt nach RATE_MAX_FEHLVERSUCHE im Fenster.
 *
 * Das Zaehlen und die Sperr-Entscheidung laufen in einem einzigen Upsert.
 * Postgres sperrt die betroffene Zeile fuer die Dauer der Anweisung, darum
 * serialisieren sich gleichzeitige Aufrufe mit demselben Schluessel. Zaehlt
 * man stattdessen zuerst per SELECT und schreibt erst nach der (langsamen)
 * Passwortpruefung mit einem zweiten Statement, koennen viele parallele
 * Anfragen alle den alten, noch nicht gesperrten Stand lesen und die Sperre
 * so vollstaendig umgehen. Darum wird hier gezaehlt, bevor scrypt laeuft,
 * nicht erst, wenn das Passwort falsch war.
 */
export async function registriereVersuch(db: Db, schluessel: string, jetzt = new Date()): Promise<RateStatus> {
  const fensterCutoff = new Date(jetzt.getTime() - RATE_FENSTER_MINUTEN * 60 * 1000);
  const gesperrtBisWert = new Date(jetzt.getTime() + RATE_SPERRE_MINUTEN * 60 * 1000);
  const zeilen = await db.query<{ fehlversuche: number; gesperrt_bis: Date | string | null }>(
    `INSERT INTO login_versuche (schluessel, fehlversuche, fenster_start, gesperrt_bis)
     VALUES ($1, 1, $2, NULL)
     ON CONFLICT (schluessel) DO UPDATE SET
       fehlversuche = CASE
         WHEN login_versuche.gesperrt_bis IS NOT NULL AND login_versuche.gesperrt_bis > $2 THEN login_versuche.fehlversuche
         WHEN login_versuche.fenster_start < $3 THEN 1
         ELSE login_versuche.fehlversuche + 1
       END,
       fenster_start = CASE
         WHEN login_versuche.gesperrt_bis IS NOT NULL AND login_versuche.gesperrt_bis > $2 THEN login_versuche.fenster_start
         WHEN login_versuche.fenster_start < $3 THEN $2
         ELSE login_versuche.fenster_start
       END,
       gesperrt_bis = CASE
         WHEN login_versuche.gesperrt_bis IS NOT NULL AND login_versuche.gesperrt_bis > $2 THEN login_versuche.gesperrt_bis
         WHEN (CASE WHEN login_versuche.fenster_start < $3 THEN 1 ELSE login_versuche.fehlversuche + 1 END) >= $4 THEN $5
         ELSE NULL
       END
     RETURNING fehlversuche, gesperrt_bis`,
    [schluessel, jetzt, fensterCutoff, RATE_MAX_FEHLVERSUCHE, gesperrtBisWert],
  );
  const bis = zeilen[0]?.gesperrt_bis ? new Date(zeilen[0].gesperrt_bis) : null;
  if (bis && bis.getTime() > jetzt.getTime()) {
    return { gesperrt: true, wartenSekunden: Math.ceil((bis.getTime() - jetzt.getTime()) / 1000) };
  }
  return { gesperrt: false, wartenSekunden: 0 };
}

export async function rateZuruecksetzen(db: Db, schluessel: string): Promise<void> {
  await db.query('DELETE FROM login_versuche WHERE schluessel = $1', [schluessel]);
}

/**
 * Loescht abgelaufene Sitzungen und erledigte Ratenbegrenzungs-Zeilen.
 * Beides traegt personenbezogene Daten (IP-Adressen, E-Mail-Adressen in
 * login_versuche), darum bleibt es nicht laenger liegen als noetig. Laeuft
 * bei jedem Login mit, eigene Hintergrundjobs braucht das Portal nicht.
 */
export async function raeumeAbgelaufenesAuf(db: Db, jetzt = new Date()): Promise<void> {
  await db.query('DELETE FROM sitzungen WHERE laeuft_ab <= $1', [jetzt]);
  const fensterCutoff = new Date(jetzt.getTime() - RATE_FENSTER_MINUTEN * 60 * 1000);
  await db.query('DELETE FROM login_versuche WHERE (gesperrt_bis IS NULL OR gesperrt_bis <= $1) AND fenster_start <= $2', [
    jetzt,
    fensterCutoff,
  ]);
}

// ---------------------------------------------------------------------------
// Sitzungen

export interface NeueSitzung {
  token: string;
  csrf: string;
  laeuftAb: Date;
}

export async function erstelleSitzung(db: Db, benutzerId: string, jetzt = new Date()): Promise<NeueSitzung> {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const laeuftAb = new Date(jetzt.getTime() + SITZUNG_MS);
  await db.query(
    'INSERT INTO sitzungen (token_hash, benutzer_id, csrf_token, laeuft_ab, zuletzt_aktiv) VALUES ($1, $2, $3, $4, $5)',
    [tokenHash(token), benutzerId, csrf, laeuftAb, jetzt],
  );
  return { token, csrf, laeuftAb };
}

export interface Sitzung {
  id: string;
  benutzer: Benutzer;
  csrf: string;
}

/** Sucht die Sitzung zum Cookie-Token. Abgelaufen nach 60 Minuten ohne Anfrage, sonst wird die Frist verlaengert. */
export async function ladeSitzung(db: Db, token: string, jetzt = new Date()): Promise<Sitzung | null> {
  if (!token || token.length > 200) return null;
  const zeilen = await db.query<
    BenutzerZeile & { sitzung_id: string; csrf_token: string; laeuft_ab: Date | string; zuletzt_aktiv: Date | string }
  >(
    `SELECT s.id AS sitzung_id, s.csrf_token, s.laeuft_ab, s.zuletzt_aktiv,
            b.id, b.email, b.name, b.rolle, b.vertriebler_slug, b.passwort_hash, b.passwort_wechsel_noetig, b.aktiv
     FROM sitzungen s JOIN benutzer b ON b.id = s.benutzer_id
     WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
  const z = zeilen[0];
  if (!z) return null;
  if (new Date(z.laeuft_ab).getTime() <= jetzt.getTime() || !z.aktiv) {
    await db.query('DELETE FROM sitzungen WHERE id = $1', [z.sitzung_id]);
    return null;
  }
  if (jetzt.getTime() - new Date(z.zuletzt_aktiv).getTime() > SITZUNG_VERLAENGERN_NACH_MS) {
    const laeuftAb = new Date(jetzt.getTime() + SITZUNG_MS);
    await db.query('UPDATE sitzungen SET zuletzt_aktiv = $2, laeuft_ab = $3 WHERE id = $1', [z.sitzung_id, jetzt, laeuftAb]);
  }
  return { id: z.sitzung_id, benutzer: zuBenutzer(z), csrf: z.csrf_token };
}

export async function beendeSitzung(db: Db, sitzungId: string): Promise<void> {
  await db.query('DELETE FROM sitzungen WHERE id = $1', [sitzungId]);
}

export async function beendeAlleSitzungen(db: Db, benutzerId: string, ausserSitzungId?: string): Promise<void> {
  if (ausserSitzungId) {
    await db.query('DELETE FROM sitzungen WHERE benutzer_id = $1 AND id <> $2', [benutzerId, ausserSitzungId]);
  } else {
    await db.query('DELETE FROM sitzungen WHERE benutzer_id = $1', [benutzerId]);
  }
}

// ---------------------------------------------------------------------------
// Login

export type LoginErgebnis =
  | { ok: true; benutzer: Benutzer; sitzung: NeueSitzung }
  | { ok: false; grund: 'gesperrt'; wartenSekunden: number }
  | { ok: false; grund: 'falsch' };

export async function login(
  db: Db,
  eingabe: { email: string; passwort: string; ip: string },
  jetzt = new Date(),
): Promise<LoginErgebnis> {
  const email = normalisiereEmail(eingabe.email);
  const schluessel = [`email:${email}`, `ip:${eingabe.ip || 'unbekannt'}`];

  await raeumeAbgelaufenesAuf(db, jetzt);

  // Zaehlt diesen Versuch atomar, bevor das langsame scrypt beginnt. So
  // bleibt die Sperre auch bei vielen gleichzeitigen Anfragen wirksam.
  let wartenSekunden = 0;
  for (const s of schluessel) {
    const status = await registriereVersuch(db, s, jetzt);
    if (status.gesperrt) wartenSekunden = Math.max(wartenSekunden, status.wartenSekunden);
  }
  if (wartenSekunden > 0) return { ok: false, grund: 'gesperrt', wartenSekunden };

  const zeilen = await db.query<BenutzerZeile & { einmal_passwort_bis: Date | string | null }>(
    `SELECT id, email, name, rolle, vertriebler_slug, passwort_hash, passwort_wechsel_noetig, aktiv, einmal_passwort_bis
     FROM benutzer WHERE email = $1`,
    [email],
  );
  const z = zeilen[0];
  // Auch bei unbekannter Adresse wird ein Hash geprueft, damit die Antwortzeit nichts verraet.
  const stimmt = z
    ? await pruefePasswort(eingabe.passwort ?? '', z.passwort_hash)
    : await pruefePasswort(eingabe.passwort ?? '', BLIND_HASH).then(() => false);

  // Die Pruefung der Ablauffrist steht bewusst erst nach scrypt: faellt sie
  // davor, wuerde ein abgelaufenes Einmal-Passwort schneller abgelehnt als
  // ein falsches, und die Antwortzeit verriete, dass die Adresse existiert.
  const einmalAbgelaufen = Boolean(
    z?.passwort_wechsel_noetig && z.einmal_passwort_bis && new Date(z.einmal_passwort_bis).getTime() <= jetzt.getTime(),
  );

  if (!z || !stimmt || !z.aktiv || einmalAbgelaufen) {
    return { ok: false, grund: 'falsch' };
  }

  for (const s of schluessel) await rateZuruecksetzen(db, s);
  await db.query('UPDATE benutzer SET letzter_login = $2 WHERE id = $1', [z.id, jetzt]);
  const sitzung = await erstelleSitzung(db, z.id, jetzt);
  return { ok: true, benutzer: zuBenutzer(z), sitzung };
}

// Ein gueltiger Hash eines zufaelligen Passworts, nur damit die Pruefung bei
// unbekannter Adresse genauso lange dauert.
const BLIND_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ---------------------------------------------------------------------------
// Benutzerverwaltung

export async function erstelleBenutzer(
  db: Db,
  daten: { email: string; name: string; rolle: Rolle; passwort: string; vertrieblerSlug?: string | null; wechselNoetig?: boolean },
): Promise<Benutzer> {
  const email = normalisiereEmail(daten.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Keine gueltige E-Mail-Adresse.');
  const name = String(daten.name ?? '').trim();
  if (!name) throw new Error('Der Name fehlt.');
  const slug = daten.vertrieblerSlug ? String(daten.vertrieblerSlug).trim() : null;
  if (slug && !/^[a-z0-9-]+$/.test(slug)) throw new Error('Der Vertriebler-Slug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.');
  const hash = await hashPasswort(daten.passwort);
  const wechselNoetig = daten.wechselNoetig ?? false;
  const einmalBis = wechselNoetig ? einmalPasswortFrist() : null;
  const zeilen = await db.query<BenutzerZeile>(
    `INSERT INTO benutzer (email, name, rolle, vertriebler_slug, passwort_hash, passwort_wechsel_noetig, einmal_passwort_bis)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, name, rolle, vertriebler_slug, passwort_hash, passwort_wechsel_noetig, aktiv`,
    [email, name, daten.rolle, slug || null, hash, wechselNoetig, einmalBis],
  );
  return zuBenutzer(zeilen[0]);
}

function einmalPasswortFrist(jetzt = new Date()): Date {
  return new Date(jetzt.getTime() + EINMAL_PASSWORT_GUELTIG_STUNDEN * 60 * 60 * 1000);
}

export async function setzePasswort(db: Db, benutzerId: string, passwort: string, wechselNoetig = false): Promise<void> {
  const hash = await hashPasswort(passwort);
  const einmalBis = wechselNoetig ? einmalPasswortFrist() : null;
  await db.query('UPDATE benutzer SET passwort_hash = $2, passwort_wechsel_noetig = $3, einmal_passwort_bis = $4 WHERE id = $1', [
    benutzerId,
    hash,
    wechselNoetig,
    einmalBis,
  ]);
}

export async function setzeAktiv(db: Db, benutzerId: string, aktiv: boolean): Promise<void> {
  await db.query('UPDATE benutzer SET aktiv = $2 WHERE id = $1', [benutzerId, aktiv]);
  if (!aktiv) await beendeAlleSitzungen(db, benutzerId);
}

export async function holeBenutzer(db: Db, benutzerId: string): Promise<Benutzer | null> {
  const zeilen = await db.query<BenutzerZeile>(
    'SELECT id, email, name, rolle, vertriebler_slug, passwort_hash, passwort_wechsel_noetig, aktiv FROM benutzer WHERE id = $1',
    [benutzerId],
  );
  return zeilen[0] ? zuBenutzer(zeilen[0]) : null;
}

export interface BenutzerUebersicht extends Benutzer {
  erstelltAm: Date;
  letzterLogin: Date | null;
}

export async function alleBenutzer(db: Db): Promise<BenutzerUebersicht[]> {
  const zeilen = await db.query<BenutzerZeile & { erstellt_am: Date | string; letzter_login: Date | string | null }>(
    `SELECT id, email, name, rolle, vertriebler_slug, passwort_hash, passwort_wechsel_noetig, aktiv, erstellt_am, letzter_login
     FROM benutzer ORDER BY rolle, name`,
  );
  return zeilen.map((z) => ({
    ...zuBenutzer(z),
    erstelltAm: new Date(z.erstellt_am),
    letzterLogin: z.letzter_login ? new Date(z.letzter_login) : null,
  }));
}
