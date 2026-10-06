// Verkaufshilfen: Uebersicht, Steckbrief mit Preis, Fassung zum Zeigen ohne Preis.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Uebersicht from '../src/pages/verkaufshilfen/index.astro';
import Steckbrief from '../src/pages/verkaufshilfen/[schluessel].astro';
import Zeigen from '../src/pages/verkaufshilfen/[schluessel]/zeigen.astro';
import Preisrechner from '../src/pages/preisrechner.astro';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { erstelleBenutzer } from '../src/lib/auth.ts';
import { neueDb, vertriebler } from './helfer.ts';

let db: Db;
let anna: Benutzer;
let chef: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna');
  chef = await erstelleBenutzer(db, { email: 'chef@example.test', name: 'Chef', rolle: 'admin', passwort: 'geheim-passwort-1' });
});
afterAll(() => db.close());

type Seite = Parameters<Awaited<ReturnType<typeof AstroContainer.create>>['renderToResponse']>[0];

async function rendere(seite: Seite, pfad: string, wer: Benutzer, params: Record<string, string> = {}): Promise<Response> {
  const container = await AstroContainer.create();
  return container.renderToResponse(seite, { request: new Request(`http://localhost${pfad}`), params, locals: { db, benutzer: wer, csrf: 'x', sitzungId: 's' } });
}

const nurText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const hauptteil = (html: string) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

describe('Verkaufshilfen', () => {
  it('die Uebersicht zeigt nur verkaufbare Module und den Tipp fuer den Zweittermin', async () => {
    const html = await (await rendere(Uebersicht, '/verkaufshilfen', anna)).text();
    const text = nurText(hauptteil(html));
    expect(text).toContain('Kostenrechner für Ihre Kunden');
    expect(text).toContain('Module im Zweittermin ansprechen');
    for (const name of ['Beitrags-Schreiber', 'Bewertungs-Assistent', 'Speisekarte und Preisliste', 'Angebots-Assistent Handwerk', 'Anfrage mit Fotos', 'Material- und Lagerliste', 'Terminbuchung mit Erinnerung', 'Tischreservierung', 'Schicht- und Urlaubsplan']) expect(text).toContain(name);
    expect(text).not.toContain('Reel-Werkstatt');
    expect(html).toMatch(/href="\/verkaufshilfen"[^>]*aria-current="page"/);
  });

  it('der Steckbrief nennt Preis und Provision und je nach Stufe, wer ihn nennt', async () => {
    const stufe1 = nurText(hauptteil(await (await rendere(Steckbrief, '/verkaufshilfen/modul-kostenrechner', anna, { schluessel: 'modul-kostenrechner' })).text()));
    expect(stufe1).toContain('200 €');
    expect(stufe1).toContain('70 €');
    expect(stufe1).toContain('Stufe 1: Sie nennen keinen Preis');
    const admin = nurText(hauptteil(await (await rendere(Steckbrief, '/verkaufshilfen/modul-kostenrechner', chef, { schluessel: 'modul-kostenrechner' })).text()));
    expect(stufe1).toContain('Nur zum Paket Groß , wie die mitarbeitende Funktion.'.replace(' ,', ','));
    expect(admin).toContain('aus dem Preisrechner, ohne Nachlass');
  });

  it('die Fassung zum Zeigen hat keinen Preis, keine Provision und keine Interna', async () => {
    const html = hauptteil(await (await rendere(Zeigen, '/verkaufshilfen/modul-kostenrechner/zeigen', anna, { schluessel: 'modul-kostenrechner' })).text());
    expect(html).toContain('data-blatt');
    expect(html).not.toMatch(/€|Euro|Provision|Stufe 1|Stufe 2|Nur für Sie/);
    expect(html).not.toContain('Anna');
    expect(nurText(html)).toContain('Unverbindlicher Richtwert, kein Angebot.');
    expect(nurText(html)).toContain('Eine Website von dekaru im Paket Groß');
  });

  it('kennt nicht verkaufbare Module nicht', async () => {
    for (const s of ['modul-reel-werkstatt', 'quatsch']) {
      expect((await rendere(Steckbrief, `/verkaufshilfen/${s}`, anna, { schluessel: s })).status).toBe(404);
      expect((await rendere(Zeigen, `/verkaufshilfen/${s}/zeigen`, anna, { schluessel: s })).status).toBe(404);
    }
  });
});

describe('Preisrechner mit Modulen', () => {
  it('zeigt dem Admin das Modul mit Preis und rechnet es mit', async () => {
    const html = await (await rendere(Preisrechner, '/preisrechner?paket=gross&m_modul-kostenrechner=on', chef)).text();
    const text = nurText(hauptteil(html));
    expect(text).toContain('4. Software-Module');
    expect(text).toContain('5. Hosting');
    expect(html).toMatch(/name="m_modul-kostenrechner"[^>]*checked/);
    expect(text).toContain('Kostenrechner für Ihre Kunden 200 €');
    expect(text).toContain('1.800 €');
  });

  it('sperrt Module ohne Paket Groß und rechnet sie nicht mit', async () => {
    for (const paket of ['klein', 'mittel']) {
      const html = await (await rendere(Preisrechner, `/preisrechner?paket=${paket}`, chef)).text();
      const feld = /<input[^>]*name="m_modul-kostenrechner"[^>]*>/.exec(html)?.[0] ?? '';
      expect(feld).toMatch(/\sdisabled/);
      expect(feld).not.toMatch(/\schecked/);
      expect(html).toMatch(/class="posten posten--gesperrt"[^>]*data-modul="modul-kostenrechner"/);
      expect(html).toMatch(/data-nur-gross(?![^>]*hidden)[^>]*>nur mit Paket Groß</);
      expect(html).toMatch(/data-module-warnung hidden/);
    }
    const gross = await (await rendere(Preisrechner, '/preisrechner?paket=gross', chef)).text();
    expect(/<input[^>]*name="m_modul-kostenrechner"[^>]*>/.exec(gross)?.[0]).not.toMatch(/\sdisabled/);
    expect(gross).toMatch(/data-nur-gross hidden/);
    expect(nurText(hauptteil(gross))).toContain('Nur mit Paket Groß.');
  });

  it('laesst ein angekreuztes Modul ohne Groß angekreuzt, warnt und rechnet es nicht', async () => {
    const html = await (await rendere(Preisrechner, '/preisrechner?paket=mittel&m_modul-kostenrechner=on', chef)).text();
    const feld = /<input[^>]*name="m_modul-kostenrechner"[^>]*>/.exec(html)?.[0] ?? '';
    expect(feld).toMatch(/\schecked/);
    expect(feld).not.toMatch(/\sdisabled/);
    expect(html).not.toMatch(/data-module-warnung hidden/);
    const text = nurText(hauptteil(html));
    expect(text).toContain('Software-Module gibt es nur mit Paket Groß. Angekreuzt ist Kostenrechner für Ihre Kunden');
    expect(text).toContain('Nicht mitgerechnet: Kostenrechner für Ihre Kunden.');
    expect(text).not.toContain('Kostenrechner für Ihre Kunden 200 €');
  });

  it('das Skript nimmt Module erst beim Paketwechsel heraus und sagt es sichtbar', () => {
    const skript = readFileSync(fileURLToPath(new URL('../src/scripts/preisrechner.ts', import.meta.url)), 'utf8');
    expect(skript).toContain("moduleAbgleichen(form, ziel.name === 'paket')");
    expect(skript).toContain('moduleAbgleichen(form, false);');
    expect(skript).toContain('herausgenommen. Software-Module gibt es');
  });

  it('Stufe 1 sieht im Preisrechner weiterhin keine Zahl ausser ab 600 Euro', async () => {
    const text = nurText(hauptteil(await (await rendere(Preisrechner, '/preisrechner?m_modul-kostenrechner=on', anna)).text()));
    expect(text).not.toContain('200 €');
    expect(text).not.toContain('Kostenrechner');
  });
});
