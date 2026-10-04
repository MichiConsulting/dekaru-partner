// Die Seite "Betrieb eintragen" so, wie ein Vertriebler sie nach dem Absenden
// sieht: der neutrale Satz, nichts vom anderen Vertriebler. Der Admin sieht
// den Treffer und die Freigabe.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import NeuSeite from '../src/pages/kunden/neu.astro';
import type { Db } from '../src/lib/db.ts';
import { erstelleBenutzer, type Benutzer } from '../src/lib/auth.ts';
import { erstelleKunde, listeKunden, pruefeKunde } from '../src/lib/kunden.ts';
import { MELDUNG_FREMD } from '../src/lib/dubletten.ts';
import { ladeProtokoll } from '../src/lib/admin-protokoll.ts';
import { neueDb, vertriebler } from './helfer.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
let chef: Benutzer;

beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Annegret');
  bert = await vertriebler(db, 'Bert');
  chef = await erstelleBenutzer(db, { email: 'chef@example.test', name: 'Chef', rolle: 'admin', passwort: 'geheim-passwort-1' });
  await erstelleKunde(
    db,
    anna.id,
    pruefeKunde({
      name: 'Schreinerei Holzwurm GmbH',
      ort: 'Nagold',
      telefon: '07452 55555',
      ansprechpartner: 'Herr Verborgen',
      notiz: 'NOTIZ-VON-ANNEGRET',
      status: 'angebot',
    }).wert,
  );
});
afterAll(() => db.close());

async function absenden(benutzer: Benutzer, felder: Record<string, string>): Promise<{ status: number; html: string }> {
  const container = await AstroContainer.create();
  const body = new URLSearchParams({ _csrf: 'x', ...felder });
  const request = new Request('http://localhost/kunden/neu', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const antwort = await container.renderToResponse(NeuSeite, {
    request,
    locals: { db, benutzer, csrf: 'x', sitzungId: 's' },
  });
  return { status: antwort.status, html: await antwort.text() };
}

describe('Betrieb eintragen mit Dublette', () => {
  it('Vertriebler: blockiert, neutraler Satz, kein Datenleck', async () => {
    const { status, html } = await absenden(bert, { name: 'schreinerei holzwurm', ort: 'Nagold', status: 'angerufen' });
    expect(status).toBe(200);
    expect(MELDUNG_FREMD).toMatch(/^Dieser Betrieb wird bereits betreut/);
    expect(html).toMatch(/Dieser Betrieb wird bereits betreut, bitte mit Michael Henning kl/);
    for (const geheim of ['Annegret', 'Herr Verborgen', 'NOTIZ-VON-ANNEGRET', '55555', 'Schreinerei Holzwurm GmbH', 'Holzwurm GmbH']) {
      expect(html).not.toContain(geheim);
    }
    expect(html).not.toContain('dublette_freigabe');
    expect(await listeKunden(db, bert.id)).toEqual([]);
  });

  it('Vertriebler: eine selbst gesetzte Freigabe hilft nicht', async () => {
    const { html } = await absenden(bert, { name: 'Schreinerei Holzwurm', ort: 'Nagold', status: 'angerufen', dublette_freigabe: '1' });
    expect(html).toMatch(/bereits betreut/);
    expect(await listeKunden(db, bert.id)).toEqual([]);
  });

  it('Admin: sieht den Treffer und speichert nur mit Freigabe, protokolliert', async () => {
    const ohne = await absenden(chef, { name: 'Schreinerei Holzwurm', ort: 'Nagold', status: 'angerufen' });
    expect(ohne.html).toContain('Annegret');
    expect(ohne.html).toContain('dublette_freigabe');
    expect(await listeKunden(db, chef.id)).toEqual([]);

    const mit = await absenden(chef, { name: 'Schreinerei Holzwurm', ort: 'Nagold', status: 'angerufen', dublette_freigabe: '1' });
    expect(mit.status).toBe(303);
    expect((await listeKunden(db, chef.id)).length).toBe(1);
    const [e] = (await ladeProtokoll(db, { aktion: 'dublette_admin_gespeichert' })).eintraege;
    expect(e.zielText).toBe('Schreinerei Holzwurm');
  });
});
