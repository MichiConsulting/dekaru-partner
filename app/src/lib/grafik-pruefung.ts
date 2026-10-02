// Naeherungspruefung fuer Text in SVG-Grafiken, ohne Browser.
//
// SVG-Text bricht nicht um: eine zu lange Zeile ragt aus ihrem Kasten oder
// ueber den Bildrand, und niemand merkt es, bis jemand auf dem Handy
// hinsieht. Dieses Modul schaetzt die Breite jeder Textzeile aus
// Zeichenklassen mal Schriftgroesse (gegen Inter kalibriert, Abweichung
// unter zehn Prozent) und prueft:
//   (a) Rand zur viewBox,
//   (b) Abstand zum umgebenden Kasten (dem kleinsten rect, in dem die Zeile
//       beginnt),
//   (c) Ueberlappung zweier Zeilen,
//   (d) Schriftgroesse in Bildschirmpixeln bei der angegebenen Breite.
// Die exakte Messung macht scripts/grafiken-pruefen.mjs im Browser.
//
// Verstanden werden die Konstrukte unserer Grafiken: rect, text, tspan,
// g mit translate(), Klassen aus dem <style>-Block mit font-size,
// font-weight, text-anchor und fill:none, und dieselben Angaben als
// Attribute. Reine Funktionen, keine Abhaengigkeiten.

export interface Kasten {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
}

export interface TextZeile extends Kasten {
  text: string;
  fs: number;
}

export interface Analyse {
  viewBox: Kasten;
  texte: TextZeile[];
  kaesten: Kasten[];
}

export interface PruefOptionen {
  /** Breite der Grafik auf dem Bildschirm in Pixeln (bei 375 px Viewport). */
  breitePx: number;
  minPx?: number;
  randViewBox?: number;
  randKasten?: number;
}

// Zeichenbreiten in em fuer Inter, obere Schranke. Fett etwa 7 % breiter.
const EM = { schmal: 0.28, leer: 0.26, mittel: 0.34, ziffer: 0.63, gross: 0.68, breit: 0.9, klein: 0.56, mw: 0.86, symbol: 0.6 };

function zeichenBreite(zeichen: string): number {
  if (zeichen === ' ') return EM.leer;
  if ("ijl|!.,:;'".includes(zeichen)) return EM.schmal;
  if ('ftrI"()[]-·/'.includes(zeichen)) return EM.mittel;
  if ('MW'.includes(zeichen)) return EM.breit;
  if ('mw'.includes(zeichen)) return EM.mw;
  if (/[0-9]/.test(zeichen)) return EM.ziffer;
  if (/[A-ZÄÖÜ]/.test(zeichen)) return EM.gross;
  if ('€%+ß'.includes(zeichen)) return EM.symbol;
  return EM.klein;
}

/** Geschaetzte Breite einer Zeile in Einheiten, als obere Schranke. */
export function schaetzeBreite(text: string, fs: number, fett: boolean): number {
  let summe = 0;
  for (const zeichen of text) summe += zeichenBreite(zeichen);
  return summe * fs * (fett ? 1.07 : 1) * 1.05;
}

// Oberkante und Unterkante relativ zur Grundlinie, wie getBBox sie liefert.
const OBEN = 0.97;
const UNTEN = 0.24;

interface Klasse {
  fs?: number;
  weight?: number;
  anchor?: string;
  ohneFuellung?: boolean;
}

interface Rahmen {
  dx: number;
  dy: number;
  fs: number;
  weight: number;
  anchor: string;
}

function attribute(roh: string): Record<string, string> {
  const aus: Record<string, string> = {};
  for (const m of roh.matchAll(/([^\s=]+)="([^"]*)"/g)) aus[m[1]] = m[2];
  return aus;
}

function gewicht(wert: string | undefined): number | undefined {
  if (!wert) return undefined;
  if (wert === 'bold') return 700;
  const n = Number(wert);
  return Number.isFinite(n) ? n : undefined;
}

function klassenAusStyle(css: string): Map<string, Klasse> {
  const aus = new Map<string, Klasse>();
  for (const regel of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decl = regel[2];
    const k: Klasse = {};
    const fs = /font-size\s*:\s*([\d.]+)px/.exec(decl);
    if (fs) k.fs = Number(fs[1]);
    const fw = /font-weight\s*:\s*(\w+)/.exec(decl);
    if (fw) k.weight = gewicht(fw[1]);
    const ta = /text-anchor\s*:\s*(start|middle|end)/.exec(decl);
    if (ta) k.anchor = ta[1];
    if (/fill\s*:\s*none/.test(decl)) k.ohneFuellung = true;
    for (const selektor of regel[1].split(',')) {
      const name = /\.([\w-]+)\s*$/.exec(selektor.trim());
      if (!name) continue;
      const alt = aus.get(name[1]) ?? {};
      aus.set(name[1], { ...alt, ...k });
    }
  }
  return aus;
}

function entities(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function anwenden(rahmen: Rahmen, attrs: Record<string, string>, klassen: Map<string, Klasse>): { rahmen: Rahmen; ohneFuellung: boolean } {
  let fs = rahmen.fs;
  let weight = rahmen.weight;
  let anchor = rahmen.anchor;
  let ohneFuellung = attrs.fill === 'none' || /fill\s*:\s*none/.test(attrs.style ?? '');
  const attrFs = Number(attrs['font-size']);
  if (attrFs) fs = attrFs;
  const attrWeight = gewicht(attrs['font-weight']);
  if (attrWeight) weight = attrWeight;
  if (attrs['text-anchor']) anchor = attrs['text-anchor'];
  // Klassen schlagen Attribute, wie im CSS.
  for (const name of (attrs.class ?? '').split(/\s+/).filter(Boolean)) {
    const k = klassen.get(name);
    if (!k) continue;
    if (k.fs) fs = k.fs;
    if (k.weight) weight = k.weight;
    if (k.anchor) anchor = k.anchor;
    if (k.ohneFuellung) ohneFuellung = true;
  }
  let dx = rahmen.dx;
  let dy = rahmen.dy;
  const t = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(attrs.transform ?? '');
  if (t) {
    dx += Number(t[1]);
    dy += Number(t[2]);
  }
  return { rahmen: { dx, dy, fs, weight, anchor }, ohneFuellung };
}

/** Zerlegt eine SVG-Datei in viewBox, Textzeilen und Kaesten. */
export function analysiereSvg(svg: string): Analyse {
  let quelle = svg.replace(/<!--[\s\S]*?-->/g, '');
  const klassen = klassenAusStyle([...quelle.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'));
  quelle = quelle.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<(title|desc)[^>]*>[\s\S]*?<\/\1>/g, '');

  const viewBox: Kasten = { x: 0, y: 0, w: 0, h: 0, name: 'viewBox' };
  const texte: TextZeile[] = [];
  const kaesten: Kasten[] = [];
  const stapel: Rahmen[] = [{ dx: 0, dy: 0, fs: 16, weight: 400, anchor: 'start' }];

  const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(quelle))) {
    const [ganz, schliesst, tag, roh, selbst] = m;
    if (schliesst) {
      if (stapel.length > 1) stapel.pop();
      continue;
    }
    const attrs = attribute(roh);
    const { rahmen, ohneFuellung } = anwenden(stapel[stapel.length - 1], attrs, klassen);

    if (tag === 'svg') {
      const vb = (attrs.viewBox ?? '0 0 0 0').trim().split(/[\s,]+/).map(Number);
      Object.assign(viewBox, { x: vb[0], y: vb[1], w: vb[2], h: vb[3] });
    } else if (tag === 'rect' && !ohneFuellung) {
      const w = Number(attrs.width ?? 0);
      const h = Number(attrs.height ?? 0);
      if (w >= 30 && h >= 12) {
        kaesten.push({ x: Number(attrs.x ?? 0) + rahmen.dx, y: Number(attrs.y ?? 0) + rahmen.dy, w, h, name: `rect${attrs.class ? '.' + attrs.class.replace(/\s+/g, '.') : ''}` });
      }
    } else if (tag === 'text') {
      const ende = quelle.indexOf('</text>', TAG.lastIndex);
      const inhalt = ende < 0 ? '' : quelle.slice(TAG.lastIndex, ende);
      TAG.lastIndex = ende < 0 ? quelle.length : ende + '</text>'.length;
      texte.push(...zeilenAusText(inhalt, attrs, rahmen, klassen));
      continue;
    }
    if (!selbst) stapel.push(rahmen);
  }
  return { viewBox, texte, kaesten };
}

function zeilenAusText(inhalt: string, attrs: Record<string, string>, rahmen: Rahmen, klassen: Map<string, Klasse>): TextZeile[] {
  const zeilen: TextZeile[] = [];
  let x = Number(attrs.x ?? 0) + rahmen.dx;
  let y = Number(attrs.y ?? 0) + rahmen.dy;
  let stuecke: { text: string; breite: number }[] = [];
  const abschliessen = () => {
    const text = stuecke
      .map((s) => s.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      const breite = stuecke.reduce((summe, s) => summe + s.breite, 0);
      const links = rahmen.anchor === 'middle' ? x - breite / 2 : rahmen.anchor === 'end' ? x - breite : x;
      zeilen.push({ text, x: links, y: y - OBEN * rahmen.fs, w: breite, h: (OBEN + UNTEN) * rahmen.fs, fs: rahmen.fs, name: 'text' });
    }
    stuecke = [];
  };
  const STUECK = /<tspan([^>]*)>([\s\S]*?)<\/tspan>|([^<]+)/g;
  let s: RegExpExecArray | null;
  while ((s = STUECK.exec(inhalt))) {
    let fs = rahmen.fs;
    let weight = rahmen.weight;
    let text = s[3] ?? s[2];
    if (s[1] !== undefined) {
      const tAttrs = attribute(s[1]);
      const innen = anwenden(rahmen, tAttrs, klassen).rahmen;
      fs = innen.fs;
      weight = innen.weight;
      if (tAttrs.x !== undefined || tAttrs.y !== undefined) {
        abschliessen();
        if (tAttrs.x !== undefined) x = Number(tAttrs.x) + rahmen.dx;
        if (tAttrs.y !== undefined) y = Number(tAttrs.y) + rahmen.dy;
      }
    }
    text = entities(text).replace(/\s+/g, ' ');
    if (stuecke.length === 0) text = text.trimStart();
    stuecke.push({ text, breite: schaetzeBreite(text, fs, weight >= 600) });
  }
  if (stuecke.length) stuecke[stuecke.length - 1].text = stuecke[stuecke.length - 1].text.trimEnd();
  abschliessen();
  return zeilen;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Alle Verstoesse einer Grafik als lesbare Zeilen. Leer heisst in Ordnung. */
export function pruefeGrafik(svg: string, optionen: PruefOptionen): string[] {
  const { breitePx, minPx = 11, randViewBox = 4, randKasten = 3 } = optionen;
  const { viewBox, texte, kaesten } = analysiereSvg(svg);
  const aus: string[] = [];
  if (!viewBox.w || !viewBox.h) return ['viewBox fehlt.'];
  const skala = breitePx / viewBox.w;

  texte.forEach((t, i) => {
    const kurz = `"${t.text.length > 40 ? t.text.slice(0, 38) + '…' : t.text}"`;
    const raender = { links: t.x - viewBox.x, rechts: viewBox.x + viewBox.w - (t.x + t.w), oben: t.y - viewBox.y, unten: viewBox.y + viewBox.h - (t.y + t.h) };
    for (const [wo, wert] of Object.entries(raender)) {
      if (wert < randViewBox) aus.push(`[VIEWBOX] ${kurz} hat ${wo} nur ${r1(wert)} Rand zum Bildrand (mindestens ${randViewBox}).`);
    }

    // Der Kasten, in dem die Zeile beginnt: der kleinste, der den Anfang enthaelt.
    const px = t.x + 1;
    const py = t.y + t.h * 0.6;
    let kasten: Kasten | null = null;
    for (const k of kaesten) {
      if (px < k.x || px > k.x + k.w || py < k.y || py > k.y + k.h) continue;
      if (!kasten || k.w * k.h < kasten.w * kasten.h) kasten = k;
    }
    if (kasten) {
      const innen = { links: t.x - kasten.x, rechts: kasten.x + kasten.w - (t.x + t.w), oben: t.y - kasten.y, unten: kasten.y + kasten.h - (t.y + t.h) };
      for (const [wo, wert] of Object.entries(innen)) {
        if (wert < randKasten) {
          aus.push(
            `[KASTEN] ${kurz} ${wert < 0 ? `ragt ${r1(-wert)} ueber den Kasten hinaus` : `hat nur ${r1(wert)} Abstand zum Kasten`} (${wo}, ${kasten.name} ${r1(kasten.x)},${r1(kasten.y)} ${r1(kasten.w)}x${r1(kasten.h)}).`,
          );
        }
      }
    }

    for (let j = i + 1; j < texte.length; j++) {
      const u = texte[j];
      // Breiten sind obere Schranken, fuer die Ueberlappung etwas enger nehmen.
      const ix = Math.min(t.x + t.w * 0.95, u.x + u.w * 0.95) - Math.max(t.x, u.x);
      const iy = Math.min(t.y + t.h, u.y + u.h) - Math.max(t.y, u.y);
      if (ix > 1 && iy > 1) aus.push(`[UEBERLAPPUNG] ${kurz} ueberlappt "${u.text.slice(0, 38)}" um ${r1(ix)}x${r1(iy)}.`);
    }

    const pxGroesse = t.fs * skala;
    if (pxGroesse < minPx - 0.05) aus.push(`[SCHRIFT] ${kurz} hat ${t.fs} Einheiten = ${r1(pxGroesse)} px bei ${breitePx} px Breite (mindestens ${minPx}).`);
  });
  return aus;
}
