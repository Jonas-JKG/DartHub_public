# Sicherheit

Bitte keine aktiven Schlüssel, Passwörter, Sitzungstoken, Bestätigungslinks oder personenbezogenen Daten in öffentlichen Issues veröffentlichen. Für Schwachstellen nach Möglichkeit GitHubs private Sicherheitsmeldung verwenden, sobald sie im Repository aktiviert ist. Falls kein privater Meldeweg angeboten wird, öffentlich nur um einen vertraulichen Kontakt bitten und keine ausnutzbaren Details posten.

Echte Zugangsdaten gehören ausschließlich in lokale Umgebungsdateien beziehungsweise die Konfiguration von Vercel und Supabase. Secret-/Service-Role-Schlüssel dürfen nicht als `NEXT_PUBLIC_`-Variablen bereitgestellt werden. Datenbank-Zugriffsregeln, Sitzungskontrollen und Ratenlimits müssen erhalten bleiben.

Bei einem tatsächlichen Schlüssel-Leak zuerst den betroffenen Schlüssel beim Anbieter sperren/ersetzen, danach Dateien und Historie bereinigen. Das Löschen einer Datei allein macht veröffentlichte Geheimnisse nicht wieder geheim.

Der öffentliche Quellstand wurde statisch auf typische Geheimnismuster geprüft. Das ist keine Garantie gegen sämtliche Sicherheitslücken. Die Absicherung der eigenen Installation, E-Mail-Zustellung und Konfiguration muss separat geprüft werden.
