// Der Briefing-Bogen (Blatt 11) als Datenmodell: Felder, Pruefung, Sperre
// gegen Passwoerter, Speichern. Jede Abfrage traegt die Benutzer-ID, ein
// Vertriebler sieht nur Boegen zu eigenen Kunden; der Admin sieht alle.
//
// Datensparsamkeit: hier stehen nur die Felder, die Angebot, Werkvertrag,
// Betreuungsvertrag und AVV brauchen. Die Inhalte fuer die Website selbst
// (Oeffnungszeiten, Leistungen, Geschichte) fragt Michi direkt beim Kunden
// ab, sie gehoeren nicht in das Portal eines Vertrieblers.
//
// Ausnahme seit 05.10.2026: die Farbpalette (Teil B). Sie ist kein Inhalt,
// sondern ein Code aus dem Palettenkatalog (HW-2, BL-2 ...), den der Betrieb im
// Schema des Erstgespraechs selbst gewaehlt hat, ohne personenbezogene Daten.
// Michi braucht ihn beim Bau; er steht zusaetzlich in der Spalte
// briefings.farbpalette (Migration 010).

import type { Db } from './db.ts';
import { holeKunde, isoDatum, istUuid } from './kunden.ts';
import { MODULE_NUR_MIT, MODULE_PAKET_NAME, auswahlAusFeldern, findeModul, findePaket, leereAuswahl, moduleMoeglich, type Auswahl } from './preise.ts';
import { moduleAusAdresse } from './module.ts';
import { ALLE_PALETTEN, BRIEFING_ZU_TEMPLATE, PALETTE_OFFEN, findePalette, passtZuTemplate } from './paletten.ts';

export type BriefingStatus = 'entwurf' | 'eingereicht' | 'uebernommen';

export const STATUS_LABEL: Record<BriefingStatus, string> = {
  entwurf: 'Entwurf',
  eingereicht: 'Eingereicht',
  uebernommen: 'Übernommen',
};

export type FeldTyp = 'text' | 'email' | 'tel' | 'date' | 'textarea' | 'checkbox' | 'select' | 'radio' | 'palette';

export interface Feld {
  name: string;
  label: string;
  typ: FeldTyp;
  pflicht?: boolean;
  hilfe?: string;
  optionen?: { wert: string; label: string }[];
  max?: number;
  autocomplete?: string;
}

export interface Teil {
  kennung: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  titel: string;
  hinweis?: string;
  felder: Feld[];
}

export const BRANCHEN = ['Handwerk', 'Gastronomie', 'Dienstleister', 'Gesundheit, Praxis', 'Garten- und Landschaftsbau', 'Reinigung', 'Umzug', 'Tierbetreuung', 'Fitness', 'Tattoo'];

const RECHTSFORMEN = ['Einzelunternehmen', 'e. K.', 'GbR', 'GmbH', 'UG (haftungsbeschränkt)', 'GmbH & Co. KG', 'KG', 'OHG', 'PartG', 'e. V.', 'Sonstige'];

const optionen = (liste: string[]) => liste.map((w) => ({ wert: w, label: w }));

/** Die Teile des Bogens in der Reihenfolge des Formulars. Teil B bekommt zusaetzlich die Preisauswahl. */
export const TEILE: Teil[] = [
  {
    kennung: 'A',
    titel: 'Betrieb und Vertragspartner',
    hinweis: 'Diese Angaben gehen in Angebot, Werkvertrag und AVV. Bitte genau wie im Gewerbe- oder Handelsregister.',
    felder: [
      { name: 'firmenname', label: 'Firmenname, genau wie im Register', typ: 'text', pflicht: true, max: 160, autocomplete: 'organization' },
      { name: 'rechtsform', label: 'Rechtsform', typ: 'select', pflicht: true, optionen: optionen(RECHTSFORMEN) },
      { name: 'unterzeichner', label: 'Wer unterschreibt, mit Anrede, Vor- und Nachname', typ: 'text', pflicht: true, max: 120, hilfe: 'Zum Beispiel "Frau Andrea Wagner". Daraus entsteht die Anrede im Angebot.' },
      { name: 'strasse', label: 'Straße und Hausnummer', typ: 'text', pflicht: true, max: 120, autocomplete: 'street-address' },
      { name: 'plz', label: 'PLZ', typ: 'text', pflicht: true, max: 10, autocomplete: 'postal-code' },
      { name: 'ort', label: 'Ort', typ: 'text', pflicht: true, max: 80, autocomplete: 'address-level2' },
      { name: 'email', label: 'E-Mail für Angebot, Vertrag und Rechnung', typ: 'email', pflicht: true, max: 120 },
      { name: 'telefon', label: 'Telefon für Rückfragen (geschäftlich)', typ: 'tel', max: 40 },
      { name: 'ansprechpartner_projekt', label: 'Ansprechpartner fürs Projekt, falls nicht der Unterzeichner', typ: 'text', max: 120, hilfe: 'Name und Funktion, keine privaten Angaben.' },
    ],
  },
  {
    kennung: 'B',
    titel: 'Was gekauft wird',
    hinweis: 'Nur, was auf der Preisliste steht. Alles andere kommt unter Teil G als Sonderwunsch, ohne Zusage und ohne Preis.',
    felder: [
      { name: 'branche', label: 'Branche', typ: 'select', pflicht: true, optionen: optionen(BRANCHEN) },
      {
        name: 'farbpalette',
        label: 'Farbpalette',
        typ: 'palette',
        hilfe: 'Die Palette, die der Betrieb im Schema gewählt hat (Schritt Farben). Ohne Wahl: noch offen.',
        optionen: [
          { wert: PALETTE_OFFEN, label: 'Noch offen' },
          ...ALLE_PALETTEN.map((p) => ({ wert: p.code, label: `${p.code} ${p.name}` })),
        ],
      },
      { name: 'seiten_namen', label: 'Seiten, mit Namen', typ: 'textarea', max: 600, hilfe: 'Zum Beispiel Leistungen, Über uns, Referenzen. Eine je Zeile.' },
      { name: 'sprache_welche', label: 'Weitere Sprache, welche', typ: 'text', max: 80 },
      { name: 'individuell_beschreibung', label: 'Individuelles Feature, Beschreibung', typ: 'textarea', max: 800, hilfe: 'Nur die Beschreibung. Den Preis nennt nur Michael Henning.' },
      { name: 'texte_kunde', label: 'Texte liefert der Kunde', typ: 'checkbox' },
      { name: 'kein_hosting_gesagt', label: 'Bei Groß ohne Hosting: dem Kunden vor dem Auftrag gesagt, dass die mitarbeitende Funktion entfällt', typ: 'checkbox' },
      { name: 'empfehlung_von', label: 'Kam über eine Empfehlung, von', typ: 'text', max: 120, hilfe: 'Die Empfehlungsregel gilt für den, der empfiehlt, nicht für den Neukunden.' },
    ],
  },
  {
    kennung: 'C',
    titel: 'Termine',
    hinweis: 'Keine Bauzeit zusagen, weder Tage noch Wochen. Den Fertigstellungstermin nennt Michael Henning im Angebot.',
    felder: [
      { name: 'wunsch_livegang', label: 'Wunschtermin für den Livegang', typ: 'date' },
      { name: 'zulieferung_bis', label: 'Bis wann liefert der Kunde Texte, Bilder und Logo?', typ: 'date', pflicht: true },
      { name: 'anlass', label: 'Harter Anlass (Eröffnung, Saisonstart, Messe)', typ: 'text', max: 160 },
    ],
  },
  {
    kennung: 'D',
    titel: 'Bilder und Logo',
    hinweis: 'Das sind die Zulieferungen im Werkvertrag.',
    felder: [
      {
        name: 'fotos',
        label: 'Fotos',
        typ: 'radio',
        optionen: [
          { wert: 'kunde', label: 'Kunde liefert eigene Fotos' },
          { wert: 'keine', label: 'Keine eigenen Fotos vorhanden, Michael Henning klärt das' },
        ],
      },
      { name: 'fotos_anzahl', label: 'Etwa wie viele Fotos', typ: 'text', max: 20 },
      {
        name: 'logo',
        label: 'Logo',
        typ: 'radio',
        optionen: [
          { wert: 'datei', label: 'Logo als Datei vorhanden' },
          { wert: 'keins', label: 'Kein Logo vorhanden' },
        ],
      },
      { name: 'fotorechte', label: 'Der Kunde bestätigt: an den Fotos, die er liefert, hat er die Rechte, und abgebildete Personen sind einverstanden', typ: 'checkbox', hilfe: 'Pflicht, wenn er Fotos liefert.' },
    ],
  },
  {
    kennung: 'E',
    titel: 'Recht',
    hinweis: 'Diese Angaben bestimmen den Auftragsverarbeitungsvertrag und die Referenznennung im Werkvertrag.',
    felder: [
      { name: 'kontaktformular', label: 'Kontaktformular', typ: 'checkbox' },
      { name: 'gesundheitsdaten', label: 'Über das Formular oder die Online-Terminanfrage kommen Gesundheitsdaten herein (Praxis, Therapie, Pflege)', typ: 'checkbox' },
      { name: 'externe_buchung', label: 'Externe Online-Buchung, Anbieter', typ: 'text', max: 80 },
      { name: 'bewerbungsformular', label: 'Bewerbungsformular', typ: 'checkbox' },
      {
        name: 'referenz',
        label: 'Referenznennung',
        typ: 'radio',
        pflicht: true,
        optionen: [
          { wert: 'ja', label: 'Der Kunde ist einverstanden, dass Michael Henning seinen Betrieb als Referenz nennt' },
          { wert: 'nein', label: 'Der Kunde möchte nicht als Referenz genannt werden' },
        ],
      },
    ],
  },
  {
    kennung: 'F',
    titel: 'Domain und alte Seite',
    hinweis: 'Nur aufnehmen, nichts zusagen. Den Umzug einer Domain klärt Michael Henning direkt mit dem Kunden. Keine Zugangsdaten, nicht einmal den Namen des Zugangs.',
    felder: [
      { name: 'domain', label: 'Vorhandene Domain', typ: 'text', max: 120 },
      { name: 'domain_anbieter', label: 'Anbieter der Domain (Strato, IONOS, ...)', typ: 'text', max: 80 },
      { name: 'domain_wuensche', label: 'Keine Domain: zwei Wunschnamen', typ: 'text', max: 200 },
      { name: 'alte_website', label: 'Adresse der bisherigen Website', typ: 'text', max: 200 },
    ],
  },
  {
    kennung: 'G',
    titel: 'Sonderwünsche, Fragen, Zusagen',
    felder: [
      { name: 'sonderwuensche', label: 'Sonderwünsche, die nicht auf der Preisliste stehen', typ: 'textarea', max: 1500, hilfe: 'Ohne Zusage und ohne Preis.' },
      { name: 'fragen', label: 'Fragen, die der Kunde an Michael Henning hat', typ: 'textarea', max: 1500 },
      { name: 'zusagen', label: 'Was Sie im Termin zugesagt haben, wörtlich', typ: 'textarea', max: 1500, hilfe: 'Das schützt Sie, den Kunden und die Provision.' },
    ],
  },
  {
    kennung: 'H',
    titel: 'Mit dem Kunden, bevor Sie gehen',
    felder: [
      { name: 'weiss_angebot', label: 'Er weiß, dass Angebot und Vertrag per Mail von Michael Henning kommen und er dort unterschreibt', typ: 'checkbox', pflicht: true },
      { name: 'weiss_zulieferung', label: 'Er weiß, was er bis wann liefern muss (Teil C)', typ: 'checkbox', pflicht: true },
      { name: 'weiss_rueckfragen', label: 'Er weiß, dass Rückfragen während des Baus direkt an Michael Henning gehen', typ: 'checkbox', pflicht: true },
    ],
  },
];

export const ALLE_FELDER: Feld[] = TEILE.flatMap((t) => t.felder);

export interface BriefingDaten {
  felder: Record<string, string>;
  auswahl: Auswahl;
}

export function leereDaten(): BriefingDaten {
  return { felder: { kontaktformular: 'on' }, auswahl: leereAuswahl() };
}

// ---------------------------------------------------------------------------
// Sperre gegen Passwoerter

/**
 * Blatt 11, Regel 2: keine Passwoerter, keine Zugangsdaten auf den Bogen.
 * Gesperrt wird nur, was nach einer notierten Angabe aussieht: ein Stichwort
 * wie "Passwort", "Kennwort", "PW", "PIN", "Login" oder "Zugangsdaten",
 * direkt gefolgt von ":" oder "=" und einem Wert. Das blosse Wort im
 * Fliesstext ("Das Passwort schickt der Kunde selbst") bleibt erlaubt.
 * Treffer sperren das Speichern, auch als Entwurf.
 */
const PASSWORT_STICHWORT =
  'passw(?:ort|örter|ords?|d)|kennw(?:ort|örter)|pwd?|pin|pass-?code|zugangsdaten|login|benutzername|username';
const PASSWORT_MUSTER = new RegExp(`(?<![\\p{L}\\p{N}])(?:${PASSWORT_STICHWORT})\\s*[:=]\\s*[^\\s:=]`, 'iu');

export function enthaeltPasswort(text: string): boolean {
  const t = String(text ?? '');
  return PASSWORT_MUSTER.test(t);
}

export const PASSWORT_SPERRE =
  'Keine Passwörter und keine Zugangsdaten auf den Bogen, auch nicht als Entwurf. Die klärt Michael Henning direkt mit dem Kunden. Bitte die Angabe entfernen.';

// ---------------------------------------------------------------------------
// Pruefung

function text(wert: unknown, max: number): string {
  return String(wert ?? '').trim().slice(0, max);
}

function istDatum(wert: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(wert) && !Number.isNaN(new Date(`${wert}T12:00:00Z`).getTime());
}

export interface Pruefung {
  daten: BriefingDaten;
  /** Fehler, die auch das Zwischenspeichern verhindern. */
  sperren: string[];
  /** Fehlende Pflichtangaben, nur beim Einreichen relevant. */
  fehlend: string[];
}

/** Bereinigt ein Formular und prueft es. Pflichtfelder gelten nur fuer das Einreichen. */
export function pruefeBriefing(eingabe: Record<string, unknown>): Pruefung {
  const felder: Record<string, string> = {};
  const sperren: string[] = [];
  const fehlend: string[] = [];

  for (const feld of ALLE_FELDER) {
    const roh = eingabe[feld.name];
    if (feld.typ === 'checkbox') {
      if (roh === 'on' || roh === '1' || roh === 'true' || roh === true) felder[feld.name] = 'on';
      continue;
    }
    const wert = text(roh, feld.max ?? 200);
    if (!wert) continue;
    if (feld.typ === 'date' && !istDatum(wert)) {
      sperren.push(`${feld.label}: das Datum muss im Format JJJJ-MM-TT vorliegen.`);
      continue;
    }
    if (feld.typ === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wert)) {
      sperren.push(`${feld.label}: keine gültige E-Mail-Adresse.`);
      continue;
    }
    if ((feld.typ === 'select' || feld.typ === 'radio' || feld.typ === 'palette') && feld.optionen && !feld.optionen.some((o) => o.wert === wert)) continue;
    if (enthaeltPasswort(wert)) {
      sperren.push(`${feld.label}: ${PASSWORT_SPERRE}`);
      continue;
    }
    felder[feld.name] = wert;
  }

  const auswahl = auswahlAusFeldern(eingabe as Record<string, string | undefined>);
  const paket = findePaket(auswahl.paket);

  for (const feld of ALLE_FELDER) {
    if (feld.pflicht && !felder[feld.name]) fehlend.push(feld.label);
  }
  if (!paket) fehlend.push('Paket');
  if (felder.fotos === 'kunde' && !felder.fotorechte) fehlend.push('Bestätigung der Fotorechte, weil der Kunde Fotos liefert');
  if (paket?.funktion && auswahl.hosting.tarif === null && !felder.kein_hosting_gesagt) {
    fehlend.push('Bei Groß ohne Hosting: der Hinweis an den Kunden, dass die mitarbeitende Funktion entfällt');
  }
  if ((auswahl.bausteine.sprache ?? 0) && !felder.sprache_welche) fehlend.push('Weitere Sprache, welche');
  if (auswahl.bausteine.individuell && !felder.individuell_beschreibung) fehlend.push('Individuelles Feature, Beschreibung');
  const palettenFehler = paletteZumTemplate(felder.branche, felder.farbpalette);
  if (palettenFehler) fehlend.push(palettenFehler);
  // Software-Module gibt es nur mit Paket Gross. Die Auswahl bleibt gespeichert
  // (Zwischenspeichern geht), nur Einreichen nicht: nichts wird still geloescht.
  const fremdeModule = moduleMoeglich(paket) ? [] : auswahl.module.map((s) => findeModul(s)?.name).filter((n): n is string => Boolean(n));
  if (fremdeModule.length > 0) {
    fehlend.push(`Software-Module gibt es ${MODULE_NUR_MIT}. Bitte Paket ${MODULE_PAKET_NAME} wählen oder abwählen: ${fremdeModule.join(', ')}.`);
  }
  // Keine Pruefung nach Branche (seit 06.10.2026): jeder Betrieb darf jedes
  // verkaufbare Modul waehlen, die Branche ist nur eine Empfehlung.

  return { daten: { felder, auswahl }, sperren, fehlend };
}

/**
 * Laesst sich die Palette im Template der Branche bauen? Seit dem Katalog
 * (06.10.2026) gilt fast jede Palette in jedem Template; nur wenige
 * Standardpaletten passen ausschliesslich zum hellen oder zum dunklen Design
 * (Tattoo). Liefert dann einen Hinweis, sonst null.
 */
export function paletteZumTemplate(branche: string | undefined, code: string | undefined): string | null {
  if (!code || code === PALETTE_OFFEN || !branche) return null;
  const template = BRIEFING_ZU_TEMPLATE[branche];
  const p = findePalette(code);
  if (!template || !p || passtZuTemplate(p, template)) return null;
  const design = template === 'tattoo' ? 'dunklen Tattoo-Design' : 'hellen Design dieser Branche';
  return `Farbpalette ${p.code} ${p.name} passt nicht zum ${design}. Bitte eine andere Palette wählen oder noch offen.`;
}

/** Wert fuer die Spalte briefings.farbpalette. */
export function farbpaletteSpalte(daten: BriefingDaten): string | null {
  const wert = daten.felder.farbpalette;
  if (wert === PALETTE_OFFEN) return PALETTE_OFFEN;
  return ALLE_PALETTEN.some((p) => p.code === wert) ? wert : null;
}

// ---------------------------------------------------------------------------
// Speichern

export interface Briefing {
  id: string;
  benutzerId: string;
  kundeId: string | null;
  kundeName: string;
  status: BriefingStatus;
  daten: BriefingDaten;
  /** Palettencode, 'offen' oder null (Spalte aus Migration 010). */
  farbpalette: string | null;
  erstelltAm: Date;
  geaendertAm: Date;
  eingereichtAm: Date | null;
  uebernommenAm: Date | null;
}

export interface BriefingMitVertriebler extends Briefing {
  vertrieblerName: string;
  vertrieblerSlug: string | null;
}

interface Zeile {
  id: string;
  benutzer_id: string;
  kunde_id: string | null;
  kunde_name: string | null;
  status: BriefingStatus;
  daten: unknown;
  farbpalette: string | null;
  erstellt_am: string | Date;
  geaendert_am: string | Date;
  eingereicht_am: string | Date | null;
  uebernommen_am: string | Date | null;
  vertriebler_name?: string;
  vertriebler_slug?: string | null;
}

const FELDER_SQL = `b.id, b.benutzer_id, b.kunde_id, k.name AS kunde_name, b.status, b.daten, b.farbpalette, b.erstellt_am, b.geaendert_am, b.eingereicht_am, b.uebernommen_am`;

function zuDaten(roh: unknown): BriefingDaten {
  const o = roh && typeof roh === 'object' ? (roh as Partial<BriefingDaten>) : {};
  const felder = o.felder && typeof o.felder === 'object' ? (o.felder as Record<string, string>) : {};
  const auswahl = o.auswahl && typeof o.auswahl === 'object' ? (o.auswahl as Auswahl) : leereAuswahl();
  return { felder, auswahl: { ...leereAuswahl(), ...auswahl, hosting: { ...leereAuswahl().hosting, ...(auswahl.hosting ?? {}) } } };
}

function zuBriefing(z: Zeile): Briefing {
  const daten = zuDaten(z.daten);
  return {
    id: z.id,
    benutzerId: z.benutzer_id,
    kundeId: z.kunde_id,
    kundeName: z.kunde_name ?? daten.felder.firmenname ?? '(Kunde gelöscht)',
    status: z.status,
    daten,
    farbpalette: z.farbpalette ?? null,
    erstelltAm: new Date(z.erstellt_am),
    geaendertAm: new Date(z.geaendert_am),
    eingereichtAm: z.eingereicht_am ? new Date(z.eingereicht_am) : null,
    uebernommenAm: z.uebernommen_am ? new Date(z.uebernommen_am) : null,
  };
}

/** Legt einen Bogen zu einem eigenen Kunden an. Firmenname und Ort werden vorbelegt. */
/**
 * Software-Module aus einem Schema-Link (/schema?...&module=kostenrechner),
 * den der Betrieb oder der Vertriebler beim Anlegen eines Bogens einfuegt.
 * Nimmt auch nur den Wert ("kostenrechner,beitrags-schreiber"). Nur
 * verkaufbare Module, Unbekanntes faellt still weg. Das Paket wird nie
 * vorbelegt: ohne Gross warnt der Bogen wie sonst auch.
 */
export function moduleAusSchemaLink(text: string | undefined | null): string[] {
  const roh = String(text ?? '').trim();
  if (!roh) return [];
  if (/[?&]module=/.test(roh) || /^https?:\/\//i.test(roh)) {
    try {
      return moduleAusAdresse(new URL(roh, 'http://x').searchParams.get('module'));
    } catch {
      return [];
    }
  }
  return moduleAusAdresse(roh);
}

export async function erstelleBriefing(db: Db, benutzerId: string, kundeId: string, module: string[] = []): Promise<Briefing | null> {
  const kunde = await holeKunde(db, benutzerId, kundeId);
  if (!kunde) return null;
  const daten = leereDaten();
  daten.felder.firmenname = kunde.name;
  if (kunde.ort) daten.felder.ort = kunde.ort;
  if (kunde.telefon) daten.felder.telefon = kunde.telefon;
  if (/^(Frau|Herr)\s/.test(kunde.ansprechpartner)) daten.felder.unterzeichner = kunde.ansprechpartner;
  daten.auswahl.module = moduleAusAdresse(module.join(','));
  const zeilen = await db.query<{ id: string }>(
    'INSERT INTO briefings (benutzer_id, kunde_id, daten) VALUES ($1, $2, $3) RETURNING id',
    [benutzerId, kunde.id, JSON.stringify(daten)],
  );
  return holeBriefing(db, benutzerId, zeilen[0].id);
}

export async function holeBriefing(db: Db, benutzerId: string, id: string): Promise<Briefing | null> {
  if (!istUuid(id)) return null;
  const zeilen = await db.query<Zeile>(
    `SELECT ${FELDER_SQL} FROM briefings b LEFT JOIN kunden k ON k.id = b.kunde_id WHERE b.id = $1 AND b.benutzer_id = $2`,
    [id, benutzerId],
  );
  return zeilen[0] ? zuBriefing(zeilen[0]) : null;
}

export async function listeBriefings(db: Db, benutzerId: string): Promise<Briefing[]> {
  const zeilen = await db.query<Zeile>(
    `SELECT ${FELDER_SQL} FROM briefings b LEFT JOIN kunden k ON k.id = b.kunde_id WHERE b.benutzer_id = $1 ORDER BY b.geaendert_am DESC`,
    [benutzerId],
  );
  return zeilen.map(zuBriefing);
}

/** Zwischenspeichern, nur im Entwurf und nur den eigenen Bogen. */
export async function speichereBriefing(db: Db, benutzerId: string, id: string, daten: BriefingDaten): Promise<Briefing | null> {
  if (!istUuid(id)) return null;
  const zeilen = await db.query<{ id: string }>(
    `UPDATE briefings SET daten = $3, farbpalette = $4, geaendert_am = now() WHERE id = $1 AND benutzer_id = $2 AND status = 'entwurf' RETURNING id`,
    [id, benutzerId, JSON.stringify(daten), farbpaletteSpalte(daten)],
  );
  return zeilen[0] ? holeBriefing(db, benutzerId, id) : null;
}

/** Einreichen: speichert und setzt den Status, wenn nichts Pflichtiges fehlt. */
export async function reicheEin(db: Db, benutzerId: string, id: string, daten: BriefingDaten, jetzt = new Date()): Promise<Briefing | null> {
  if (!istUuid(id)) return null;
  const zeilen = await db.query<{ id: string }>(
    `UPDATE briefings SET daten = $3, status = 'eingereicht', eingereicht_am = $4, farbpalette = $5, geaendert_am = now()
     WHERE id = $1 AND benutzer_id = $2 AND status = 'entwurf' RETURNING id`,
    [id, benutzerId, JSON.stringify(daten), jetzt, farbpaletteSpalte(daten)],
  );
  return zeilen[0] ? holeBriefing(db, benutzerId, id) : null;
}

export async function loescheBriefing(db: Db, benutzerId: string, id: string): Promise<boolean> {
  if (!istUuid(id)) return false;
  const zeilen = await db.query<{ id: string }>(
    `DELETE FROM briefings WHERE id = $1 AND benutzer_id = $2 AND status = 'entwurf' RETURNING id`,
    [id, benutzerId],
  );
  return zeilen.length > 0;
}

// ---------------------------------------------------------------------------
// Admin

const FELDER_ADMIN_SQL = `${FELDER_SQL}, v.name AS vertriebler_name, v.vertriebler_slug`;

function zuMitVertriebler(z: Zeile): BriefingMitVertriebler {
  return { ...zuBriefing(z), vertrieblerName: z.vertriebler_name ?? '', vertrieblerSlug: z.vertriebler_slug ?? null };
}

/**
 * Nur fuer den Admin: alle eingereichten und uebernommenen Boegen, wahlweise
 * nach Status. Entwuerfe bleiben beim Vertriebler, bis er sie abschickt.
 */
export async function alleBriefings(db: Db, status?: string): Promise<BriefingMitVertriebler[]> {
  const params: unknown[] = [];
  let wo = `b.status <> 'entwurf'`;
  if (status === 'eingereicht' || status === 'uebernommen') {
    params.push(status);
    wo = `b.status = $1`;
  }
  const zeilen = await db.query<Zeile>(
    `SELECT ${FELDER_ADMIN_SQL} FROM briefings b LEFT JOIN kunden k ON k.id = b.kunde_id JOIN benutzer v ON v.id = b.benutzer_id
     WHERE ${wo} ORDER BY CASE b.status WHEN 'eingereicht' THEN 0 WHEN 'entwurf' THEN 1 ELSE 2 END, b.geaendert_am DESC`,
    params,
  );
  return zeilen.map(zuMitVertriebler);
}

export async function holeBriefingAdmin(db: Db, id: string): Promise<BriefingMitVertriebler | null> {
  if (!istUuid(id)) return null;
  const zeilen = await db.query<Zeile>(
    `SELECT ${FELDER_ADMIN_SQL} FROM briefings b LEFT JOIN kunden k ON k.id = b.kunde_id JOIN benutzer v ON v.id = b.benutzer_id WHERE b.id = $1 AND b.status <> 'entwurf'`,
    [id],
  );
  return zeilen[0] ? zuMitVertriebler(zeilen[0]) : null;
}

/**
 * Admin: als uebernommen markieren (YAML erzeugt) oder zur Ueberarbeitung
 * zurueckgeben. Die einzige Stelle, an der der Admin einen Bogen schreibt.
 * Admin-Seiten rufen sie nur ueber admin-aktionen.ts auf, das protokolliert.
 */
export async function setzeStatusAdmin(db: Db, id: string, status: 'uebernommen' | 'entwurf', jetzt = new Date()): Promise<boolean> {
  if (!istUuid(id)) return false;
  const zeilen =
    status === 'uebernommen'
      ? await db.query<{ id: string }>(`UPDATE briefings SET status = 'uebernommen', uebernommen_am = $2 WHERE id = $1 AND status <> 'entwurf' RETURNING id`, [id, jetzt])
      : await db.query<{ id: string }>(`UPDATE briefings SET status = 'entwurf', eingereicht_am = NULL, uebernommen_am = NULL WHERE id = $1 AND status <> 'entwurf' RETURNING id`, [id]);
  return zeilen.length > 0;
}

export function datumFeld(wert: string | undefined): string | null {
  return wert && istDatum(wert) ? wert : null;
}

export { isoDatum };
