-- dekaru Partner-Portal, Schema Version 4: Ablauf fuer Einmal-Passwoerter.
-- Wiederholbar wie die vorigen Versionen. Anwenden mit: npm run db:migrate
--
-- WICHTIG VOR DEM DEPLOY: diese Migration muss gegen Neon gelaufen sein,
-- bevor der zugehoerige Code live geht. Ohne die Spalte schlagen Logins
-- fehl, weil auth.ts sie beim SELECT erwartet.

ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS einmal_passwort_bis timestamptz;

INSERT INTO schema_version (version) VALUES (4) ON CONFLICT DO NOTHING;
