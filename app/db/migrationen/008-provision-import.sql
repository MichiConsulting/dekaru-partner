-- dekaru Partner-Portal, Schema Version 8: automatischer Provisionsimport
-- mit Benachrichtigung. Wiederholbar wie die vorigen Versionen. Anwenden mit:
-- npm run db:migrate
--
-- WICHTIG VOR DEM DEPLOY: diese Migration muss gegen Neon gelaufen sein,
-- bevor der zugehoerige Code live geht. Die Provisionsseiten, die
-- Einstellungen und der Import lesen die neuen Spalten.

-- Vertriebler kann die Mail "Ihre Provisionsabrechnung ist im Portal" in den
-- Einstellungen abschalten. Standard: an.
ALTER TABLE benutzer ADD COLUMN IF NOT EXISTS provision_mail boolean NOT NULL DEFAULT true;

-- Was beim letzten Import mit der Benachrichtigung geschah, fuer den Hinweis
-- im Admin: gesendet, abgeschaltet, kein_smtp, kein_konto, fehler, und
-- ausstehend zwischen Ablegen und Versand (wird beim naechsten Senden nachgeholt).
ALTER TABLE provision_abrechnungen ADD COLUMN IF NOT EXISTS benachrichtigung text;
ALTER TABLE provision_abrechnungen ADD COLUMN IF NOT EXISTS benachrichtigt_am timestamptz;

INSERT INTO schema_version (version) VALUES (8) ON CONFLICT DO NOTHING;
