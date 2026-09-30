// Provisionsaufstellungen: Import der JSON-Dateien aus dekaru-rechnungen
// (provision/<monat>/<slug>.json, erzeugt von provision.mjs) und Abfrage je
// Vertriebler. Das Portal rechnet nichts nach, es zeigt die Aufstellung.

import type { Db } from './db.ts';

export const FORMAT_VERSION = 1;

export interface ProvisionZeile {
  monat: string;
  betragCent: number;
  art: string;
  text: string;
  nummer: string;
  slug: string;
  kunde: string;
  grundlageCent: number;
  zahlungIso: string | null;
  leistungsmonat: string | null;
  entstanden?: string;
}

export interface Abrechnung {
  format: number;
  monat: string;
  vertriebler: string;
  name: string;
  erstellt: string;
  auszahlungZum: string;
  zeilen: ProvisionZeile[];
  vortragCent: number;
  summeCent: number;
  auszahlungCent: number;
  neuerVortragCent: number;
  aufgelaufen: ProvisionZeile[];
  aufgelaufenCent: number;
  hinweise: { slug: string; monat?: string; text: string }[];
}

export interface GespeicherteAbrechnung extends Abrechnung {
  id: string;
  importiertAm: Date;
  ausgezahltAm: string | null;
}

const MONAT = /^\d{4}-(0[1-9]|1[0-2])$/;

function ganzzahl(wert: unknown, name: string, fehler: string[]): number {
  if (!Number.isInteger(wert)) fehler.push(`${name} muss eine ganze Zahl in Cent sein.`);
  return Number(wert) || 0;
}

function zeile(roh: unknown, wo: string, fehler: string[]): ProvisionZeile {
  const z = (roh ?? {}) as Record<string, unknown>;
  if (!MONAT.test(String(z.monat ?? ''))) fehler.push(`${wo}: monat fehlt oder ist kein JJJJ-MM.`);
  if (!z.nummer) fehler.push(`${wo}: nummer fehlt.`);
  return {
    monat: String(z.monat ?? ''),
    betragCent: ganzzahl(z.betragCent, `${wo}: betragCent`, fehler),
    art: String(z.art ?? ''),
    text: String(z.text ?? ''),
    nummer: String(z.nummer ?? ''),
    slug: String(z.slug ?? ''),
    kunde: String(z.kunde ?? ''),
    grundlageCent: ganzzahl(z.grundlageCent, `${wo}: grundlageCent`, fehler),
    zahlungIso: z.zahlungIso ? String(z.zahlungIso) : null,
    leistungsmonat: z.leistungsmonat ? String(z.leistungsmonat) : null,
    entstanden: z.entstanden ? String(z.entstanden) : undefined,
  };
}

/** Prueft eine JSON-Datei aus provision.mjs. Liefert die Abrechnung oder Fehler. */
export function pruefeAbrechnung(daten: unknown): { abrechnung: Abrechnung | null; fehler: string[] } {
  const fehler: string[] = [];
  const d = (daten ?? {}) as Record<string, unknown>;
  if (typeof daten !== 'object' || daten === null) return { abrechnung: null, fehler: ['Keine JSON-Struktur.'] };
  if (d.format !== FORMAT_VERSION) fehler.push(`format muss ${FORMAT_VERSION} sein, gefunden: ${String(d.format)}.`);
  if (!MONAT.test(String(d.monat ?? ''))) fehler.push('monat fehlt oder ist kein JJJJ-MM.');
  if (!/^[a-z0-9-]+$/.test(String(d.vertriebler ?? ''))) fehler.push('vertriebler fehlt oder ist kein Slug.');

  const zeilen = Array.isArray(d.zeilen) ? d.zeilen.map((z, i) => zeile(z, `zeilen[${i}]`, fehler)) : [];
  if (!Array.isArray(d.zeilen)) fehler.push('zeilen fehlt.');
  const aufgelaufen = Array.isArray(d.aufgelaufen) ? d.aufgelaufen.map((z, i) => zeile(z, `aufgelaufen[${i}]`, fehler)) : [];

  const summeCent = ganzzahl(d.summeCent, 'summeCent', fehler);
  const auszahlungCent = ganzzahl(d.auszahlungCent, 'auszahlungCent', fehler);
  const vortragCent = ganzzahl(d.vortragCent ?? 0, 'vortragCent', fehler);
  const neuerVortragCent = ganzzahl(d.neuerVortragCent ?? 0, 'neuerVortragCent', fehler);

  const zeilenSumme = zeilen.reduce((s, z) => s + z.betragCent, 0);
  if (fehler.length === 0 && zeilenSumme !== summeCent) {
    fehler.push(`summeCent (${summeCent}) passt nicht zur Summe der Zeilen (${zeilenSumme}).`);
  }
  if (fehler.length === 0 && Math.max(0, summeCent + vortragCent) !== auszahlungCent) {
    fehler.push('auszahlungCent passt nicht zu summeCent und vortragCent.');
  }

  const hinweise = Array.isArray(d.hinweise)
    ? d.hinweise.map((h) => {
        const o = (h ?? {}) as Record<string, unknown>;
        return { slug: String(o.slug ?? ''), monat: o.monat ? String(o.monat) : undefined, text: String(o.text ?? '') };
      })
    : [];

  if (fehler.length > 0) return { abrechnung: null, fehler };
  return {
    abrechnung: {
      format: FORMAT_VERSION,
      monat: String(d.monat),
      vertriebler: String(d.vertriebler),
      name: String(d.name ?? d.vertriebler),
      erstellt: String(d.erstellt ?? ''),
      auszahlungZum: String(d.auszahlungZum ?? ''),
      zeilen,
      vortragCent,
      summeCent,
      auszahlungCent,
      neuerVortragCent,
      aufgelaufen,
      aufgelaufenCent: Number.isInteger(d.aufgelaufenCent)
        ? Number(d.aufgelaufenCent)
        : aufgelaufen.reduce((s, z) => s + z.betragCent, 0),
      hinweise,
    },
    fehler: [],
  };
}

/** Legt die Abrechnung ab oder ersetzt die vorhandene fuer denselben Monat und Slug. */
export async function importiereAbrechnung(
  db: Db,
  abrechnung: Abrechnung,
  importiertVon: string | null,
): Promise<{ id: string; ersetzt: boolean }> {
  const vorhanden = await db.query<{ id: string }>(
    'SELECT id FROM provision_abrechnungen WHERE vertriebler_slug = $1 AND monat = $2',
    [abrechnung.vertriebler, abrechnung.monat],
  );
  const zeilen = await db.query<{ id: string }>(
    `INSERT INTO provision_abrechnungen (vertriebler_slug, monat, daten, importiert_von, importiert_am)
     VALUES ($1, $2, $3::jsonb, $4, now())
     ON CONFLICT (vertriebler_slug, monat) DO UPDATE
       SET daten = EXCLUDED.daten, importiert_von = EXCLUDED.importiert_von, importiert_am = now()
     RETURNING id`,
    [abrechnung.vertriebler, abrechnung.monat, JSON.stringify(abrechnung), importiertVon],
  );
  return { id: zeilen[0].id, ersetzt: vorhanden.length > 0 };
}

interface AbrechnungZeile {
  id: string;
  daten: Abrechnung | string;
  importiert_am: Date | string;
  ausgezahlt_am: Date | string | null;
}

function zuGespeichert(z: AbrechnungZeile): GespeicherteAbrechnung {
  const daten = typeof z.daten === 'string' ? (JSON.parse(z.daten) as Abrechnung) : z.daten;
  const ausgezahlt = z.ausgezahlt_am
    ? z.ausgezahlt_am instanceof Date
      ? z.ausgezahlt_am.toISOString().slice(0, 10)
      : String(z.ausgezahlt_am).slice(0, 10)
    : null;
  return { ...daten, id: z.id, importiertAm: new Date(z.importiert_am), ausgezahltAm: ausgezahlt };
}

/** Alle Abrechnungen eines Vertrieblers, neueste zuerst. */
export async function ladeAbrechnungen(db: Db, vertrieblerSlug: string): Promise<GespeicherteAbrechnung[]> {
  const zeilen = await db.query<AbrechnungZeile>(
    'SELECT id, daten, importiert_am, ausgezahlt_am FROM provision_abrechnungen WHERE vertriebler_slug = $1 ORDER BY monat DESC',
    [vertrieblerSlug],
  );
  return zeilen.map(zuGespeichert);
}

export async function ladeAbrechnung(db: Db, vertrieblerSlug: string, monat: string): Promise<GespeicherteAbrechnung | null> {
  if (!MONAT.test(monat)) return null;
  const zeilen = await db.query<AbrechnungZeile>(
    'SELECT id, daten, importiert_am, ausgezahlt_am FROM provision_abrechnungen WHERE vertriebler_slug = $1 AND monat = $2',
    [vertrieblerSlug, monat],
  );
  return zeilen[0] ? zuGespeichert(zeilen[0]) : null;
}

export interface AbrechnungUebersicht {
  id: string;
  vertriebler: string;
  name: string;
  monat: string;
  summeCent: number;
  auszahlungCent: number;
  aufgelaufenCent: number;
  importiertAm: Date;
  ausgezahltAm: string | null;
}

/** Nur fuer den Admin: alle importierten Abrechnungen. */
export async function alleAbrechnungen(db: Db): Promise<AbrechnungUebersicht[]> {
  const zeilen = await db.query<AbrechnungZeile & { vertriebler_slug: string }>(
    'SELECT id, vertriebler_slug, daten, importiert_am, ausgezahlt_am FROM provision_abrechnungen ORDER BY monat DESC, vertriebler_slug',
  );
  return zeilen.map((z) => {
    const a = zuGespeichert(z);
    return {
      id: a.id,
      vertriebler: z.vertriebler_slug,
      name: a.name,
      monat: a.monat,
      summeCent: a.summeCent,
      auszahlungCent: a.auszahlungCent,
      aufgelaufenCent: a.aufgelaufenCent,
      importiertAm: a.importiertAm,
      ausgezahltAm: a.ausgezahltAm,
    };
  });
}

export async function markiereAusgezahlt(db: Db, id: string, datum: string | null): Promise<void> {
  await db.query('UPDATE provision_abrechnungen SET ausgezahlt_am = $2 WHERE id = $1', [id, datum]);
}

export interface Summen {
  entstandenCent: number;
  ausgezahltCent: number;
  offenCent: number;
  aufgelaufenCent: number;
}

/** Summen ueber alle Abrechnungen eines Vertrieblers. */
export function summen(abrechnungen: GespeicherteAbrechnung[]): Summen {
  const entstandenCent = abrechnungen.reduce((s, a) => s + a.summeCent, 0);
  const ausgezahltCent = abrechnungen.filter((a) => a.ausgezahltAm).reduce((s, a) => s + a.auszahlungCent, 0);
  const offenCent = abrechnungen.filter((a) => !a.ausgezahltAm).reduce((s, a) => s + a.auszahlungCent, 0);
  // Aufgelaufen ist ein Stand, kein Fluss: es gilt der Wert der neuesten Abrechnung.
  const neueste = [...abrechnungen].sort((a, b) => b.monat.localeCompare(a.monat))[0];
  return { entstandenCent, ausgezahltCent, offenCent, aufgelaufenCent: neueste?.aufgelaufenCent ?? 0 };
}

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function euro(cent: number): string {
  return EURO.format((cent ?? 0) / 100);
}

const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function monatsname(monat: string): string {
  const [jahr, mm] = String(monat).split('-').map(Number);
  return MONATSNAMEN[mm - 1] ? `${MONATSNAMEN[mm - 1]} ${jahr}` : String(monat);
}

export function datumDe(iso: string | null | undefined): string {
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return t ? `${t[3]}.${t[2]}.${t[1]}` : '';
}
