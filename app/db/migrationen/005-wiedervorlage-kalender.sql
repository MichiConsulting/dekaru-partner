-- dekaru Partner-Portal, Schema Version 5: Wiedervorlage und Kalender-Abo.
-- Wiederholbar wie die vorigen Versionen. Anwenden mit: npm run db:migrate
--
-- WICHTIG VOR DEM DEPLOY: diese Migration muss gegen Neon gelaufen sein,
-- bevor der zugehoerige Code live geht. Ohne die Spalten schlagen die
-- Startseite, /kunden und /kalender fehl.

-- Eine Wiedervorlage je Kunde: Datum, kurzer Grund, und wann sie erledigt
-- wurde. Offen heisst: Datum gesetzt und erledigt_am leer. Eine neue
-- Wiedervorlage setzt erledigt_am wieder auf NULL.
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS wiedervorlage_am date;
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS wiedervorlage_grund text NOT NULL DEFAULT '';
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS wiedervorlage_erledigt_am timestamptz;
CREATE INDEX IF NOT EXISTS kunden_wiedervorlage ON kunden(benutzer_id, wiedervorlage_am)
  WHERE wiedervorlage_am IS NOT NULL AND wiedervorlage_erledigt_am IS NULL;

-- Persoenlicher Abo-Link fuer den Kalender (.ics). Ein Token je Benutzer,
-- in der Datenbank nur sein SHA-256, genau wie beim Sitzungs-Cookie.
-- Widerrufen loescht die Zeile, neu erzeugen ersetzt sie.
CREATE TABLE IF NOT EXISTS kalender_token (
  benutzer_id uuid PRIMARY KEY REFERENCES benutzer(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  zuletzt_abgerufen timestamptz
);

INSERT INTO schema_version (version) VALUES (5) ON CONFLICT DO NOTHING;
