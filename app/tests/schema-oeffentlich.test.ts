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
    expect(html).toContain('href="https://dekaru.de/datenschutz"');
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

  it('enthaelt alle Schritte und die Branchen-Links auf /schema', async () => {
    const html = await rendere('praxis');
    for (let i = 0; i <= 5; i++) expect(html).toContain(`id="schritt-${i}"`);
    for (const id of BRANCHEN_IDS) expect(html).toContain(`href="/schema?branche=${id}#schritt-1"`);
    expect(html).not.toContain('href="/erstgespraech');
    expect(html).toMatch(/data-branche="praxis"/);
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
});
