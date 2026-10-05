// Inhalte fuer das Schema im Erstgespraech (/erstgespraech). Nur auf dem
// Server benutzt: das Skript im Browser (src/scripts/schema.ts) importiert
// diese Datei nicht, damit keine Paket- oder Tarifpreise im oeffentlichen
// Bundle unter /_astro/ landen.
//
// Preise auf der Seite gibt es genau zwei: PREIS_AB (Website) und HOSTING.ab,
// beide aus src/data/preise.json. Dazu das Gratisquartal aus derselben Datei.
// Paketpreise und Tarifnamen gehoeren in den Zweittermin (inhalt/07-do-und-dont.md).

import { ALLE_POSTEN, FUNKTION, GRUNDLEISTUNG, HOSTING, PAKETE, PREIS_AB, euro, type PaketSchluessel } from './preise.ts';

export type BrancheId = 'handwerk' | 'gastro' | 'friseur' | 'praxis';
export const BRANCHEN_IDS: BrancheId[] = ['handwerk', 'gastro', 'friseur', 'praxis'];
export const BRANCHE_VORGABE: BrancheId = 'handwerk';

export interface Punkt {
  titel: string;
  text: string;
}

export interface Branche {
  id: BrancheId;
  name: string;
  /** Kurzer Satz unter dem Namen auf der Auswahlkarte. */
  beispiele: string;
  /** Schritt 1: der Betrieb heute. */
  heute: Punkt[];
  /** Name der mitarbeitenden Funktion in dieser Branche. */
  funktion: string;
  /** Was der Besucher im Formular angibt. */
  felder: string[];
  /** Eine erfundene Beispielanfrage, wie sie per Mail ankommt. */
  beispielAnfrage: { zeit: string; text: string };
  /** Was die Funktion dem Betrieb abnimmt. */
  abnahme: Punkt[];
  /** Wer die Website besucht, als Satzanfang: "Ein Kunde", "Ein Gast" ... */
  besucher: string;
  /** Bezeichnung fuer die Leistungs- oder Speisekarte. */
  leistungsliste: string;
  /** Zusatzhinweis im Datenweg, z. B. bei Praxen. */
  datenHinweis?: string;
}

const TERMIN = FUNKTION.name;

export const BRANCHEN: Record<BrancheId, Branche> = {
  handwerk: {
    id: 'handwerk',
    name: 'Handwerk',
    beispiele: 'Elektro, Sanitär, Maler, Tischlerei',
    heute: [
      { titel: 'Das Telefon klingelt auf der Baustelle', text: 'Mit Werkzeug in der Hand geht keiner ran. Die Mailbox füllt sich.' },
      { titel: 'Anfragen auf Zetteln', text: 'Was am Telefon reinkommt, landet auf einem Zettel im Auto oder im Kopf.' },
      { titel: 'Rückruf erst am Abend', text: 'Bis dahin hat der Kunde vielleicht schon den nächsten Betrieb angerufen.' },
      { titel: 'Und die Website?', text: 'Gibt es eine? Wie wirkt sie, wenn man sie auf dem Handy öffnet?' },
    ],
    funktion: TERMIN,
    felder: ['Name', 'Telefon oder Mail', 'Worum es geht', 'Wunschtermin'],
    beispielAnfrage: { zeit: 'Dienstag, 21:40 Uhr', text: 'Wasserhahn in der Küche tropft. Wunschtermin: Donnerstag Vormittag.' },
    abnahme: [
      { titel: 'Kein Anruf mitten in der Arbeit', text: 'Die Anfrage kommt als Mail, Sie lesen sie, wenn Sie Zeit haben.' },
      { titel: 'Alles Wichtige steht schon drin', text: 'Name, Rückrufnummer, Anliegen und Wunschtermin. Kein Zettel nötig.' },
      { titel: 'Auch abends und am Wochenende', text: 'Kunden fragen an, wenn es ihnen passt, nicht nur zu Ihren Bürozeiten.' },
    ],
    besucher: 'Ein Kunde',
    leistungsliste: 'Leistungsliste',
  },
  gastro: {
    id: 'gastro',
    name: 'Gastronomie',
    beispiele: 'Restaurant, Café, Imbiss, Bar',
    heute: [
      { titel: 'Das Telefon klingelt im Service', text: 'Mitten im vollen Laden will jemand einen Tisch für Samstag.' },
      { titel: 'Tischwünsche auf dem Block', text: 'Notiert neben der Kasse, manchmal doppelt, manchmal gar nicht.' },
      { titel: 'Dieselben Fragen jeden Tag', text: 'Wann haben Sie offen? Gibt es etwas Vegetarisches? Wo kann man parken?' },
      { titel: 'Und die Website?', text: 'Findet ein Gast dort die aktuelle Karte und die Öffnungszeiten, auch auf dem Handy?' },
    ],
    funktion: 'Online-Tischanfrage',
    felder: ['Name', 'Telefon oder Mail', 'Datum und Uhrzeit', 'Anzahl Personen'],
    beispielAnfrage: { zeit: 'Montag, 22:15 Uhr', text: 'Tisch für 6 Personen am Samstag um 19 Uhr, ein Kinderstuhl.' },
    abnahme: [
      { titel: 'Kein Telefon im Service', text: 'Tischwünsche kommen als Mail, Sie antworten, wenn Ruhe ist.' },
      { titel: 'Datum, Uhrzeit, Personen', text: 'Alles steht vollständig in der Anfrage, nichts geht auf dem Block verloren.' },
      { titel: 'Sie behalten den Überblick', text: 'Sie bestätigen selbst, ob der Tisch frei ist. Nichts wird automatisch eingetragen.' },
    ],
    besucher: 'Ein Gast',
    leistungsliste: 'Speisekarte',
  },
  friseur: {
    id: 'friseur',
    name: 'Friseur und Kosmetik',
    beispiele: 'Salon, Kosmetik, Nagelstudio, Barbier',
    heute: [
      { titel: 'Das Telefon klingelt beim Färben', text: 'Die Hände sind beschäftigt, die Kundin auf dem Stuhl wartet.' },
      { titel: 'Terminwünsche auf Zetteln', text: 'Schnell notiert, später ins Buch übertragen, manchmal vergessen.' },
      { titel: 'Abends erreicht Sie keiner', text: 'Wer nach Feierabend einen Termin möchte, ruft woanders an.' },
      { titel: 'Und die Website?', text: 'Sieht man dort Ihre Leistungen, Preise und Arbeiten, auch auf dem Handy?' },
    ],
    funktion: TERMIN,
    felder: ['Name', 'Telefon oder Mail', 'Gewünschte Leistung', 'Wunschtermin'],
    beispielAnfrage: { zeit: 'Sonntag, 20:05 Uhr', text: 'Schneiden und Färben. Wunschtermin: Freitag ab 15 Uhr.' },
    abnahme: [
      { titel: 'Kein Griff zum Telefon', text: 'Die Anfrage wartet als Mail, bis die Kundin auf dem Stuhl fertig ist.' },
      { titel: 'Leistung und Wunschzeit stehen drin', text: 'Sie sehen sofort, wie lange der Termin dauert und wann er passt.' },
      { titel: 'Sie bestätigen selbst', text: 'Sie schauen in Ihr Terminbuch und melden sich. Nichts wird automatisch gebucht.' },
    ],
    besucher: 'Eine Kundin',
    leistungsliste: 'Preisliste',
  },
  praxis: {
    id: 'praxis',
    name: 'Praxis und Dienstleister',
    beispiele: 'Physiotherapie, Beratung, Fahrschule, Agentur',
    heute: [
      { titel: 'Das Telefon klingelt im Termin', text: 'Während einer Behandlung oder Beratung kann keiner rangehen.' },
      { titel: 'Eine lange Rückrufliste', text: 'Abends wird zurückgerufen, oft mehrmals, bis jemand erreicht ist.' },
      { titel: 'Immer wieder dieselben Fragen', text: 'Was bieten Sie an, was kostet es, wie läuft der erste Termin ab?' },
      { titel: 'Und die Website?', text: 'Beantwortet sie diese Fragen, bevor jemand anruft, auch auf dem Handy?' },
    ],
    funktion: TERMIN,
    felder: ['Name', 'Telefon oder Mail', 'Anliegen in einem Satz', 'Wunschtermin'],
    beispielAnfrage: { zeit: 'Mittwoch, 19:30 Uhr', text: 'Erstgespräch gewünscht. Wunschtermin: nächste Woche, gern vormittags.' },
    abnahme: [
      { titel: 'Weniger Anrufe im Termin', text: 'Anfragen kommen als Mail und warten, bis Sie Zeit haben.' },
      { titel: 'Keine Rückruf-Schleifen', text: 'Telefon oder Mail und Wunschzeit stehen schon drin. Sie antworten einmal.' },
      { titel: 'Sie bestätigen selbst', text: 'Sie vergeben den Termin wie bisher. Nichts wird automatisch gebucht.' },
    ],
    besucher: 'Ein Kunde',
    leistungsliste: 'Leistungsübersicht',
    datenHinweis: 'Am Formular steht: Bitte keine Gesundheitsangaben. Die gehören ins Gespräch, nicht in eine Mail.',
  },
};

export function findeBranche(id: string | null | undefined): Branche {
  return BRANCHEN[(BRANCHEN_IDS as string[]).includes(String(id)) ? (id as BrancheId) : BRANCHE_VORGABE];
}

// ---------------------------------------------------------------------------
// Bausteine

export type BausteinGruppe = 'grund' | 'inhalt' | 'sichtbar' | 'funktion';

export interface Baustein {
  schluessel: string;
  gruppe: BausteinGruppe;
  /** Beschriftung je Paket, null wenn nicht enthalten. */
  je: Record<PaketSchluessel, string | null>;
}

export const PAKET_REIHE: PaketSchluessel[] = PAKETE.map((p) => p.schluessel);

/**
 * Kurze Beschriftung fuer die Kacheln. Die Namen in preise.json sind teils in
 * Michis Ich-Form ("Texte von mir"), die Kacheln spricht aber auch ein
 * Vertriebler an. Was hier fehlt, faellt auf den Namen aus preise.json zurueck.
 */
function beschriftung(schluessel: string, wert: number | boolean, branche: Branche): string {
  const n = typeof wert === 'number' ? wert : 0;
  switch (schluessel) {
    case 'galerie':
      return 'Bildergalerie';
    case 'leistungsliste':
      return branche.leistungsliste;
    case 'referenzen':
      return 'Bewertungen und Kundenstimmen';
    case 'seo':
      return 'Grundlagen für die Google-Suche';
    case 'texte':
      return n === 1 ? 'Text für eine Seite geschrieben' : `Texte für ${n} Seiten geschrieben`;
    case 'team':
      return 'Team vorgestellt';
    case 'bilder':
      return 'Ihre Fotos aufbereitet';
    default:
      return ALLE_POSTEN.find((p) => p.schluessel === schluessel)?.name ?? schluessel;
  }
}

function leer(): Record<PaketSchluessel, string | null> {
  return { klein: null, mittel: null, gross: null };
}

/** Alle Kacheln fuer Schritt 2, in der Reihenfolge, in der sie einfliegen. */
export function bausteine(branche: Branche): Baustein[] {
  const liste: Baustein[] = [];

  const aufbau = leer();
  for (const p of PAKETE) aufbau[p.schluessel] = p.aufbau;
  liste.push({ schluessel: 'aufbau', gruppe: 'grund', je: aufbau });

  GRUNDLEISTUNG.forEach((text, i) => {
    const je = leer();
    for (const p of PAKETE) je[p.schluessel] = text;
    liste.push({ schluessel: `grund-${i}`, gruppe: 'grund', je });
  });

  for (const posten of ALLE_POSTEN) {
    if (posten.schluessel === 'unterseite') continue; // steckt schon im Aufbau
    const je = leer();
    let drin = false;
    for (const p of PAKETE) {
      const w = p.enthalten[posten.schluessel];
      if (w) {
        je[p.schluessel] = beschriftung(posten.schluessel, w, branche);
        drin = true;
      }
    }
    if (!drin) continue;
    const gruppe: BausteinGruppe = posten.schluessel === 'seo' || posten.schluessel === 'referenzen' ? 'sichtbar' : 'inhalt';
    liste.push({ schluessel: posten.schluessel, gruppe, je });
  }

  const funktion = leer();
  for (const p of PAKETE) if (p.funktion) funktion[p.schluessel] = branche.funktion;
  liste.push({ schluessel: 'funktion', gruppe: 'funktion', je: funktion });

  return liste;
}

/** Wie viele Kacheln ein Paket hat. */
export function anzahlBausteine(liste: Baustein[], paket: PaketSchluessel): number {
  return liste.filter((b) => b.je[paket] !== null).length;
}

/** Die Pakete, die die mitarbeitende Funktion enthalten (heute nur Gross). */
export const PAKETE_MIT_FUNKTION = PAKETE.filter((p) => p.funktion).map((p) => p.name);

// ---------------------------------------------------------------------------
// Preise: genau diese drei Angaben, sonst keine.

export const PREISANGABEN = {
  website: `ab ${euro(PREIS_AB)}`,
  hosting: `ab ${euro(HOSTING.ab)} im Monat`,
  gratisquartal: HOSTING.gratisHinweis,
};
