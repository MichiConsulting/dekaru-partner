// Zahlen fuer die Startseite (Cockpit). Alles, was aus der Datenbank kommt,
// steht hier und ist ohne Astro testbar; Lernstand und Pflichtsaetze holt
// die Seite selbst, weil sie die Inhalte aus dem Bundle brauchen.

import type { Db } from './db.ts';
import { heuteBerlin, monatVon, quartal, woche } from './datum.ts';
import { monatszahlen } from './kunden.ts';
import { termineImZeitraum, type KalenderEintrag } from './kalender.ts';
import { anzahlFaellig, offeneWiedervorlagen, wiedervorlagenAlle, type Wiedervorlage } from './wiedervorlage.ts';

export interface ProvisionQuartal {
  /** Erster und letzter Abrechnungsmonat des Quartals, JJJJ-MM. */
  von: string;
  bis: string;
  nummer: number;
  jahr: number;
  entstandenCent: number;
  ausgezahltCent: number;
  aufgelaufenCent: number;
  abrechnungen: number;
}

interface AbrechnungFuerQuartal {
  monat: string;
  summeCent: number;
  auszahlungCent: number;
  aufgelaufenCent: number;
  ausgezahltAm: string | null;
  /** Nur beim Admin gesetzt, damit "aufgelaufen" je Vertriebler einmal zaehlt. */
  vertriebler?: string;
}

/**
 * Provision im Quartal des Monats "heute": entstanden ist die Summe der
 * Abrechnungen mit Abrechnungsmonat im Quartal, ausgezahlt der Teil davon,
 * den der Admin als ueberwiesen markiert hat. Aufgelaufen ist ein Stand, kein
 * Fluss: je Vertriebler gilt der Wert der neuesten Abrechnung ueberhaupt.
 */
export function provisionImQuartal(abrechnungen: AbrechnungFuerQuartal[], heute = heuteBerlin()): ProvisionQuartal {
  const q = quartal(monatVon(heute));
  const imQuartal = abrechnungen.filter((a) => a.monat >= q.von && a.monat <= q.bis);
  const neueste = new Map<string, AbrechnungFuerQuartal>();
  for (const a of abrechnungen) {
    const schluessel = a.vertriebler ?? '';
    const bisher = neueste.get(schluessel);
    if (!bisher || a.monat > bisher.monat) neueste.set(schluessel, a);
  }
  return {
    von: q.von,
    bis: q.bis,
    nummer: q.nummer,
    jahr: q.jahr,
    entstandenCent: imQuartal.reduce((s, a) => s + a.summeCent, 0),
    ausgezahltCent: imQuartal.filter((a) => a.ausgezahltAm).reduce((s, a) => s + a.auszahlungCent, 0),
    aufgelaufenCent: [...neueste.values()].reduce((s, a) => s + a.aufgelaufenCent, 0),
    abrechnungen: imQuartal.length,
  };
}

export interface CockpitZahlen {
  heute: string;
  woche: { von: string; bis: string };
  monat: string;
  termineWoche: KalenderEintrag[];
  /** Die naechsten Termine ab heute, hoechstens drei, auch ueber die Woche hinaus. */
  naechsteTermine: KalenderEintrag[];
  wiedervorlagen: Wiedervorlage[];
  faellig: number;
  ueberfaellig: number;
  abschluesseMonat: number;
  neueMonat: number;
}

export async function cockpitZahlen(db: Db, benutzerId: string, heute = heuteBerlin()): Promise<CockpitZahlen> {
  const w = woche(heute);
  const monat = monatVon(heute);
  const termineWoche = await termineImZeitraum(db, benutzerId, w.von, w.bis);
  const kommende = await termineImZeitraum(db, benutzerId, heute, '9999-12-31');
  const wiedervorlagen = await offeneWiedervorlagen(db, benutzerId);
  const zahlen = await monatszahlen(db, benutzerId, monat);
  return {
    heute,
    woche: w,
    monat,
    termineWoche,
    naechsteTermine: kommende.slice(0, 3),
    wiedervorlagen,
    faellig: anzahlFaellig(wiedervorlagen, heute),
    ueberfaellig: wiedervorlagen.filter((v) => v.datum < heute).length,
    abschluesseMonat: zahlen.abschluesse,
    neueMonat: zahlen.neue,
  };
}

export interface CockpitZahlenAdmin {
  heute: string;
  woche: { von: string; bis: string };
  monat: string;
  termineWoche: number;
  wiedervorlagenOffen: number;
  wiedervorlagenFaellig: number;
  abschluesseMonat: number;
  neueMonat: number;
  aktiveVertriebler: number;
}

/** Nur fuer den Admin: dieselben Zahlen ueber alle Vertriebler. */
export async function cockpitZahlenAdmin(db: Db, heute = heuteBerlin()): Promise<CockpitZahlenAdmin> {
  const w = woche(heute);
  const monat = monatVon(heute);
  const monatVonTag = `${monat}-01`;
  const [j, m] = monat.split('-').map(Number);
  const naechsterMonat = `${m === 12 ? j + 1 : j}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const zeilen = await db.query<{ termine: string; abschluesse: string; neue: string; aktive: string }>(
    `SELECT
       (SELECT COUNT(*) FROM kunden WHERE termin_datum >= $1::date AND termin_datum <= $2::date) AS termine,
       (SELECT COUNT(*) FROM kunden WHERE status = 'abschluss' AND status_seit >= $3::date AND status_seit < $4::date) AS abschluesse,
       (SELECT COUNT(*) FROM kunden WHERE erstellt_am >= $3::date AND erstellt_am < $4::date) AS neue,
       (SELECT COUNT(*) FROM benutzer WHERE rolle = 'vertriebler' AND aktiv) AS aktive`,
    [w.von, w.bis, monatVonTag, naechsterMonat],
  );
  const wv = await wiedervorlagenAlle(db, heute);
  const z = zeilen[0];
  return {
    heute,
    woche: w,
    monat,
    termineWoche: Number(z?.termine ?? 0),
    wiedervorlagenOffen: wv.offen,
    wiedervorlagenFaellig: wv.faellig,
    abschluesseMonat: Number(z?.abschluesse ?? 0),
    neueMonat: Number(z?.neue ?? 0),
    aktiveVertriebler: Number(z?.aktive ?? 0),
  };
}
