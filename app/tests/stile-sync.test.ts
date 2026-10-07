// src/data/stile.json ist abgeleitet, nie Quelle. Dieser Test schlaegt an,
// wenn die eingecheckte Datei von dekaru-templates/_core/stile/stile.mjs
// abweicht. Dann: npm run stile-sync. Solange die Stile nicht in main des
// Template-Repos gemergt sind, liest der Sync aus dem Branch "stile"
// (DEKARU_STILE_REF). Fehlt beides (Vercel, fremder Rechner), wird nur die
// Struktur geprueft.
import { describe, expect, it } from 'vitest';
import { findeQuelle, ladeModul, leseQuelle, leseZiel, quelleVorhanden, stimmtUeberein } from '../scripts/stile-sync.mjs';
import stileDaten from '../src/data/stile.json';
import texte from '../../inhalt/stile.json';
import { ALLE_PALETTEN, PALETTEN_BRANCHEN, findePalette } from '../src/lib/paletten.ts';
import { ALLE_STILE, BEWEGUNGSSTUFEN, BEWEGUNG_STANDARD, STANDARD_JE_BRANCHE, standardStil, stilZurPalette } from '../src/lib/stile.ts';

const LANGER_STRICH = /[–—]/;

describe('stile.json Sync', () => {
  it('ist als abgeleitet gekennzeichnet und kennt sechs Stile, vier Bewegungsstufen und alle zehn Branchen', () => {
    expect(stileDaten._hinweis).toMatch(/Nicht von Hand aendern/);
    expect(stileDaten.feld).toEqual({ stil: 'stil', bewegung: 'bewegung' });
    expect(stileDaten.erzeugt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stileDaten.stile.map((s) => s.kennung).sort()).toEqual(['feuilleton', 'frisch', 'plakat', 'raster', 'stille', 'werkstatt']);
    expect(stileDaten.bewegung.stufen).toEqual(['aus', 'ruhig', 'lebendig', 'verspielt']);
    expect(BEWEGUNG_STANDARD).toBe('ruhig');
    expect(Object.keys(STANDARD_JE_BRANCHE).sort()).toEqual(PALETTEN_BRANCHEN.map((b) => b.id).sort());
  });

  it('inhalt/stile.json hat Texte fuer genau die Stile und Stufen aus dem Sync', () => {
    expect(Object.keys(texte.stile).sort()).toEqual(stileDaten.stile.map((s) => s.kennung).sort());
    expect(Object.keys(texte.bewegung).sort()).toEqual([...stileDaten.bewegung.stufen].sort());
    for (const s of ALLE_STILE) {
      expect(s.beschreibung, s.kennung).not.toBe('');
      expect(s.leitidee, s.kennung).not.toBe('');
      expect(s.passtZu, s.kennung).not.toBe('');
    }
    for (const b of BEWEGUNGSSTUFEN) expect(b.erklaerung, b.wert).not.toBe('');
  });

  it('die Texte haben keine langen Gedankenstriche und keinen Ortsbezug', () => {
    const alles = JSON.stringify(texte);
    expect(alles).not.toMatch(LANGER_STRICH);
    expect(alles).not.toMatch(/lokal|regional|aus der Region/i);
  });

  it.skipIf(!quelleVorhanden())('stimmt mit dekaru-templates ueberein', async () => {
    expect(stimmtUeberein(await leseQuelle(), leseZiel()), 'src/data/stile.json weicht ab. Bitte npm run stile-sync ausfuehren und die Datei committen.').toBe(true);
  });

  it('erkennt eine Abweichung, aber nicht Zeitstempel und Herkunft', () => {
    const ziel = leseZiel();
    const veraendert = structuredClone(ziel);
    veraendert.stile[0].modi = ['hell', 'dunkel'];
    expect(stimmtUeberein(veraendert, ziel)).toBe(false);
    expect(stimmtUeberein({ ...ziel, erzeugt: '1999-01-01', quelle: 'anderswo' }, ziel)).toBe(true);
  });

  // Der eigentliche Abgleich der Regeln: jede Branche, jeder Stil, ohne
  // Palette und mit jeder Palette, gegen pruefeStil aus dem Template-System.
  it.skipIf(!quelleVorhanden())('Vertraeglichkeit und Standard entsprechen pruefeStil aus dem Template-System', async () => {
    const m = await ladeModul(findeQuelle()!.text);
    const paletten = [null, ...ALLE_PALETTEN];
    let geprueft = 0;
    for (const industry of Object.keys(STANDARD_JE_BRANCHE)) {
      for (const p of paletten) {
        const modusPalette = p ? p.modus : undefined;
        const standard = m.pruefeStil({ industry, stil: undefined, palette: p?.code, modusPalette });
        expect(standard.fehler, `${industry} ${p?.code}`).toEqual([]);
        expect(standardStil(industry, p)?.kennung, `${industry} ${p?.code}`).toBe(standard.stil);
        for (const s of ALLE_STILE) {
          const echt = m.pruefeStil({ industry, stil: s.kennung, palette: p?.code, modusPalette });
          const portal = stilZurPalette(industry, p, s.kennung);
          expect(portal !== null, `${industry} ${s.kennung} ${p?.code ?? 'ohne Palette'}: ${echt.fehler.join(' ')}`).toBe(echt.fehler.length > 0);
          geprueft += 1;
        }
      }
    }
    expect(geprueft).toBeGreaterThan(6000);
  });
});

describe('Vertraeglichkeit von Stil und Palette', () => {
  const dunkel = ALLE_PALETTEN.find((p) => p.modus === 'dunkel')!;
  const hell = findePalette('HW-2')!;

  it('meldet einen hellen Stil mit dunkler Palette', () => {
    expect(stilZurPalette('handwerk', dunkel, 'werkstatt')).toMatch(/Werkstatt gibt es nur hell.*ist dunkel/);
    expect(stilZurPalette('handwerk', dunkel, 'raster')).toBeNull();
    expect(stilZurPalette('handwerk', hell, 'werkstatt')).toBeNull();
  });

  it('erlaubt in tattoo nur Stile mit dunkler Fassung, auch mit heller Palette', () => {
    expect(stilZurPalette('tattoo', hell, 'feuilleton')).toMatch(/dunkles Design/);
    expect(stilZurPalette('tattoo', null, 'frisch')).toMatch(/dunkles Design/);
    expect(stilZurPalette('tattoo', hell, 'plakat')).toBeNull();
  });

  it('Standard und offen passen immer', () => {
    expect(stilZurPalette('handwerk', dunkel, 'standard')).toBeNull();
    expect(stilZurPalette('tattoo', hell, 'offen')).toBeNull();
    expect(standardStil('handwerk', hell)?.kennung).toBe('werkstatt');
    expect(standardStil('handwerk', dunkel)?.kennung).toBe('raster');
    expect(standardStil('tattoo', null)?.kennung).toBe('plakat');
  });
});
