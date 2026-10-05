-- dekaru Partner-Portal, Schema Version 10: Farbpalette im Briefing-Bogen.
-- Wiederholbar wie die vorigen Versionen. Anwenden mit: npm run db:migrate
--
-- Haengt nur von Version 6 ab (Tabelle briefings). Version 9 entsteht
-- parallel in einem anderen Zweig (Kalender) und wird hier nicht
-- vorausgesetzt; die Reihenfolge 9 und 10 ist egal.
--
-- WICHTIG VOR DEM DEPLOY: diese Migration muss gegen Neon gelaufen sein,
-- bevor der zugehoerige Code live geht. Speichern, Einreichen und die
-- Admin-Liste der Boegen lesen und schreiben die neue Spalte.

-- Die Palette, die der Betrieb im Erstgespraech gewaehlt hat, als Code aus
-- dem Template-System (z. B. HW-2, siehe src/data/paletten.json). Daneben
-- steht der Wert auch in daten.felder.farbpalette; die Spalte ist da, damit
-- Michi den Code in der Liste sieht und danach filtern kann, ohne JSON zu
-- lesen. 'offen' heisst: bewusst noch nicht entschieden. NULL: nicht
-- angegeben.
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS farbpalette text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'briefings_farbpalette_format') THEN
    ALTER TABLE briefings ADD CONSTRAINT briefings_farbpalette_format
      CHECK (farbpalette IS NULL OR farbpalette = 'offen' OR farbpalette ~ '^[A-Z]{2}-[0-9]{1,2}$');
  END IF;
END $$;

-- Boegen, die den Wert schon im JSON tragen (falls Code vor der Migration lief).
UPDATE briefings
   SET farbpalette = daten->'felder'->>'farbpalette'
 WHERE farbpalette IS NULL
   AND (daten->'felder'->>'farbpalette' = 'offen' OR daten->'felder'->>'farbpalette' ~ '^[A-Z]{2}-[0-9]{1,2}$');

INSERT INTO schema_version (version) VALUES (10) ON CONFLICT DO NOTHING;
