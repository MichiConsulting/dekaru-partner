// Mini-Schemata der Software-Module: im Schema (Schritt Funktion) und auf der
// Fassung zum Zeigen. Prueft Vollstaendigkeit, Barrierefreiheit, Bewegung und
// dass nirgends ein Preis steht.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Seite from '../src/pages/erstgespraech.astro';
import Zeigen from '../src/pages/verkaufshilfen/[schluessel]/zeigen.astro';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { VERKAUFBARE_MODULE, kurzSchluessel } from '../src/lib/module.ts';
import { MINI_SCHEMATA } from '../src/lib/modul-schema.ts';
import { neueDb, vertriebler } from './helfer.ts';

const lies = (pfad: string) => readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), 'utf8');
const css = lies('../src/styles/modul-schema.css');
const komponente = lies('../src/components/ModulSchema.astro');
const symbole = lies('../src/components/ModulSchemaSymbole.astro');

let db: Db;
let anna: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna');
});
afterAll(() => db.close());

async function schritt4(branche: string): Promise<string> {
  const container = await AstroContainer.create();
  const request = new Request(`http://localhost/erstgespraech?branche=${branche}`);
  const html = await (await container.renderToResponse(Seite, { request, locals: { db, benutzer: anna, csrf: 'x', sitzungId: 's' } })).text();
  return html.slice(html.indexOf('id="schritt-4"'), html.indexOf('id="schritt-5"'));
}

describe('Mini-Schemata', () => {
  it('gibt es fuer jedes verkaufbare Modul', () => {
    for (const m of VERKAUFBARE_MODULE) {
      const kurz = kurzSchluessel(m.schluessel);
      expect(MINI_SCHEMATA, kurz).toContain(kurz);
      expect(komponente, kurz).toContain(`kurz === '${kurz}'`);
    }
  });

  it('jede Modulkarte hat Mini-Schema, Name, Nutzen und drei Schritte in einem details', async () => {
    for (const branche of ['handwerk', 'gastro']) {
      const s = await schritt4(branche);
      const block = s.slice(s.indexOf(`data-fuer-branche="${branche}"`, s.indexOf('data-module')));
      for (const m of VERKAUFBARE_MODULE) {
        const kurz = kurzSchluessel(m.schluessel);
        const karte = new RegExp(`<details class="modul-so"[^>]*>\\s*<summary[^>]*>\\s*<span class="ms ms--${kurz}"[^>]*aria-hidden="true"[\\s\\S]*?<strong[^>]*>${m.name}</strong>[\\s\\S]*?So funktioniert es[\\s\\S]*?</summary>\\s*<ol class="modul-so__schritte"[^>]*>([\\s\\S]*?)</ol>`);
        const treffer = karte.exec(block);
        expect(treffer, `${branche} ${kurz}`).not.toBeNull();
        expect(treffer![1].match(/<li[\s>]/g), `${branche} ${kurz}`).toHaveLength(3);
      }
      // Vormerken bleibt ausserhalb des summary, ein eigener Knopf.
      expect(block).not.toMatch(/<summary[^>]*>(?:(?!<\/summary>)[\s\S])*data-modul-wahl/);
      // Zeichen nur einmal je Seite.
      expect(s.match(/class="ms-symbole"/g)).toHaveLength(1);
    }
  });

  it('zeigt keinen Preis und keinen Text in SVG', async () => {
    const s = await schritt4('handwerk');
    const mini = [...s.matchAll(/<span class="ms ms--[\s\S]*?<strong/g)].map((t) => t[0]).join(' ');
    expect(mini).not.toMatch(/€|\bEuro\b/);
    expect(komponente + symbole).not.toMatch(/<text[\s>]/);
    expect(komponente).not.toMatch(/€/);
  });

  it('bewegt sich nur mit Skript, im aktiven Schritt, ohne reduzierte Bewegung, hoechstens dreimal', () => {
    const bewegung = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'), css.indexOf('@media print'));
    const vorher = css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    expect(vorher).not.toMatch(/animation(-name)?\s*:/);
    for (const zeile of bewegung.matchAll(/animation-iteration-count:\s*([^;]+);/g)) expect(Number(zeile[1])).toBeLessThanOrEqual(3);
    expect(bewegung).not.toMatch(/infinite/);
    for (const sel of bewegung.matchAll(/^\s*(\.[^{]+)\{/gm)) {
      if (sel[1].includes('ms')) expect(sel[1], sel[1]).toMatch(/\.schema--js \.ist-aktiv \.ms/);
    }
  });

  it('steht auf der Fassung zum Zeigen still, mit drei Schritten und passender Marke', async () => {
    const container = await AstroContainer.create();
    for (const m of VERKAUFBARE_MODULE) {
      const request = new Request(`http://localhost/verkaufshilfen/${m.schluessel}/zeigen`);
      const html = await (await container.renderToResponse(Zeigen, { request, params: { schluessel: m.schluessel }, locals: { db, benutzer: anna, csrf: 'x', sitzungId: 's' } })).text();
      const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
      expect(main, m.schluessel).toContain(`ms--${kurzSchluessel(m.schluessel)}`);
      expect(main, m.schluessel).toContain('So funktioniert es');
      expect(main.match(/class="blatt__schritte"[^>]*>([\s\S]*?)<\/ol>/)![1].match(/<li[\s>]/g), m.schluessel).toHaveLength(3);
      expect(main, m.schluessel).toContain(m.art === 'besucher' ? 'Software für Ihre Website' : 'Software für Ihren Betrieb');
      expect(main, m.schluessel).not.toMatch(/€|\bEuro\b/);
    }
  });
});
