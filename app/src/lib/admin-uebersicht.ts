// Admin-Uebersicht aller Vertriebler: Zahlen eines Monats, Provision im
// Quartal, Lernstand, Pflichtsaetze, letzte Anmeldung, Hinweise.
//
// Die Monatszahlen kommen aus kunden_statuswechsel (Migration 007): gezaehlt
// wird jeder Kunde, der im Monat in den Status gewechselt ist. Ersttermin ist
// der Wechsel auf "termin", Zweittermin auf "zweittermin".

import type { Db } from './db.ts';

export const TAGE_OHNE_ANMELDUNG = 14;

export interface UebersichtZeile {
  benutzerId: string;
  name: string;
  aktiv: boolean;
  erstellt: Date;
  ersttermine: number;
  zweittermine: number;
  abschluesse: number;
  absagen: number;
  /** Abschluesse durch Zweittermine, null ohne Zweittermin */
  quote: number | null;
  provisionQuartalCent: number;
  kapitelErledigt: number;
  quizRichtig: number;
  quizBeantwortet: number;
  pflichtsaetzeSitzen: number;
  letzterLogin: Date | null;
  hinweise: string[];
}

const MONAT = /^\d{4}-(0[1-9]|1[0-2])$/;

export function istMonat(wert: string): boolean {
  return MONAT.test(String(wert ?? ''));
}

function monatPlus(monat: string, n: number): string {
  const [j, m] = monat.split('-').map(Number);
  const i = j * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Die drei Monate des Quartals, in dem der Monat liegt. */
export function quartalMonate(monat: string): string[] {
  const [j, m] = monat.split('-').map(Number);
  const erster = Math.floor((m - 1) / 3) * 3 + 1;
  const start = `${j}-${String(erster).padStart(2, '0')}`;
  return [start, monatPlus(start, 1), monatPlus(start, 2)];
}

export function quartalLabel(monat: string): string {
  const [j, m] = monat.split('-').map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${j}`;
}

/** Die letzten n Monate bis einschliesslich des Monats, neueste zuerst. */
export function letzteMonate(bis: string, n = 12): string[] {
  return Array.from({ length: n }, (_, i) => monatPlus(bis, -i));
}

export interface UebersichtOptionen {
  monat: string;
  pflichtsatzIds: string[];
  kapitelGesamt: number;
  jetzt?: Date;
}

/** Eine Zeile je Vertriebler. Admins zaehlen nicht mit. */
export async function vertrieblerUebersicht(db: Db, o: UebersichtOptionen): Promise<UebersichtZeile[]> {
  if (!istMonat(o.monat)) throw new Error('Monat muss JJJJ-MM sein.');
  const jetzt = o.jetzt ?? new Date();
  const von = `${o.monat}-01`;
  const bis = `${monatPlus(o.monat, 1)}-01`;
  const quartal = quartalMonate(o.monat);

  const zeilen = await db.query<{
    id: string;
    name: string;
    aktiv: boolean;
    erstellt_am: Date | string;
    letzter_login: Date | string | null;
    ersttermine: string | number;
    zweittermine: string | number;
    abschluesse: string | number;
    absagen: string | number;
    provision: string | number | null;
    erledigt: string | number;
    richtig: string | number;
    beantwortet: string | number;
    sitzen: string | number;
  }>(
    `SELECT b.id, b.name, b.aktiv, b.erstellt_am, b.letzter_login,
       (SELECT COUNT(DISTINCT COALESCE(w.kunde_id::text, w.id::text)) FROM kunden_statuswechsel w
          WHERE w.benutzer_id = b.id AND w.status = 'termin' AND w.am >= $1::date AND w.am < $2::date) AS ersttermine,
       (SELECT COUNT(DISTINCT COALESCE(w.kunde_id::text, w.id::text)) FROM kunden_statuswechsel w
          WHERE w.benutzer_id = b.id AND w.status = 'zweittermin' AND w.am >= $1::date AND w.am < $2::date) AS zweittermine,
       (SELECT COUNT(DISTINCT COALESCE(w.kunde_id::text, w.id::text)) FROM kunden_statuswechsel w
          WHERE w.benutzer_id = b.id AND w.status = 'abschluss' AND w.am >= $1::date AND w.am < $2::date) AS abschluesse,
       (SELECT COUNT(DISTINCT COALESCE(w.kunde_id::text, w.id::text)) FROM kunden_statuswechsel w
          WHERE w.benutzer_id = b.id AND w.status = 'absage' AND w.am >= $1::date AND w.am < $2::date) AS absagen,
       (SELECT COALESCE(SUM((p.daten->>'summeCent')::bigint), 0) FROM provision_abrechnungen p
          WHERE b.vertriebler_slug IS NOT NULL AND p.vertriebler_slug = b.vertriebler_slug AND p.monat = ANY($3::text[])) AS provision,
       (SELECT COUNT(*) FROM kapitel_fortschritt k WHERE k.benutzer_id = b.id) AS erledigt,
       (SELECT COUNT(*) FROM quiz_antworten q WHERE q.benutzer_id = b.id AND q.richtig) AS richtig,
       (SELECT COUNT(*) FROM quiz_antworten q WHERE q.benutzer_id = b.id) AS beantwortet,
       (SELECT COUNT(*) FROM pflichtsatz_antworten s WHERE s.benutzer_id = b.id AND s.richtig AND s.satz_id = ANY($4::text[])) AS sitzen
     FROM benutzer b
     WHERE b.rolle = 'vertriebler'
     ORDER BY b.name`,
    [von, bis, quartal, o.pflichtsatzIds],
  );

  return zeilen.map((z) => {
    const zweittermine = Number(z.zweittermine);
    const abschluesse = Number(z.abschluesse);
    const zeile: UebersichtZeile = {
      benutzerId: z.id,
      name: z.name,
      aktiv: z.aktiv,
      erstellt: new Date(z.erstellt_am),
      ersttermine: Number(z.ersttermine),
      zweittermine,
      abschluesse,
      absagen: Number(z.absagen),
      quote: zweittermine > 0 ? abschluesse / zweittermine : null,
      provisionQuartalCent: Number(z.provision ?? 0),
      kapitelErledigt: Number(z.erledigt),
      quizRichtig: Number(z.richtig),
      quizBeantwortet: Number(z.beantwortet),
      pflichtsaetzeSitzen: Number(z.sitzen),
      letzterLogin: z.letzter_login ? new Date(z.letzter_login) : null,
      hinweise: [],
    };
    zeile.hinweise = hinweise(zeile, { pflichtsaetze: o.pflichtsatzIds.length, kapitel: o.kapitelGesamt, jetzt });
    return zeile;
  });
}

/** Auffaelligkeiten fuer eine Zeile. Deaktivierte Zugaenge bekommen keine. */
export function hinweise(
  z: Pick<UebersichtZeile, 'aktiv' | 'letzterLogin' | 'erstellt' | 'pflichtsaetzeSitzen' | 'kapitelErledigt' | 'quizBeantwortet' | 'zweittermine' | 'abschluesse' | 'absagen' | 'ersttermine'>,
  soll: { pflichtsaetze: number; kapitel: number; jetzt: Date },
): string[] {
  if (!z.aktiv) return [];
  const aus: string[] = [];
  const grenze = soll.jetzt.getTime() - TAGE_OHNE_ANMELDUNG * 24 * 60 * 60 * 1000;
  if (!z.letzterLogin) {
    if (z.erstellt.getTime() < grenze) aus.push(`Seit über ${TAGE_OHNE_ANMELDUNG} Tagen eingeladen, nie angemeldet`);
    else aus.push('Noch nie angemeldet');
  } else if (z.letzterLogin.getTime() < grenze) {
    aus.push(`Seit über ${TAGE_OHNE_ANMELDUNG} Tagen nicht angemeldet`);
  }
  if (soll.pflichtsaetze > 0 && z.pflichtsaetzeSitzen < soll.pflichtsaetze) {
    aus.push(`Pflichtsätze offen (${soll.pflichtsaetze - z.pflichtsaetzeSitzen})`);
  }
  if (soll.kapitel > 0 && z.kapitelErledigt === 0 && z.quizBeantwortet === 0) aus.push('Lernen nicht begonnen');
  if (z.zweittermine >= 3 && z.abschluesse === 0) aus.push('Zweittermine ohne Abschluss');
  if (z.absagen >= 5 && z.absagen > 2 * (z.ersttermine + z.zweittermine)) aus.push('Viele Absagen');
  return aus;
}

export const SORTIERUNGEN = {
  name: 'Name',
  ersttermine: 'Ersttermine',
  zweittermine: 'Zweittermine',
  abschluesse: 'Abschlüsse',
  absagen: 'Absagen',
  quote: 'Abschlussquote',
  provision: 'Provision',
  lernen: 'Lernfortschritt',
  pflichtsaetze: 'Pflichtsätze',
  login: 'Letzte Anmeldung',
  hinweise: 'Hinweise',
} as const;

export type Sortierung = keyof typeof SORTIERUNGEN;
export type Richtung = 'auf' | 'ab';

export function istSortierung(wert: string): wert is Sortierung {
  return Object.prototype.hasOwnProperty.call(SORTIERUNGEN, wert);
}

/** Natuerliche Richtung beim ersten Klick: Namen aufsteigend, Zahlen absteigend. */
export function standardRichtung(sort: Sortierung): Richtung {
  return sort === 'name' ? 'auf' : 'ab';
}

function wert(z: UebersichtZeile, sort: Sortierung): number | string {
  switch (sort) {
    case 'name':
      return z.name.toLocaleLowerCase('de-DE');
    case 'ersttermine':
      return z.ersttermine;
    case 'zweittermine':
      return z.zweittermine;
    case 'abschluesse':
      return z.abschluesse;
    case 'absagen':
      return z.absagen;
    case 'quote':
      return z.quote ?? -1;
    case 'provision':
      return z.provisionQuartalCent;
    case 'lernen':
      return z.kapitelErledigt * 100000 + z.quizRichtig;
    case 'pflichtsaetze':
      return z.pflichtsaetzeSitzen;
    case 'login':
      return z.letzterLogin ? z.letzterLogin.getTime() : 0;
    case 'hinweise':
      return z.hinweise.length;
  }
}

/** Sortiert eine Kopie. Bei Gleichstand entscheidet der Name. */
export function sortiere(zeilen: UebersichtZeile[], sort: Sortierung, richtung: Richtung): UebersichtZeile[] {
  const faktor = richtung === 'auf' ? 1 : -1;
  return [...zeilen].sort((a, b) => {
    const x = wert(a, sort);
    const y = wert(b, sort);
    const v = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, 'de-DE') : Number(x) - Number(y);
    return v !== 0 ? v * faktor : a.name.localeCompare(b.name, 'de-DE');
  });
}

export function quoteText(quote: number | null): string {
  if (quote === null) return 'keine';
  return `${Math.round(quote * 100)} %`;
}
