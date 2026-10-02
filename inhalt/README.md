# inhalt/: Lerninhalte für Vertriebler

Quelle für das Informationsblatt (PDF unter `pdf/`) und für das Partner-Portal
(`app/`). Beides liest dieselben Dateien, damit es keine zwei Wahrheiten gibt.

Stand der Inhalte: 01.10.2026 (Entscheidungen von Michi vom 01.10.2026 eingearbeitet). Fachliche Quellen sind die Blätter unter
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

| Datei | Zeigt |
|---|---|
| `website-pakete.svg` | Die drei Pakete Klein, Mittel, Groß als Vergleichstabelle, Groß hervorgehoben |
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
