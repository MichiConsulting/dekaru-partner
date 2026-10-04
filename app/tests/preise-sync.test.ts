// src/data/preise.json ist abgeleitet, nie Quelle. Dieser Test schlaegt an,
// wenn die eingecheckte Datei von preise.ts, hosting.ts (dekaru-website) oder
// leistungen.einmalig (dekaru-rechnungen) abweicht. Dann: npm run preise-sync.
// Fehlen die Quell-Repos (fremder Rechner), wird nur die Struktur geprueft.
import { describe, expect, it } from 'vitest';
import { leseQuellen, leseZiel, quellenVorhanden, stimmtUeberein } from '../scripts/preise-sync.mjs';
import preise from '../src/data/preise.json';

const quellenDa = quellenVorhanden();

describe('preise.json Sync', () => {
  it('die eingecheckte Datei hat alle Bloecke', () => {
    expect(preise.pakete.map((p) => p.schluessel)).toEqual(['klein', 'mittel', 'gross']);
    expect(preise.gruppen.length).toBeGreaterThan(0);
    expect(preise.hosting.tarife.map((t) => t.id)).toEqual(['start', 'basis', 'plus']);
    expect(preise.hosting.gratisMonate).toBeGreaterThan(0);
    expect(preise.zusatzleistungen.length).toBeGreaterThan(0);
    expect(preise.funktion.name.length).toBeGreaterThan(0);
    expect(preise.erzeugt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.skipIf(!quellenDa)('stimmt mit den Quellen in dekaru-website und dekaru-rechnungen ueberein', () => {
    const quelle = leseQuellen();
    const ziel = leseZiel();
    expect(stimmtUeberein(quelle, ziel), 'src/data/preise.json weicht von den Quellen ab. Bitte npm run preise-sync ausfuehren und die Datei committen.').toBe(
      true,
    );
  });

  it('erkennt eine Abweichung', () => {
    const ziel = leseZiel();
    const veraendert = structuredClone(ziel);
    veraendert.pakete[0].preis += 1;
    expect(stimmtUeberein(veraendert, ziel)).toBe(false);
    // Der Zeitstempel allein ist keine Abweichung.
    expect(stimmtUeberein({ ...ziel, erzeugt: '1999-01-01' }, ziel)).toBe(true);
  });
});
