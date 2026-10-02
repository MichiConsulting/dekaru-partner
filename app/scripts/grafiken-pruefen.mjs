#!/usr/bin/env node
// Misst den Text in allen Grafiken im Browser, so wie das Portal sie zeigt.
//
//   npm run pruefe-grafiken
//   node scripts/grafiken-pruefen.mjs [--breite-lernen 299] [--breite-kapitel 800] [--json datei]
//
// Fuer jede SVG unter ../inhalt/lernen/grafiken/ (inline in der Lernkarte,
// hell und dunkel) und ../inhalt/grafiken/ (als Bild, Portalschriften und
// Fallback system-ui) wird jeder <text>/<tspan> mit getBBox() vermessen:
//   (a) mindestens 4 Einheiten Rand zur viewBox,
//   (b) mindestens 3 Einheiten Abstand zum umgebenden Kasten (rect oder
//       gefuellter path, in dem die Zeile beginnt),
//   (c) keine Ueberlappung zweier Texte,
//   (d) Schriftgroesse auf dem Bildschirm bei 375 px Viewport mindestens
//       11 px (Lerngrafik 299 px breit, Kapitelgrafik 800 px Mindestbreite).
// Exit-Code 1 bei Verstoessen. tests/grafiken.test.ts macht dieselbe Pruefung
// als Naeherung ohne Browser; dieses Script ist der Massstab.
//
// Playwright mit Chromium wird gesucht wie beim PDF-Build: lokal in
// node_modules, dann global (npm root -g), dann ueber PLAYWRIGHT_DIR.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INHALT = resolve(APP, '..', 'inhalt');
const FONTS = join(APP, 'node_modules', '@fontsource');

const ARGS = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 ? ARGS[i + 1] : fallback;
};
const BREITE_LERNEN = Number(arg('breite-lernen', 299));
const BREITE_KAPITEL = Number(arg('breite-kapitel', 800));
const JSON_AUS = arg('json', null);
const RAND_VIEWBOX = 4;
const RAND_KASTEN = 3;
const MIN_PX = 11;

const ORDNER = [
  { name: 'lernen', pfad: join(INHALT, 'lernen', 'grafiken'), breite: BREITE_LERNEN, modi: ['hell', 'dunkel'] },
  { name: 'kapitel', pfad: join(INHALT, 'grafiken'), breite: BREITE_KAPITEL, modi: ['hell', 'fallback'] },
];

async function ladePlaywright() {
  const kandidaten = [join(APP, 'node_modules', 'playwright'), process.env.PLAYWRIGHT_DIR];
  try {
    kandidaten.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch {
    // kein npm im Pfad, dann eben nicht
  }
  for (const dir of kandidaten) {
    if (dir && existsSync(join(dir, 'index.mjs'))) return import(pathToFileURL(join(dir, 'index.mjs')).href);
  }
  console.error('Playwright nicht gefunden. npm install -g playwright && npx playwright install chromium, oder PLAYWRIGHT_DIR setzen.');
  process.exit(2);
}

function fontFace(familie, ordner, gewicht) {
  const datei = join(FONTS, ordner, 'files', `${ordner}-latin-${gewicht}-normal.woff2`);
  return `@font-face{font-family:"${familie}";font-weight:${gewicht};font-style:normal;src:url("${pathToFileURL(datei).href}") format("woff2")}`;
}

// Farbvariablen wie in global.css, hell und dunkel.
const CSS = `
${[400, 500, 600, 700].map((g) => fontFace('Inter', 'inter', g)).join('\n')}
${[400, 500, 600, 700].map((g) => fontFace('Space Grotesk', 'space-grotesk', g)).join('\n')}
:root{--lk-paper:#fff;--lk-f1:#ece6da;--lk-f2:#e3e8ec;--lk-f3:#cfcfc9;--lk-ink:#141414;--lk-muted:#5f5f5f;--lk-line:#b8b8b8;--lk-warn:#8a5a00;--font-body:'Inter',system-ui,sans-serif}
:root.dunkel{--lk-paper:#1f1f1f;--lk-f1:#2d2823;--lk-f2:#222a31;--lk-f3:#454545;--lk-ink:#f2f2f2;--lk-muted:#a8a8a8;--lk-line:#4a4a4a;--lk-warn:#e0b24a;color:#f2f2f2;background:#121212}
:root.fallback svg, :root.fallback svg *{font-family:system-ui,sans-serif !important}
body{margin:0;padding:16px;font-family:var(--font-body);color:#141414}
.w svg{display:block;width:100%;height:auto;font-family:var(--font-body)}
`;

function seite(name, svg, breite) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="w" data-datei="${name}" style="width:${breite}px">${svg.replace(/<\?xml[^>]*\?>\s*/, '')}</div>
</body></html>`;
}

// Laeuft im Browser: misst alle Texte und Kaesten der einen SVG auf der Seite.
const MESSE = `(() => {
  const wrap = document.querySelector('body > .w');
  const svg = wrap.querySelector('svg');
  if (!svg) return { datei: wrap.dataset.datei, fehler: 'kein <svg> gefunden', vb: { x: 0, y: 0, w: 1, h: 1 }, texte: [] };
  const vb = svg.viewBox.baseVal;
  // getBBox liefert lokale Koordinaten ohne transform der Eltern, deshalb
  // alles in das Koordinatensystem der Wurzel umrechnen.
  const inWurzel = (el) => {
    const b = el.getBBox();
    const m = svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
    const ecken = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    const xs = ecken.map((p) => p.x), ys = ecken.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, m };
  };
  const kaesten = [];
  for (const el of svg.querySelectorAll('rect, path, circle, ellipse, polygon')) {
    const cs = getComputedStyle(el);
    if (cs.fill === 'none' || cs.display === 'none') continue;
    let b; try { b = inWurzel(el); } catch { continue; }
    if (b.width < 30 || b.height < 12) continue;
    kaesten.push({ el, m: b.m, tag: el.tagName, klasse: el.getAttribute('class') || '', x: b.x, y: b.y, w: b.width, h: b.height, flaeche: b.width * b.height });
  }
  const texte = [];
  for (const t of svg.querySelectorAll('text')) {
    const spans = Array.from(t.querySelectorAll('tspan'));
    for (const el of spans.length ? spans : [t]) {
      const inhalt = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!inhalt) continue;
      let b; try { b = inWurzel(el); } catch { continue; }
      if (b.width === 0) continue;
      const cs = getComputedStyle(el);
      const anker = cs.textAnchor;
      const px = anker === 'middle' ? b.x + b.width / 2 : anker === 'end' ? b.x + b.width - 1 : b.x + 1;
      const py = b.y + b.height / 2;
      let kasten = null;
      for (const k of kaesten) {
        if (px < k.x || px > k.x + k.w || py < k.y || py > k.y + k.h) continue;
        if (k.tag === 'path' && k.el.isPointInFill && !k.el.isPointInFill(new DOMPoint(px, py).matrixTransform(k.m.inverse()))) continue;
        if (!kasten || k.flaeche < kasten.flaeche) kasten = k;
      }
      texte.push({ text: inhalt, x: b.x, y: b.y, w: b.width, h: b.height, fs: parseFloat(cs.fontSize),
        kasten: kasten ? { tag: kasten.tag, klasse: kasten.klasse, x: kasten.x, y: kasten.y, w: kasten.w, h: kasten.h } : null });
    }
  }
  return { datei: wrap.dataset.datei, vb: { x: vb.x, y: vb.y, w: vb.width, h: vb.height }, texte };
})()`;

const r1 = (n) => Math.round(n * 10) / 10;

function pruefe(messung, breite) {
  if (messung.fehler) return [{ art: 'DATEI', meldung: messung.fehler }];
  const { vb, texte } = messung;
  const skala = breite / vb.w;
  const aus = [];
  texte.forEach((t, i) => {
    const kurz = `"${t.text.length > 40 ? t.text.slice(0, 38) + '…' : t.text}"`;
    const raender = { links: t.x - vb.x, rechts: vb.x + vb.w - (t.x + t.w), oben: t.y - vb.y, unten: vb.y + vb.h - (t.y + t.h) };
    for (const [wo, wert] of Object.entries(raender)) {
      if (wert < RAND_VIEWBOX) aus.push({ art: 'VIEWBOX', meldung: `${kurz} hat ${wo} nur ${r1(wert)} Rand zum Bildrand (mindestens ${RAND_VIEWBOX}).` });
    }
    if (t.kasten) {
      const k = t.kasten;
      const innen = { links: t.x - k.x, rechts: k.x + k.w - (t.x + t.w), oben: t.y - k.y, unten: k.y + k.h - (t.y + t.h) };
      for (const [wo, wert] of Object.entries(innen)) {
        if (wert < RAND_KASTEN) {
          const name = `${k.tag}${k.klasse ? '.' + k.klasse.replace(/\s+/g, '.') : ''} ${r1(k.x)},${r1(k.y)} ${r1(k.w)}x${r1(k.h)}`;
          aus.push({ art: 'KASTEN', meldung: `${kurz} ${wert < 0 ? `ragt ${r1(-wert)} ueber den Kasten hinaus` : `hat nur ${r1(wert)} Abstand zum Kasten`} (${wo}, ${name}).` });
        }
      }
    }
    for (let j = i + 1; j < texte.length; j++) {
      const u = texte[j];
      const ix = Math.min(t.x + t.w, u.x + u.w) - Math.max(t.x, u.x);
      const iy = Math.min(t.y + t.h, u.y + u.h) - Math.max(t.y, u.y);
      if (ix > 0.5 && iy > 0.5) aus.push({ art: 'UEBERLAPPUNG', meldung: `${kurz} ueberlappt "${u.text.slice(0, 38)}" um ${r1(ix)}x${r1(iy)}.` });
    }
    const px = t.fs * skala;
    if (px < MIN_PX - 0.05) aus.push({ art: 'SCHRIFT', meldung: `${kurz} hat ${t.fs} Einheiten = ${r1(px)} px bei ${breite} px Breite (mindestens ${MIN_PX}).` });
  });
  return aus;
}

const { chromium } = await ladePlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
const ergebnis = {};
for (const o of ORDNER) {
  if (!existsSync(o.pfad)) continue;
  for (const name of readdirSync(o.pfad).filter((n) => n.endsWith('.svg')).sort()) {
    const svg = readFileSync(join(o.pfad, name), 'utf8');
    const schluessel = `${o.name}/${name}`;
    ergebnis[schluessel] = { verstoesse: {} };
    for (const modus of o.modi) {
      // Jede SVG auf einer eigenen Seite, weil <style> in SVGs dokumentweit gilt.
      await page.setContent(seite(name, svg, o.breite), { waitUntil: 'load' });
      await page.evaluate((m) => {
        document.documentElement.className = m;
        return document.fonts.ready;
      }, modus);
      const messung = await page.evaluate(MESSE);
      ergebnis[schluessel].texte = messung.texte.length;
      ergebnis[schluessel].vb = messung.vb;
      ergebnis[schluessel].verstoesse[modus] = pruefe(messung, o.breite);
    }
  }
}
await browser.close();

let gesamt = 0;
for (const [datei, e] of Object.entries(ergebnis)) {
  const gesehen = new Map();
  for (const [modus, liste] of Object.entries(e.verstoesse)) {
    for (const v of liste) {
      const k = `${v.art}|${v.meldung}`;
      if (!gesehen.has(k)) gesehen.set(k, { ...v, modi: [] });
      gesehen.get(k).modi.push(modus);
    }
  }
  const liste = [...gesehen.values()];
  gesamt += liste.length;
  console.log(`${datei}  (viewBox ${e.vb.w}x${e.vb.h}, ${e.texte} Texte): ${liste.length === 0 ? 'ok' : liste.length + ' Verstoesse'}`);
  for (const v of liste) console.log(`  [${v.art}] ${v.meldung}${v.modi.length < 2 ? ' [' + v.modi.join(',') + ']' : ''}`);
}
console.log(`\nGesamt: ${gesamt} Verstoesse.`);
if (JSON_AUS) writeFileSync(JSON_AUS, JSON.stringify(ergebnis, null, 2));
process.exit(gesamt > 0 ? 1 : 0);
