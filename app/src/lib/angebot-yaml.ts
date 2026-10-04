// Aus einem eingereichten Briefing-Bogen die Eingabedatei fuer das
// Angebotssystem in dekaru-rechnungen erzeugen (angebote/eingang/*.yaml,
// Format wie angebote/eingang/_beispiel.yaml). Michi legt die Datei dort ab
// und ruft /angebot auf. Was das Angebotssystem nicht als Feld kennt, steht
// als Kommentar dabei: die Kundendatei fuer kunden/<slug>.json, die Angaben
// fuer Werkvertrag und AVV, die Zusagen aus Teil G.
//
// Es gibt hier keinen Preis als Zahl, der nicht aus src/data/preise.json
// kaeme: Paket und Bausteine nennt die Datei nur mit Schluessel, den Preis
// setzt das Angebotssystem aus seiner eigenen preise.json. Nur die freien
// Positionen (Zusatzleistungen) und die Hosting-Option tragen den Preis, weil
// das Format es so verlangt.

import type { Briefing } from './briefing.ts';
import { ALLE_POSTEN, FUNKTION, HOSTING, berechne, findePaket, findeTarif, findeZusatzleistung, type Auswahl } from './preise.ts';

export interface YamlKontext {
  vertrieblerName: string;
  vertrieblerSlug: string | null;
  /** JJJJ-MM-TT, Angebotsdatum. */
  heute: string;
}

export interface YamlErgebnis {
  dateiname: string;
  inhalt: string;
  slug: string;
}

/** Slug aus dem Firmennamen, wie die Kundendateien in dekaru-rechnungen heissen. */
export function kundenSlug(firmenname: string): string {
  const slug = String(firmenname ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'kunde';
}

/** YAML-Zeichenkette in doppelten Anfuehrungszeichen, immer, damit kein Wert als Zahl oder Datum gelesen wird. */
export function yamlText(wert: unknown): string {
  const text = String(wert ?? '');
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').replace(/\t/g, ' ')}"`;
}

function kommentar(text: string, einzug = ''): string[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((zeile) => `#${einzug} ${zeile}`.replace(/\s+$/, ''));
}

function kommentarFeld(label: string, wert: string | undefined): string[] {
  if (!wert) return [];
  const zeilen = wert.split(/\r?\n/);
  if (zeilen.length === 1) return [`# ${label}: ${zeilen[0]}`];
  return [`# ${label}:`, ...zeilen.map((z) => `#   ${z}`)];
}

function hostingOption(auswahl: Auswahl): string[] {
  const h = berechne(auswahl).hosting;
  if (!h) return [];
  const tarif = findeTarif(h.tarif.id)!;
  const kopf = `Hosting ${tarif.name}, Betrieb und Pflege, ${
    h.zahlweise === 'jaehrlich' ? `Jahresvertrag, ${HOSTING.bezahlteMonate} von 12 Monaten berechnet` : 'monatlich kündbar nach der Mindestlaufzeit'
  }.`;
  const text = h.gratisquartal ? `${kopf} Gratisquartal: ${HOSTING.gratisHinweis}` : kopf;
  return [
    'optionen:',
    `  - beschreibung: ${yamlText(text)}`,
    '    menge: 1',
    `    einheit: ${yamlText(h.zahlweise === 'jaehrlich' ? 'Jahr' : 'Monat')}`,
    `    einzelpreis: ${h.jeZahlung.toFixed(2)}`,
  ];
}

function bausteineBlock(auswahl: Auswahl, felder: Record<string, string>): string[] {
  const paket = findePaket(auswahl.paket)!;
  const zeilen: string[] = [];
  const kommentare: string[] = [];
  for (const posten of ALLE_POSTEN) {
    const roh = auswahl.bausteine[posten.schluessel];
    if (!roh) continue;
    if (posten.art === 'anzahl') {
      const menge = Math.trunc(Number(roh));
      if (menge > 0) zeilen.push(`  ${posten.schluessel}: ${menge}`);
      continue;
    }
    if (paket.enthalten[posten.schluessel]) continue;
    if (posten.art === 'anfrage') {
      const text = felder.individuell_beschreibung ?? '';
      kommentare.push(`  # ${posten.name}: Preis aus dem Gespräch eintragen, dann die Raute entfernen.`);
      kommentare.push(`  # ${posten.schluessel}: { preis: 0, beschreibung: ${yamlText(text || posten.name)} }`);
      continue;
    }
    zeilen.push(`  ${posten.schluessel}: true`);
  }
  if (zeilen.length === 0 && kommentare.length === 0) return ['bausteine: {}'];
  if (zeilen.length === 0) return ['bausteine: {}', ...kommentare];
  return ['bausteine:', ...zeilen, ...kommentare];
}

function positionenBlock(auswahl: Auswahl): string[] {
  const zeilen: string[] = [];
  for (const schluessel of auswahl.zusatzleistungen) {
    const z = findeZusatzleistung(schluessel);
    if (!z) continue;
    zeilen.push(`  - beschreibung: ${yamlText(z.zusatz ? `${z.name}. ${z.zusatz}` : z.name)}`);
    zeilen.push('    menge: 1');
    zeilen.push(`    einheit: ${yamlText(z.einheit)}`);
    zeilen.push(`    einzelpreis: ${z.preis.toFixed(2)}`);
  }
  return zeilen.length ? ['positionen:', ...zeilen] : [];
}

function jaNein(wert: string | undefined): string {
  return wert === 'on' ? 'ja' : 'nein';
}

export function erzeugeAngebotYaml(b: Briefing, k: YamlKontext): YamlErgebnis {
  const f = b.daten.felder;
  const a = b.daten.auswahl;
  const paket = findePaket(a.paket);
  if (!paket) throw new Error('Der Bogen nennt kein gültiges Paket.');
  const firmenname = f.firmenname || b.kundeName;
  const slug = kundenSlug(firmenname);
  const hosting = findeTarif(a.hosting.tarif);
  const zahlweise = hosting && hosting.monat === null ? 'jaehrlich' : a.hosting.zahlweise;

  const kundendatei = {
    slug,
    firmenname,
    rechtsform: f.rechtsform ?? '',
    ansprechpartner: f.unterzeichner ?? '',
    anschrift: { strasse: f.strasse ?? '', plz: f.plz ?? '', ort: f.ort ?? '', land: 'Deutschland' },
    email: f.email ?? '',
    ...(f.telefon ? { telefon: f.telefon } : {}),
    hostingTarif: hosting ? hosting.id : null,
    ...(hosting ? { hostingZahlweise: zahlweise, gratisquartal: a.hosting.gratisquartal } : {}),
  };

  const eingereicht = b.eingereichtAm ? b.eingereichtAm.toISOString().slice(0, 10) : k.heute;
  const zeilen: string[] = [
    '# Angebots-Eingabe aus dem Briefing-Bogen im Partner-Portal.',
    `# Erzeugt am ${k.heute}. Vertriebler: ${k.vertrieblerName}${k.vertrieblerSlug ? ` (${k.vertrieblerSlug})` : ''}. Bogen eingereicht am ${eingereicht}.`,
    `# Ablegen unter dekaru-rechnungen/angebote/eingang/${k.heute}-${slug}.yaml, dann /angebot aufrufen.`,
    '# Vor dem Erstellen: Anschreiben pruefen, Fertigstellung eintragen, Teil G unten lesen.',
    '#',
    `# Kundendatei kunden/${slug}.json, falls sie noch fehlt (Teil A des Bogens):`,
    ...kommentar(JSON.stringify(kundendatei, null, 2)),
    '#',
    `# vertriebler.json, Block zuordnung: ${JSON.stringify({ [slug]: { vertriebler: k.vertrieblerSlug ?? 'SLUG_EINTRAGEN', termin: eingereicht, gratisquartal: a.hosting.gratisquartal } })}`,
    ...(f.ansprechpartner_projekt ? kommentarFeld('Ansprechpartner fuers Projekt', f.ansprechpartner_projekt) : []),
    ...(f.branche ? [`# Branche: ${f.branche}`] : []),
    '',
    `kunde: ${slug}`,
    `angebotsdatum: ${k.heute}`,
    'gueltigTage: 30',
    '',
    `betreff: ${yamlText(`Neue Website für ${firmenname}`)}`,
    '',
    'anschreiben: >',
    `  vielen Dank für das Gespräch mit ${k.vertrieblerName}. Wie besprochen finden Sie hier die`,
    '  Zusammenstellung für Ihre neue Website. Bei Fragen rufen Sie mich gerne an.',
    '',
    `# Paket ${paket.name}${paket.funktion ? `, mit ${FUNKTION.name}` : ''}. Preis und Inhalt kommen aus preise.json.`,
    `paket: ${paket.schluessel}`,
    ...bausteineBlock(a, f),
  ];
  if (f.seiten_namen) zeilen.push(...kommentarFeld('Seiten, mit Namen', f.seiten_namen));
  if (f.sprache_welche) zeilen.push(`# Weitere Sprache: ${f.sprache_welche}`);
  if (f.texte_kunde === 'on') zeilen.push('# Texte liefert der Kunde.');
  zeilen.push('');

  const positionen = positionenBlock(a);
  if (positionen.length) zeilen.push(...positionen, '');

  const option = hostingOption(a);
  if (option.length) {
    zeilen.push(...option);
  } else {
    zeilen.push(`# Kein Hosting, der Kunde hostet selbst.${paket.funktion ? ` Die ${FUNKTION.name} entfällt, dem Kunden gesagt: ${jaNein(f.kein_hosting_gesagt)}.` : ''}`);
  }
  if (f.empfehlung_von) zeilen.push(`# Empfehlung von: ${f.empfehlung_von} (die Empfehlungsregel gilt für den, der empfiehlt).`);
  zeilen.push('');

  zeilen.push('nichtEnthalten:', '  - "Fotoaufnahmen vor Ort"', '  - "Betreuung von Social-Media-Kanälen"', '');

  zeilen.push('# Termine aus Teil C. Den Fertigstellungstermin nennt Michael Henning, deshalb hier noch auskommentiert.');
  if (f.wunsch_livegang) zeilen.push(`# Wunschtermin Livegang: ${f.wunsch_livegang}`);
  if (f.zulieferung_bis) zeilen.push(`# Zulieferung bis: ${f.zulieferung_bis}`);
  if (f.anlass) zeilen.push(`# Harter Anlass: ${f.anlass}`);
  zeilen.push('# fertigstellung: JJJJ-MM-TT', 'anzahlungProzent: 50', 'auftragsfeld: true', '');

  zeilen.push('# Fuer den Werkvertrag (Teil D): Zulieferungen');
  zeilen.push(`# Fotos: ${f.fotos === 'kunde' ? `Kunde liefert${f.fotos_anzahl ? `, etwa ${f.fotos_anzahl}` : ''}, Rechte bestätigt: ${jaNein(f.fotorechte)}` : f.fotos === 'keine' ? 'keine vorhanden, klären' : 'keine Angabe'}`);
  zeilen.push(`# Logo: ${f.logo === 'datei' ? 'als Datei vorhanden' : f.logo === 'keins' ? 'keines vorhanden' : 'keine Angabe'}`);
  zeilen.push(`# Referenznennung: ${f.referenz === 'ja' ? 'ja' : f.referenz === 'nein' ? 'nein, Kunde widerspricht' : 'keine Angabe'}`);
  zeilen.push('#', '# Fuer den AVV (Teil E):');
  zeilen.push(`# Kontaktformular: ${jaNein(f.kontaktformular)}. Gesundheitsdaten (Art. 9 DSGVO): ${jaNein(f.gesundheitsdaten)}.`);
  zeilen.push(`# Externe Online-Buchung: ${f.externe_buchung || 'nein'}. Newsletter: ${a.bausteine.newsletter ? 'ja (Baustein)' : 'nein'}. Bewerbungsformular: ${jaNein(f.bewerbungsformular)}.`);
  if (paket.funktion && hosting) zeilen.push(`# ${FUNKTION.name}: ja, läuft mit Hosting ${hosting.name}.`);
  zeilen.push('#', '# Domain (Teil F), nichts zugesagt:');
  zeilen.push(`# Domain: ${f.domain || 'keine'}${f.domain_anbieter ? `, Anbieter ${f.domain_anbieter}` : ''}`);
  if (f.domain_wuensche) zeilen.push(`# Wunschnamen: ${f.domain_wuensche}`);
  if (f.alte_website) zeilen.push(`# Bisherige Website: ${f.alte_website}`);
  zeilen.push('#', '# Teil G, vor dem Angebot mit dem Kunden klaeren:');
  zeilen.push(...(kommentarFeld('Sonderwünsche', f.sonderwuensche).length ? kommentarFeld('Sonderwünsche', f.sonderwuensche) : ['# Sonderwünsche: keine']));
  zeilen.push(...(kommentarFeld('Fragen des Kunden', f.fragen).length ? kommentarFeld('Fragen des Kunden', f.fragen) : ['# Fragen des Kunden: keine']));
  zeilen.push(...(kommentarFeld('Zusagen im Termin, wörtlich', f.zusagen).length ? kommentarFeld('Zusagen im Termin, wörtlich', f.zusagen) : ['# Zusagen im Termin: keine']));

  return { dateiname: `${k.heute}-${slug}.yaml`, inhalt: `${zeilen.join('\n')}\n`, slug };
}
