import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analysiereSvg, pruefeGrafik, schaetzeBreite } from '../src/lib/grafik-pruefung.ts';

const INHALT = fileURLToPath(new URL('../../inhalt/', import.meta.url));
const LERNEN = `${INHALT}lernen/grafiken/`;
const KAPITEL = `${INHALT}grafiken/`;

// Breite der Grafik auf dem Bildschirm bei 375 px Viewport: die Lerngrafik
// liegt inline in der Karte (299 px), die Kapitelgrafik hat als Bild eine
// Mindestbreite von 800 px zum Schieben (lernen.css, global.css).
const BREITE_LERNEN = 299;
const BREITE_KAPITEL = 800;

const svgs = (ordner: string) => (existsSync(ordner) ? readdirSync(ordner).filter((n) => n.endsWith('.svg')).sort() : []);

describe('Naeherung fuer SVG-Text', () => {
  it('schaetzt Breiten in der Groessenordnung von Inter', () => {
    // Gemessen in Chromium mit Inter 12px: "Der Betrieb weiß vor dem Start," = 180.
    const b = schaetzeBreite('Der Betrieb weiß vor dem Start,', 12, false);
    expect(b).toBeGreaterThan(175);
    expect(b).toBeLessThan(205);
    expect(schaetzeBreite('Festpreis', 12, true)).toBeGreaterThan(schaetzeBreite('Festpreis', 12, false));
  });

  it('liest viewBox, Kaesten, Klassen und verschobene Gruppen', () => {
    const svg = `<svg viewBox="0 0 200 100" font-size="12">
      <style>.h{font-weight:700}.s{font-size:11px}.r{fill:none;stroke:#000}</style>
      <rect class="r" x="0" y="0" width="200" height="100"/>
      <g transform="translate(20 10)">
        <rect x="0" y="0" width="100" height="40"/>
        <text class="h s" x="8" y="20">Hallo</text>
      </g>
    </svg>`;
    const a = analysiereSvg(svg);
    expect(a.viewBox).toMatchObject({ w: 200, h: 100 });
    expect(a.kaesten).toHaveLength(1);
    expect(a.kaesten[0]).toMatchObject({ x: 20, y: 10, w: 100, h: 40 });
    expect(a.texte).toHaveLength(1);
    expect(a.texte[0]).toMatchObject({ text: 'Hallo', fs: 11 });
    expect(a.texte[0].x).toBe(28);
  });

  it('meldet eine Zeile, die aus ihrem Kasten ragt, und eine am Bildrand', () => {
    const svg = `<svg viewBox="0 0 120 60" font-size="12">
      <rect x="4" y="4" width="60" height="30"/>
      <text x="10" y="22">Dieser Satz ist viel zu lang</text>
      <text x="4" y="56">Rand</text>
    </svg>`;
    const befunde = pruefeGrafik(svg, { breitePx: 299 });
    expect(befunde.some((b) => b.startsWith('[KASTEN]') && b.includes('ragt'))).toBe(true);
    expect(befunde.some((b) => b.startsWith('[VIEWBOX]'))).toBe(true);
  });

  it('meldet zu kleine Schrift und uebereinander liegende Zeilen', () => {
    const svg = `<svg viewBox="0 0 400 60" font-size="12">
      <text x="10" y="20">Eins</text>
      <text x="12" y="24">Zwei</text>
    </svg>`;
    const befunde = pruefeGrafik(svg, { breitePx: 299 });
    expect(befunde.some((b) => b.startsWith('[SCHRIFT]'))).toBe(true);
    expect(befunde.some((b) => b.startsWith('[UEBERLAPPUNG]'))).toBe(true);
  });

  it('laesst eine saubere Grafik durch', () => {
    const svg = `<svg viewBox="0 0 320 60" font-size="12">
      <rect x="4" y="4" width="312" height="52"/>
      <text x="16" y="24">Passt gut hinein.</text>
      <text x="16" y="44" text-anchor="start">Zweite Zeile.</text>
    </svg>`;
    expect(pruefeGrafik(svg, { breitePx: 299 })).toEqual([]);
  });
});

describe('Die echten Grafiken', () => {
  it('Lerngrafiken: jede Zeile passt in Kasten und Bild, Schrift mindestens 11 px auf dem Handy', () => {
    for (const datei of svgs(LERNEN)) {
      const befunde = pruefeGrafik(readFileSync(LERNEN + datei, 'utf8'), { breitePx: BREITE_LERNEN });
      expect(befunde, datei).toEqual([]);
    }
  });

  it('Kapitelgrafiken: jede Zeile passt in Kasten und Bild, Schrift mindestens 11 px bei 800 px Breite', () => {
    for (const datei of svgs(KAPITEL)) {
      const befunde = pruefeGrafik(readFileSync(KAPITEL + datei, 'utf8'), { breitePx: BREITE_KAPITEL });
      expect(befunde, datei).toEqual([]);
    }
  });

  it('Lerngrafiken: Styles sind an die eigene ID gebunden, weil mehrere auf einer Seite liegen', () => {
    const ids = new Set<string>();
    for (const datei of svgs(LERNEN)) {
      const svg = readFileSync(LERNEN + datei, 'utf8');
      const id = /<svg[^>]*\sid="([\w-]+)"/.exec(svg)?.[1];
      expect(id, `${datei}: <svg> braucht eine id`).toBeTruthy();
      expect(ids.has(id!), `${datei}: id ${id} doppelt`).toBe(false);
      ids.add(id!);
      const css = /<style[^>]*>([\s\S]*?)<\/style>/.exec(svg)?.[1] ?? '';
      for (const regel of css.matchAll(/([^{}]+)\{/g)) {
        for (const selektor of regel[1].split(',')) {
          expect(selektor.trim(), `${datei}: Selektor "${selektor.trim()}"`).toMatch(new RegExp(`^#${id}\\b`));
        }
      }
    }
  });
});
