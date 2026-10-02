# dekaru Partner-Portal

Website für die Vertriebspartner von dekaru, später unter `partner.dekaru.de`.
Jeder Vertriebler hat einen eigenen Login und sieht drei Bereiche:

1. **Lernen**: jedes Kapitel als 4 bis 8 Lernkarten mit Grafiken, Kennzahlen
   und Merksätzen, der lange Text bleibt unter "Ausführlich lesen". Danach die
   Abfrage auf einer eigenen Seite, eine Frage je Seite (Auswahl, Wahr/Falsch,
   Zuordnen, Lückentext), Auflösung erst nach der Antwort, am Ende eine
   Ergebnisseite. Fortschritt und Punkte werden je Person gespeichert, falsche
   Fragen lassen sich wiederholen.
2. **Meine Kunden**: eigene Betriebe eintragen, Status pflegen, filtern,
   Termine und Abschlüsse des Monats sehen. Niemand sieht fremde Einträge.
3. **Meine Provision**: die Monatsaufstellungen aus `dekaru-rechnungen`, mit
   entstandener, ausgezahlter und aufgelaufener Provision und den Regeln.

Dazu ein **Admin-Bereich** für Michi: Zugänge anlegen und deaktivieren
(Einladung mit Einmal-Passwort), alle Kunden, Lernstand, Provision importieren.

## Aufbau

```
dekaru-partner/
  inhalt/            Kapitel (NN-name.md), quiz.json, grafiken/*.svg   (anderer Agent)
  pdf/               Informationsblatt als PDF                          (anderer Agent)
  app/               dieses Portal
    astro.config.mjs Astro 6, SSR, Vercel-Adapter, Region fra1 in vercel.json
    db/migrationen/  Schema als SQL, wiederholbar
    scripts/         db-migrate, admin-anlegen, provision-import
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
weiter in `quiz_antworten`. Styles nur in `styles/lernen.css`.

**Provision.** `dekaru-rechnungen/provision.mjs` schreibt neben jeder
Markdown-Aufstellung eine `<slug>.json` (`lib/provision-json.mjs`, Format 1).
Das Portal prüft die Datei (`src/lib/provision.ts`, Summen müssen zu den Zeilen
passen), legt sie in `provision_abrechnungen` ab und zeigt sie dem Vertriebler,
dessen `vertriebler_slug` zum Slug in `vertriebler.json` passt. Import
entweder im Admin-Bereich (Datei hochladen) oder per Skript. Der Admin markiert
eine Abrechnung als ausgezahlt, dann zählt sie als überwiesen.

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
npm test               # Vitest: Login, Zugriff, Kunden, Quiz, Provision
npm run check          # Typen
npm run build          # Vercel-Build nach .vercel/output
ADAPTER=node npm run build && PGLITE_PFAD=./.pglite node dist/server/entry.mjs
                       # eigenständiger Server auf Port 4321, für Lighthouse
```

Lighthouse (mobil, Chrome headless, angemeldet, Stand 30.09.2026): Login,
Start, Kapitel, Kunden jeweils Performance 97 bis 99, Accessibility 100, Best
Practices 100. Desktop 100/100/100. SEO liegt bei 45 bis 50 und bleibt es: das
Portal trägt `noindex` und hat keine öffentlichen Seiten.

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
Datei unter `db/migrationen/` dazu, denselben Befehl noch einmal. Aktuell
`002-lernen.sql` (Lernbereich): nach dem Merge einmal gegen die Live-Datenbank
ausführen, sonst fehlen die Tabellen `lernkarten_stand` und
`abfrage_durchlaeufe` und der Lernbereich bricht mit einem Fehler ab.

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
  beim Login, Server-Logs beim Hoster.
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
- Passwort vergessen: gibt es bewusst nicht als Selbstbedienung. Michi setzt im
  Admin ein neues Einmal-Passwort.
- Grafiken werden als `<img>` eingebunden, ihre Schriften fallen deshalb auf
  `system-ui` zurück (so in `inhalt/README.md` vorgesehen).
- Astro 6 markiert `markdown.rehypePlugins` als veraltet. Fällt es weg,
  liefert die Route `/lernen/grafiken/<datei>` die Bilder trotzdem aus.
