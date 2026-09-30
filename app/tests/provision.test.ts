import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import { importiereAbrechnung, ladeAbrechnung, ladeAbrechnungen, markiereAusgezahlt, pruefeAbrechnung, summen, alleAbrechnungen } from '../src/lib/provision.ts';

const ZEILE = {
  monat: '2026-10', betragCent: 24500, art: 'einmalig', text: 'Zahlungseingang', nummer: '2026-0007',
  slug: 'muster-baeckerei', kunde: 'Muster Bäckerei', grundlageCent: 70000, zahlungIso: '2026-10-14', leistungsmonat: null,
};
const HOSTING = { ...ZEILE, monat: '2026-12', betragCent: 1365, art: 'hosting', text: 'Hosting, 1. bezahlter Monat', nummer: '2026-0008', grundlageCent: 3900, entstanden: '2026-10' };

function abrechnung(extra: Record<string, unknown> = {}) {
  return {
    format: 1, monat: '2026-10', vertriebler: 'anna', name: 'Anna', erstellt: '2026-11-03', auszahlungZum: '2026-11-05',
    zeilen: [ZEILE], vortragCent: 0, summeCent: 24500, auszahlungCent: 24500, neuerVortragCent: 0,
    aufgelaufen: [HOSTING], aufgelaufenCent: 1365, hinweise: [],
    ...extra,
  };
}

describe('Abrechnung pruefen', () => {
  it('nimmt eine gueltige Datei an', () => {
    const { abrechnung: a, fehler } = pruefeAbrechnung(abrechnung());
    expect(fehler).toEqual([]);
    expect(a?.zeilen[0].betragCent).toBe(24500);
    expect(a?.aufgelaufenCent).toBe(1365);
  });
  it('meldet Format, Monat, Slug und unstimmige Summen', () => {
    expect(pruefeAbrechnung(abrechnung({ format: 2 })).fehler.join(' ')).toMatch(/format/);
    expect(pruefeAbrechnung(abrechnung({ monat: '2026-13' })).fehler.join(' ')).toMatch(/monat/);
    expect(pruefeAbrechnung(abrechnung({ vertriebler: 'Anna Müller' })).fehler.join(' ')).toMatch(/vertriebler/);
    expect(pruefeAbrechnung(abrechnung({ summeCent: 1 })).fehler.join(' ')).toMatch(/summeCent/);
    expect(pruefeAbrechnung(abrechnung({ auszahlungCent: 1 })).fehler.join(' ')).toMatch(/auszahlungCent/);
    expect(pruefeAbrechnung(abrechnung({ zeilen: [{ ...ZEILE, betragCent: 12.5 }] })).fehler.join(' ')).toMatch(/betragCent/);
    expect(pruefeAbrechnung('nix').abrechnung).toBeNull();
  });
  it('rechnet Vortrag in die Auszahlung ein', () => {
    const { fehler } = pruefeAbrechnung(abrechnung({ vortragCent: -30000, auszahlungCent: 0, neuerVortragCent: -5500 }));
    expect(fehler).toEqual([]);
  });
});

describe('Import und Sichtbarkeit', () => {
  let db: Db;
  let annaId: string;
  beforeAll(async () => {
    db = await neueDb();
    annaId = (await vertriebler(db, 'Anna', 'anna')).id;
    await vertriebler(db, 'Bert', 'bert');
  });
  afterAll(() => db.close());

  it('importiert, ersetzt denselben Monat und trennt nach Slug', async () => {
    const a = pruefeAbrechnung(abrechnung()).abrechnung!;
    const erst = await importiereAbrechnung(db, a, annaId);
    expect(erst.ersetzt).toBe(false);
    const zweit = await importiereAbrechnung(db, { ...a, summeCent: 24500 }, annaId);
    expect(zweit.ersetzt).toBe(true);
    expect(zweit.id).toBe(erst.id);
    await importiereAbrechnung(db, { ...a, monat: '2026-11', zeilen: [], summeCent: 0, auszahlungCent: 0, aufgelaufen: [], aufgelaufenCent: 0 }, annaId);
    await importiereAbrechnung(db, { ...a, vertriebler: 'bert', name: 'Bert' }, annaId);

    const annas = await ladeAbrechnungen(db, 'anna');
    expect(annas.map((x) => x.monat)).toEqual(['2026-11', '2026-10']);
    const berts = await ladeAbrechnungen(db, 'bert');
    expect(berts.length).toBe(1);
    expect(await ladeAbrechnung(db, 'bert', '2026-11')).toBeNull();
    expect(await ladeAbrechnung(db, 'niemand', '2026-10')).toBeNull();
    expect((await ladeAbrechnung(db, 'anna', '2026-10'))?.zeilen[0].kunde).toBe('Muster Bäckerei');
    expect((await alleAbrechnungen(db)).length).toBe(3);
  });

  it('summiert entstanden, ausgezahlt, offen und aufgelaufen', async () => {
    let annas = await ladeAbrechnungen(db, 'anna');
    expect(summen(annas)).toEqual({ entstandenCent: 24500, ausgezahltCent: 0, offenCent: 24500, aufgelaufenCent: 0 });
    await markiereAusgezahlt(db, annas.find((x) => x.monat === '2026-10')!.id, '2026-11-05');
    annas = await ladeAbrechnungen(db, 'anna');
    expect(annas.find((x) => x.monat === '2026-10')?.ausgezahltAm).toBe('2026-11-05');
    expect(summen(annas)).toMatchObject({ ausgezahltCent: 24500, offenCent: 0 });
  });
});
