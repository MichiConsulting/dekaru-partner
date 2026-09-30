# inhalt/: Lerninhalte für Vertriebler

Quelle für das Informationsblatt (PDF unter `pdf/`) und für das Partner-Portal
(`app/`). Beides liest dieselben Dateien, damit es keine zwei Wahrheiten gibt.

Stand der Inhalte: 30.09.2026. Fachliche Quellen sind die Blätter unter
`~/dekaru/brain/projekte/vertrieb-partner/` (Blatt 13 für Hosting, 04 für
Provision, 06 für Do und Don't), `dekaru-website/site/src/data/preise.ts`
(Komponentenpreise und Größen-Schwellen), `hosting.ts` (Hosting-Tarife) und
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

| Datei | Zeigt |
|---|---|
| `groessen-schwellen.svg` | Preisstrahl mit den Grenzen S, M, L (1.000 und 1.700 €) |
| `website-spanne.svg` | Die drei Voreinstellungen Klein, Mittel, Groß als Säulen mit Bausteinen |
| `hosting-stufen.svg` | Start, Basis, Plus nebeneinander |
| `aenderung-ablauf.svg` | Ablauf einer Änderung: Mail, Umsetzung, Zählung, 25 €, Monatsende |
| `gratisquartal.svg` | Drei Gratismonate, sechs Pflichtmonate, danach kündbar |
| `zusatzleistungen-wann.svg` | Wann welche Zusatzleistung angesprochen wird |
| `ablauf-auftrag.svg` | Vom Anruf bis zur Rechnung in zwei Spuren |
| `provision-zeitleiste.svg` | Wann welche Provision kommt, an einem Beispiel |

## quiz.json

Lernfragen für das Portal. Struktur:

```
{
  "version": 1,
  "stand": "2026-09-30",
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
