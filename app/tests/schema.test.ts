// Schema fuer das Erstgespraech: nur erlaubte Preise, keine Tarifnamen, nur
// fertige Module, Farben mit genug Kontrast in hell und dunkel.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Seite from '../src/pages/erstgespraech.astro';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { HOSTING, HOSTING_TARIFE, PAKETE, PREIS_AB, euro, findeModul } from '../src/lib/preise.ts';
import { BRANCHEN, BRANCHEN_IDS, anzahlBausteine, bausteine, findeBranche } from '../src/lib/schema.ts';
import { verfuegbareModule } from '../src/lib/schema-module.ts';
import { VERKAUFBARE_MODULE } from '../src/lib/module.ts';
import { ALLE_PALETTEN, FARBGRUPPEN, HINWEIS_NAMEN, SCHEMA_ZU_TEMPLATE, empfohlenePaletten, findePalette, palettenBranche, paletteFuerSchema, probeStil, schemaDaten } from '../src/lib/paletten.ts';
import { neueDb, vertriebler } from './helfer.ts';

const lies = (pfad: string) => readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), 'utf8');

let db: Db;
let anna: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Annegret');
});
afterAll(() => db.close());

async function rendere(branche: string, extra = ''): Promise<{ html: string; schema: string }> {
  const container = await AstroContainer.create();
  const request = new Request(`http://localhost/erstgespraech?branche=${branche}${extra}`);
  const antwort = await container.renderToResponse(Seite, { request, locals: { db, benutzer: anna, csrf: 'x', sitzungId: 's' } });
  const html = await antwort.text();
  const start = html.indexOf('data-schema');
  const ende = html.indexOf('</main>');
  expect(start).toBeGreaterThan(-1);
  return { html, schema: html.slice(start, ende) };
}

/** Nur der sichtbare Text, ohne Tags und Attribute. */
const nurText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

describe('Seite /erstgespraech', () => {
  it.each(BRANCHEN_IDS)('Branche %s: nur "ab 600 €" und "ab 19 € im Monat" als Preise', async (id) => {
    const { schema } = await rendere(id);
    const text = nurText(schema);
    const betraege = new Set([...text.matchAll(/\d[\d.,]*\s*€/g)].map((m) => m[0].replace(/\s+/g, ' ')));
    expect([...betraege].sort()).toEqual([euro(HOSTING.ab), euro(PREIS_AB)].sort());
    expect(text).toContain(`ab ${euro(PREIS_AB)}`);
    expect(text).toContain(`ab ${euro(HOSTING.ab)} im Monat`);
    for (const p of PAKETE) if (p.preis !== PREIS_AB) expect(schema).not.toContain(String(p.preis));
    for (const t of HOSTING_TARIFE) expect(text).not.toMatch(new RegExp(`\\b${t.name}\\b`));
    expect(text).toContain('Gratisquartal');
  });

  it.each(BRANCHEN_IDS)('Branche %s: keine langen Striche, kein Ortsbezug, keine Bauzeit, kein Versprechen', async (id) => {
    const { schema } = await rendere(id);
    const text = nurText(schema);
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/\b(lokal\w*|Region\w*|Gegend|um die Ecke)\b/i);
    expect(text).not.toMatch(/\b(\d+|ein|zwei|drei|vier|fünf|sechs|sieben|acht|zehn)\s+(Werk)?(Tagen?|Wochen?)\b/i);
    expect(text).not.toMatch(/Terminbuchung|Tischreservierung|Reservierung/);
    expect(text).not.toMatch(/nicht dazwischen/i);
    expect(text).not.toMatch(/von mir|bei mir/);
    expect(text).not.toMatch(/Dekaru|DEKARU/);
  });

  it('zeigt die gewaehlte Branche und blendet die anderen aus', async () => {
    const { schema } = await rendere('gastro');
    expect(schema).toMatch(/data-branche="gastro"/);
    expect(schema).toMatch(/<div data-fuer-branche="gastro"(?![^>]*hidden)/);
    expect(schema).toMatch(/<div data-fuer-branche="handwerk"[^>]*hidden/);
    expect(nurText(schema)).toContain('Online-Tischanfrage');
  });

  it('faellt bei unbekannter Branche auf Handwerk zurueck', () => {
    expect(findeBranche('quatsch').id).toBe('handwerk');
    expect(findeBranche(null).id).toBe('handwerk');
    expect(findeBranche('praxis').id).toBe('praxis');
  });

  it('zeigt den Datenweg so, wie er heute ist', async () => {
    const text = nurText((await rendere('handwerk')).schema);
    expect(text).toContain('Formulardienst von dekaru');
    expect(text).toContain('Frankfurt');
    expect(text).toMatch(/Inhalt der Anfrage nicht gespeichert/);
  });

  it('zeigt Module nur in passenden Branchen und nie, was noch nicht verkauft wird', async () => {
    // Namen aus dekaru-rechnungen/preise.json, die heute nicht verkaufbar sind.
    const nichtVerkaufbar = ['Terminbuchung', 'Tischreservierung', 'Reel-Werkstatt', 'Beitrags-Schreiber', 'Bewertungs-Assistent', 'Angebots-Assistent', 'Schicht- und Urlaubsplan', 'Lagerliste', 'Anfrage mit Fotos', 'Fotoanfrage', 'Speisekarte und Preisliste'];
    for (const id of BRANCHEN_IDS) {
      const { schema } = await rendere(id);
      for (const name of nichtVerkaufbar) expect(schema, name).not.toContain(name);
      // Schritt 4: der Block der gewaehlten Branche, sichtbar, mit Modulen genau dann, wenn es welche gibt.
      const schritt4 = schema.slice(schema.indexOf('id="schritt-4"'), schema.indexOf('id="schritt-5"'));
      const eigener = schritt4.slice(schritt4.indexOf(`data-fuer-branche="${id}"`));
      const bis = eigener.indexOf('data-fuer-branche=', 10);
      const block = bis > -1 ? eigener.slice(0, bis) : eigener;
      expect(block.includes('data-module'), id).toBe(verfuegbareModule(id).length > 0);
    }
    for (const id of ['handwerk', 'umzug', 'reinigung', 'garten']) {
      const text = nurText((await rendere(id)).schema);
      expect(text, id).toContain('Kostenrechner für Ihre Kunden');
      expect(text, id).toContain('Im Paket Groß zusätzlich möglich');
      expect(text, id).toContain('nur zu einer Website im Paket Groß');
    }
  });

  it('zeigt die Module in Schritt 2 als Zeile nur beim Paket Groß, nicht als Baustein', async () => {
    const { schema } = await rendere('umzug');
    expect(schema).toMatch(/<div data-fuer-branche="umzug"(?! hidden)[^>]*>\s*<p class="bausteine-module" data-in="gross"/);
    expect(schema).toMatch(/<div data-fuer-branche="garten" hidden[^>]*>\s*<p class="bausteine-module"/);
    expect(nurText(schema)).toMatch(/Nur im Paket Groß dazu wählbar:\s+Kostenrechner für Ihre Kunden\. Mehr dazu in Schritt 4\./);
    expect(schema).not.toMatch(/data-fuer-branche="(gastro|friseur|praxis)"[^>]*>\s*<p class="bausteine-module"/);
    // Die Zahl der Bausteine bleibt, Module sind kein Teil des Pakets.
    for (const p of PAKETE) expect(anzahlBausteine(bausteine(BRANCHEN.umzug), p.schluessel)).toBe(anzahlBausteine(bausteine(BRANCHEN.handwerk), p.schluessel));
    // CSS: die Zeile verschwindet bei Klein und Mittel.
    expect(css).toContain(".schema[data-paket='klein'] .bausteine-module:not([data-in~='klein'])");
    expect(css).toContain(".schema[data-paket='mittel'] .bausteine-module:not([data-in~='mittel'])");
  });
});

describe('Die sieben Branchen', () => {
  it('hat Umzug, Reinigung und Garten mit eigenen Texten fuer jeden Schritt', () => {
    expect(BRANCHEN_IDS).toEqual(['handwerk', 'gastro', 'friseur', 'praxis', 'umzug', 'reinigung', 'garten']);
    const gesehen = new Set<string>();
    for (const id of BRANCHEN_IDS) {
      const b = BRANCHEN[id];
      expect(b.heute).toHaveLength(4);
      expect(b.felder).toHaveLength(4);
      expect(b.abnahme).toHaveLength(3);
      expect(b.funktion).toBe(id === 'gastro' ? 'Online-Tischanfrage' : 'Online-Terminanfrage');
      // Keine Branche schreibt die Saetze einer anderen ab.
      for (const p of [...b.heute.slice(0, 3), ...b.abnahme]) {
        if (p.titel === 'Sie bestätigen selbst') continue;
        expect(gesehen.has(p.text), `${id}: ${p.text}`).toBe(false);
        gesehen.add(p.text);
      }
      expect(gesehen.has(b.beispielAnfrage.text)).toBe(false);
      gesehen.add(b.beispielAnfrage.text);
    }
    for (const id of ['umzug', 'reinigung', 'garten'] as const) expect(findeBranche(id).id).toBe(id);
  });

  it.each(['umzug', 'reinigung', 'garten'] as const)('%s: gleichnamiges Template, dessen Paletten und der Kostenrechner', async (id) => {
    expect(SCHEMA_ZU_TEMPLATE[id]).toBe(id);
    const { schema } = await rendere(id);
    const standard = palettenBranche(id)!.standard;
    expect(standard).toMatch(/^(UM|RE|GT)-1$/);
    expect(schema).toMatch(new RegExp(`<div class="empfehlung" data-fuer-branche="${id}"(?! hidden)`));
    expect(schema).toContain(`data-palette-wahl="${standard}"`);
    expect(nurText(schema)).toContain(`Die Vorschau zeigt Palette ${standard}`);
    expect(verfuegbareModule(id).map((m) => m.schluessel)).toEqual(['modul-kostenrechner']);
    expect(schema).toMatch(new RegExp(`<input[^>]*value="http://localhost/schema\\?branche=${id}"`));
    expect(schema).toMatch(new RegExp(`class="branche branche--${id}" href="/erstgespraech\\?branche=${id}#schritt-1"[^>]*aria-current="true"`));
  });

  it('jede Schema-Branche hat ein Template mit Palettenempfehlung', () => {
    for (const id of BRANCHEN_IDS) expect(empfohlenePaletten(SCHEMA_ZU_TEMPLATE[id]).length, id).toBeGreaterThanOrEqual(4);
  });

  it('hat fuer jede Branche eine Kartenfarbe in schema.css', () => {
    for (const id of BRANCHEN_IDS) expect(css, id).toContain(`.branche--${id} {`);
  });
});

describe('Schritt Farben', () => {
  it.each(BRANCHEN_IDS)('Branche %s: zeigt alle Farbgruppen und die Empfehlung der Branche', async (id) => {
    const { schema } = await rendere(id);
    const text = nurText(schema);
    expect(text).toContain('In welchen Farben?');
    for (const g of FARBGRUPPEN) {
      expect(schema).toContain(`href="/erstgespraech?branche=${id}&amp;gruppe=${g.kuerzel}#schritt-3"`);
      expect(text).toContain(g.label);
      expect(text).toContain(`${g.codes.length} Paletten`);
    }
    // Empfehlung: die Paletten der Template-Branche, als Links mit Gruppe und Palette.
    const empfohlen = empfohlenePaletten(SCHEMA_ZU_TEMPLATE[id]);
    expect(empfohlen.length).toBeGreaterThanOrEqual(4);
    expect(text).toContain('Passt oft zu Ihrer Branche');
    for (const p of empfohlen) expect(schema).toContain(`href="/erstgespraech?branche=${id}&amp;gruppe=${p.gruppe}&amp;palette=${p.code}#schritt-3"`);
    expect(text).toContain('Noch keine Palette gewählt');
    // Ohne gewaehlte Gruppe keine Karten im HTML, die Gruppenansicht ist zu.
    expect(schema).not.toMatch(/class="palette" href="\//);
    expect(schema).toMatch(/data-gruppen-ansicht hidden/);
    expect(schema).not.toMatch(/aria-current="true"[^>]*data-palette-wahl|data-palette-wahl[^>]*aria-current="true"/);
  });

  it('oeffnet eine Gruppe aus der Adresse und zeigt nur deren Karten', async () => {
    const { schema } = await rendere('gastro', '&gruppe=bl');
    const karten = [...schema.matchAll(/class="palette" href="[^"]*" data-palette-wahl="([A-Z]{2}-\d+)"/g)].map((m) => m[1]);
    expect(karten).toEqual(FARBGRUPPEN.find((g) => g.kuerzel === 'BL')!.codes);
    expect(schema).toMatch(/data-gruppen-uebersicht hidden/);
    expect(schema).toContain('data-gruppe="BL"');
    expect(schema).toContain('href="/erstgespraech?branche=gastro#schritt-3" data-gruppe-zurueck');
    // Der Hinweis zu den Namen steht in der Gruppe IN und immer unten im Schritt,
    // damit er auch bei einer gewaehlten IN-Palette ohne offene Gruppe sichtbar ist.
    expect(schema).toMatch(/data-hinweis-namen hidden/);
    expect(nurText(schema)).toContain(HINWEIS_NAMEN);
    const inspiriert = await rendere('gastro', '&gruppe=IN');
    expect(inspiriert.schema).not.toMatch(/data-hinweis-namen hidden/);
    expect(nurText(inspiriert.schema)).toContain(HINWEIS_NAMEN);
    expect(nurText(inspiriert.schema)).toContain('Inspiriert von Apple');
  });

  it('uebernimmt jede Palette aus der Adresse, auch aus einer anderen Branche', async () => {
    const { schema } = await rendere('handwerk', '&gruppe=PT&palette=HW-2');
    expect(schema).toMatch(/data-palette="HW-2"/);
    expect(schema).toMatch(/data-palette-wahl="HW-2"[^>]*aria-current="true"/);
    expect(nurText(schema)).toContain('Palette HW-2 Petrol');
    expect(nurText(schema)).toContain('Diesen Namen bitte nennen.');
    expect(schema).toContain(`style="${probeStil(findePalette('HW-2')!)}" data-farb-vorschau`);
    const fremd = await rendere('friseur', '&palette=BL-2');
    expect(nurText(fremd.schema)).toContain('Palette BL-2 Denim');
    // Die Kachel der Gruppe traegt den Hinweis auf die Wahl.
    expect(fremd.schema).toMatch(/data-gruppe-gewaehlt="BL"(?! hidden)/);
    expect(fremd.schema).toMatch(/data-gruppe-gewaehlt="PT" hidden/);
  });

  it('ignoriert Unsinn in der Adresse', async () => {
    for (const extra of ['&palette=quatsch', '&palette=', '&gruppe=XX', '&palette=<b>']) {
      const { schema } = await rendere('handwerk', extra);
      expect(schema).not.toMatch(/data-palette="[A-Z]/);
      expect(schema).not.toContain('data-gruppe="XX"');
    }
    expect(paletteFuerSchema('ge-2')?.code).toBe('GE-2');
  });

  it('liefert dem Skript kompakte Daten fuer alle Paletten, ohne Preise', async () => {
    const { schema } = await rendere('praxis');
    const roh = /<script type="application\/json" data-paletten-daten>([\s\S]*?)<\/script>/.exec(schema)?.[1] ?? '';
    const daten = JSON.parse(roh);
    expect(daten).toEqual(schemaDaten());
    expect(Object.keys(daten.paletten)).toHaveLength(ALLE_PALETTEN.length);
    for (const [, werte] of Object.entries(daten.paletten) as [string, string[]][]) expect(werte[4]).toMatch(/^(#[0-9a-f]{6}){10}$/);
    expect(roh).not.toMatch(/€|Euro/);
    expect(roh.length).toBeLessThan(25000);
  });

  it('hat sechs Schritte, in der richtigen Reihenfolge', async () => {
    const { schema } = await rendere('gastro');
    const ids = [...schema.matchAll(/id="schritt-(\d)" data-schritt="(\d)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6].map((n) => [n, n]));
    for (let n = 1; n <= 6; n++) expect(nurText(schema)).toContain(`Schritt ${n} von 6`);
    expect(nurText(schema)).toContain('in sechs Schritten');
  });
});

describe('Link zum Nachschicken', () => {
  it('nimmt Farbgruppe und gewaehlte Palette mit', async () => {
    const { schema } = await rendere('praxis', '&gruppe=OL&palette=GE-3');
    expect(schema).toMatch(/<input[^>]*value="http:\/\/localhost\/schema\?branche=praxis&amp;gruppe=OL&amp;palette=GE-3"/);
    const nur = await rendere('praxis', '&palette=GE-3');
    expect(nur.schema).toMatch(/<input[^>]*value="http:\/\/localhost\/schema\?branche=praxis&amp;palette=GE-3"/);
    const skript = lies('../src/scripts/schema-link.ts');
    expect(skript).toContain("url.searchParams.set('gruppe', schema.dataset.gruppe)");
    expect(skript).toContain("url.searchParams.set('palette', schema.dataset.palette)");
  });

  it('bietet den oeffentlichen Link mit der gewaehlten Branche und den Hinweis', async () => {
    const { schema } = await rendere('friseur');
    expect(schema).toContain('data-link-kopieren');
    expect(nurText(schema)).toContain('Link zum Nachschicken kopieren');
    expect(nurText(schema)).toContain('Erst nach dem Termin schicken. Die Vorschau der Website wird nie verschickt.');
    expect(schema).toMatch(/<input[^>]*value="http:\/\/localhost\/schema\?branche=friseur"/);
    expect(schema).toMatch(/<input[^>]*readonly/);
  });

  it('Skript importiert nichts aus lib/ und baut nur /schema', () => {
    const skript = lies('../src/scripts/schema-link.ts');
    expect(skript).not.toMatch(/from\s+['"][^'"]*lib\//);
    expect(skript).not.toMatch(/preise/);
    expect(skript).toContain("new URL('/schema', location.origin)");
  });
});

describe('Bausteine', () => {
  it('wachsen von Klein ueber Mittel zu Gross', () => {
    for (const id of BRANCHEN_IDS) {
      const liste = bausteine(BRANCHEN[id]);
      const [k, m, g] = (['klein', 'mittel', 'gross'] as const).map((p) => anzahlBausteine(liste, p));
      expect(k).toBeLessThan(m);
      expect(m).toBeLessThan(g);
    }
  });

  it('haben die mitarbeitende Funktion nur in Paketen mit Funktion, branchenspezifisch benannt', () => {
    const gastro = bausteine(BRANCHEN.gastro).find((b) => b.schluessel === 'funktion')!;
    for (const p of PAKETE) expect(gastro.je[p.schluessel] !== null).toBe(p.funktion);
    expect(gastro.je.gross).toBe('Online-Tischanfrage');
    expect(bausteine(BRANCHEN.friseur).find((b) => b.schluessel === 'funktion')!.je.gross).toBe('Online-Terminanfrage');
  });

  it('nutzen die Branchenbezeichnung fuer die Leistungsliste', () => {
    const k = bausteine(BRANCHEN.gastro).find((b) => b.schluessel === 'leistungsliste')!;
    expect(k.je.mittel).toBe('Speisekarte');
    expect(k.je.klein).toBeNull();
  });
});

describe('Module', () => {
  it('zeigt nur verkaufbare Module der passenden Branche, ohne Preis', () => {
    // Heute verkaufbar: nur der Kostenrechner, in Handwerk, Umzug, Reinigung und Garten.
    for (const b of ['handwerk', 'umzug', 'reinigung', 'garten'] as const) expect(verfuegbareModule(b).map((m) => m.schluessel)).toEqual(['modul-kostenrechner']);
    for (const b of ['gastro', 'friseur', 'praxis'] as const) expect(verfuegbareModule(b)).toEqual([]);
    for (const b of BRANCHEN_IDS) {
      for (const m of verfuegbareModule(b)) {
        expect(findeModul(m.schluessel), m.schluessel).not.toBeNull();
        expect(`${m.name} ${m.kurz}`).not.toMatch(/€|\d+\s*Euro/);
      }
    }
  });

  it('Schema-Branchen eines Moduls passen genau zu seinen Templates', () => {
    for (const m of VERKAUFBARE_MODULE) {
      const erwartet = BRANCHEN_IDS.filter((b) => m.templates.includes(SCHEMA_ZU_TEMPLATE[b]));
      expect([...m.schemaBranchen].sort(), m.schluessel).toEqual([...erwartet].sort());
    }
  });
});

describe('Browser-Skript', () => {
  it('importiert keine Preise und nichts aus lib/', () => {
    const skript = lies('../src/scripts/schema.ts');
    expect(skript).not.toMatch(/from\s+['"][^'"]*lib\//);
    expect(skript).not.toMatch(/preise/);
    expect(skript).not.toContain('€');
  });
});

// ---------------------------------------------------------------------------
// Farben

const css = lies('../src/styles/schema.css');
const globalCss = lies('../src/styles/global.css');

function block(quelle: string, selektor: string): Map<string, string> {
  const start = quelle.indexOf(selektor);
  expect(start, `${selektor} fehlt`).toBeGreaterThan(-1);
  const klammer = quelle.indexOf('{', start);
  const ende = quelle.indexOf('}', klammer);
  const karte = new Map<string, string>();
  for (const t of quelle.slice(klammer + 1, ende).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) karte.set(t[1], t[2].trim());
  return karte;
}

function luminanz(hex: string): number {
  const h = hex.replace('#', '');
  const kanal = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * kanal(0) + 0.7152 * kanal(2) + 0.0722 * kanal(4);
}
function kontrast(a: string, b: string): number {
  const [x, y] = [luminanz(a), luminanz(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe('schema.css', () => {
  const hell = block(css, ':root {');
  const dunkelSystem = block(css, ":root:not([data-theme='light'])");
  const dunkelWahl = block(css, ":root[data-theme='dark']");
  const gHell = block(globalCss, ':root {');
  const gDunkel = block(globalCss, ":root[data-theme='dark']");

  it('hat in allen drei Bloecken dieselben Farben, dunkel zweimal gleich', () => {
    expect([...dunkelSystem.keys()].sort()).toEqual([...hell.keys()].sort());
    expect([...dunkelWahl.entries()].sort()).toEqual([...dunkelSystem.entries()].sort());
  });

  it('benutzt nur Variablen, die es gibt', () => {
    // --pl-* setzt src/lib/paletten.ts als style-Attribut der Palettenproben.
    const proben = [...probeStil(ALLE_PALETTEN[0]).matchAll(/(--pl-[a-z-]+):/g)].map((t) => t[1]);
    const bekannt = new Set([...hell.keys(), ...gHell.keys(), '--fl-flaeche', '--fl-text', '--fl-rand', '--i', ...proben]);
    // Auch die Seite selbst (SVG-Attribute).
    const seite = lies('../src/components/SchemaErstgespraech.astro');
    for (const quelle of [css, seite]) {
      for (const t of quelle.matchAll(/var\((--[a-z0-9-]+)/g)) expect(bekannt.has(t[1]), `${t[1]} ist nirgends definiert`).toBe(true);
    }
  });

  it('erreicht 4.5:1 fuer Text auf jeder Farbflaeche, hell und dunkel', () => {
    const familien = [...hell.keys()].filter((k) => k.endsWith('-text')).map((k) => k.replace(/-text$/, ''));
    expect(familien.length).toBeGreaterThanOrEqual(6);
    for (const [name, karte] of [
      ['hell', hell],
      ['dunkel', dunkelWahl],
    ] as const) {
      for (const f of familien) {
        const k = kontrast(karte.get(`${f}-text`)!, karte.get(`${f}-flaeche`)!);
        expect(k, `${f} ${name}: ${k.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('hebt die Randfarben sichtbar von der Seite ab (Zierde, mindestens 2:1)', () => {
    for (const [karte, seite] of [
      [hell, gHell],
      [dunkelWahl, gDunkel],
    ] as const) {
      for (const [k, v] of karte) if (k.endsWith('-rand')) expect(kontrast(v, seite.get('--bg')!), k).toBeGreaterThanOrEqual(2);
    }
  });
});
