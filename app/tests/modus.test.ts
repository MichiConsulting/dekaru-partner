// Hell und dunkel: das Init-Skript setzt data-theme nur bei gespeicherter
// Wahl, und global.css hat fuer beide Modi dieselben Variablen.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const initSkript = readFileSync(fileURLToPath(new URL('../public/theme-init.js', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../src/styles/global.css', import.meta.url)), 'utf8');

function fuehreInitAus(gespeichert: string | null, speicherKaputt = false) {
  const attribute = new Map<string, string>();
  const klassen = new Set<string>();
  const sandbox = {
    document: {
      documentElement: {
        setAttribute: (name: string, wert: string) => attribute.set(name, wert),
        classList: { add: (k: string) => klassen.add(k) },
      },
    },
    localStorage: {
      getItem: (schluessel: string) => {
        if (speicherKaputt) throw new Error('gesperrt');
        return schluessel === 'dekaru-theme' ? gespeichert : null;
      },
    },
  };
  runInNewContext(initSkript, sandbox);
  return { attribute, klassen };
}

describe('theme-init.js', () => {
  it('setzt data-theme auf die gespeicherte Wahl', () => {
    expect(fuehreInitAus('dark').attribute.get('data-theme')).toBe('dark');
    expect(fuehreInitAus('light').attribute.get('data-theme')).toBe('light');
  });

  it('laesst data-theme ohne Wahl leer, damit die Systemeinstellung gilt', () => {
    expect(fuehreInitAus(null).attribute.has('data-theme')).toBe(false);
    expect(fuehreInitAus('irgendwas').attribute.has('data-theme')).toBe(false);
  });

  it('markiert den Umschalter als bereit, auch wenn der Speicher gesperrt ist', () => {
    const { klassen, attribute } = fuehreInitAus('dark', true);
    expect(klassen.has('modus-bereit')).toBe(true);
    expect(attribute.has('data-theme')).toBe(false);
  });
});

function variablenIn(block: string): Map<string, string> {
  const karte = new Map<string, string>();
  for (const treffer of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) karte.set(treffer[1], treffer[2].trim());
  return karte;
}

function blockNach(selektor: string): string {
  const start = css.indexOf(selektor);
  expect(start, `Selektor ${selektor} fehlt in global.css`).toBeGreaterThan(-1);
  const klammer = css.indexOf('{', start);
  const ende = css.indexOf('}', klammer);
  return css.slice(klammer + 1, ende);
}

describe('global.css: Farbvariablen fuer hell und dunkel', () => {
  const hell = variablenIn(blockNach(':root {'));
  const dunkelSystem = variablenIn(blockNach(":root:not([data-theme='light'])"));
  const dunkelWahl = variablenIn(blockNach(":root[data-theme='dark']"));
  // Nur Farben. Masse wie --text-h1 oder --space-m gelten in beiden Modi.
  const farben = [...hell.keys()].filter((name) =>
    /^--(bg|surface(-2)?|text(-muted)?|border(-strong)?|accent(-hover|-active)?|on-accent|ok(-bg)?|fehler(-bg)?|focus|lk-[a-z0-9]+|grafik-papier)$/.test(name),
  );

  it('kennt beide Modi und die Systemeinstellung', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
    expect(farben.length).toBeGreaterThan(20);
  });

  it('definiert jede Farbvariable des hellen Modus auch im dunklen', () => {
    for (const name of farben) {
      expect(dunkelWahl.has(name), `${name} fehlt in [data-theme='dark']`).toBe(true);
      expect(dunkelSystem.has(name), `${name} fehlt im prefers-color-scheme-Block`).toBe(true);
    }
  });

  it('haelt die beiden dunklen Bloecke gleich', () => {
    expect([...dunkelWahl.entries()].sort()).toEqual([...dunkelSystem.entries()].sort());
  });

  it('setzt color-scheme je Modus', () => {
    expect(blockNach(':root {')).toMatch(/color-scheme:\s*light/);
    expect(blockNach(":root[data-theme='dark']")).toMatch(/color-scheme:\s*dark/);
  });
});
