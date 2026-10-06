// Verkaufshilfen: Uebersicht, Steckbrief mit Preis, Fassung zum Zeigen ohne Preis.
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
    for (const name of ['Terminbuchung', 'Tischreservierung', 'Reel-Werkstatt', 'Beitrags-Schreiber', 'Bewertungs-Assistent', 'Angebots-Assistent', 'Lagerliste']) expect(text).not.toContain(name);
    expect(html).toMatch(/href="\/verkaufshilfen"[^>]*aria-current="page"/);
  });

  it('der Steckbrief nennt Preis und Provision und je nach Stufe, wer ihn nennt', async () => {
    const stufe1 = nurText(hauptteil(await (await rendere(Steckbrief, '/verkaufshilfen/modul-kostenrechner', anna, { schluessel: 'modul-kostenrechner' })).text()));
    expect(stufe1).toContain('200 €');
    expect(stufe1).toContain('70 €');
    expect(stufe1).toContain('Stufe 1: Sie nennen keinen Preis');
    const admin = nurText(hauptteil(await (await rendere(Steckbrief, '/verkaufshilfen/modul-kostenrechner', chef, { schluessel: 'modul-kostenrechner' })).text()));
    expect(admin).toContain('aus dem Preisrechner, ohne Nachlass');
  });

  it('die Fassung zum Zeigen hat keinen Preis, keine Provision und keine Interna', async () => {
    const html = hauptteil(await (await rendere(Zeigen, '/verkaufshilfen/modul-kostenrechner/zeigen', anna, { schluessel: 'modul-kostenrechner' })).text());
    expect(html).toContain('data-blatt');
    expect(html).not.toMatch(/€|Euro|Provision|Stufe 1|Stufe 2|Nur für Sie/);
    expect(html).not.toContain('Anna');
    expect(nurText(html)).toContain('Unverbindlicher Richtwert, kein Angebot.');
  });

  it('kennt nicht verkaufbare Module nicht', async () => {
    for (const s of ['modul-terminbuchung', 'quatsch']) {
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

  it('Stufe 1 sieht im Preisrechner weiterhin keine Zahl ausser ab 600 Euro', async () => {
    const text = nurText(hauptteil(await (await rendere(Preisrechner, '/preisrechner?m_modul-kostenrechner=on', anna)).text()));
    expect(text).not.toContain('200 €');
    expect(text).not.toContain('Kostenrechner');
  });
});
