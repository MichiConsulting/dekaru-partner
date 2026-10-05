// Schema fuer das Erstgespraech: nur erlaubte Preise, keine Tarifnamen, nur
// fertige Module, Farben mit genug Kontrast in hell und dunkel.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Seite from '../src/pages/erstgespraech.astro';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { HOSTING, HOSTING_TARIFE, PAKETE, PREIS_AB, euro } from '../src/lib/preise.ts';
import { BRANCHEN, BRANCHEN_IDS, anzahlBausteine, bausteine, findeBranche } from '../src/lib/schema.ts';
import { SCHEMA_MODULE, verfuegbareModule, type SchemaModul } from '../src/lib/schema-module.ts';
import { neueDb, vertriebler } from './helfer.ts';

const lies = (pfad: string) => readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), 'utf8');

let db: Db;
let anna: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Annegret');
});
afterAll(() => db.close());

async function rendere(branche: string): Promise<{ html: string; schema: string }> {
  const container = await AstroContainer.create();
  const request = new Request(`http://localhost/erstgespraech?branche=${branche}`);
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

  it('zeigt keinen Bereich fuer Module, solange keines verfuegbar ist', async () => {
    for (const id of BRANCHEN_IDS) {
      const { schema } = await rendere(id);
      const offen = verfuegbareModule(id).length > 0;
      expect(schema.includes('class="module"')).toBe(offen);
      for (const m of SCHEMA_MODULE.filter((x) => x.status !== 'verfuegbar')) expect(schema).not.toContain(m.name);
    }
  });
});

describe('Link zum Nachschicken', () => {
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
  const beispiel = (status: SchemaModul['status'], branchen: SchemaModul['branchen']): SchemaModul => ({ id: 'x', name: 'X', kurz: 'x', branchen, status });

  it('zeigt nur verfuegbare Module der passenden Branche', () => {
    const liste = [beispiel('verfuegbar', ['gastro']), beispiel('geplant', ['gastro']), beispiel('in-arbeit', ['gastro']), beispiel('verfuegbar', ['handwerk'])];
    expect(verfuegbareModule('gastro', liste)).toEqual([liste[0]]);
    expect(verfuegbareModule('praxis', liste)).toEqual([]);
  });

  it('fuehrt alle Module aus dem Bauplan mit Branchen und gueltigem Status', () => {
    expect(SCHEMA_MODULE).toHaveLength(11);
    expect(new Set(SCHEMA_MODULE.map((m) => m.id)).size).toBe(11);
    for (const m of SCHEMA_MODULE) {
      expect(['geplant', 'in-arbeit', 'verfuegbar']).toContain(m.status);
      expect(m.branchen.length).toBeGreaterThan(0);
      for (const b of m.branchen) expect(BRANCHEN_IDS).toContain(b);
      expect(m.kurz).not.toMatch(/€|\d+\s*Euro/);
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
    const bekannt = new Set([...hell.keys(), ...gHell.keys(), '--fl-flaeche', '--fl-text', '--fl-rand', '--i']);
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
