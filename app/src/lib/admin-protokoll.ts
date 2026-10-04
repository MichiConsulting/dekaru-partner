// Protokoll der Admin-Aktionen (Tabelle admin_protokoll, Migration 007).
//
// Jede schreibende Admin-Aktion ruft protokolliere() auf, am besten ueber die
// Funktionen in admin-aktionen.ts, die Aktion und Eintrag zusammen erledigen.
// Dieses Modul schreibt ausschliesslich mit INSERT. UPDATE und DELETE auf
// admin_protokoll gibt es im Code nicht, die Datenbank verweigert sie
// zusaetzlich per Trigger (ausser Loeschen nach Ablauf der Aufbewahrung).

import type { Db } from './db.ts';

/** Aufbewahrung in Monaten. Muss zum Trigger in 007-admin-ausbau.sql passen. */
export const PROTOKOLL_AUFBEWAHRUNG_MONATE = 24;

/**
 * Alle bekannten Aktionen mit ihrer Beschriftung. Neue Admin-Aktionen
 * bekommen hier einen Schluessel, bevor sie protokolliert werden.
 */
export const AKTIONEN = {
  zugang_angelegt: 'Zugang angelegt',
  zugang_deaktiviert: 'Zugang deaktiviert',
  zugang_aktiviert: 'Zugang aktiviert',
  einmal_passwort_neu: 'Einmal-Passwort neu',
  slug_geaendert: 'Slug geändert',
  stufe_geaendert: 'Stufe geändert',
  provision_importiert: 'Provision importiert',
  provision_ausgezahlt: 'Als ausgezahlt markiert',
  provision_auszahlung_zurueck: 'Auszahlung zurückgesetzt',
  provision_mail_nachgeholt: 'Provisionsmail nachgeholt',
  dublette_freigegeben: 'Dublette freigegeben',
  dublette_zugeordnet: 'Dublette zugeordnet',
  dublette_abgelehnt: 'Dublette beim Bisherigen belassen',
  dublette_admin_gespeichert: 'Kunde trotz Dublette gespeichert',
} as const;

export type Aktion = keyof typeof AKTIONEN;

export function aktionLabel(aktion: string): string {
  return (AKTIONEN as Record<string, string>)[aktion] ?? aktion;
}

export function istAktion(wert: string): wert is Aktion {
  return Object.prototype.hasOwnProperty.call(AKTIONEN, wert);
}

/** Wer etwas getan hat: ein Admin oder ein Skript (dann ohne ID). */
export interface Akteur {
  id: string | null;
  name: string;
}

export function skriptAkteur(skript: string): Akteur {
  return { id: null, name: `Skript ${skript}` };
}

export interface ProtokollEingabe {
  aktion: Aktion;
  zielTyp?: 'benutzer' | 'abrechnung' | 'kunde' | 'dublette' | '';
  zielId?: string | null;
  zielText?: string;
  details?: Record<string, unknown>;
}

// Schluessel, deren Werte nie ins Protokoll gehoeren, egal wie tief sie stecken.
const GEHEIM = /pass|token|csrf|hash|secret|geheim|cookie|sitzung/i;

/** Entfernt alles, was nach Passwort oder Token aussieht, und kuerzt lange Texte. */
export function bereinigeDetails(wert: unknown, tiefe = 0): unknown {
  if (tiefe > 4) return null;
  if (Array.isArray(wert)) return wert.slice(0, 50).map((w) => bereinigeDetails(w, tiefe + 1));
  if (wert && typeof wert === 'object') {
    const aus: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(wert as Record<string, unknown>)) {
      if (GEHEIM.test(k)) continue;
      aus[k] = bereinigeDetails(v, tiefe + 1);
    }
    return aus;
  }
  if (typeof wert === 'string') return wert.slice(0, 300);
  if (typeof wert === 'number' || typeof wert === 'boolean' || wert === null) return wert;
  return null;
}

/** Schreibt einen Eintrag. Wirft, wenn die Aktion unbekannt ist. */
export async function protokolliere(db: Db, akteur: Akteur, eintrag: ProtokollEingabe): Promise<void> {
  if (!istAktion(eintrag.aktion)) throw new Error(`Unbekannte Admin-Aktion: ${String(eintrag.aktion)}`);
  const details = bereinigeDetails(eintrag.details ?? {});
  await db.query(
    `INSERT INTO admin_protokoll (admin_id, admin_name, aktion, ziel_typ, ziel_id, ziel_text, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      akteur.id,
      String(akteur.name ?? '').slice(0, 120) || 'unbekannt',
      eintrag.aktion,
      eintrag.zielTyp ?? '',
      eintrag.zielId ?? null,
      String(eintrag.zielText ?? '').slice(0, 200),
      JSON.stringify(details ?? {}),
    ],
  );
}

export interface ProtokollEintrag {
  id: number;
  zeitpunkt: Date;
  adminId: string | null;
  adminName: string;
  aktion: string;
  zielTyp: string;
  zielId: string | null;
  zielText: string;
  details: Record<string, unknown>;
}

export interface ProtokollFilter {
  aktion?: string;
  suche?: string;
  /** JJJJ-MM-TT, einschliesslich */
  von?: string;
  /** JJJJ-MM-TT, einschliesslich */
  bis?: string;
  seite?: number;
}

export const PROTOKOLL_SEITE = 50;

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** Liest das Protokoll, neueste zuerst. Liefert eine Zeile mehr als die Seite, um "weitere" zu erkennen. */
export async function ladeProtokoll(
  db: Db,
  filter: ProtokollFilter = {},
): Promise<{ eintraege: ProtokollEintrag[]; weitere: boolean }> {
  const bedingungen = ['TRUE'];
  const params: unknown[] = [];
  if (filter.aktion && istAktion(filter.aktion)) {
    params.push(filter.aktion);
    bedingungen.push(`aktion = $${params.length}`);
  }
  const suche = String(filter.suche ?? '').trim().slice(0, 100);
  if (suche) {
    params.push(`%${suche.replace(/[%_\\]/g, (z) => `\\${z}`)}%`);
    const n = params.length;
    bedingungen.push(`(ziel_text ILIKE $${n} OR admin_name ILIKE $${n})`);
  }
  if (filter.von && DATUM.test(filter.von)) {
    params.push(filter.von);
    bedingungen.push(`zeitpunkt >= $${params.length}::date`);
  }
  if (filter.bis && DATUM.test(filter.bis)) {
    params.push(filter.bis);
    bedingungen.push(`zeitpunkt < ($${params.length}::date + 1)`);
  }
  const seite = Math.max(1, Math.min(1000, Math.floor(Number(filter.seite) || 1)));
  params.push(PROTOKOLL_SEITE + 1, (seite - 1) * PROTOKOLL_SEITE);
  const zeilen = await db.query<{
    id: number | string;
    zeitpunkt: Date | string;
    admin_id: string | null;
    admin_name: string;
    aktion: string;
    ziel_typ: string;
    ziel_id: string | null;
    ziel_text: string;
    details: Record<string, unknown> | string;
  }>(
    `SELECT id, zeitpunkt, admin_id, admin_name, aktion, ziel_typ, ziel_id, ziel_text, details
     FROM admin_protokoll WHERE ${bedingungen.join(' AND ')}
     ORDER BY zeitpunkt DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const eintraege = zeilen.slice(0, PROTOKOLL_SEITE).map((z) => ({
    id: Number(z.id),
    zeitpunkt: new Date(z.zeitpunkt),
    adminId: z.admin_id,
    adminName: z.admin_name,
    aktion: z.aktion,
    zielTyp: z.ziel_typ,
    zielId: z.ziel_id,
    zielText: z.ziel_text,
    details: typeof z.details === 'string' ? (JSON.parse(z.details) as Record<string, unknown>) : z.details,
  }));
  return { eintraege, weitere: zeilen.length > PROTOKOLL_SEITE };
}

const DETAIL_NAMEN: Record<string, string> = {
  alt: 'vorher',
  neu: 'nachher',
  rolle: 'Rolle',
  slug: 'Slug',
  summeCent: 'Provision',
  auszahlungCent: 'Auszahlung',
  datei: 'Datei',
  datum: 'Datum',
  treffer: 'Treffer',
  geloeschteEintraege: 'gelöschte Einträge',
};

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Details als kurzer Text fuer die Tabelle, zum Beispiel "vorher: anna, nachher: anna-b". */
export function detailsText(details: Record<string, unknown>): string {
  return Object.entries(details ?? {})
    .map(([k, v]) => {
      if (k === 'ersetzt') return v ? 'vorhandene ersetzt' : 'neu';
      const name = DETAIL_NAMEN[k] ?? k;
      if (k.endsWith('Cent') && typeof v === 'number') return `${name}: ${EURO.format(v / 100)}`;
      const text = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      return `${name}: ${text === '' ? 'leer' : text}`;
    })
    .join(', ');
}
