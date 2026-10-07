// Oeffentliche Fassung des Schemas (/schema): ohne Login erreichbar, aber nur
// genau dieser Pfad; noindex; keine Sitzung, kein Cookie, kein Name aus dem
// Portal; dieselben Preis- und Textregeln wie /erstgespraech.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import type { APIContext, MiddlewareNext } from 'astro';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { HOSTING, HOSTING_TARIFE, PAKETE, PREIS_AB, euro } from '../src/lib/preise.ts';
import { BRANCHEN_IDS } from '../src/lib/schema.ts';
import stileDaten from '../src/data/stile.json';
import stileTexte from '../../inhalt/stile.json';
import { entscheideZugriff, istOeffentlichesSchema } from '../src/lib/zugriff.ts';
import { neueDb, vertriebler } from './helfer.ts';

// Die Middleware holt sich ihre Datenbank ueber getDb(). Im Test ist das eine
// eigene PGlite-Instanz; fuer /schema darf sie gar nicht erst angefragt werden.
const dbAufrufe = vi.hoisted(() => ({ anzahl: 0, db: null as unknown }));
vi.mock('../src/lib/db.ts', async (original) => {
  const echt = await original<typeof import('../src/lib/db.ts')>();
  return {
    ...echt,
    getDb: async () => {
      dbAufrufe.anzahl += 1;
      return dbAufrufe.db;
    },
  };
});

const { onRequest } = await import('../src/middleware.ts');
const { default: SchemaSeite } = await import('../src/pages/schema.astro');

let db: Db;
let anna: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  dbAufrufe.db = db;
  anna = await vertriebler(db, 'Annegret');
});
afterAll(() => db.close());

// ---------------------------------------------------------------------------
// Middleware

interface Ergebnis {
  antwort: Response;
  nextAufgerufen: boolean;
  locals: App.Locals;
  gesetzteCookies: number;
}

async function anfrage(pfad: string, optionen: { methode?: string; cookie?: string } = {}): Promise<Ergebnis> {
  const url = new URL(pfad, 'http://localhost');
  const request = new Request(url, { method: optionen.methode ?? 'GET' });
  const locals = {} as App.Locals;
  let nextAufgerufen = false;
  let gesetzteCookies = 0;
  const context = {
    url,
    request,
    locals,
    cookies: {
      get: (name: string) => (optionen.cookie && name === 'dp_sitzung' ? { value: optionen.cookie } : undefined),
      set: () => {
        gesetzteCookies += 1;
      },
      delete: () => {
        gesetzteCookies += 1;
      },
    },
    redirect: (ziel: string, status = 302) => new Response(null, { status, headers: { Location: ziel } }),
  } as unknown as APIContext;
  const next = (async () => {
    nextAufgerufen = true;
    return new Response('<html>Seite</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  }) as MiddlewareNext;
  const antwort = (await onRequest(context, next)) as Response;
  return { antwort, nextAufgerufen, locals, gesetzteCookies };
}

describe('Middleware fuer /schema', () => {
  it('laesst /schema ohne Login durch, ohne Datenbank und ohne Cookie', async () => {
    const vorher = dbAufrufe.anzahl;
    const r = await anfrage('/schema?branche=gastro');
    expect(r.antwort.status).toBe(200);
    expect(r.nextAufgerufen).toBe(true);
    expect(dbAufrufe.anzahl).toBe(vorher);
    expect(r.locals.benutzer).toBeNull();
    expect(r.locals.csrf).toBeNull();
    expect(r.locals.sitzungId).toBeNull();
    expect(r.gesetzteCookies).toBe(0);
    expect(r.antwort.headers.get('Set-Cookie')).toBeNull();
  });

  it('bleibt auch mit vorgemerkten Modulen ohne Datenbank und ohne Cookie', async () => {
    const vorher = dbAufrufe.anzahl;
    const r = await anfrage('/schema?branche=gastro&palette=BL-2&module=kostenrechner,beitrags-schreiber');
    expect(r.antwort.status).toBe(200);
    expect(r.nextAufgerufen).toBe(true);
    expect(dbAufrufe.anzahl).toBe(vorher);
    expect(r.gesetzteCookies).toBe(0);
    expect(r.antwort.headers.get('Set-Cookie')).toBeNull();
  });

  it('liest auch ein mitgeschicktes Sitzungs-Cookie nicht', async () => {
    const vorher = dbAufrufe.anzahl;
    const r = await anfrage('/schema', { cookie: 'irgendein-token' });
    expect(r.antwort.status).toBe(200);
    expect(dbAufrufe.anzahl).toBe(vorher);
    expect(r.locals.benutzer).toBeNull();
  });

  it('setzt noindex und dieselben Sicherheits-Header wie im Portal', async () => {
    const { antwort } = await anfrage('/schema');
    expect(antwort.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(antwort.headers.get('X-Frame-Options')).toBe('DENY');
    expect(antwort.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(antwort.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(antwort.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('nimmt auf /schema nur GET und HEAD an', async () => {
    expect((await anfrage('/schema', { methode: 'HEAD' })).antwort.status).toBe(200);
    for (const methode of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await anfrage('/schema', { methode });
      expect(r.antwort.status, methode).toBe(405);
      expect(r.nextAufgerufen).toBe(false);
    }
  });

  it.each(['/schema/', '/schema/x', '/schemas', '/schema-irgendwas', '/schema.json', '/Schema', '/erstgespraech', '/', '/kunden', '/admin'])(
    '%s ohne Login fuehrt zum Login',
    async (pfad) => {
      const r = await anfrage(pfad);
      expect(r.antwort.status).toBe(303);
      expect(r.antwort.headers.get('Location')).toMatch(/^\/login/);
      expect(r.nextAufgerufen).toBe(false);
    },
  );

  it('fuehrt /erstgespraech mit Branche nach dem Login dorthin zurueck', async () => {
    const r = await anfrage('/erstgespraech?branche=gastro');
    expect(r.antwort.headers.get('Location')).toBe(`/login?weiter=${encodeURIComponent('/erstgespraech?branche=gastro')}`);
  });
});

describe('Zugriff auf /schema', () => {
  it('ist genau ein Pfad, kein Praefix', () => {
    expect(istOeffentlichesSchema('/schema')).toBe(true);
    for (const p of ['/schema/', '/schema/x', '/schemas', '/schema-irgendwas', '/Schema', '/x/schema']) {
      expect(istOeffentlichesSchema(p), p).toBe(false);
      expect(entscheideZugriff(p, null), p).toEqual({ typ: 'login' });
    }
    expect(entscheideZugriff('/schema', null)).toEqual({ typ: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// Seite

async function rendere(branche: string): Promise<string> {
  const container = await AstroContainer.create();
  const request = new Request(`http://localhost/schema?branche=${branche}`);
  // Absichtlich mit Sitzungsdaten: auch wenn je etwas in locals stuende,
  // darf die Seite nichts davon zeigen.
  const antwort = await container.renderToResponse(SchemaSeite, { request, locals: { db, benutzer: anna, csrf: 'geheim-csrf', sitzungId: 's' } });
  expect(antwort.status).toBe(200);
  return antwort.text();
}

const nurText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');

describe('Seite /schema', () => {
  it('ist noindex und hat einen schlichten Kopf ohne Portal', async () => {
    const html = await rendere('handwerk');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(html.match(/<header[\s\S]*?<\/header>/)?.[0].replace(/<[^>]+>/g, ' ').trim()).toBe('dekaru');
    expect(html).not.toContain('Partner-Portal');
    expect(html).not.toMatch(/class="nav"|class="unternav"|data-konto|data-modus/);
    expect(html).not.toContain('/logout');
    expect(html).not.toContain('_csrf');
  });

  it('verlinkt Impressum und Datenschutz von dekaru.de', async () => {
    const html = await rendere('handwerk');
    expect(html).toContain('href="https://dekaru.de/impressum"');
    expect(html).toContain('href="/datenschutz"');
  });

  it('zeigt keine Namen und keine Sitzungsdaten', async () => {
    const html = await rendere('handwerk');
    expect(html).not.toContain('Annegret');
    expect(html).not.toContain(anna.email);
    expect(html).not.toContain('geheim-csrf');
  });

  it('zeigt keine Hinweise fuer Vertriebler', async () => {
    const text = nurText(await rendere('handwerk'));
    expect(text).not.toMatch(/Zum Zeigen im ersten Termin/);
    expect(text).not.toMatch(/Präsentieren|Präsentation/);
    expect(text).not.toMatch(/Nachschicken|nach dem Termin schicken/i);
    expect(text).not.toMatch(/Vertriebler/);
  });

  // Entscheidung 07.10.2026: der Stil kommt ins Angebot, nicht ins Erstgespraech.
  it('zeigt keine Stile und keine Bewegungsstufen', async () => {
    const html = await rendere('handwerk');
    const text = nurText(html);
    // Werkstatt, Stille, Frisch und Raster sind auch gewoehnliche Woerter, darum mit "Stil" davor.
    for (const s of stileDaten.stile) expect(text, s.name).not.toContain(`Stil ${s.name}`);
    expect(text).not.toMatch(/Feuilleton|Plakat/);
    for (const t of Object.values(stileTexte.stile)) expect(text).not.toContain(t.leitidee);
    expect(text).not.toMatch(/Stil der Website|Bewegung auf der Seite|Standard der Branche/);
    expect(html).not.toMatch(/data-feld="(stil|bewegung)"/);
  });

  it('enthaelt alle Schritte und die Branchen-Links auf /schema', async () => {
    const html = await rendere('praxis');
    for (let i = 0; i <= 6; i++) expect(html).toContain(`id="schritt-${i}"`);
    for (const id of BRANCHEN_IDS) expect(html).toContain(`href="/schema?branche=${id}#schritt-1"`);
    expect(html).not.toContain('href="/erstgespraech');
    expect(html).toMatch(/data-branche="praxis"/);
  });

  it('zeigt die Farbpaletten und uebernimmt eine Wahl aus der Adresse, ohne etwas zu speichern', async () => {
    const vorher = dbAufrufe.anzahl;
    const html = await rendere('gastro&gruppe=BL&palette=GA-3');
    expect(html).toMatch(/data-palette-wahl="GA-3"[^>]*aria-current="true"/);
    expect(nurText(html)).toContain('Palette GA-3 Nachtblau');
    expect(html).toContain('href="/schema?branche=gastro&amp;gruppe=BL&amp;palette=BL-1#schritt-3"');
    expect(html).toContain('href="/schema?branche=gastro&amp;gruppe=SE&amp;palette=GA-2#schritt-3"');
    expect(html).not.toMatch(/<form/);
    expect(dbAufrufe.anzahl).toBe(vorher);
  });

  it.each(['gastro', 'umzug'])('Branche %s: Module waehlbar und vormerkbar, ohne Preis und ohne Speichern', async (id) => {
    const vorher = dbAufrufe.anzahl;
    const html = await rendere(`${id}&module=kostenrechner`);
    const schritt4 = html.slice(html.indexOf('id="schritt-4"'), html.indexOf('id="schritt-5"'));
    expect(nurText(schritt4)).toContain('Kostenrechner für Ihre Kunden');
    expect(nurText(schritt4)).toMatch(/Ihre Auswahl:\s+Kostenrechner für Ihre Kunden/);
    expect(schritt4).toMatch(/data-modul-wahl="kostenrechner"[^>]*aria-pressed="true"/);
    expect(schritt4).toContain(`href="/schema?branche=${id}#schritt-4"`);
    expect(schritt4).not.toMatch(/€|\bEuro\b/);
    // Der Modulpreis steht nirgends, auch nicht in Attributen oder Daten.
    expect(html).not.toMatch(/\b200\s*(€|Euro)|"preis"|data-preis/);
    expect(html).not.toMatch(/<form/);
    expect(dbAufrufe.anzahl).toBe(vorher);
  });

  it.each(BRANCHEN_IDS)('Branche %s: nur die erlaubten Preise, auf der ganzen Seite', async (id) => {
    const html = await rendere(id);
    const text = nurText(html);
    const betraege = new Set([...text.matchAll(/\d[\d.,]*\s*€/g)].map((m) => m[0].replace(/\s+/g, ' ')));
    expect([...betraege].sort()).toEqual([euro(HOSTING.ab), euro(PREIS_AB)].sort());
    for (const p of PAKETE) if (p.preis !== PREIS_AB) expect(text).not.toContain(euro(p.preis));
    for (const t of HOSTING_TARIFE) expect(text).not.toMatch(new RegExp(`\\b${t.name}\\b`));
  });

  it.each(BRANCHEN_IDS)('Branche %s: keine langen Striche, kein Ortsbezug, dekaru klein', async (id) => {
    const text = nurText(await rendere(id));
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toMatch(/\b(lokal\w*|Region\w*|Gegend|um die Ecke)\b/i);
    expect(text).not.toMatch(/Dekaru|DEKARU/);
    expect(text).not.toMatch(/von mir|bei mir/);
  });

  it.each(['umzug', 'reinigung', 'garten'])('Branche %s: eigene Texte, Datenweg, Kostenrechner im Paket Groß, keine Bauzeit', async (id) => {
    const html = await rendere(id);
    const text = nurText(html);
    expect(html).toMatch(new RegExp(`data-branche="${id}"`));
    expect(html).toMatch(new RegExp(`class="branche branche--${id}" href="/schema\\?branche=${id}#schritt-1"[^>]*aria-current="true"`));
    expect(text).toContain('Formulardienst von dekaru');
    expect(text).toMatch(/Inhalt der Anfrage nicht gespeichert/);
    expect(text).toContain('Im Paket Groß zusätzlich möglich');
    expect(text).toContain('Kostenrechner für Ihre Kunden');
    expect(text).not.toMatch(/\b(\d+|ein|zwei|drei|vier|fünf|sechs|sieben|acht|zehn)\s+(Werk)?(Tagen?|Wochen?)\b/i);
    // Nicht verkaufbare Module tauchen nie auf.
    expect(text).not.toMatch(/Reel-Werkstatt/);
    for (const name of ['Anfrage mit Fotos', 'Terminbuchung mit Erinnerung', 'Tischreservierung', 'Schicht- und Urlaubsplan']) expect(text).toContain(name);
  });
});
