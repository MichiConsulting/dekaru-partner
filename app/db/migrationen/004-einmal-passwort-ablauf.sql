-- dekaru Partner-Portal, Schema Version 4: Ablauf fuer Einmal-Passwoerter.
-- Wiederholbar wie die vorigen Versionen. Anwenden mit: npm run db:migrate
--
-- WICHTIG VOR DEM DEPLOY: diese Migration muss gegen Neon gelaufen sein,
-- bevor der zugehoerige Code live geht. Ohne die Spalte schlagen Logins
-- fehl, weil auth.ts sie beim SELECT erwartet.

ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS einmal_passwort_bis timestamptz;

-- Ohne diese Zeile gilt fuer jede bereits offene Einladung (Spalte noch
-- NULL) "nicht abgelaufen", und die neue Frist liefe erst beim naechsten
-- Zuruecksetzen des Passworts ins Leer. 72 Stunden ab jetzt entspricht der
-- Frist in auth.ts (EINMAL_PASSWORT_GUELTIG_STUNDEN).
UPDATE benutzer SET einmal_passwort_bis = now() + interval '72 hours'
  WHERE passwort_wechsel_noetig AND einmal_passwort_bis IS NULL;

INSERT INTO schema_version (version) VALUES (4) ON CONFLICT DO NOTHING;
