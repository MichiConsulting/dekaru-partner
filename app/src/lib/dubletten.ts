// Dubletten-Warnung: derselbe Betrieb darf nicht von zwei Vertrieblern
// gleichzeitig angesprochen werden.
//
// Verglichen wird ueber normalisierte Werte (Name ohne Rechtsform, Ort,
// Telefonnummer nur als Ziffern). Ein Vertriebler erfaehrt nur, dass der
// Betrieb schon betreut wird, nie von wem und nie mit welchen Daten. Der
// Admin sieht beide Eintraege und entscheidet.

import type { Db } from './db.ts';
import type { Benutzer } from './auth.ts';
import { istUuid, type KundeEingabe } from './kunden.ts';

export const MELDUNG_FREMD = 'Dieser Betrieb wird bereits betreut, bitte mit Michael Henning klären.';
export const MELDUNG_EIGEN = 'Diesen Betrieb haben Sie bereits eingetragen. Bitte den vorhandenen Eintrag weiterführen.';

// ---------------------------------------------------------------------------
// Normalisierung

/** Kleinbuchstaben, Umlaute ausgeschrieben, andere Akzente entfernt. */
function grundform(text: string): string {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Rechtsformen und Zusaetze, die am Betrieb nichts aendern. Verglichen wird
// je Wort, nachdem Punkte entfernt sind ("e.K." wird "ek").
const RECHTSFORMEN = new Set([
  'gmbh', 'mbh', 'ggmbh', 'ug', 'haftungsbeschraenkt', 'ag', 'kg', 'ohg', 'gbr', 'ek', 'ekfm', 'ekfr', 'ev',
  'co', 'cokg', 'kgaa', 'se', 'ltd', 'partg', 'partgmbb', 'inh', 'inhaber', 'inhaberin', 'eg', 'mbb',
]);

/** Name des Betriebs ohne Rechtsform, Sonderzeichen und Leerraum. */
export function normalisiereName(name: string): string {
  const roh = grundform(name)
    .replace(/\./g, '')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Einzelbuchstaben hintereinander gehoeren zusammen: "e. K." wird "ek".
  const woerter: string[] = [];
  let ausEinzelbuchstaben = false;
  for (const w of roh) {
    if (w.length === 1 && ausEinzelbuchstaben) {
      woerter[woerter.length - 1] += w;
    } else {
      woerter.push(w);
      ausEinzelbuchstaben = w.length === 1;
    }
  }
  return woerter.filter((w) => !RECHTSFORMEN.has(w)).join('');
}

/** Ort ohne Postleitzahl, Klammerzusatz und Sonderzeichen. */
export function normalisiereOrt(ort: string): string {
  return grundform(ort)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z]+/g, '');
}

/** Telefonnummer nur als Ziffern in nationaler Form: +49 und 0049 werden zu 0. */
export function normalisiereTelefon(telefon: string): string {
  const roh = String(telefon ?? '').trim();
  const ohneNull = roh.replace(/\(\s*0\s*\)/g, '');
  let ziffern = ohneNull.replace(/\D/g, '');
  if (roh.startsWith('+')) {
    ziffern = ziffern.startsWith('49') ? `0${ziffern.slice(2)}` : `00${ziffern}`;
  } else if (ziffern.startsWith('0049')) {
    ziffern = `0${ziffern.slice(4)}`;
  }
  return ziffern;
}

export interface Schluessel {
  name: string;
  ort: string;
  telefon: string;
}

export function schluessel(k: { name: string; ort?: string; telefon?: string }): Schluessel {
  return { name: normalisiereName(k.name), ort: normalisiereOrt(k.ort ?? ''), telefon: normalisiereTelefon(k.telefon ?? '') };
}

const TELEFON_MIN = 6;

/**
 * Gleicher Betrieb, wenn die Telefonnummer gleich ist, oder wenn der Name
 * gleich ist und der Ort gleich oder auf einer Seite leer.
 */
export function gleicherBetrieb(a: Schluessel, b: Schluessel): boolean {
  if (a.telefon.length >= TELEFON_MIN && a.telefon === b.telefon) return true;
  if (!a.name || a.name !== b.name) return false;
  return !a.ort || !b.ort || a.ort === b.ort;
}

// ---------------------------------------------------------------------------
// Pruefung beim Speichern

interface KandidatZeile {
  id: string;
  benutzer_id: string;
  name: string;
  ort: string;
  telefon: string;
}

/** Alle Eintraege, die zu den Angaben passen, ausser dem eigenen, der gerade bearbeitet wird. */
export async function findeTreffer(
  db: Db,
  eingabe: Pick<KundeEingabe, 'name' | 'ort' | 'telefon'>,
  ausserKundeId?: string | null,
): Promise<KandidatZeile[]> {
  const ziel = schluessel(eingabe);
  if (!ziel.name && ziel.telefon.length < TELEFON_MIN) return [];
  // Klein genug fuer einen Vergleich im Speicher: ein paar hundert Betriebe.
  // So gilt dieselbe Normalisierung wie im Test, ohne sie in SQL nachzubauen.
  const zeilen = await db.query<KandidatZeile>('SELECT id, benutzer_id, name, ort, telefon FROM kunden');
  return zeilen.filter((z) => z.id !== ausserKundeId && gleicherBetrieb(ziel, schluessel(z)));
}

/** Treffer, fuer die der Admin diesem Vertriebler bereits eine Freigabe erteilt hat. */
async function freigegebeneTreffer(db: Db, benutzerId: string): Promise<Set<string>> {
  const zeilen = await db.query<{ kid: string }>(
    `SELECT DISTINCT unnest(treffer) AS kid FROM dubletten_meldungen
     WHERE benutzer_id = $1 AND status IN ('freigegeben', 'zugeordnet')`,
    [benutzerId],
  );
  return new Set(zeilen.map((z) => z.kid));
}

/** Was ein Vertriebler sieht: nur ob, nie wer oder was. */
export interface PruefungVertriebler {
  blockiert: boolean;
  meldung: string | null;
}

/** Was der Admin sieht, wenn er selbst speichert. */
export interface TrefferAdmin {
  id: string;
  name: string;
  ort: string;
  telefon: string;
  vertriebler: string;
}

export type DublettenPruefung =
  | { rolle: 'vertriebler'; blockiert: boolean; meldung: string | null }
  | { rolle: 'admin'; blockiert: boolean; meldung: string | null; treffer: TrefferAdmin[] };

/**
 * Prueft vor dem Speichern. Bei einer Aenderung nur, wenn sich Name, Ort oder
 * Telefon geaendert haben, damit alte Eintraege nicht am Statuswechsel scheitern.
 *
 * Fuer Vertriebler enthaelt das Ergebnis bewusst keine Daten des Treffers.
 * Eine Meldung fuer den Admin wird abgelegt, wenn ein fremder Treffer blockiert.
 */
export async function pruefeDublette(
  db: Db,
  benutzer: Pick<Benutzer, 'id' | 'rolle'>,
  eingabe: Pick<KundeEingabe, 'name' | 'ort' | 'telefon'>,
  optionen: { kundeId?: string | null; alt?: Pick<KundeEingabe, 'name' | 'ort' | 'telefon'> | null; adminFreigabe?: boolean } = {},
): Promise<DublettenPruefung> {
  const istAdmin = benutzer.rolle === 'admin';
  const leer: DublettenPruefung = istAdmin
    ? { rolle: 'admin', blockiert: false, meldung: null, treffer: [] }
    : { rolle: 'vertriebler', blockiert: false, meldung: null };

  if (optionen.alt) {
    const a = schluessel(optionen.alt);
    const n = schluessel(eingabe);
    if (a.name === n.name && a.ort === n.ort && a.telefon === n.telefon) return leer;
  }

  const alle = await findeTreffer(db, eingabe, optionen.kundeId ?? null);
  if (alle.length === 0) return leer;

  if (istAdmin) {
    const namen = await db.query<{ id: string; name: string }>('SELECT id, name FROM benutzer WHERE id = ANY($1::uuid[])', [
      [...new Set(alle.map((t) => t.benutzer_id))],
    ]);
    const nameJe = new Map(namen.map((n) => [n.id, n.name]));
    const treffer = alle.map((t) => ({
      id: t.id,
      name: t.name,
      ort: t.ort,
      telefon: t.telefon,
      vertriebler: t.benutzer_id === benutzer.id ? 'Sie selbst' : (nameJe.get(t.benutzer_id) ?? ''),
    }));
    // Der Admin gibt sich selbst frei, indem er "trotzdem speichern" waehlt.
    if (optionen.adminFreigabe) return { rolle: 'admin', blockiert: false, meldung: null, treffer };
    return { rolle: 'admin', blockiert: true, meldung: 'Diesen Betrieb gibt es schon. Bitte die Treffer prüfen.', treffer };
  }

  const eigene = alle.filter((t) => t.benutzer_id === benutzer.id);
  const freigaben = await freigegebeneTreffer(db, benutzer.id);
  const fremde = alle.filter((t) => t.benutzer_id !== benutzer.id && !freigaben.has(t.id));

  if (fremde.length > 0) {
    await legeMeldungAn(db, benutzer.id, eingabe, fremde.map((t) => t.id), optionen.kundeId ?? null);
    return { rolle: 'vertriebler', blockiert: true, meldung: MELDUNG_FREMD };
  }
  if (eigene.length > 0) return { rolle: 'vertriebler', blockiert: true, meldung: MELDUNG_EIGEN };
  return leer;
}

/**
 * Legt eine offene Meldung an. Gibt es fuer dieselben Treffer schon eine
 * offene oder eine abgelehnte, bleibt es dabei: der Admin hat schon
 * entschieden oder wird es noch, ein erneuter Versuch erzeugt keine neue.
 */
async function legeMeldungAn(
  db: Db,
  benutzerId: string,
  eingabe: Pick<KundeEingabe, 'name' | 'ort' | 'telefon'>,
  treffer: string[],
  eigenerKundeId: string | null,
): Promise<void> {
  const sortiert = [...treffer].sort();
  const offen = await db.query<{ id: string }>(
    `SELECT id FROM dubletten_meldungen
     WHERE benutzer_id = $1 AND status IN ('offen', 'abgelehnt') AND treffer @> $2::uuid[] AND treffer <@ $2::uuid[]`,
    [benutzerId, sortiert],
  );
  if (offen.length > 0) return;
  await db.query(
    `INSERT INTO dubletten_meldungen (benutzer_id, eigener_kunde_id, name, ort, telefon, treffer)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[])`,
    [benutzerId, eigenerKundeId && istUuid(eigenerKundeId) ? eigenerKundeId : null, eingabe.name, eingabe.ort, eingabe.telefon, sortiert],
  );
}

// ---------------------------------------------------------------------------
// Admin-Sicht

export type MeldungStatus = 'offen' | 'freigegeben' | 'zugeordnet' | 'abgelehnt';

export const MELDUNG_STATUS: Record<MeldungStatus, string> = {
  offen: 'Offen',
  freigegeben: 'Freigegeben',
  zugeordnet: 'Dem Anfragenden zugeordnet',
  abgelehnt: 'Beim Bisherigen belassen',
};

export interface DublettenMeldung {
  id: string;
  gemeldetAm: Date;
  anfrage: { benutzerId: string; vertriebler: string; name: string; ort: string; telefon: string };
  bestand: { id: string; benutzerId: string; vertriebler: string; name: string; ort: string; telefon: string; status: string }[];
  status: MeldungStatus;
  entschiedenAm: Date | null;
}

/** Nur fuer den Admin: Meldungen mit beiden Seiten. */
export async function ladeMeldungen(db: Db, nurOffene = false): Promise<DublettenMeldung[]> {
  const zeilen = await db.query<{
    id: string;
    gemeldet_am: Date | string;
    benutzer_id: string;
    vertriebler: string;
    name: string;
    ort: string;
    telefon: string;
    treffer: string[];
    status: MeldungStatus;
    entschieden_am: Date | string | null;
  }>(
    `SELECT m.id, m.gemeldet_am, m.benutzer_id, b.name AS vertriebler, m.name, m.ort, m.telefon, m.treffer, m.status, m.entschieden_am
     FROM dubletten_meldungen m JOIN benutzer b ON b.id = m.benutzer_id
     ${nurOffene ? "WHERE m.status = 'offen'" : ''}
     ORDER BY (m.status = 'offen') DESC, m.gemeldet_am DESC
     LIMIT 200`,
  );
  const ids = [...new Set(zeilen.flatMap((z) => z.treffer))];
  const bestand = ids.length
    ? await db.query<{ id: string; benutzer_id: string; vertriebler: string; name: string; ort: string; telefon: string; status: string }>(
        `SELECT k.id, k.benutzer_id, b.name AS vertriebler, k.name, k.ort, k.telefon, k.status
         FROM kunden k JOIN benutzer b ON b.id = k.benutzer_id WHERE k.id = ANY($1::uuid[])`,
        [ids],
      )
    : [];
  const je = new Map(bestand.map((k) => [k.id, k]));
  return zeilen.map((z) => ({
    id: z.id,
    gemeldetAm: new Date(z.gemeldet_am),
    anfrage: { benutzerId: z.benutzer_id, vertriebler: z.vertriebler, name: z.name, ort: z.ort, telefon: z.telefon },
    bestand: z.treffer
      .map((t) => je.get(t))
      .filter((k): k is NonNullable<typeof k> => Boolean(k))
      .map((k) => ({ id: k.id, benutzerId: k.benutzer_id, vertriebler: k.vertriebler, name: k.name, ort: k.ort, telefon: k.telefon, status: k.status })),
    status: z.status,
    entschiedenAm: z.entschieden_am ? new Date(z.entschieden_am) : null,
  }));
}

export async function zaehleOffeneMeldungen(db: Db): Promise<number> {
  const z = await db.query<{ n: string | number }>("SELECT COUNT(*) AS n FROM dubletten_meldungen WHERE status = 'offen'");
  return Number(z[0]?.n ?? 0);
}

export interface BestandsPaar {
  a: { id: string; name: string; ort: string; telefon: string; vertriebler: string };
  b: { id: string; name: string; ort: string; telefon: string; vertriebler: string };
}

/** Nur fuer den Admin: Dubletten, die schon im Bestand liegen, bei verschiedenen Vertrieblern. */
export async function dublettenImBestand(db: Db): Promise<BestandsPaar[]> {
  const zeilen = await db.query<KandidatZeile & { vertriebler: string }>(
    `SELECT k.id, k.benutzer_id, k.name, k.ort, k.telefon, b.name AS vertriebler
     FROM kunden k JOIN benutzer b ON b.id = k.benutzer_id ORDER BY k.erstellt_am`,
  );
  const mit = zeilen.map((z) => ({ z, s: schluessel(z) }));
  const paare: BestandsPaar[] = [];
  for (let i = 0; i < mit.length; i++) {
    for (let j = i + 1; j < mit.length; j++) {
      if (mit[i].z.benutzer_id === mit[j].z.benutzer_id) continue;
      if (!gleicherBetrieb(mit[i].s, mit[j].s)) continue;
      const teil = ({ z }: (typeof mit)[number]) => ({ id: z.id, name: z.name, ort: z.ort, telefon: z.telefon, vertriebler: z.vertriebler });
      paare.push({ a: teil(mit[i]), b: teil(mit[j]) });
    }
  }
  return paare;
}

export async function holeMeldung(db: Db, id: string): Promise<DublettenMeldung | null> {
  if (!istUuid(id)) return null;
  return (await ladeMeldungen(db)).find((m) => m.id === id) ?? null;
}
