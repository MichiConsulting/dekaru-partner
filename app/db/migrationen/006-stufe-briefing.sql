-- dekaru Partner-Portal, Schema Version 6: Stufe je Vertriebler und der
-- digitale Briefing-Bogen. Wiederholbar wie die vorigen Versionen.
-- Anwenden mit: npm run db:migrate
--
-- Haengt nur von Version 1 ab (benutzer, kunden). Die Versionen 5, 7 und 8
-- entstehen parallel in anderen Zweigen und werden hier nicht vorausgesetzt.

-- Stufe nach § 1 Absatz 5 und 6 des Vertriebspartnervertrags. Stufe 1: die
-- ersten fuenf Zweittermine gemeinsam, "ab 600 Euro" ist die einzige Zahl.
-- Stufe 2: der Vertriebler nennt Paketpreis und Bausteine aus dem Preisrechner
-- selbst. Der Beginn von Stufe 2 wird ihm in Textform bestaetigt; dieses
-- Datum steht in stufe_bestaetigt_am.
ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS stufe integer NOT NULL DEFAULT 1 CHECK (stufe IN (1, 2));
ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS stufe_seit date;
ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS stufe_bestaetigt_am date;

-- Jede Aenderung der Stufe bleibt nachvollziehbar: wer, wann, welche Stufe,
-- ab wann, und wann die Bestaetigung in Textform rausging.
CREATE TABLE IF NOT EXISTS stufen_protokoll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  stufe integer NOT NULL CHECK (stufe IN (1, 2)),
  seit date NOT NULL,
  bestaetigt_am date,
  gesetzt_von uuid REFERENCES benutzer(id) ON DELETE SET NULL,
  gesetzt_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stufen_protokoll_benutzer ON stufen_protokoll(benutzer_id);

-- Der Briefing-Bogen (Blatt 11) zu einem Kunden aus "Meine Kunden". Nur der
-- Vertriebler, dem der Kunde gehoert, sieht und fuellt den Bogen; der Admin
-- sieht alle. Die Felder liegen als JSON in "daten", weil der Bogen sich mit
-- dem Kit aendert und keine Spalte je Frage braucht. Wird der Kunde
-- geloescht, bleibt der Bogen mit den Angaben aus "daten" erhalten.
CREATE TABLE IF NOT EXISTS briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  kunde_id uuid REFERENCES kunden(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf', 'eingereicht', 'uebernommen')),
  daten jsonb NOT NULL DEFAULT '{}'::jsonb,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  eingereicht_am timestamptz,
  -- Wann der Admin die Angebots-Eingabe (YAML) erzeugt hat.
  uebernommen_am timestamptz
);
CREATE INDEX IF NOT EXISTS briefings_benutzer ON briefings(benutzer_id);
CREATE INDEX IF NOT EXISTS briefings_status ON briefings(status);

INSERT INTO schema_version (version) VALUES (6) ON CONFLICT DO NOTHING;
