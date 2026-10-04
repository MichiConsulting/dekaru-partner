// Stufe je Vertriebler: Standard 1, Stufe 2 nur mit Datum und Bestaetigung in
// Textform, jede Aenderung im Protokoll. Preise sieht nur Admin oder Stufe 2.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { erstelleBenutzer } from '../src/lib/auth.ts';
import { neueDb, vertriebler } from './helfer.ts';
import { darfPreiseSehen, ladeProtokoll, ladeStufe, pruefeStufe, setzeStufe, stufenAller } from '../src/lib/stufe.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
let admin: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna');
  bert = await vertriebler(db, 'Bert');
  admin = await erstelleBenutzer(db, { email: 'admin@example.test', name: 'Michi', rolle: 'admin', passwort: 'geheim-passwort-1' });
});
afterAll(() => db.close());

describe('Stufe', () => {
  it('jeder neue Zugang beginnt in Stufe 1', async () => {
    expect(await ladeStufe(db, anna.id)).toEqual({ stufe: 1, seit: null, bestaetigtAm: null });
    expect(await ladeStufe(db, 'keine-uuid')).toEqual({ stufe: 1, seit: null, bestaetigtAm: null });
  });

  it('Stufe 2 braucht Datum und Bestaetigung in Textform', () => {
    expect(pruefeStufe({ stufe: '2', seit: '', bestaetigtAm: '' }).fehler.length).toBe(2);
    expect(pruefeStufe({ stufe: '2', seit: '2026-10-04', bestaetigtAm: '' }).fehler).toEqual([
      'Stufe 2 braucht das Datum der Bestätigung in Textform (§ 1 Absatz 6 des Vertrags).',
    ]);
    expect(pruefeStufe({ stufe: '2', seit: '2026-13-99', bestaetigtAm: '2026-10-01' }).fehler.length).toBeGreaterThan(0);
    const ok = pruefeStufe({ stufe: 2, seit: '2026-10-04', bestaetigtAm: '2026-10-03' });
    expect(ok.fehler).toEqual([]);
    expect(ok.wert).toEqual({ stufe: 2, seit: '2026-10-04', bestaetigtAm: '2026-10-03' });
    // Stufe 1 geht auch ohne Datum, alles andere als 2 ist 1.
    expect(pruefeStufe({ stufe: '7', seit: '', bestaetigtAm: '' })).toEqual({ wert: { stufe: 1, seit: null, bestaetigtAm: null }, fehler: [] });
  });

  it('setzt die Stufe und protokolliert sie', async () => {
    await setzeStufe(db, anna.id, { stufe: 2, seit: '2026-10-04', bestaetigtAm: '2026-10-03' }, admin.id);
    expect(await ladeStufe(db, anna.id)).toEqual({ stufe: 2, seit: '2026-10-04', bestaetigtAm: '2026-10-03' });
    expect((await ladeStufe(db, bert.id)).stufe).toBe(1);

    await setzeStufe(db, anna.id, { stufe: 1, seit: '2026-11-01', bestaetigtAm: null }, admin.id);
    const protokoll = await ladeProtokoll(db, anna.id);
    expect(protokoll.map((p) => [p.stufe, p.seit, p.bestaetigtAm, p.gesetztVon])).toEqual([
      [1, '2026-11-01', null, 'Michi'],
      [2, '2026-10-04', '2026-10-03', 'Michi'],
    ]);
    expect(await ladeProtokoll(db, bert.id)).toEqual([]);

    const alle = await stufenAller(db);
    expect(alle.get(anna.id)?.stufe).toBe(1);
    expect(alle.get(bert.id)?.stufe).toBe(1);
  });

  it('Preise sieht nur der Admin oder Stufe 2', () => {
    expect(darfPreiseSehen(admin, { stufe: 1 })).toBe(true);
    expect(darfPreiseSehen(anna, { stufe: 1 })).toBe(false);
    expect(darfPreiseSehen(anna, { stufe: 2 })).toBe(true);
    expect(darfPreiseSehen(anna, null)).toBe(false);
    expect(darfPreiseSehen(null, { stufe: 2 })).toBe(false);
  });
});
