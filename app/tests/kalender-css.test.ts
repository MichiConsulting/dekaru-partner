// Kalender-CSS: jede benutzte Variable gibt es in global.css, Farben in hell
// und dunkel. Eine fehlende Variable ergab frueher schwarze Schrift auf
// dunkelgrauem Grund; dieser Test faengt das ab. Dazu die Kontraste der
// Text- und Flaechenpaare im Kalender nach WCAG (mindestens 4,5:1, Symbole
// und Randlinien mindestens 3:1).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const lies = (pfad: string) => readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), 'utf8');
const global = lies('../src/styles/global.css');
const kalender = lies('../src/styles/kalender.css');

function block(selektor: string): Map<string, string> {
  const start = global.indexOf(selektor);
  const auf = global.indexOf('{', start);
  const zu = global.indexOf('}', auf);
  const karte = new Map<string, string>();
  for (const t of global.slice(auf + 1, zu).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) karte.set(t[1], t[2].trim());
  return karte;
}

const hell = block(':root {');
const dunkel = block(":root[data-theme='dark']");
const dunkelSystem = block(":root:not([data-theme='light'])");

/** Variablen, die kalender.css selbst setzt (Raster-Masse, Lage der Termine). */
function lokaleVariablen(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((t) => t[1]));
}

describe('kalender.css nutzt nur vorhandene Variablen', () => {
  const benutzt = new Set([...kalender.matchAll(/var\((--[a-z0-9-]+)/g)].map((t) => t[1]));
  // Diese setzt das Markup per style-Attribut (Spalten, Stunden, Lage).
  const ausMarkup = new Set(['--tage', '--stunden', '--i', '--oben', '--hoehe', '--spur', '--spuren', '--spalte-min']);
  const lokal = lokaleVariablen(kalender);

  it('findet Variablen', () => {
    expect(benutzt.size).toBeGreaterThan(15);
  });

  for (const name of benutzt) {
    it(`${name} ist definiert`, () => {
      const vorhanden = hell.has(name) || lokal.has(name) || ausMarkup.has(name);
      expect(vorhanden, `${name} fehlt in global.css`).toBe(true);
    });
  }

  it('jede benutzte Farbvariable gibt es auch in beiden dunklen Bloecken', () => {
    const farben = [...benutzt].filter((n) => /^#|^rgba?\(/.test(hell.get(n) ?? ''));
    expect(farben.length).toBeGreaterThan(8);
    for (const n of farben) {
      expect(dunkel.has(n), `${n} fehlt in [data-theme='dark']`).toBe(true);
      expect(dunkelSystem.has(n), `${n} fehlt im prefers-color-scheme-Block`).toBe(true);
    }
  });
});

function luminanz(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Keine Hex-Farbe: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function kontrast(a: string, b: string): number {
  const [x, y] = [luminanz(a), luminanz(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('Kontraste im Kalender', () => {
  // [Vordergrund, Hintergrund, Mindestwert]
  const paare: [string, string, number][] = [
    ['--text', '--kal-termin-bg', 4.5],
    ['--text', '--kal-wv-bg', 4.5],
    ['--text', '--surface', 4.5],
    ['--text', '--bg', 4.5],
    ['--text-muted', '--surface', 4.5],
    ['--text-muted', '--bg', 4.5],
    ['--text-muted', '--kal-termin-bg', 4.5],
    ['--text-muted', '--kal-wv-bg', 4.5],
    ['--on-accent', '--accent', 4.5],
    ['--bg', '--text', 4.5],
    ['--accent', '--surface', 4.5],
    ['--accent', '--bg', 4.5],
    // Symbole, Punkte und Randlinien: Grafik, 3:1.
    ['--kal-termin-rand', '--kal-termin-bg', 3],
    ['--kal-wv-rand', '--kal-wv-bg', 3],
    ['--kal-termin-rand', '--surface', 3],
    ['--kal-wv-rand', '--surface', 3],
  ];
  for (const [modus, karte] of [
    ['hell', hell],
    ['dunkel', dunkel],
  ] as const) {
    for (const [vorne, hinten, min] of paare) {
      it(`${modus}: ${vorne} auf ${hinten} mindestens ${min}:1`, () => {
        const wert = kontrast(karte.get(vorne)!, karte.get(hinten)!);
        expect(wert, `${vorne} auf ${hinten} im Modus ${modus}: ${wert.toFixed(2)}`).toBeGreaterThanOrEqual(min);
      });
    }
  }
});
