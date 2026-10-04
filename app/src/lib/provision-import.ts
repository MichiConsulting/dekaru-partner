// Automatischer Provisionsimport: Endpunkt POST /api/provision-import und die
// Benachrichtigung des Vertrieblers.
//
// Ablauf je Anfrage (eine Abrechnung je Anfrage, so wie eine Datei im Upload):
//   1. Sperre wegen Fehlversuchen? Dann 429, auch mit richtigem Token.
//   2. Token nur aus "Authorization: Bearer ...", zeitkonstant verglichen.
//      Ohne eingerichtetes Token (PROVISION_IMPORT_TOKEN) immer 401.
//   3. Nur application/json, hoechstens 2 MB, dieselbe Pruefung wie der Upload
//      (pruefeAbrechnung).
//   4. Mit ?pruefen=1 nur pruefen und sagen, was passieren wuerde.
//   5. Sonst ablegen. Gleicher Monat und Slug ersetzt wie beim Upload. Ist der
//      Inhalt unveraendert (das Feld "erstellt" zaehlt nicht), wird nichts
//      geschrieben und keine Mail verschickt. So darf das Sende-Skript
//      beliebig oft laufen.
//   6. Nach einem neuen oder ersetzten Import bekommt genau der Vertriebler mit
//      diesem Slug eine Mail ohne Betraege, sofern er sie nicht abgeschaltet hat
//      und SMTP eingerichtet ist. Ein Mailfehler macht den Import nicht
//      rueckgaengig, das Ergebnis steht in der Antwort und im Admin.
//
// Die Logik steht hier und nicht in der Route, damit Vitest sie direkt
// aufrufen kann.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import { registriereVersuch, rateZuruecksetzen } from './auth.ts';
import { importiereAbrechnung, monatsname, pruefeAbrechnung, type Abrechnung } from './provision.ts';
import { smtpAusUmgebung, smtpVersender, type Versender } from './smtp.ts';
import { protokolliere, type Akteur } from './admin-protokoll.ts';

export const IMPORT_PFAD = '/api/provision-import';
export const MAX_GROESSE = 2_000_000;
/** Kuerzere Tokens gelten als nicht eingerichtet. openssl rand -hex 32 ergibt 64 Zeichen. */
export const MIN_TOKEN_LAENGE = 32;

export type ImportStatus = 'neu' | 'ersetzt' | 'unveraendert';
export type Benachrichtigung = 'gesendet' | 'abgeschaltet' | 'kein_smtp' | 'kein_konto' | 'fehler';

// 'ausstehend' steht nur zwischen Ablegen und Versand in der Datenbank. Bleibt
// es stehen (Zeitlimit der Funktion), holt der naechste Import die Mail nach.
export const BENACHRICHTIGUNG_TEXT: Record<Benachrichtigung | 'ausstehend', string> = {
  ausstehend: 'nicht abgeschlossen, wird beim nächsten Senden nachgeholt',
  gesendet: 'Mail gesendet',
  abgeschaltet: 'vom Vertriebler abgeschaltet',
  kein_smtp: 'nicht gesendet, SMTP fehlt',
  kein_konto: 'kein aktiver Zugang zu diesem Slug',
  fehler: 'Versand fehlgeschlagen',
};

type Umgebung = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Token

function sha256(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/** Das eingerichtete Token oder null, wenn es fehlt oder zu kurz ist. */
export function importToken(env: Umgebung = process.env): string | null {
  const t = (env.PROVISION_IMPORT_TOKEN ?? '').trim();
  return t.length >= MIN_TOKEN_LAENGE ? t : null;
}

/**
 * Prueft "Authorization: Bearer <token>". Beide Seiten werden vorher gehasht,
 * damit timingSafeEqual gleich lange Puffer bekommt und die Laenge des
 * echten Tokens nicht ueber die Laufzeit verraten wird.
 */
export function tokenGueltig(kopf: string | null, erwartet: string | null): boolean {
  if (!erwartet) return false;
  const t = /^Bearer[ ]+(\S+)[ ]*$/.exec(kopf ?? '');
  if (!t) return false;
  return timingSafeEqual(sha256(t[1]), sha256(erwartet));
}

// ---------------------------------------------------------------------------
// Vergleich fuer die Idempotenz

function kanonisch(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(kanonisch);
  if (wert && typeof wert === 'object') {
    const o = wert as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, kanonisch(o[k])]),
    );
  }
  return wert;
}

/** Gleicher Inhalt, egal in welcher Reihenfolge die Schluessel stehen. "erstellt" zaehlt nicht. */
export function gleicherInhalt(a: unknown, b: unknown): boolean {
  const ohne = (x: unknown) => {
    const o = { ...(JSON.parse(JSON.stringify(x ?? {})) as Record<string, unknown>) };
    delete o.erstellt;
    return JSON.stringify(kanonisch(o));
  };
  return ohne(a) === ohne(b);
}

// ---------------------------------------------------------------------------
// Import mit Benachrichtigung

interface Vorhanden {
  id: string;
  daten: unknown;
  ausgezahlt_am: unknown;
  benachrichtigung: string | null;
}

async function vorhandene(db: Db, a: Abrechnung): Promise<Vorhanden | null> {
  const zeilen = await db.query<Vorhanden>(
    'SELECT id, daten, ausgezahlt_am, benachrichtigung FROM provision_abrechnungen WHERE vertriebler_slug = $1 AND monat = $2',
    [a.vertriebler, a.monat],
  );
  const z = zeilen[0];
  if (!z) return null;
  return { ...z, daten: typeof z.daten === 'string' ? JSON.parse(z.daten) : z.daten };
}

export interface Vorschau {
  status: ImportStatus;
  /** Die vorhandene Abrechnung war schon als ausgezahlt markiert. */
  warAusgezahlt: boolean;
}

/** Was ein Import taete, ohne etwas zu schreiben. */
export async function vorschau(db: Db, a: Abrechnung): Promise<Vorschau> {
  const v = await vorhandene(db, a);
  if (!v) return { status: 'neu', warAusgezahlt: false };
  return { status: gleicherInhalt(v.daten, a) ? 'unveraendert' : 'ersetzt', warAusgezahlt: Boolean(v.ausgezahlt_am) };
}

export interface ImportErgebnis extends Vorschau {
  id: string | null;
  benachrichtigung: Benachrichtigung | null;
}

export interface ImportOptionen {
  importiertVon: string | null;
  versender: Versender | null;
  /** Basis fuer den Link in der Mail, z. B. https://partner.dekaru.de */
  portalUrl: string;
}

/** Text der Benachrichtigung. Bewusst ohne Betraege (Datensparsamkeit). */
export function provisionsMail(name: string, monat: string, portalUrl: string, ersetzt: boolean) {
  const mname = monatsname(monat);
  const link = `${portalUrl.replace(/\/+$/, '')}/provision/${monat}`;
  const text = [
    `Guten Tag ${name},`,
    '',
    ersetzt
      ? `Ihre Provisionsabrechnung für ${mname} wurde im Portal aktualisiert.`
      : `Ihre Provisionsabrechnung für ${mname} ist im Portal.`,
    '',
    `Sie finden sie nach der Anmeldung hier:`,
    link,
    '',
    'Die Beträge stehen bewusst nur im Portal und nicht in dieser Mail.',
    '',
    `Diese Mail ist automatisch verschickt. Abschalten können Sie sie hier: ${portalUrl.replace(/\/+$/, '')}/einstellungen`,
    '',
    'Viele Grüße',
    'Michael Henning, dekaru',
  ].join('\n');
  return { subject: `Ihre Provisionsabrechnung für ${mname} ist im Portal`, text };
}

async function benachrichtige(
  db: Db,
  a: Abrechnung,
  ersetzt: boolean,
  optionen: ImportOptionen,
): Promise<Benachrichtigung> {
  const zeilen = await db.query<{ email: string; name: string; aktiv: boolean; rolle: string; provision_mail: boolean }>(
    'SELECT email, name, aktiv, rolle, provision_mail FROM benutzer WHERE vertriebler_slug = $1',
    [a.vertriebler],
  );
  const b = zeilen[0];
  if (!b || !b.aktiv || b.rolle !== 'vertriebler') return 'kein_konto';
  if (!b.provision_mail) return 'abgeschaltet';
  if (!optionen.versender) return 'kein_smtp';
  const mail = provisionsMail(b.name, a.monat, optionen.portalUrl, ersetzt);
  try {
    await optionen.versender.senden({ to: b.email, ...mail });
    return 'gesendet';
  } catch (fehler) {
    // Nur die Meldung, keine Adresse und kein Inhalt ins Log.
    console.error(`Provisionsmail fuer ${a.vertriebler}/${a.monat} fehlgeschlagen: ${(fehler as Error).message}`);
    return 'fehler';
  }
}

async function setzeStatus(db: Db, id: string, status: Benachrichtigung | 'ausstehend'): Promise<void> {
  await db.query(
    `UPDATE provision_abrechnungen
        SET benachrichtigung = $2,
            benachrichtigt_am = CASE WHEN $2 = 'gesendet' THEN now() ELSE NULL END
      WHERE id = $1`,
    [id, status],
  );
}

/** Mail, die beim letzten Mal scheiterte oder nicht zu Ende kam. NULL (vor Migration 008) zaehlt nicht. */
const NACHHOLEN = new Set(['fehler', 'ausstehend']);

/**
 * Legt die Abrechnung ab und benachrichtigt den Vertriebler, wenn sich etwas
 * geaendert hat. Bei unveraendertem Inhalt wird nur eine gescheiterte Mail
 * nachgeholt, damit erneutes Senden auch diesen Fall repariert.
 */
export async function importiereUndBenachrichtige(db: Db, a: Abrechnung, optionen: ImportOptionen): Promise<ImportErgebnis> {
  const vorher = await vorhandene(db, a);
  const v = await vorschau(db, a);
  if (v.status === 'unveraendert') {
    if (!vorher || !NACHHOLEN.has(vorher.benachrichtigung ?? '')) return { ...v, id: null, benachrichtigung: null };
    const benachrichtigung = await benachrichtige(db, a, false, optionen);
    await setzeStatus(db, vorher.id, benachrichtigung);
    return { ...v, id: vorher.id, benachrichtigung };
  }
  const { id } = await importiereAbrechnung(db, a, optionen.importiertVon);
  await setzeStatus(db, id, 'ausstehend');
  const benachrichtigung = await benachrichtige(db, a, v.status === 'ersetzt', optionen);
  await setzeStatus(db, id, benachrichtigung);
  return { ...v, id, benachrichtigung };
}

/** Versender aus der Umgebung, oder null, wenn SMTP nicht eingerichtet ist. */
export function versenderAusUmgebung(env: Umgebung = process.env): Versender | null {
  const e = smtpAusUmgebung(env);
  return e ? smtpVersender(e) : null;
}

// ---------------------------------------------------------------------------
// Einstellungen und Admin

export async function provisionMailAn(db: Db, benutzerId: string): Promise<boolean> {
  const z = await db.query<{ provision_mail: boolean }>('SELECT provision_mail FROM benutzer WHERE id = $1', [benutzerId]);
  return z[0]?.provision_mail ?? true;
}

export async function setzeProvisionMail(db: Db, benutzerId: string, an: boolean): Promise<void> {
  await db.query('UPDATE benutzer SET provision_mail = $2 WHERE id = $1', [benutzerId, an]);
}

/** Je Abrechnung, was mit der Mail geschah. Fuer die Tabelle im Admin. */
export async function benachrichtigungen(db: Db): Promise<Map<string, Benachrichtigung | 'ausstehend'>> {
  const zeilen = await db.query<{ id: string; benachrichtigung: Benachrichtigung | 'ausstehend' | null }>(
    'SELECT id, benachrichtigung FROM provision_abrechnungen WHERE benachrichtigung IS NOT NULL',
  );
  return new Map(zeilen.map((z) => [z.id, z.benachrichtigung as Benachrichtigung | 'ausstehend']));
}

// ---------------------------------------------------------------------------
// Der Endpunkt

export const RATE_PRAEFIX = 'provision-import:';

export interface AnfrageKontext {
  request: Request;
  db: Db;
  ip: string;
  env?: Umgebung;
  /** undefined: aus der Umgebung bauen. null: nicht senden. */
  versender?: Versender | null;
  portalUrl: string;
}

function json(status: number, daten: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

/** So steht der Import per Token im Admin-Protokoll: ohne Admin-ID. */
export const TOKEN_AKTEUR: Akteur = { id: null, name: 'Import per Token' };

/**
 * Schreibt einen Import ins Admin-Protokoll. Ein unveraenderter Import ohne
 * nachgeholte Mail hat nichts geschrieben und bekommt darum keinen Eintrag.
 */
export async function protokolliereProvisionsImport(
  db: Db,
  akteur: Akteur,
  a: Abrechnung,
  e: ImportErgebnis,
  datei?: string,
): Promise<void> {
  const ziel = { zielTyp: 'abrechnung' as const, zielId: e.id, zielText: `${a.vertriebler} ${a.monat}` };
  if (e.status === 'unveraendert') {
    if (!e.id || !e.benachrichtigung) return;
    await protokolliere(db, akteur, { aktion: 'provision_mail_nachgeholt', ...ziel, details: { benachrichtigung: e.benachrichtigung } });
    return;
  }
  await protokolliere(db, akteur, {
    aktion: 'provision_importiert',
    ...ziel,
    details: {
      ersetzt: e.status === 'ersetzt',
      summeCent: a.summeCent,
      auszahlungCent: a.auszahlungCent,
      benachrichtigung: e.benachrichtigung ?? 'keine',
      ...(datei ? { datei } : {}),
    },
  });
}

async function gesperrt(db: Db, schluessel: string): Promise<number> {
  const z = await db.query<{ gesperrt_bis: Date | string | null }>(
    'SELECT gesperrt_bis FROM login_versuche WHERE schluessel = $1',
    [schluessel],
  );
  const bis = z[0]?.gesperrt_bis ? new Date(z[0].gesperrt_bis).getTime() : 0;
  return bis > Date.now() ? Math.ceil((bis - Date.now()) / 1000) : 0;
}

export async function bearbeiteImportAnfrage(k: AnfrageKontext): Promise<Response> {
  const env = k.env ?? process.env;
  const schluessel = `${RATE_PRAEFIX}${k.ip}`;

  const warten = await gesperrt(k.db, schluessel);
  if (warten > 0) {
    return json(429, { ok: false, fehler: 'Zu viele Fehlversuche. Bitte spaeter erneut.' }, { 'Retry-After': String(warten) });
  }

  if (!tokenGueltig(k.request.headers.get('authorization'), importToken(env))) {
    // Nur Fehlversuche zaehlen. Ein echter Lauf schickt je Vertriebler zwei
    // Anfragen und soll sich nie selbst aussperren.
    const rate = await registriereVersuch(k.db, schluessel);
    if (rate.gesperrt) {
      return json(429, { ok: false, fehler: 'Zu viele Fehlversuche. Bitte spaeter erneut.' }, { 'Retry-After': String(rate.wartenSekunden) });
    }
    return json(401, { ok: false, fehler: 'Nicht berechtigt.' }, { 'WWW-Authenticate': 'Bearer' });
  }
  await rateZuruecksetzen(k.db, schluessel);

  const typ = k.request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(typ.trim())) {
    return json(415, { ok: false, fehler: 'Nur application/json.' });
  }
  const laenge = Number(k.request.headers.get('content-length') ?? 0);
  if (laenge > MAX_GROESSE) return json(413, { ok: false, fehler: 'Zu gross.' });
  const text = await k.request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_GROESSE) return json(413, { ok: false, fehler: 'Zu gross.' });

  let daten: unknown;
  try {
    daten = JSON.parse(text);
  } catch {
    return json(400, { ok: false, fehler: 'Kein gueltiges JSON.' });
  }
  const { abrechnung, fehler } = pruefeAbrechnung(daten);
  if (!abrechnung) return json(422, { ok: false, fehler: fehler.join(' ') });

  const kopf = { vertriebler: abrechnung.vertriebler, monat: abrechnung.monat };
  const nurPruefen = new URL(k.request.url).searchParams.get('pruefen') === '1';
  if (nurPruefen) {
    const v = await vorschau(k.db, abrechnung);
    return json(200, { ok: true, pruefung: true, ...kopf, ...v });
  }

  const versender = k.versender === undefined ? versenderAusUmgebung(env) : k.versender;
  const e = await importiereUndBenachrichtige(k.db, abrechnung, { importiertVon: null, versender, portalUrl: k.portalUrl });
  await protokolliereProvisionsImport(k.db, TOKEN_AKTEUR, abrechnung, e);
  // Zusaetzlich eine Zeile ohne Betraege im Funktions-Log bei Vercel.
  console.info(`provision-import ${kopf.vertriebler}/${kopf.monat}: ${e.status}, Mail: ${e.benachrichtigung ?? 'keine'}`);
  return json(200, {
    ok: true,
    ...kopf,
    status: e.status,
    warAusgezahlt: e.warAusgezahlt,
    benachrichtigung: e.benachrichtigung,
  });
}
