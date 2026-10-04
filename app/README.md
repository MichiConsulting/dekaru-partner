# dekaru Partner-Portal

Website für die Vertriebspartner von dekaru, später unter `partner.dekaru.de`.
Jeder Vertriebler hat einen eigenen Login und sieht vier Bereiche:

1. **Lernen**: jedes Kapitel als 4 bis 8 Lernkarten mit Grafiken, Kennzahlen
   und Merksätzen, der lange Text bleibt unter "Ausführlich lesen". Danach die
   Abfrage auf einer eigenen Seite, eine Frage je Seite (Auswahl, Wahr/Falsch,
   Zuordnen, Lückentext), Auflösung erst nach der Antwort, am Ende eine
   Ergebnisseite. Fortschritt und Punkte werden je Person gespeichert, falsche
   Fragen lassen sich wiederholen.
2. **Gespräch**: die Gesprächshilfe fürs Handy. Was der Kunde fragt, was der
   Vertriebler sagt, mit Suche und Themen-Chips. Sechs Pflichtsätze sind als
   "wortgleich" markiert und lassen sich unter `/gespraech/ueben` Satz für Satz
   üben (Lückentext und Satzteile ordnen im Wechsel, Lösung erst nach der
   Antwort). Ein Satz sitzt, wenn der letzte Versuch stimmt.
3. **Meine Kunden**: eigene Betriebe eintragen, Status pflegen, filtern,
   Termine und Abschlüsse des Monats sehen. Niemand sieht fremde Einträge.
4. **Meine Provision**: die Monatsaufstellungen aus `dekaru-rechnungen`, mit
   entstandener, ausgezahlter und aufgelaufener Provision und den Regeln.
5. **Kalender**: eigene Termine und offene Wiedervorlagen als Wochen- oder
   Monatsliste, jeder Eintrag als `.ics`, dazu ein persönlicher Abo-Link für
   die Kalender-App (unter Einstellungen).

Die **Startseite ist ein Cockpit**: Termine diese Woche, fällige
Wiedervorlagen, Abschlüsse im Monat, Provision im laufenden Quartal,
Lernfortschritt und Pflichtsätze, jede Kachel mit dem Weg in ihren Bereich.
Der Admin sieht dieselben Kacheln mit den Gesamtzahlen aller Vertriebler.

Dazu ein **Admin-Bereich** für Michi: Zugänge anlegen und deaktivieren
(Einladung mit Einmal-Passwort), alle Kunden, Lernstand mitsamt der
Pflichtsätze, Provision importieren, eine Übersicht aller Vertriebler, das
Protokoll der Admin-Aktionen und die Dublettenprüfung bei Betrieben.

## Aufbau

```
dekaru-partner/
  inhalt/            Kapitel (NN-name.md), quiz.json, grafiken/*.svg   (anderer Agent)
  pdf/               Informationsblatt als PDF                          (anderer Agent)
  app/               dieses Portal
    astro.config.mjs Astro 6, SSR, Vercel-Adapter, Region fra1 in vercel.json
    db/migrationen/  Schema als SQL, wiederholbar
    scripts/         db-migrate, admin-anlegen, provision-import, preise-sync
    src/data/        preise.json, abgeleitet aus dekaru-website und dekaru-rechnungen
    src/lib/         Logik ohne Astro-Abhängigkeit, dadurch testbar
    src/pages/       Seiten und Endpunkte
    tests/           Vitest, laufen gegen PGlite im Speicher
```

**Technik.** Astro mit Server-Rendering auf Vercel (`@astrojs/vercel`),
Postgres bei Neon über `DATABASE_URL`, für Entwicklung und Tests PGlite hinter
derselben Schnittstelle (`src/lib/db.ts`). Beide lesen dieselben SQL-Dateien aus
`db/migrationen/`. Kein Framework für die Oberfläche: Formulare per POST,
Redirect nach dem Speichern, ein kleines Skript nur für das Verbinden von
Paaren im Quiz. Schriften Space Grotesk und Inter liegen im Bundle, es gibt
keinen Aufruf nach draußen, kein Tracking, ein einziges Sitzungs-Cookie.

**Hell und dunkel.** Ein Knopf im Kopf schaltet um, die Wahl liegt in
`localStorage` unter `dekaru-theme` (wie auf dekaru.de). Ohne Wahl gilt die
Systemeinstellung, auch ohne JavaScript über `prefers-color-scheme`.
`public/theme-init.js` setzt `data-theme` auf `<html>` schon im `<head>`,
damit beim Laden nichts aufblitzt; eine eigene Datei, weil die CSP keine
Inline-Skripte erlaubt. Die Farbvariablen stehen in `global.css` einmal für
hell und zweimal gleich für dunkel (`[data-theme='dark']` und das Media
Query), `tests/modus.test.ts` hält beide Blöcke gleich.

**Sicherheit.** Passwörter mit scrypt (`src/lib/passwort.ts`). Sitzungen in
der Tabelle `sitzungen`, im Cookie nur ein Zufallstoken, in der Datenbank
dessen SHA-256; Cookie httpOnly, Secure, SameSite=Lax, 14 Tage. Jede Sitzung
hat ein CSRF-Token, das jedes Formular als `_csrf` mitschickt und die
Middleware prüft; dazu Astros Origin-Prüfung. Login mit Ratenbegrenzung: fünf
Fehlversuche in 15 Minuten je Adresse oder IP sperren 15 Minuten. Rollen
`admin` und `vertriebler`, Zugriff in `src/lib/zugriff.ts`, jede Abfrage nach
Benutzer gefiltert. Content-Security-Policy, `X-Frame-Options`, `no-store`
auf allen Seiten. Neue Zugänge bekommen ein Einmal-Passwort und müssen beim
ersten Login ein eigenes setzen.

**Inhalte.** Die Kapitel werden beim Build aus `../inhalt/` eingelesen
(Content Collection, Frontmatter `nummer`, `titel`, `kurz`), `quiz.json` und die
Grafiken landen im Bundle. Das Format steht in `../inhalt/README.md`. Solange
dort keine Kapitel liegen, gilt `app/inhalt-platzhalter/`. Fehlerhafte Fragen
werden übersprungen und dem Admin unter Lernen aufgelistet. Ein Kapitel gilt
als erledigt, wenn alle Fragen einmal richtig beantwortet sind. Grafiken sind
nur angemeldet erreichbar (`/grafiken/<datei>`).

**Lernbereich.** Die Lernkarten kommen aus `../inhalt/lernen/<kapitel>.json`
(`lib/lernkarten.ts` prüft das Format, Fehler sieht der Admin unter Lernen),
die Lerngrafiken aus `../inhalt/lernen/grafiken/` werden inline gesetzt und
nehmen die Farbvariablen `--lk-*` aus `global.css`. Routen je Kapitel:
`/lernen/<kapitel>` (Karten, mit JavaScript eine nach der anderen, ohne
untereinander), `/lernen/<kapitel>/lesen` (ganzer Text),
`/lernen/<kapitel>/abfrage` (eine Frage je Seite, Bewertung auf dem Server,
die Frage-Seite enthält keine Lösung) und `/lernen/<kapitel>/ergebnis`.
`/lernen/wiederholen/abfrage` nimmt alle zuletzt falschen Fragen. Der Stand
liegt in `lernkarten_stand` (zuletzt gesehene Karte, gelesen) und
`abfrage_durchlaeufe` (ein Durchlauf je Person und Kapitel), die Einzelantworten
weiter in `quiz_antworten` (Migration `003-lernen.sql`). Styles nur in
`styles/lernen.css`.

**Grafiken prüfen.** Text in SVG bricht nicht um, eine zu lange Zeile ragt
einfach aus ihrem Kasten. `tests/grafiken.test.ts` schätzt deshalb für jede
Grafik unter `../inhalt/grafiken/` und `../inhalt/lernen/grafiken/` die Breite
jeder Textzeile (`src/lib/grafik-pruefung.ts`, Zeichenklassen mal
Schriftgröße, gegen Inter kalibriert) und prüft Rand zur viewBox, Abstand zum
umgebenden Kasten, Überlappungen und die Schriftgröße in Bildschirmpixeln bei
375 px Breite (mindestens 11 px). `npm run pruefe-grafiken` misst dasselbe
exakt im Browser (Playwright mit Chromium, lokal, global oder über
`PLAYWRIGHT_DIR`, wie beim PDF-Build) und ist der Maßstab, wenn die Näherung
zweifelt. Beide erwarten 0 Befunde.

**Gesprächshilfe.** `../inhalt/gespraechshilfe.json` wird ebenfalls beim Build
eingelesen (`src/lib/inhalt-gespraech.ts`), geprüft (`src/lib/gespraech.ts`)
und ins Bundle geschrieben. Fehlerhafte Einträge sieht der Admin unter
`/gespraech`. Der Übungsstand der Pflichtsätze liegt in `pflichtsatz_antworten`
(Migration `002-pflichtsaetze.sql`, `src/lib/gespraech-fortschritt.ts`). Der
Platzhalter `{{Ihr Name}}` wird mit dem Namen der angemeldeten Person gefüllt.

**Wiedervorlage.** Je Kunde ein Datum und ein kurzer Grund, Spalten
`wiedervorlage_am`, `wiedervorlage_grund` und `wiedervorlage_erledigt_am` an
`kunden` (Migration `005-wiedervorlage-kalender.sql`, Logik in
`src/lib/wiedervorlage.ts`). Setzen, ändern, erledigen und entfernen laufen
über `POST /kunden/<id>/wiedervorlage`, nur für eigene Kunden. Die Liste
`/kunden/wiedervorlagen` gruppiert nach überfällig, heute, diese Woche und
später; "heute" kommt aus Europe/Berlin (`src/lib/datum.ts`), weil der Server
auf Vercel in UTC läuft.

**Kalender und Abo.** `/kalender` zeigt Termine (`termin_datum`) und offene
Wiedervorlagen als Liste je Tag, Woche (`?von=JJJJ-MM-TT`) oder Monat
(`?ansicht=monat&monat=JJJJ-MM`), ohne Widget und ohne JavaScript.
`src/lib/kalender.ts` schreibt iCalendar nach RFC 5545: CRLF, Faltung bei 75
Oktetten, Maskierung von Komma, Semikolon und Backslash, ganztägige Einträge
mit stabiler UID, VTIMEZONE Europe/Berlin. Einzelne Einträge kommen von
`/kalender/eintrag/<termin|wiedervorlage>/<id>.ics` (angemeldet, nur eigene).
Der Abo-Link `/kalender/abo/<token>.ics` ist ohne Login erreichbar; das
Token (32 Zufallsbytes) erzeugt und widerruft jede Person selbst unter
`/einstellungen`, es wird einmal angezeigt und nur als SHA-256 gespeichert
(Tabelle `kalender_token`, `src/lib/kalender-token.ts`). Je IP-Adresse gelten
fünf unbekannte Tokens in 15 Minuten und höchstens 60 Abrufe in 15 Minuten,
danach 429 für 15 Minuten (`src/lib/rate.ts`, dieselbe Tabelle wie der
Login). Der Feed enthält nur Betriebsname, Status und Datum, keine
Telefonnummern, Notizen oder Gründe. Deaktivierte Zugänge liefern nichts.

**Cockpit.** `src/lib/cockpit.ts` liefert die Zahlen der Startseite:
Termine der Kalenderwoche, offene und fällige Wiedervorlagen, Abschlüsse und
neue Betriebe im Monat, Provision im Quartal (entstanden = Summe der
Abrechnungen mit Abrechnungsmonat im Quartal, ausgezahlt = davon als
überwiesen markiert, aufgelaufen = Stand der neuesten Abrechnung, beim Admin
je Vertriebler einmal). Lernstand und Pflichtsätze holt die Seite selbst.

**Provision.** `dekaru-rechnungen/provision.mjs` schreibt neben jeder
Markdown-Aufstellung eine `<slug>.json` (`lib/provision-json.mjs`, Format 1).
Das Portal prüft die Datei (`src/lib/provision.ts`, Summen müssen zu den Zeilen
passen), legt sie in `provision_abrechnungen` ab und zeigt sie dem Vertriebler,
dessen `vertriebler_slug` zum Slug in `vertriebler.json` passt. Import
entweder im Admin-Bereich (Datei hochladen) oder per Skript. Der Admin markiert
eine Abrechnung als ausgezahlt, dann zählt sie als überwiesen.

**Admin-Übersicht** (`/admin/uebersicht`, `src/lib/admin-uebersicht.ts`).
Je Vertriebler im gewählten Monat: Ersttermine, Zweittermine, Abschlüsse,
Absagen, Abschlussquote (Abschlüsse durch Zweittermine), entstandene Provision
im Quartal des Monats (Summe `summeCent` der importierten Abrechnungen),
Kapitel und Quizpunkte, Pflichtsätze (x von 6), letzte Anmeldung. Sortiert
wird über Links im Spaltenkopf, ohne JavaScript. Auffällig sind: 14 Tage
ohne Anmeldung (oder nie angemeldet), offene Pflichtsätze, Lernen nicht
begonnen, drei Zweittermine ohne Abschluss, viele Absagen; deaktivierte
Zugänge nie. Gezählt wird jeder Betrieb, der im Monat in den Status
gewechselt ist. Den Verlauf schreibt ein Trigger in `kunden_statuswechsel`
mit (nur Kunde, Vertriebler, Status, Tag). Für Einträge vor Migration 7 kennt
die Datenbank nur den damaligen letzten Status, die Monatszahlen sind erst ab
dann genau.

**Protokoll der Admin-Aktionen** (`/admin/protokoll`, Tabelle
`admin_protokoll`). Jede schreibende Admin-Aktion steht dort mit Zeitpunkt,
wer, was, Ziel und kurzen Details, nie mit Passwort, Hash oder Token
(`bereinigeDetails` filtert solche Schlüssel zusätzlich heraus). Alle
Aktionen laufen über `src/lib/admin-aktionen.ts`, das nach dem Erfolg
`protokolliere()` aus `src/lib/admin-protokoll.ts` aufruft: Zugang anlegen,
deaktivieren, aktivieren, Einmal-Passwort neu, Slug ändern, Stufe ändern
(`stufe_geaendert`), Provision hochladen (mit Mailstatus), eine gescheiterte
Provisionsmail nachholen, ausgezahlt markieren und zurücksetzen, Briefing als
übernommen markieren oder zurückgeben, die Angebots-Eingabe (YAML)
herunterladen, Dubletten entscheiden, Kunde trotz Dublette speichern. Die
Skripte `admin-anlegen` und `provision-import` protokollieren ebenso, als
"Skript ..." ohne Admin-ID, der Endpunkt `/api/provision-import` als "Import
per Token". Ein unveränderter Import ohne nachgeholte Mail schreibt nichts
und bekommt darum keinen Eintrag.
**Neue Admin-Aktionen** bekommen einen
Schlüssel in `AKTIONEN` und eine Funktion in `admin-aktionen.ts`;
`tests/admin-protokoll.test.ts` schlägt fehl, sobald eine Admin-Seite einen
schreibenden Baustein oder SQL direkt aufruft.

Unveränderlich: der Code enthält kein UPDATE oder DELETE auf
`admin_protokoll` (der Test prüft das), und ein Trigger lehnt UPDATE,
TRUNCATE und das Löschen jüngerer Zeilen in der Datenbank ab. Keine
Fremdschlüssel, damit auch ein gelöschter Benutzer keine Zeile verändert.
**Aufbewahrung 24 Monate.** Danach entfernt Michi alte Zeilen einmal im Jahr
von Hand im SQL-Editor von Neon; der Trigger lässt nur Zeilen durch, die
älter als 24 Monate sind:

```
DELETE FROM admin_protokoll WHERE zeitpunkt < now() - interval '24 months';
```

**Dubletten** (`src/lib/dubletten.ts`, `/admin/dubletten`). Beim Anlegen und
beim Ändern von Name, Ort oder Telefon eines Kunden prüft das Portal, ob
derselbe Betrieb schon eingetragen ist, bei irgendeinem Vertriebler.
Verglichen werden normalisierte Werte: Name ohne Rechtsform (GmbH, UG, e.K.,
GmbH & Co. KG und andere), ohne Groß und Klein, Sonderzeichen und Leerraum,
Umlaute ausgeschrieben (NFC und NFD gleich); Ort ohne Postleitzahl und
Klammerzusatz; Telefon nur als Ziffern, +49 und 0049 werden 0. Gleich ist ein
Betrieb bei gleicher Telefonnummer (ab sechs Ziffern) oder bei gleichem Namen
und gleichem oder fehlendem Ort. Ein Vertriebler sieht dann nur "Dieser
Betrieb wird bereits betreut, bitte mit Michael Henning klären." und kann
nicht speichern; er erfährt weder wer noch welche Daten. Gleichzeitig entsteht
eine Meldung in `dubletten_meldungen` (nur Name, Ort, Telefon des Versuchs).
Der Admin sieht unter `/admin/dubletten` beide Seiten und entscheidet: beim
Bisherigen lassen, dem Anfragenden zuordnen (der bisherige Eintrag wird
gelöscht, Notiz und Ansprechpartner wandern nicht mit) oder beide behalten.
Nach Zuordnen oder Freigabe kann der Anfragende speichern. Speichert der
Admin selbst einen Kunden, sieht er die Treffer und kann mit einem Haken
"Trotzdem speichern" freigeben, das wird protokolliert. Außerdem listet die
Seite Dubletten, die schon im Bestand liegen.

**Stufe.** Jeder Vertriebler hat Stufe 1 oder 2 (Migration
`006-stufe-briefing.sql`, Spalten `stufe`, `stufe_seit`,
`stufe_bestaetigt_am` in `benutzer`, jede Änderung in `stufen_protokoll`).
Neue Zugänge starten mit Stufe 1. Der Admin setzt die Stufe unter
**Admin** → **Vertriebler** → Person, mit Datum ab wann und dem Datum der
Bestätigung in Textform, die der Vertrag für Stufe 2 verlangt. Ohne dieses
Datum lässt sich Stufe 2 nicht setzen. Logik in `src/lib/stufe.ts`.

**Preisrechner.** `/preisrechner` rechnet mit denselben Zahlen wie dekaru.de:
Pakete, Bausteine, die Funktion nur im Paket Groß, Hosting und die
Zusatzleistungen. Die Zahlen stehen in `src/data/preise.json`, die nie von
Hand geändert wird. `npm run preise-sync` liest sie aus
`dekaru-website/site/src/data/preise.ts` und `hosting.ts` sowie aus
`dekaru-rechnungen/preise.json` (Block `leistungen.einmalig`) und schreibt die
Datei neu; `npm run preise-pruefen` meldet nur Abweichungen, ebenso
`tests/preise-sync.test.ts`. Nach jeder Preisänderung auf dekaru.de also
einmal syncen und die Datei committen, weil Vercel die anderen Repos nicht
sieht. Sichtbar sind die Zahlen nur für Admin und Stufe 2: Summe, Hosting mit
dem Hinweis auf die ersten zwölf bezahlten Monate und die eigene Provision
(35 %, einschließlich etwaiger Umsatzsteuer). Stufe 1 sieht nur "ab 600 €"
und den Hinweis, dass Michael Henning den Preis nennt; die Prüfung liegt auf
dem Server, nicht im Markup. Ohne JavaScript rechnet der Knopf
**Berechnen** auf dem Server, mit JavaScript aktualisiert sich die Summe
sofort (`src/scripts/preisrechner.ts`).

**Briefing-Bogen.** Der Bogen aus Blatt 11 als Formular (`/briefing`), immer
an einen Betrieb aus "Meine Kunden" gebunden, Teil A wird daraus vorbelegt.
Zwischenspeichern geht jederzeit, ohne Pflichtfelder; **An Michael Henning
schicken** prüft die Pflichtangaben und setzt den Status auf eingereicht,
danach ist der Bogen für den Vertriebler gesperrt. Der Admin sieht unter
**Admin** → **Briefing-Bögen** nur abgeschickte Bögen, Entwürfe bleiben beim
Vertriebler. Dort lädt er die Angebots-Eingabe als YAML herunter
(`src/lib/angebot-yaml.ts`, Format von
`dekaru-rechnungen/angebote/eingang/_beispiel.yaml`), legt sie nach
`angebote/eingang/` und ruft `/angebot` auf. Paket und Bausteine stehen nur als
Schlüssel darin, die Preise setzt das Angebotssystem aus seiner eigenen
`preise.json`. Kundendatei, Zuordnung zum Vertriebler, Angaben für Werkvertrag
und AVV sowie Teil G stehen als Kommentar dabei. Der Download markiert den
Bogen als übernommen; **Zur Überarbeitung zurückgeben** macht ihn wieder zum
Entwurf. Datensparsam: nur die Felder, die Angebot und Verträge brauchen.
Einträge wie "Passwort:", "Kennwort ist", "PIN:" oder "Login:" sperren das
Speichern, auch als Entwurf (`enthaeltPasswort` in `src/lib/briefing.ts`).
`tests/angebot-yaml.test.ts` liest die erzeugte Datei mit dem YAML-Parser
und der Paketlogik aus `dekaru-rechnungen`, wenn das Repo daneben liegt.

**Provision automatisch.** `POST /api/provision-import` nimmt eine Abrechnung
als JSON entgegen, gesendet von `npm run provision -- --monat JJJJ-MM --senden`
in dekaru-rechnungen. Kein Login, Schutz über `Authorization: Bearer <Token>`
gegen `PROVISION_IMPORT_TOKEN` (zeitkonstanter Vergleich über SHA-256, ohne
eingerichtetes Token oder unter 32 Zeichen immer 401, Token in der URL zählt
nicht). Fünf Fehlversuche je IP sperren 15 Minuten (Tabelle `login_versuche`,
Schlüssel `provision-import:<ip>`), erfolgreiche Anfragen zählen nicht. Nur
`application/json` bis 2 MB, dieselbe Prüfung wie der Upload. `?pruefen=1`
prüft nur und sagt, ob neu, ersetzt oder unverändert. Gleicher Monat und Slug
ersetzt wie beim Upload; ist der Inhalt gleich (das Feld `erstellt` zählt
nicht), wird nichts geschrieben und keine Mail verschickt. Logik in
`src/lib/provision-import.ts`, der Pfad ist in `zugriff.ts` als Token-Pfad von
Login und CSRF ausgenommen, genau dieser eine Pfad.

Nach einem neuen oder geänderten Import, auch per Upload im Admin, bekommt der
Vertriebler mit diesem Slug eine Mail "Ihre Provisionsabrechnung für <Monat>
ist im Portal" mit Link, ohne Beträge. Abschalten unter `/einstellungen`
(Spalte `benutzer.provision_mail`). Versand per SMTP über `PORTAL_SMTP_*`, die
gleichen Regeln wie im Formulardienst: STARTTLS ist bei Port 587 Pflicht,
Anmeldung immer, Zertifikat wird geprüft. Weil nodemailer im Portal nicht
installiert ist, steckt ein kleiner eigener Client in `src/lib/smtp.ts`; wer
lieber nodemailer will, tauscht nur `smtpVersender()`. Fehlen die Variablen,
geht keine Mail raus und der Admin sieht unter Provision einen Hinweis. Was mit
der Mail geschah, steht je Abrechnung in der Spalte `benachrichtigung`
(Migration `008-provision-import.sql`). Ein Mailfehler macht den Import nicht
rückgängig. Jeder Import steht im Admin-Protokoll, per Token als "Import per
Token" ohne Admin-ID, dazu eine Zeile ohne Beträge im Vercel-Log.

## Lokale Entwicklung

```
cd app
npm install
npm run dev            # http://localhost:4321, Datenbank im Speicher
```

Damit die Daten den Neustart überleben:

```
cp .env.example .env   # enthält PGLITE_PFAD=./.pglite
npm run admin:anlegen -- --email michi@example.de --name "Michael Henning"
npm run dev
```

Das Skript gibt ein Einmal-Passwort aus. Nach dem Login verlangt das Portal ein
eigenes Passwort.

```
npm test               # Vitest: Login, Zugriff, Kunden, Wiedervorlage, Kalender,
                       # Cockpit, Quiz, Provision, Admin, Stufe, Preise, Sync,
                       # Briefing, Angebots-YAML
npm run check          # Typen
npm run build          # Vercel-Build nach .vercel/output
ADAPTER=node npm run build && PGLITE_PFAD=./.pglite node dist/server/entry.mjs
                       # eigenständiger Server auf Port 4321, für Lighthouse
```

Lighthouse (mobil, Chrome headless, angemeldet, Stand 02.10.2026, hell und
dunkel): Start, Lernen, Lernkarte, Abfrage, Gespräch, Kunden jeweils
Performance 100, Accessibility 100, Best Practices 100. Stand 04.10.2026:
Start (Vertriebler und Admin), Kalender Woche und Monat, Wiedervorlagen,
Einstellungen jeweils Performance 99, Accessibility 100, Best Practices 100. SEO liegt bei 45 bis 50
und bleibt es: das Portal trägt `noindex` und hat keine öffentlichen Seiten.

## Einrichtung durch Michi, Schritt für Schritt

Menünamen englisch, wie sie auf dem Mac und bei Vercel erscheinen.

### 1. GitHub-Repo anlegen

1. Auf github.com: **New repository**, Owner `MichiConsulting`, Name
   `dekaru-partner`, **Private**, ohne README. **Create repository**.
2. Im Terminal:
   ```
   cd ~/dekaru/dekaru-partner
   git remote add origin git@github.com:MichiConsulting/dekaru-partner.git
   git push -u origin main
   ```

### 2. Vercel-Projekt importieren

1. vercel.com, Team **MichiConsulting's projects** oben links wählen.
2. **Add New…** → **Project** → bei `dekaru-partner` auf **Import**.
3. **Framework Preset**: Astro. **Root Directory**: auf **Edit** klicken und
   `app` wählen. Das ist wichtig, sonst findet Vercel weder `package.json`
   noch `vercel.json`.
4. Noch **nicht** auf Deploy klicken, erst die Datenbank (Schritt 3), weil der
   Build ohne `DATABASE_URL` zwar durchläuft, die Seite dann aber beim ersten
   Aufruf einen Fehler zeigt. Alternativ deployen und nach Schritt 3 unter
   **Deployments** → **⋯** → **Redeploy**.

### 3. Neon-Datenbank in Frankfurt anlegen

1. Im Vercel-Projekt: Reiter **Storage** → **Create Database** (oder
   **Connect Store**) → unter **Marketplace Database Providers** **Neon**
   wählen → **Continue**.
2. Plan **Free** reicht zum Start (0,5 GB, schläft bei Nichtnutzung ein, der
   erste Aufruf dauert dann eine Sekunde länger). **Continue**.
3. **Database Name** `dekaru-partner`, **Region** **Frankfurt, Germany
   (eu-central-1)**. Vercel zeigt hier die AWS-Region, Frankfurt ist die
   einzige deutsche. **Create**.
4. Bei **Connect to project** das Projekt `dekaru-partner` und die
   Environments **Production**, **Preview**, **Development** angehakt lassen,
   **Connect**. Vercel legt damit `DATABASE_URL` und einige weitere Variablen
   (`POSTGRES_URL`, `DATABASE_URL_UNPOOLED`, …) automatisch im Projekt an. Das
   Portal braucht nur `DATABASE_URL`; sie zeigt auf den Pooler-Endpunkt
   (`-pooler` im Hostnamen), genau richtig für Serverless.

### 4. Umgebungsvariablen prüfen

Vercel-Projekt → **Settings** → **Environment Variables**. Dort muss
`DATABASE_URL` stehen (aus Schritt 3). Weitere Variablen braucht das Portal
nicht. `PGLITE_PFAD` bleibt lokal in `.env` und wird nie eingetragen.

### 5. Schema anlegen und ersten Admin erzeugen

Beides läuft einmalig vom Mac aus gegen die Neon-Datenbank. Die Verbindung
holt sich Michi so, dass sie nie in einer Datei landet:

1. Vercel → **Storage** → die Neon-Datenbank → **.env.local** Reiter → bei
   `DATABASE_URL` auf **Copy Snippet** (oder in Neon: **Connect** →
   Connection string kopieren, mit `?sslmode=require`).
2. Im Terminal, den Wert nur in dieser einen Shell setzen:
   ```
   cd ~/dekaru/dekaru-partner/app
   export DATABASE_URL='postgres://…?sslmode=require'
   npm run db:migrate
   npm run admin:anlegen -- --email <michis Adresse> --name "Michael Henning"
   unset DATABASE_URL
   ```
   Das zweite Skript gibt das Einmal-Passwort aus. Es gilt für den ersten
   Login, danach verlangt das Portal ein eigenes.

`db:migrate` ist wiederholbar und wendet nur an, was fehlt. Kommt eine neue
`NNN-…sql` dazu, denselben Befehl noch einmal.

**Offen seit Gesprächshilfe, neuem Lernbereich und Cockpit:**
`002-pflichtsaetze.sql` (Tabelle `pflichtsatz_antworten`), `003-lernen.sql`
(Tabellen `lernkarten_stand` und `abfrage_durchlaeufe`),
`004-einmal-passwort-ablauf.sql` und `005-wiedervorlage-kalender.sql`
(Wiedervorlage-Spalten an `kunden`, Tabelle `kalender_token`) sind auf der
Live-Datenbank noch nicht angewendet. Vor dem Merge nach `main` einmalig vom
Mac aus:

```
cd ~/dekaru/dekaru-partner/app
export DATABASE_URL='postgres://…?sslmode=require'
npm run db:migrate        # meldet "Angewendet: 2, 3, 4, 5"
unset DATABASE_URL
```

Bis dahin zeigen `/gespraech`, `/gespraech/ueben`, der Admin-Lernstand, der
Lernbereich, die Startseite, `/kunden` und `/kalender` auf partner.dekaru.de
einen Fehler, weil Tabellen und Spalten fehlen.

**Offen seit dem Admin-Ausbau:** `007-admin-ausbau.sql` (Tabellen
`admin_protokoll`, `kunden_statuswechsel`, `dubletten_meldungen`, zwei
Trigger) muss vor dem Deploy des zugehörigen Codes gegen Neon laufen, sonst
scheitern Admin-Aktionen und das Speichern von Kunden. Derselbe Befehl wie
oben, er meldet dann unter anderem "Angewendet: 7". Die Migration hängt nur von
Version 1 ab; laufen 005, 006 oder 008 erst danach, ist das unschädlich.

### 6. Deployen und Region prüfen

1. **Deployments** → neuestes Deployment → **Redeploy**, oder einfach ein
   `git push`. Vercel deployt jeden Push auf `main` automatisch; Preview-URLs
   entstehen für andere Branches.
2. Region prüfen: `app/vercel.json` setzt `"regions": ["fra1"]`. Zur
   Kontrolle im Projekt **Settings** → **Functions** → **Function Region**
   muss **Frankfurt, Germany (fra1)** stehen. Steht dort etwas anderes,
   überschreibt `vercel.json` es beim nächsten Deploy; sicherheitshalber dort
   ebenfalls Frankfurt wählen.
3. Die `*.vercel.app`-URL aufrufen, anmelden, Passwort setzen.

### 7. Domain partner.dekaru.de

1. Vercel-Projekt → **Settings** → **Domains** → `partner.dekaru.de` eintragen
   → **Add**. Vercel zeigt dann den benötigten DNS-Eintrag: für eine Subdomain
   ein **CNAME**. Der Wert ist in der Regel `cname.vercel-dns.com`, neuere
   Projekte bekommen manchmal eine nummerierte Variante wie
   `cname.vercel-dns-0.com`. **Immer den Wert nehmen, den Vercel anzeigt.**
2. Bei INWX: **Nameserver** → `dekaru.de` → **DNS-Einträge** → **Eintrag
   hinzufügen**: Typ **CNAME**, Name `partner`, Wert wie von Vercel angezeigt,
   TTL 3600. Speichern.
3. Zurück bei Vercel unter **Domains** auf **Refresh**. Nach wenigen Minuten
   steht **Valid Configuration**, das Zertifikat stellt Vercel automatisch aus.
4. `https://partner.dekaru.de` aufrufen. Das Cookie ist auf `Secure` gesetzt,
   der Login funktioniert nur über HTTPS.

### 8. Vertriebler einladen

Im Portal **Admin** → **Vertriebler** → Name, E-Mail, Vertriebler-Slug (genau
wie in `dekaru-rechnungen/vertriebler.json`), **Anlegen**. Das Einmal-Passwort
wird einmal angezeigt und persönlich weitergegeben, nie per Mail mit dem
Login-Link zusammen. Deaktivieren beendet sofort alle Sitzungen.

### 9. Provision monatlich

**Vor dem ersten Deploy dieses Stands:** `008-provision-import.sql` muss auf
Neon laufen, sonst scheitern Provisionsseiten, Einstellungen und Import an den
fehlenden Spalten:

```
cd ~/dekaru/dekaru-partner/app
export DATABASE_URL='postgres://…?sslmode=require'
npm run db:migrate
unset DATABASE_URL
```

**Token für den automatischen Import, einmalig:**

1. `openssl rand -hex 32 | pbcopy` erzeugt das Token direkt in die
   Zwischenablage.
2. `security add-generic-password -a "$USER" -s dekaru-portal-import -U -w`
   und bei der Frage mit Cmd+V einfügen. Damit liegt es im macOS-Schlüsselbund.
3. Vercel → Projekt → **Settings** → **Environment Variables**: Key
   `PROVISION_IMPORT_TOKEN`, Value Cmd+V, nur **Production**, **Sensitive**
   anhaken, **Save**, danach **Redeploy**.
4. `pbcopy < /dev/null` leert die Zwischenablage.

**Mail an die Vertriebler, einmalig:** dieselben Werte wie beim Formulardienst
(Google Workspace SMTP-Relay), nur mit dem Präfix `PORTAL_SMTP_`:
`PORTAL_SMTP_HOST` (`smtp-relay.gmail.com`), `PORTAL_SMTP_PORT` (`587`),
`PORTAL_SMTP_SECURE` (`false`), `PORTAL_SMTP_USER`, `PORTAL_SMTP_PASS`,
`PORTAL_SMTP_FROM`. Ebenfalls nur Production, `PORTAL_SMTP_PASS` als
Sensitive. Im Google-Admin muss das Relay die Anmeldung mit diesem Konto
erlauben (wie beim Formulardienst).

**Ablauf am Fünften:**

```
cd ~/dekaru/dekaru-rechnungen
npm run provision -- --monat 2026-10                  # erzeugen, md prüfen
export PORTAL_URL=https://partner.dekaru.de
export PORTAL_IMPORT_TOKEN="$(security find-generic-password -a "$USER" -s dekaru-portal-import -w)"
npm run provision -- --monat 2026-10 --senden --trockenlauf
npm run provision -- --monat 2026-10 --senden
unset PORTAL_IMPORT_TOKEN
```

Die Ausgabe zeigt je Vertriebler neu, ersetzt oder unverändert und ob die Mail
rausging. Danach überweisen und hier **Ausgezahlt** markieren.

Der bisherige Weg bleibt:

```
cd ~/dekaru/dekaru-rechnungen && npm run provision          # schreibt md und json
cd ~/dekaru/dekaru-partner/app
export DATABASE_URL='…' && npm run provision:import -- --monat 2026-10 && unset DATABASE_URL
```

Oder im Portal **Admin** → **Provision importieren** und die JSON-Dateien aus
`dekaru-rechnungen/provision/<Monat>/` hochladen. Nach der Überweisung dort
**Ausgezahlt** mit Datum markieren.

## Datenschutz

### Unterauftragsverarbeiter

| Dienst | Zweck | Standort | Grundlage |
|---|---|---|---|
| Vercel Inc. | Hosting, Serverless-Funktionen, Logs | Funktionen in Frankfurt (fra1), Edge-Netz weltweit, Unternehmenssitz USA | Vercel DPA mit EU-Standardvertragsklauseln, im Vercel-Dashboard unter Settings → Legal akzeptieren; AVV-Eintrag in `dekaru-rechnungen` (Anlage 3) ergänzen |
| Neon Inc. | Postgres-Datenbank | AWS eu-central-1 (Frankfurt) | Neon DPA (über den Vercel Marketplace, zusätzlich bei neon.tech/dpa), ebenfalls in Anlage 3 aufnehmen |
| Google (Workspace) | Versand der Provisionsmail über das SMTP-Relay | EU/USA nach Workspace-Vertrag | Google Workspace Data Processing Amendment, wie beim Formulardienst |

Beides sind US-Unternehmen mit Datenhaltung in Frankfurt. Für die Übermittlung
gelten die Standardvertragsklauseln beider DPAs; das Data Privacy Framework
kann zusätzlich genannt werden, wenn der Anbieter zertifiziert ist (bei Vercel
der Fall, bei Neon prüfen).

### Was in die Datenschutzerklärung für Vertriebler gehört

Die Seite `/datenschutz` enthält den Text mit `{{…}}`-Platzhaltern für
Anschrift, Kontakt, Fristen und die Vertragsdaten der Anbieter. Zu füllen
oder zu prüfen:

- Verantwortlicher mit Anschrift, E-Mail, Telefon.
- Zweck und Rechtsgrundlage: Partnervertrag (Art. 6 Abs. 1 lit. b), Kundenkontakte
  im berechtigten Interesse (lit. f), Kaltakquise nur B2B nach § 7 UWG.
- Datenkategorien: Zugangsdaten, Lernfortschritt, selbst eingetragene
  Kundenkontakte (nur geschäftlich), Provisionsaufstellung, IP-Adresse kurz
  beim Login, Server-Logs beim Hoster. Dazu die E-Mail-Adresse für die
  Benachrichtigung über neue Abrechnungen (ohne Beträge, abschaltbar).
- Cookie `dp_sitzung`, technisch notwendig, kein Tracking, keine Dritten.
- Empfänger Vercel und Neon mit Standort und Grundlage.
- Speicherdauer: Zugang bis Ende der Zusammenarbeit, Provisionsaufstellungen
  nach steuerlicher Aufbewahrungsfrist, Kundenkontakte bis sie nicht mehr
  gebraucht werden.
- Betroffenenrechte und Aufsichtsbehörde (LfDI Baden-Württemberg).

Außerdem gehört das Portal ins Verarbeitungsverzeichnis, und die Vertriebler
sollten im Partnervertrag auf die Datensparsamkeit bei Kundenkontakten
verpflichtet werden (nur geschäftliche Daten von Gewerbetreibenden).

## Offene Punkte

- Datenschutzseite: Platzhalter füllen, Text vor dem ersten Vertriebler
  prüfen lassen.
- "Stufe ändern" gibt es im Portal noch nicht. Der Protokollschlüssel
  `stufe_geaendert` steht bereit, die Aktion selbst gehört dann in
  `admin-aktionen.ts`.
- Datenschutzseite: Admin-Protokoll (Nachvollziehbarkeit der Verwaltung,
  24 Monate) und Dublettenprüfung noch aufnehmen.
- Passwort vergessen: gibt es bewusst nicht als Selbstbedienung. Michi setzt im
  Admin ein neues Einmal-Passwort.
- Grafiken werden als `<img>` eingebunden, ihre Schriften fallen deshalb auf
  `system-ui` zurück (so in `inhalt/README.md` vorgesehen).
- Astro 6 markiert `markdown.rehypePlugins` als veraltet. Fällt es weg,
  liefert die Route `/lernen/grafiken/<datei>` die Bilder trotzdem aus.
- Admin-Schreibvorgänge für Stufe und Briefing laufen je über eine Funktion
  (`setzeStufe` in `stufe.ts`, `setzeStatusAdmin` in `briefing.ts`). Sobald
  `admin-aktionen.ts` mit `protokolliere()` aus dem Zweig `admin-ausbau` da
  ist, dort den Aufruf ergänzen.
