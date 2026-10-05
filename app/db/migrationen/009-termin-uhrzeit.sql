-- dekaru Partner-Portal, Schema Version 9: Termine mit Uhrzeit und Dauer.
-- Wiederholbar wie die vorigen Versionen. Anwenden mit: npm run db:migrate
--
-- WICHTIG VOR DEM DEPLOY: diese Migration muss gegen Neon gelaufen sein,
-- bevor der zugehoerige Code live geht. Startseite, Kunden und Kalender
-- lesen die neuen Spalten.

-- Beginn als Wanduhrzeit in Europe/Berlin (time ohne Zeitzone), Dauer in
-- Minuten. Ohne Beginn bleibt ein Termin ganztaegig, so wie alle bisherigen.
-- Die Dauer setzt das Portal bei gesetzter Uhrzeit auf 60, wenn nichts
-- anderes angegeben ist.
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS termin_beginn time;
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS termin_dauer_minuten integer;

-- Eine Uhrzeit gibt es nur zu einem Datum, eine Dauer nur zu einer Uhrzeit,
-- und die Dauer liegt zwischen 5 Minuten und 12 Stunden.
ALTER TABLE kunden DROP CONSTRAINT IF EXISTS kunden_termin_beginn_mit_datum;
ALTER TABLE kunden ADD CONSTRAINT kunden_termin_beginn_mit_datum
  CHECK (termin_beginn IS NULL OR termin_datum IS NOT NULL);
ALTER TABLE kunden DROP CONSTRAINT IF EXISTS kunden_termin_dauer_mit_beginn;
ALTER TABLE kunden ADD CONSTRAINT kunden_termin_dauer_mit_beginn
  CHECK (termin_dauer_minuten IS NULL OR termin_beginn IS NOT NULL);
ALTER TABLE kunden DROP CONSTRAINT IF EXISTS kunden_termin_dauer_bereich;
ALTER TABLE kunden ADD CONSTRAINT kunden_termin_dauer_bereich
  CHECK (termin_dauer_minuten IS NULL OR termin_dauer_minuten BETWEEN 5 AND 720);

INSERT INTO schema_version (version) VALUES (9) ON CONFLICT DO NOTHING;
