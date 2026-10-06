// Preisrechner: dieselbe Logik wie src/components/Preisrechner.astro auf
// dekaru.de, mit den Zahlen aus src/data/preise.json (erzeugt von
// scripts/preise-sync.mjs). Keine Zahl steht hier im Code, ausser dem
// Provisionssatz, der im Partnervertrag steht.
//
// Die Datei kommt ohne node-Abhaengigkeiten aus, damit das kleine Skript im
// Browser (src/scripts/preisrechner.ts) dieselbe Funktion ausfuehrt wie der
// Server. Es gibt dadurch nur eine Rechnung.

import daten from '../data/preise.json' with { type: 'json' };
// Software-Module: Preise aus dem Sync (nur verkaufbare), Namen aus dem
// Inhalt fuer Betriebe. Bewusst nicht inhalt/verkaufshilfen.json, das sind
// interne Hinweise, und diese Datei landet ueber den Preisrechner im Bundle.
import modulPreise from '../data/module.json' with { type: 'json' };
import modulTexte from '../../../inhalt/module.json' with { type: 'json' };

export const PREISE = daten;

/** 35 Prozent nach Blatt 04 und § 7 des Vertriebspartnervertrags, brutto einschliesslich einer etwaigen Umsatzsteuer. */
export const PROVISION_PROZENT = 35;
/** Hosting-Provision gibt es auf die ersten zwoelf bezahlten Monate. */
export const HOSTING_PROVISION_MONATE = 12;

export type PaketSchluessel = 'klein' | 'mittel' | 'gross';
export type HostingId = 'start' | 'basis' | 'plus';
export type Zahlweise = 'monatlich' | 'jaehrlich';
export type Postenart = 'schalter' | 'anzahl' | 'anfrage';

export interface Posten {
  schluessel: string;
  name: string;
  hinweis: string;
  preis: number;
  art: Postenart;
  max?: number;
  einheit?: string;
}

export interface Paket {
  schluessel: PaketSchluessel;
  name: string;
  preis: number;
  empfohlen: boolean;
  beschreibung: string;
  aufbau: string;
  enthalten: Record<string, number | boolean>;
  funktion: boolean;
}

export interface Zusatzleistung {
  schluessel: string;
  name: string;
  preis: number;
  einheit: string;
  zusatz?: string;
  voraussetzung?: string[];
  nutzen: string;
}

/** Ein verkaufbares Software-Modul mit Preis. Nur was in src/data/module.json steht und einen Text in inhalt/module.json hat. */
export interface ModulPosten {
  schluessel: string;
  name: string;
  preis: number;
  einheit: string;
  stufe: string;
}

export interface HostingTarif {
  id: HostingId;
  name: string;
  monat: number | null;
  jahr: number;
  aenderungen: number;
  beliebt: boolean;
}

export const PAKETE = daten.pakete as Paket[];
export const GRUPPEN = daten.gruppen as { titel: string; posten: Posten[] }[];
export const ALLE_POSTEN: Posten[] = GRUPPEN.flatMap((g) => g.posten);
export const FUNKTION = daten.funktion;
export const GRUNDLEISTUNG = daten.grundleistung;
export const HOSTING_TARIFE = daten.hosting.tarife as HostingTarif[];
export const HOSTING = daten.hosting;
/** Zusatzleistungen, die der Vertriebler anbieten darf: alles ohne Voraussetzung (die Einzelaenderung haengt am Hosting). */
export const ZUSATZLEISTUNGEN = (daten.zusatzleistungen as Zusatzleistung[]).filter((z) => !z.voraussetzung);
/**
 * Verkaufbare Software-Module. Ein Modul ohne Text in inhalt/module.json
 * bleibt draussen (tests/module.test.ts meldet das), damit nie ein
 * Schluessel oder ein Name ohne Umlaute im Portal steht.
 */
export const MODULE: ModulPosten[] = (modulPreise.module as Omit<ModulPosten, 'name'>[]).flatMap((m) => {
  const text = (modulTexte.module as { schluessel: string; name: string }[]).find((t) => t.schluessel === m.schluessel);
  return text ? [{ ...m, name: text.name }] : [];
});
export const PREIS_AB: number = Math.min(...PAKETE.map((p) => p.preis));
export const PAKET_EMPFOHLEN: Paket = PAKETE.find((p) => p.empfohlen) ?? PAKETE[0];

export function findePaket(schluessel: string | null | undefined): Paket | null {
  const text = String(schluessel ?? '').trim().toLowerCase().replace('ß', 'ss');
  return PAKETE.find((p) => p.schluessel === text) ?? null;
}

export function findePosten(schluessel: string): Posten | null {
  return ALLE_POSTEN.find((p) => p.schluessel === schluessel) ?? null;
}

export function findeTarif(id: string | null | undefined): HostingTarif | null {
  return HOSTING_TARIFE.find((t) => t.id === id) ?? null;
}

export function findeZusatzleistung(schluessel: string): Zusatzleistung | null {
  return ZUSATZLEISTUNGEN.find((z) => z.schluessel === schluessel) ?? null;
}

/** Nur verkaufbare Module. Alles andere gibt es im Portal nicht. */
export function findeModul(schluessel: string): ModulPosten | null {
  return MODULE.find((m) => m.schluessel === schluessel) ?? null;
}

// ---------------------------------------------------------------------------
// Auswahl

export interface HostingAuswahl {
  tarif: HostingId | null;
  zahlweise: Zahlweise;
  gratisquartal: boolean;
}

export interface Auswahl {
  paket: PaketSchluessel;
  /** Zahl bei "anzahl" (zusaetzlich zum Enthaltenen), Wahrheitswert bei "schalter" und "anfrage". */
  bausteine: Record<string, number | boolean>;
  zusatzleistungen: string[];
  /** Schluessel verkaufbarer Software-Module. Alte Briefings ohne das Feld bekommen [] (leereAuswahl). */
  module: string[];
  hosting: HostingAuswahl;
}

export function leereAuswahl(paket: PaketSchluessel = PAKET_EMPFOHLEN.schluessel): Auswahl {
  return { paket, bausteine: {}, zusatzleistungen: [], module: [], hosting: { tarif: null, zahlweise: 'monatlich', gratisquartal: false } };
}

type Lesbar = { get(name: string): string | null } | Record<string, string | undefined>;

function wert(quelle: Lesbar, name: string): string | null {
  if (typeof (quelle as { get?: unknown }).get === 'function') return (quelle as { get(n: string): string | null }).get(name);
  const v = (quelle as Record<string, string | undefined>)[name];
  return v === undefined ? null : v;
}

/**
 * Liest die Auswahl aus einem Formular oder einer Query. Feldnamen:
 * paket, b_<schluessel> (Zahl oder "on"), z_<schluessel> ("on"), m_<schluessel> ("on"),
 * hosting (start, basis, plus, keins), zahlweise, gratisquartal.
 * Unbekanntes wird ignoriert, Werte werden begrenzt.
 */
export function auswahlAusFeldern(quelle: Lesbar, vorgabe: PaketSchluessel = PAKET_EMPFOHLEN.schluessel): Auswahl {
  const paket = findePaket(wert(quelle, 'paket')) ?? findePaket(vorgabe) ?? PAKETE[0];
  const auswahl = leereAuswahl(paket.schluessel);
  for (const posten of ALLE_POSTEN) {
    const roh = wert(quelle, `b_${posten.schluessel}`);
    if (roh === null || roh === '') continue;
    if (posten.art === 'anzahl') {
      const n = Math.trunc(Number(roh));
      if (Number.isFinite(n) && n > 0) auswahl.bausteine[posten.schluessel] = Math.min(n, posten.max ?? n);
    } else if (roh === 'on' || roh === '1' || roh === 'true') {
      auswahl.bausteine[posten.schluessel] = true;
    }
  }
  for (const z of ZUSATZLEISTUNGEN) {
    const roh = wert(quelle, `z_${z.schluessel}`);
    if (roh === 'on' || roh === '1' || roh === 'true') auswahl.zusatzleistungen.push(z.schluessel);
  }
  for (const m of MODULE) {
    const roh = wert(quelle, `m_${m.schluessel}`);
    if (roh === 'on' || roh === '1' || roh === 'true') auswahl.module.push(m.schluessel);
  }
  const tarif = findeTarif(wert(quelle, 'hosting'));
  auswahl.hosting.tarif = tarif?.id ?? null;
  auswahl.hosting.zahlweise = wert(quelle, 'zahlweise') === 'jaehrlich' ? 'jaehrlich' : 'monatlich';
  const g = wert(quelle, 'gratisquartal');
  auswahl.hosting.gratisquartal = g === 'on' || g === '1' || g === 'true';
  return auswahl;
}

// ---------------------------------------------------------------------------
// Rechnung

export interface Zeile {
  art: 'paket' | 'baustein' | 'zusatzleistung' | 'modul';
  schluessel: string;
  bezeichnung: string;
  /** Betrag in Euro. null bei "nach Absprache". */
  betrag: number | null;
  /** Nur bei Bausteinen mit Anzahl. */
  menge?: number;
}

export interface HostingErgebnis {
  tarif: HostingTarif;
  zahlweise: Zahlweise;
  gratisquartal: boolean;
  /** Was je Zahlung faellig ist: Monatspreis oder Jahrespreis. */
  jeZahlung: number;
  /** Rechnerischer Monatspreis, bei Jahreszahlung Jahrespreis durch bezahlte Monate. */
  jeMonat: number;
  /** Provision auf die ersten zwoelf bezahlten Monate, in Euro. */
  provision: number;
  hinweise: string[];
}

export interface Ergebnis {
  paket: Paket;
  zeilen: Zeile[];
  /** Paket plus Bausteine, wie der Rechner auf dekaru.de. */
  summeWebsite: number;
  summeZusatzleistungen: number;
  /** Software-Module, einmalig. */
  summeModule: number;
  /** Alles Einmalige: Website, Zusatzleistungen und Module. Darauf gibt es die Provision (Module nur im Erstauftrag). */
  summeEinmalig: number;
  provisionEinmalig: number;
  /** Bausteine ohne Listenpreis, die gewaehlt sind. */
  nachAbsprache: number;
  hosting: HostingErgebnis | null;
  hinweise: string[];
}

function rundeCent(euro: number): number {
  return Math.round(euro * 100) / 100;
}

export function provisionAuf(betrag: number): number {
  return rundeCent((betrag * PROVISION_PROZENT) / 100);
}

export function berechne(auswahl: Auswahl): Ergebnis {
  const paket = findePaket(auswahl.paket) ?? PAKETE[0];
  const zeilen: Zeile[] = [{ art: 'paket', schluessel: paket.schluessel, bezeichnung: `Paket ${paket.name}`, betrag: paket.preis }];
  const hinweise: string[] = [];
  let summeWebsite = paket.preis;
  let nachAbsprache = 0;

  for (const posten of ALLE_POSTEN) {
    const roh = auswahl.bausteine[posten.schluessel];
    if (roh === undefined || roh === false || roh === 0) continue;
    if (posten.art === 'anzahl') {
      // Der Zaehler zaehlt nur weitere Stuecke, das Enthaltene spielt nicht hinein.
      const menge = Math.min(Math.max(Math.trunc(Number(roh)), 0), posten.max ?? Number.MAX_SAFE_INTEGER);
      if (menge <= 0) continue;
      const betrag = posten.preis * menge;
      summeWebsite += betrag;
      zeilen.push({ art: 'baustein', schluessel: posten.schluessel, bezeichnung: `${posten.name} × ${menge}`, betrag, menge });
      continue;
    }
    if (paket.enthalten[posten.schluessel]) {
      // Auf dekaru.de faellt ein enthaltener Baustein beim Paketwechsel aus
      // der Auswahl. Hier dasselbe: er zaehlt nicht und erscheint nicht.
      continue;
    }
    if (posten.art === 'anfrage') {
      nachAbsprache += 1;
      zeilen.push({ art: 'baustein', schluessel: posten.schluessel, bezeichnung: posten.name, betrag: null });
      continue;
    }
    summeWebsite += posten.preis;
    zeilen.push({ art: 'baustein', schluessel: posten.schluessel, bezeichnung: posten.name, betrag: posten.preis });
  }

  let summeZusatzleistungen = 0;
  for (const schluessel of auswahl.zusatzleistungen) {
    const z = findeZusatzleistung(schluessel);
    if (!z) continue;
    summeZusatzleistungen += z.preis;
    zeilen.push({ art: 'zusatzleistung', schluessel: z.schluessel, bezeichnung: z.name, betrag: z.preis });
  }
  let summeModule = 0;
  // Doppelte Schluessel zaehlen einmal, unbekannte (nicht verkaufbare) gar nicht.
  for (const schluessel of new Set(auswahl.module ?? [])) {
    const m = findeModul(schluessel);
    if (!m) continue;
    summeModule += m.preis;
    zeilen.push({ art: 'modul', schluessel: m.schluessel, bezeichnung: m.name, betrag: m.preis });
  }
  if (nachAbsprache > 0) hinweise.push('Ein individuelles Feature hat keinen Listenpreis. Den Preis nennt nur Michael Henning, er kommt als Nachtrag ins Angebot.');

  const summeEinmalig = summeWebsite + summeZusatzleistungen + summeModule;
  return {
    paket,
    zeilen,
    summeWebsite,
    summeZusatzleistungen,
    summeModule,
    summeEinmalig,
    provisionEinmalig: provisionAuf(summeEinmalig),
    nachAbsprache,
    hosting: berechneHosting(auswahl.hosting, paket),
    hinweise,
  };
}

export function berechneHosting(auswahl: HostingAuswahl, paket: Paket): HostingErgebnis | null {
  const tarif = findeTarif(auswahl.tarif);
  const hinweise: string[] = [];
  if (!tarif) {
    if (paket.funktion) hinweise.push(`Ohne Hosting bei dekaru entfällt die ${FUNKTION.name}.`);
    return null;
  }
  let zahlweise = auswahl.zahlweise;
  if (tarif.monat === null && zahlweise !== 'jaehrlich') {
    zahlweise = 'jaehrlich';
    hinweise.push(`${tarif.name} gibt es nur als Jahresvertrag.`);
  }
  const jeZahlung = zahlweise === 'jaehrlich' ? tarif.jahr : (tarif.monat as number);
  const jeMonat = zahlweise === 'jaehrlich' ? Math.round(tarif.jahr / HOSTING.bezahlteMonate) : (tarif.monat as number);
  // Zwoelf bezahlte Monate: monatlich zwoelf Rechnungen, jaehrlich eine
  // Jahresrechnung (zwoelf Monate erhalten, zehn berechnet).
  const grundlage = zahlweise === 'jaehrlich' ? tarif.jahr : (tarif.monat as number) * HOSTING_PROVISION_MONATE;
  if (auswahl.gratisquartal) {
    hinweise.push(
      `Gratisquartal: die ersten ${HOSTING.gratisMonate} Monate frei, danach mindestens ${HOSTING.mindestBezahlt} bezahlte Monate. Die Provision beginnt mit dem ersten bezahlten Monat.`,
    );
  }
  return { tarif, zahlweise, gratisquartal: auswahl.gratisquartal, jeZahlung, jeMonat, provision: provisionAuf(grundlage), hinweise };
}

// ---------------------------------------------------------------------------
// Anzeige

const GANZ = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const CENT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.600 €" oder "647,50 €". Wie auf dekaru.de, nur mit Cent, wenn welche da sind. */
export function euro(betrag: number): string {
  const text = Number.isInteger(betrag) ? GANZ.format(betrag) : CENT.format(betrag);
  return `${text} €`;
}

/** Inhaltsliste einer Paketkarte wie auf dekaru.de: Aufbau, dann enthaltene Bausteine. */
export function paketInhalte(paket: Paket): string[] {
  const liste = [paket.aufbau];
  for (const posten of ALLE_POSTEN) {
    const w = paket.enthalten[posten.schluessel];
    if (!w || posten.schluessel === 'unterseite') continue;
    liste.push(posten.art === 'anzahl' ? `${posten.name}, ${w} Seiten` : posten.name);
  }
  return liste;
}

/** Pakete, die einen Posten enthalten, mit Menge. */
export function enthaltenIn(schluessel: string): { paket: Paket; menge: number | boolean }[] {
  return PAKETE.filter((p) => Boolean(p.enthalten[schluessel])).map((p) => ({ paket: p, menge: p.enthalten[schluessel] }));
}
