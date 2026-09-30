#!/usr/bin/env node
/**
 * Baut das Informationsblatt für Vertriebler als PDF.
 *
 *   node pdf/build.mjs            HTML und PDF erzeugen
 *   node pdf/build.mjs --html     nur HTML (pdf/build/informationsblatt.html)
 *
 * Quelle sind die Kapitel unter inhalt/*.md und die Grafiken unter
 * inhalt/grafiken/. Der Markdown-Parser hier ist bewusst klein und kennt nur
 * die Teilmenge, die inhalt/README.md beschreibt.
 *
 * PDF-Erzeugung: Playwright mit Chromium. Gesucht wird zuerst ein lokal
 * installiertes Playwright, dann das global installierte (npm root -g), dann
 * der Pfad aus der Umgebungsvariable PLAYWRIGHT_DIR. Ohne Playwright fällt
 * das Script auf Google Chrome (headless, --print-to-pdf) zurück, dann ohne
 * Seitenzahlen in der Fußzeile.
 *
 * Keine Abhängigkeiten im Repo, damit app/ und pdf/ sich nicht in die Quere
 * kommen.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const INHALT = join(REPO, "inhalt");
const BUILD = join(HIER, "build");
const PDF = join(HIER, "dekaru-informationsblatt-vertrieb.pdf");
const ABLAGE = resolve(REPO, "..", "_ablage", "dekaru-informationsblatt-vertrieb.pdf");
const STAND = "30.09.2026";
const NUR_HTML = process.argv.includes("--html");

// ---------------------------------------------------------------- Markdown

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function grafik(alt, pfad) {
  const datei = join(INHALT, pfad);
  if (!existsSync(datei)) throw new Error(`Grafik fehlt: ${pfad}`);
  let svg = readFileSync(datei, "utf8").replace(/<\?xml[^>]*\?>\s*/, "");
  svg = svg.replace("<svg ", '<svg class="grafik" ');
  return `<figure>${svg}<figcaption>${inline(alt)}</figcaption></figure>`;
}

function tabelle(zeilen) {
  const zellen = (z) => z.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const kopf = zellen(zeilen[0]);
  const leerKopf = kopf.every((c) => c === "");
  const rows = zeilen.slice(2).map(zellen);
  // Spalten, in denen jede Zelle kurz ist, werden nicht umbrochen (Preise, Zahlen).
  const kurz = kopf.map((_, s) => rows.every((r) => (r[s] || "").length <= 16));
  const zelle = (c, s, tag) => `<${tag}${kurz[s] ? ' class="nowrap"' : ""}>${inline(c)}</${tag}>`;
  const body = rows.map((r) => "<tr>" + r.map((c, s) => zelle(c, s, "td")).join("") + "</tr>").join("\n");
  const head = leerKopf ? "" : "<thead><tr>" + kopf.map((c, s) => zelle(c, s, "th")).join("") + "</tr></thead>";
  const klassen = [leerKopf ? "kv" : "", rows.length <= 5 ? "kompakt" : ""].filter(Boolean).join(" ");
  return `<table class="${klassen}">${head}<tbody>${body}</tbody></table>`;
}

function markdown(body) {
  const lines = body.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const level = m[1].length;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      i++; continue;
    }
    if ((m = line.match(/^!\[(.*?)\]\((.*?)\)\s*$/))) {
      out.push(grafik(m[1], m[2]));
      i++; continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      out.push(tabelle(rows));
      continue;
    }
    if (line.startsWith(">")) {
      const parts = [];
      let cur = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        const t = lines[i].replace(/^>\s?/, "");
        if (t.trim() === "") { if (cur.length) { parts.push(cur.join(" ")); cur = []; } }
        else cur.push(t);
        i++;
      }
      if (cur.length) parts.push(cur.join(" "));
      out.push("<blockquote>" + parts.map((p) => `<p>${inline(p)}</p>`).join("") + "</blockquote>");
      continue;
    }
    if (/^- /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      while (i < lines.length && (/^- /.test(lines[i]) || /^\d+\. /.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^\s{2,}\S/.test(lines[i])) items[items.length - 1] += " " + lines[i].trim();
        else items.push(lines[i].replace(/^(- |\d+\. )/, ""));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>` + items.map((t) => `<li>${inline(t)}</li>`).join("") + `</${tag}>`);
      continue;
    }
    // Absatz: bis zur nächsten Leerzeile oder zum nächsten Blockanfang
    const para = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3}\s|!\[|\||>|- |\d+\. )/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    const text = para.join(" ");
    const frage = /^\*\*[^*]+\*\*$/.test(text) ? ' class="frage"' : "";
    out.push(`<p${frage}>${inline(text)}</p>`);
  }
  // Ein fett beginnender Absatz direkt vor einer Tabelle ist deren Ueberschrift und bleibt bei ihr.
  return out.join("\n").replace(/<p>(<strong>[^\n]*?<\/p>)\n(<table)/g, '<p class="frage">$1\n$2');
}

// ---------------------------------------------------------------- Kapitel

const dateien = readdirSync(INHALT)
  .filter((f) => /^\d{2}-.*\.md$/.test(f))
  .sort();

const kapitel = dateien.map((f) => {
  const { meta, body } = frontmatter(readFileSync(join(INHALT, f), "utf8"));
  const bodyOhneH1 = body.replace(/^\s*#\s+.*\n/, "");
  return {
    slug: f.replace(/\.md$/, ""),
    nummer: Number(meta.nummer),
    titel: meta.titel,
    kurz: meta.kurz || "",
    html: markdown(bodyOhneH1),
  };
});

const toc = kapitel
  .map((k) => `<li><span class="toc-num">${k.nummer}</span><span><span class="toc-name">${escapeHtml(k.titel)}</span><span class="toc-kurz">${escapeHtml(k.kurz)}</span></span></li>`)
  .join("\n");

const body = kapitel
  .map((k) => `<section class="kapitel" id="${k.slug}"><p class="kapitel-label">Kapitel ${k.nummer}</p><h1>${escapeHtml(k.titel)}</h1>\n${k.html}\n</section>`)
  .join("\n");

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>dekaru Informationsblatt für Vertriebler</title>
<link rel="stylesheet" href="../style.css">
</head>
<body>
<section class="cover">
  <div>
    <p class="cover-mark">dekaru</p>
    <div class="cover-rule"></div>
    <h1 class="cover-title">Informationsblatt für Vertriebler</h1>
    <p class="cover-sub">Was dekaru verkauft, was Sie sagen dürfen und wie Ihre Provision entsteht. Für Laien geschrieben, jede Zahl geprüft.</p>
  </div>
  <div class="cover-meta">
    <p><strong>Stand ${STAND}</strong><br>Michael Henning Consulting, Marke dekaru, Horb am Neckar<br>Vertraulich, nur für Vertriebspartner von dekaru. Ersetzt nicht den Handelsvertretervertrag.</p>
  </div>
</section>
<section class="toc">
  <h1 class="toc-title">Inhalt</h1>
  <ol>${toc}</ol>
</section>
${body}
</body>
</html>
`;

mkdirSync(BUILD, { recursive: true });
const HTML = join(BUILD, "informationsblatt.html");
writeFileSync(HTML, html);
console.log(`HTML: ${HTML} (${kapitel.length} Kapitel)`);
if (NUR_HTML) process.exit(0);

// ---------------------------------------------------------------- PDF

function findePlaywright() {
  const kandidaten = [];
  if (process.env.PLAYWRIGHT_DIR) kandidaten.push(process.env.PLAYWRIGHT_DIR);
  kandidaten.push(join(REPO, "node_modules", "playwright"));
  kandidaten.push(join(REPO, "app", "node_modules", "playwright"));
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    kandidaten.push(join(root, "playwright"));
  } catch {}
  for (const k of kandidaten) {
    const pkg = join(k, "package.json");
    if (existsSync(pkg)) {
      try { return createRequire(pkg)(k); } catch {}
    }
  }
  return null;
}

const fuss = `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5pt;color:#4A4A4A;padding:0 17mm;display:flex;justify-content:space-between;">
  <span>dekaru · Informationsblatt für Vertriebler · Stand ${STAND}</span>
  <span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>
</div>`;

async function mitPlaywright(pw) {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: PDF,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: fuss,
    margin: { top: "18mm", right: "17mm", bottom: "20mm", left: "17mm" },
  });
  await browser.close();
}

function mitChrome() {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (!existsSync(chrome)) throw new Error("Weder Playwright noch Google Chrome gefunden.");
  const r = spawnSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${PDF}`, pathToFileURL(HTML).href], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  console.warn("Hinweis: mit Chrome gebaut, ohne Seitenzahlen in der Fußzeile.");
}

const pw = findePlaywright();
if (pw) await mitPlaywright(pw); else mitChrome();
console.log(`PDF: ${PDF}`);

if (existsSync(dirname(ABLAGE))) {
  copyFileSync(PDF, ABLAGE);
  console.log(`Kopie: ${ABLAGE}`);
}
