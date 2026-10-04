# inhalt/: Lerninhalte für Vertriebler

Quelle für das Informationsblatt (PDF unter `pdf/`) und für das Partner-Portal
(`app/`). Beides liest dieselben Dateien, damit es keine zwei Wahrheiten gibt.

Stand der Inhalte: 04.10.2026 (Entscheidungen von Michi vom 01.10.2026 und zur Steuer auf die Provision vom 04.10.2026 eingearbeitet). Fachliche Quellen sind die Blätter unter
`~/dekaru/brain/projekte/vertrieb-partner/` (Blatt 13 für Hosting, 04 für
Provision, 06 für Do und Don't, 14 für die Website-Pakete),
`dekaru-website/site/src/data/preise.ts` (Paket- und Bausteinpreise), `hosting.ts` (Hosting-Tarife) und
`dekaru-rechnungen/vorlagen/betreuungsvertrag.md`. Ändert sich dort etwas,
gehört es hier nachgezogen, nicht umgekehrt.

## Kapitel

Eine Datei je Kapitel, Reihenfolge über die Nummer im Dateinamen:

| Datei | Kapitel |
|---|---|
| `01-dekaru.md` | dekaru in einem Satz |
| `02-website.md` | Was eine Website bei dekaru ist |
| `03-hosting.md` | Hosting und Pflege |
| `04-aenderung.md` | So läuft eine Änderung |
| `05-zusatzleistungen.md` | Zusatzleistungen |
| `06-ablauf.md` | Ablauf und Rollen |
| `07-do-und-dont.md` | Was Sie sagen dürfen und was nie |
| `08-provision.md` | Provision |
| `09-einwaende.md` | Häufige Einwände und ehrliche Antworten |
| `10-glossar.md` | Glossar |
| `11-preisliste.md` | Preisliste für Vertriebler (Anhang) |

### Frontmatter

Jede Kapiteldatei beginnt mit einem YAML-Block:

```
---
nummer: 3
titel: Hosting und Pflege
kurz: Ein Satz, der im Inhaltsverzeichnis und auf Kapitelkarten steht.
---
```

Der Kapitel-Schlüssel (`kapitel` im Quiz) ist der Dateiname ohne `.md`,
zum Beispiel `03-hosting`.

### Markdown-Teilmenge

Der PDF-Build hat einen eigenen kleinen Parser und kennt nur diese Elemente.
Das Portal kann einen vollen Markdown-Parser nehmen, die Dateien bleiben
darin gültig.

- Überschriften `#` (nur einmal, Kapiteltitel), `##`, `###`
- Absätze, getrennt durch Leerzeilen
- Listen mit `- ` und `1. `
- Tabellen im GitHub-Stil mit Kopfzeile und Trennzeile `|---|---|`
- Zitate mit `> ` (Formulierungen fürs Gespräch)
- `**fett**`
- Grafiken als `![Beschreibung](grafiken/name.svg)`. Der Build bettet die
  SVG-Datei inline ein und setzt die Beschreibung als Bildunterschrift.

Keine HTML-Tags, keine Fußnoten, keine verschachtelten Listen, keine langen
Gedankenstriche.

## Grafiken

`grafiken/*.svg`, eigenständige Dateien, jeweils mit `<title>` und `<desc>`
für Screenreader und mit `viewBox`, damit sie skalieren. Farben: Text
`#141414`, gedämpft `#5C5C5C`, Flächen `#EEEEEB` und `#D9D9D5`, Linien
`#C9C9C5`, Akzent Bordeaux `#7B1E2B` (Text auf hell `#6E1A26`), jeweils
höchstens eine Hervorhebung je Grafik. Schriften `Space Grotesk` für
Überschriften und `Inter` für Text, mit Fallback auf `system-ui`. Wer die
Grafiken einbindet, sollte beide Schriften laden, sonst greift der Fallback.
Maße: 800 Einheiten breit, Schrift mindestens 11. Das Portal zeigt sie auf
dem Handy mit 800 px Mindestbreite zum Schieben, damit die Schrift lesbar
bleibt. Text bricht in SVG nicht um, deshalb muss jede Zeile in ihren Kasten
passen; `npm test` und `npm run pruefe-grafiken` in `app/` prüfen das.

| Datei | Zeigt |
|---|---|
| `website-pakete.svg` | Die drei Pakete Klein, Mittel, Groß als Vergleichstabelle, Groß hervorgehoben |
| `hosting-stufen.svg` | Start, Basis, Plus nebeneinander |
| `aenderung-ablauf.svg` | Ablauf einer Änderung: Mail, Umsetzung, Zählung, 25 €, Monatsende |
| `gratisquartal.svg` | Drei Gratismonate, sechs Pflichtmonate, danach kündbar |
| `zusatzleistungen-wann.svg` | Wann welche Zusatzleistung angesprochen wird |
| `ablauf-auftrag.svg` | Vom Anruf bis zur Rechnung in zwei Spuren |
| `provision-zeitleiste.svg` | Wann welche Provision kommt, an einem Beispiel |

## lernen/: Lernkarten für das Portal

Je Kapitel eine Datei `lernen/<kapitel>.json`, zum Beispiel `lernen/03-hosting.json`.
Das ist die kurze Lernversion des Kapitels, die das Portal Karte für Karte
zeigt. Das PDF und die Seite "Ausführlich lesen" nehmen weiter die
Markdown-Datei. Inhaltlich muss alles aus dem Kapitel stammen, nichts wird
erfunden. Das Portal prüft das Format beim Build; ein Fehler macht die ganze
Datei ungültig und wird dem Admin unter Lernen angezeigt.

```
{
  "kapitel": "03-hosting",
  "karten": [
    {
      "titel": "Die drei Stufen",
      "icon": "treppe",
      "saetze": ["Ein bis drei Kernsätze, zusammen höchstens 40 Wörter."],
      "grafik": "hosting-treppe.svg",
      "merke": "Ein Satz, der hängen bleiben soll."
    }
  ]
}
```

- 4 bis 8 Karten je Kapitel, jede mit `titel`, `icon` und `saetze` (1 bis 3,
  zusammen höchstens 40 Wörter).
- Wahlweise, höchstens zwei je Karte: `grafik` (Dateiname aus
  `lernen/grafiken/` oder `grafiken/`), `kennzahl` (`{ "wert", "label" }`),
  `tabelle` (`{ "kopf": [...], "zeilen": [[...]] }`, bis 11 Zeilen),
  `liste` (2 bis 6 Einträge) oder `zitat` (Formulierung fürs Gespräch, bis
  80 Wörter).
- `merke` ist optional, ein Satz.
- Icons: sprechblase, person, paket, stern, telefon, warnung, liste, zahnrad,
  plus, euro, google, dokument, server, treppe, haken, kreuz, uhr, kalender,
  mail, weg, lupe, karte, schild, hand, buch, bildschirm.

### lernen/grafiken/

Grafiken nur für die Lernkarten, anders gebaut als die unter `grafiken/`:
sie werden inline in die Seite gesetzt und übernehmen die Farben des Portals,
damit sie hell und dunkel funktionieren. Deshalb keine festen Farben an den
Elementen, sondern Klassen mit Variablen und Ersatzwert im `<style>`-Block
(`#g-xx .f1{fill:var(--lk-f1,#ece6da)}`), Text über `fill="currentColor"`. Jede
Datei braucht `<title>`, `<desc>` und `viewBox`, mit eindeutigen IDs je Datei,
weil mehrere Grafiken auf einer Seite liegen. Aus demselben Grund trägt das
`<svg>` eine eigene `id` (`g-xx`) und jede Regel im `<style>` beginnt mit
dieser ID, sonst überschreiben sich gleichnamige Klassen zweier Grafiken.

Maße: **320 Einheiten breit**, hochkant statt breit, Schrift **mindestens 12**
(Überschriften 13, Zahlen bis 20). Auf dem Handy ist die Grafik 299 px breit,
dann sind 12 Einheiten noch 11 px. SVG-Text bricht nicht um: jede Zeile ist
ein eigenes `<text>`, und jede Zeile muss mit mindestens 4 Einheiten Rand in
die viewBox und mit 3 Einheiten in ihren Kasten passen. `npm test` in `app/`
prüft das näherungsweise, `npm run pruefe-grafiken` misst es im Browser.

| Datei | Zeigt |
|---|---|
| `vier-argumente.svg` | Die vier Argumente als Kacheln |
| `pakete-vergleich.svg` | Klein, Mittel, Groß als drei Spalten mit Seitensymbolen |
| `beispielrechnungen.svg` | Drei Beispielrechnungen als Kassenbons |
| `google-zwei-dinge.svg` | Suchmaschinen-Grundlagen und Google-Profil nebeneinander |
| `hosting-treppe.svg` | Start, Basis, Plus als Treppe |
| `hosting-jahr.svg` | Zehn Monate bezahlt, zwölf erhalten |
| `gratisquartal-kalender.svg` | Gratisquartal als Zwölf-Monats-Kalender |
| `aenderung-zaehlen.svg` | Eine Mail mit drei Punkten sind drei Änderungen |
| `zusatzleistungen-drei.svg` | Die drei Zusatzleistungen als Karten |
| `ablauf-zeitstrahl.svg` | Acht Schritte vom Anruf bis zur Rechnung |
| `stufen-1-2.svg` | Stufe 1 und Stufe 2 |
| `do-dont-ampel.svg` | Immer, im Zweifel, nie als Ampel |
| `provision-balken.svg` | Provision je Paket als Balken |
| `anlauf-wochen.svg` | Sechs bis zehn Wochen bis zum ersten Geld |

## quiz.json

Lernfragen für das Portal. Struktur:

```
{
  "version": 1,
  "stand": "2026-10-01",
  "titel": "...",
  "typen": { ... Beschreibung je Typ ... },
  "fragen": [ ... ]
}
```

Jede Frage hat `id` (eindeutig, `q01` ...), `typ`, `kapitel` (Dateiname ohne
`.md`) und `erklaerung` (Text, der nach der Antwort gezeigt wird, immer mit
der Begründung der richtigen Antwort). Dazu je Typ:

**multiple-choice**

```
"frage": "...",
"optionen": ["...", "..."],
"richtig": [1],          // Indizes in optionen, 0-basiert
"mehrfach": false        // true: mehrere Antworten sind richtig, alle müssen gewählt sein
```

**wahr-falsch**

```
"aussage": "...",
"richtig": true
```

**zuordnen**

```
"frage": "...",
"paare": [ { "links": "...", "rechts": "..." }, ... ]
```

Das Portal mischt die rechte Seite. Jede linke Seite hat genau eine richtige
rechte Seite. Richtig ist die Frage, wenn alle Paare stimmen.

**lueckentext**

```
"text": "Der Stichtag ist der {{1}}. des Monats.",
"luecken": [ { "nr": 1, "richtig": ["25", "25."] } ]
```

Vergleich ohne Beachtung von Groß- und Kleinschreibung und ohne Leerzeichen
am Rand. Mehrere Schreibweisen (`1500` und `1.500`) stehen als Alternativen.

Fragen prüfen: `node -e 'JSON.parse(require("fs").readFileSync("inhalt/quiz.json","utf8"))'`.

## gespraechshilfe.json

Die Gesprächshilfe im Portal (`/gespraech`): was Betriebe fragen und was der
Vertriebler darauf sagt. Quellen sind die Blätter 01, 02, 03, 06, 10, 13 und
14 unter `~/dekaru/brain/projekte/vertrieb-partner/`, Kapitel 09 hier und die
Telefon-Übung. Nichts darf den Kapiteln widersprechen; ändert sich dort etwas,
gehört es hier nachgezogen.

```
{
  "version": 1,
  "stand": "2026-10-02",
  "titel": "...",
  "einleitung": "Sechs Sätze lernen Sie wortgleich, alles andere sagen Sie in eigenen Worten.",
  "themen": ["Preis", "Ablauf", "Hosting", "Vertrauen", "Kein Interesse", "Recht und Datenschutz"],
  "eintraege": [ ... ]
}
```

Jeder Eintrag:

| Feld | Pflicht | Inhalt |
|---|---|---|
| `id` | ja | eindeutig, `g01` ... |
| `thema` | ja | genau eines der sechs Themen oben, wortgleich |
| `frage` | ja | so, wie der Kunde fragt |
| `antwort` | ja | kurz, gesprochen, Sie-Form, ein bis drei Sätze. Der Vertriebler spricht von "Herrn Henning" oder "er" |
| `pflicht` | ja | `true` bei den sechs Sätzen, die wortgleich gelernt werden. Alles andere `false` |
| `hinweis` | nein | warum die Antwort so lautet, was dazu nie gesagt wird. Wird aufklappbar gezeigt |
| `uebung` | bei `pflicht: true` | Übungsdaten, siehe unten |

Der Platzhalter `{{Ihr Name}}` in `antwort` und `uebung.teile` wird im Portal
durch den Namen der angemeldeten Person ersetzt. Er darf keine Lücke sein.

**`uebung`** nur bei Pflichtsätzen, beide Felder nötig:

```
"uebung": {
  "luecken": ["600 €", "Angebot", "Festpreis"],
  "teile": ["Jede Website", "beginnt bei 600 €.", "Was Ihre kostet,", "steht im Angebot,", "als Festpreis."]
}
```

- `luecken`: Wörter oder Wortgruppen, die im Lückentext fehlen. Jede muss als
  ganzes Wort genau so im Satz vorkommen, Lücken dürfen sich nicht
  überschneiden. Verglichen wird ohne Groß- und Kleinschreibung, ohne
  Satzzeichen am Ende und ohne "€".
- `teile`: der Satz in mindestens drei Stücken, in der richtigen Reihenfolge.
  Mit Leerzeichen verbunden müssen sie genau die `antwort` ergeben. Das Portal
  mischt sie, der Vertriebler bringt sie in die richtige Reihenfolge.

Die Pflichtsätze sind inhaltlich festgelegt: Einstieg, Preis "ab 600 €",
Referenzen (ehrlich, er fängt gerade an), Dauer (Termin steht im Angebot),
Vorschau nur im Termin, Gratisquartal. Es bleiben genau sechs.

Was in keiner Antwort steht: ein Ortsbezug, eine Bauzeit in Tagen oder Wochen,
Preise außer "ab 600 €" und den Hosting-Zahlen, Referenzkunden, Floskeln,
lange Gedankenstriche. Fehlerhafte Einträge überspringt das Portal und listet
sie dem Admin unter `/gespraech` auf. Prüfen: `cd app && npm test`.
