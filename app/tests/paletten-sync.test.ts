// src/data/paletten.json ist abgeleitet, nie Quelle. Dieser Test schlaegt an,
// wenn die eingecheckte Datei von dekaru-templates/_system/paletten.json
// abweicht. Dann: npm run paletten-sync. Fehlt das Template-Repo (Vercel,
// fremder Rechner), wird nur die Struktur geprueft.
import { describe, expect, it } from 'vitest';
import { leseQuelle, leseZiel, quelleVorhanden, stimmtUeberein } from '../scripts/paletten-sync.mjs';
import paletten from '../src/data/paletten.json';

const HAUSFARBEN = ['#7b1e2b', '#6e1a26', '#cc7079', '#862532', '#551520'];

describe('paletten.json Sync', () => {
  it('ist als abgeleitet gekennzeichnet und hat alle zehn Template-Branchen', () => {
    expect(paletten._hinweis).toMatch(/Nicht von Hand aendern/);
    expect(paletten.quelle).toBe('dekaru-templates/_system/paletten.mjs');
    expect(paletten.feld).toBe('palette');
    expect(paletten.erzeugt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(paletten.branchen.map((b) => b.id).sort()).toEqual(
      ['dienstleister', 'fitness', 'garten', 'gastro', 'gesundheit', 'handwerk', 'reinigung', 'tattoo', 'tierbetreuung', 'umzug'],
    );
    for (const b of paletten.branchen) {
      expect(b.paletten.length).toBeGreaterThanOrEqual(4);
      expect(b.paletten[0].standard).toBe(true);
      expect(b.standard).toBe(b.paletten[0].code);
    }
  });

  it('enthaelt keine dekaru-Hausfarbe', () => {
    for (const b of paletten.branchen) for (const p of b.paletten) for (const v of Object.values(p.farben)) expect(HAUSFARBEN, p.code).not.toContain(v);
  });

  it.skipIf(!quelleVorhanden())('stimmt mit dekaru-templates ueberein', () => {
    expect(stimmtUeberein(leseQuelle(), leseZiel()), 'src/data/paletten.json weicht ab. Bitte npm run paletten-sync ausfuehren und die Datei committen.').toBe(true);
  });

  it('erkennt eine Abweichung, aber nicht den Zeitstempel', () => {
    const ziel = leseZiel();
    const veraendert = structuredClone(ziel);
    veraendert.branchen[0].paletten[1].farben.accent = '#000000';
    expect(stimmtUeberein(veraendert, ziel)).toBe(false);
    expect(stimmtUeberein({ ...ziel, erzeugt: '1999-01-01' }, ziel)).toBe(true);
  });
});
