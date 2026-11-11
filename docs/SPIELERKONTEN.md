# Spielerkonten und Turnier-Lobbys (Migration 022)

Alle Spieler verwenden ein bestätigtes E-Mail-Konto mit eindeutigem öffentlichem Nutzernamen. Jeder bestätigte Spieler darf Turniere und Training erstellen. Bestehende Konten, Turniere, Freundschaften und gespeicherte Autodarts-Verknüpfungen bleiben erhalten. Der besondere Owner-Passwortzugang bleibt unter „Weiterer Zugang“ in der Anmeldung. Die internen Tabellen- und Rollennamen bleiben für vorhandene Daten kompatibel.

## Supabase aktualisieren

1. Im SQL Editor **desselben Supabase-Projekts, das Vercel verwendet**, eine neue Abfrage öffnen.
2. Falls noch nicht installiert: [016_player_accounts.sql](../supabase/migrations/016_player_accounts.sql) vollständig ausführen. Voraussetzung sind die bisherigen Migrationen 011–015.
3. Danach [017_account_lobbies.sql](../supabase/migrations/017_account_lobbies.sql) vollständig einfügen und **Run** drücken. Nicht anschließend alte Einrichtungsskripte darüber ausführen.
4. Danach [018_navigation_email_friends.sql](../supabase/migrations/018_navigation_email_friends.sql) vollständig ausführen.
5. Danach [019_strict_email_verification.sql](../supabase/migrations/019_strict_email_verification.sql) vollständig ausführen.
6. Danach [020_username_search.sql](../supabase/migrations/020_username_search.sql) vollständig ausführen.
7. Danach [021_training_modes.sql](../supabase/migrations/021_training_modes.sql) vollständig ausführen.
8. Danach [022_clock_multiplayer.sql](../supabase/migrations/022_clock_multiplayer.sql) vollständig ausführen.
9. Die neue Vercel-Version laden. Keine neuen Environment Variables erforderlich; `MANAGER_AUTH_ENABLED=true` bleibt gesetzt.

017–022 sind wiederholbar und löschen keine Konten, Turniere oder Ergebnisse. Bestehende Konten mit Nutzernamen behalten ihre Einrichtung. Neue Konten werden unmittelbar nach der ersten Anmeldung zur Kontoeinrichtung geführt: Autodarts verbinden oder „Manuell spielen / später verbinden“. Nach Abschluss erscheint dieser Schritt nicht erneut; die Verbindung lässt sich in den Einstellungen ändern. Der Owner kann dort ebenfalls seinen öffentlichen Nutzernamen und seine Scheibe hinterlegen.

## Anmeldung und Zuschauer

Ohne Anmeldung zeigen Konto-, Turnier-, Trainings- und Matchseiten nur die Aufforderung zur Anmeldung. Die Anmeldeseite selbst hat kein Seitenmenü. Nur `/watch/<zufälliges Geheimnis>` bleibt öffentlich: eine einzelne Zuschaueransicht ohne Seitenmenü oder Bearbeitung, mit „Anmelden“ rechts oben. Der Turnier-Ersteller und Owner teilen diesen Link über „Zuschauerlink“. Gedruckte ältere Zuschauerlinks pro Konto bleiben kompatibel.

Es gibt keine Gastanmeldung, persönlichen Spielercodes, freie Spielerübernahme oder Spieler-Einladungslinks mehr. Die entsprechenden App-Seiten, API-Handler und Codegeneratoren wurden entfernt; ihre früheren Datenbank-Einstiegsfunktionen verlieren auch die Server-RPC-Freigabe. Historische Migrationen und interne Teilnehmerbindungen bleiben für bestehende Kontozuordnungen und das Scoring erhalten. Autodarts-Tickets sind Anbieterprotokoll und keine Dartbracket-Anmeldecodes.

## Turnier und Training

- Ein neues Turnier öffnet zunächst eine **Turnier-Lobby**, auch ohne fertige Teilnehmerliste. Bis zur Auslosung gibt es noch keine Paarungen.
- Über „Spieler & Regeln anpassen“ werden echte Konten gesucht und hinzugefügt oder entfernt. Freunde erscheinen zuerst; das eigene Konto trägt „Du“. Nutzernamen sind ohne Unterscheidung der Groß-/Kleinschreibung eindeutig (3–24 Buchstaben einschließlich ä/ö/ü/ß, Zahlen oder Unterstriche).
- Hinzugefügte Teilnehmer sehen das Turnier in ihrer Übersicht und erhalten eine Kontobenachrichtigung unter Freunde. Sie benötigen keinen Link und keine zusätzliche Freigabe, um ihren zugeordneten Spieler zu öffnen.
- Erst **„Auslosen und starten“** erzeugt die Paarungen: mindestens drei Teilnehmer, mit Gruppenphase mindestens vier. Die Kontozuordnungen bleiben dabei erhalten. Änderungen nach dem Start erfolgen weiterhin über die bewusste Neuauslosung mit Ergebniswarnung.
- Training verwendet den gespeicherten Nutzernamen. **„Spieler einladen“** sucht Konten einschließlich Freunden; auch Nichtfreunde können eingeladen werden. Nur der adressierte Empfänger kann die Einladung unter Freunde annehmen und den freien Platz belegen. Beide bereiten Spieler dürfen starten. Löschen, Regeln und Entfernen bleiben beim Ersteller und Owner.
- Freundschaften werden über öffentliche Nutzernamen angefragt und vom Empfänger bestätigt. Es gibt keine E-Mail-Suche und keine Freundschaftslinks mehr.
- Der Owner verwaltet und trägt Ergebnisse ein, ohne einen Spieler wechseln zu müssen. Er kann sein eigenes Konto in die Teilnehmerliste aufnehmen. Im Match steuert er weiterhin nur Seiten ohne anwesenden Spieler.

## Spielerverwaltung und Statistiken

Der Owner sieht Name, Nutzername, E-Mail, Status, erstellte Turniere insgesamt, davon laufende Turniere und gespielte Matches. Die Turnierzahlen beziehen sich auf die Erstellung, die Matchzahlen auf die tatsächliche Spielerzuordnung. Training zählt bei Matches mit, nicht bei erstellten Turnieren.

Ab 017 wird jedes beendete Match einmal pro Teilnehmerkonto dauerhaft gezählt, auch wenn das Turnier danach gelöscht oder neu ausgelost wird. Bestehende noch gespeicherte Ergebnisse werden übernommen, soweit sich die Kontozuordnung nachvollziehen lässt. Bereits früher gelöschte Ergebnisse und alte Trainingsrunden ohne eindeutige historische Kontozuordnung lassen sich nicht nachträglich rekonstruieren. Freilose zählen nicht als gespielte Matches.

## E-Mail und Passwort

E-Mail und Nutzername werden getrimmt und kleingeschrieben. Passwörter bleiben unverändert. Registrierung/Bestätigung und Passwort-Reset haben getrennte serverseitige 60-Sekunden-Wartezeiten. Die Oberfläche lädt den aktuellen Stand auch nach Neuladen oder Formularwechsel.

Ein Reset direkt nach der Registrierung wird nicht durch die Bestätigungssperre blockiert. Erzwingen Supabase oder SMTP eine gemeinsame Pause, zeigt die Anwendung den echten Fehler und die gemeinsame Restzeit an. Site URL muss die Produktionsdomain sein; erlaubte Redirect URL: `https://DEINE-DOMAIN/auth/confirm`.

Ab 019 werden **nur tatsächlich bei Supabase geprüfte E-Mail-Link-/OTP-Anmeldungen** als Bestätigung gespeichert. Versandzeit, automatisch gesetztes `email_confirmed_at` und die in 018 importierten Zeitstempel reichen nicht aus. Bestehende Spielerkonten müssen deshalb nach 019 **einmal einen neuen Bestätigungslink öffnen**; alte unbewiesene Sitzungen verlieren ihren Zugriff, auch im Match. Konten, Namen, Turniere, Freunde und Autodarts-Verknüpfungen bleiben erhalten. Die besondere Owner-Passwortanmeldung ist ausgenommen.

Die Registrierung legt auf dem Server zunächst per Auth Admin ein unbestätigtes Konto an (`email_confirm:false`), ohne Sitzung und ohne automatischen Mailversand. Danach fordert sie ausdrücklich einen E-Mail-Link über `signInWithOtp` an. Die Supabase-Secret-Key-Konfiguration wird dafür serverseitig verwendet; sie gelangt nie zum Browser. Bestehende Konten werden bei einer erneuten Registrierung weder überschrieben noch mit einem neuen Passwort versehen. Nach tatsächlicher Bestätigung funktioniert die normale Passwortanmeldung. Passwortanmeldung allein kann den Bestätigungsnachweis niemals erzeugen. Auch der Passwort-Reset kann nach einem gültigen Mail-Link den Nachweis herstellen.

Bei Registrierung oder erfolglosem Kontowechsel werden vorherige App-, Spieler- und Gastcookies entfernt, damit ein alter Owner-Zugang nicht als scheinbar bestätigtes neues Konto weiterläuft. Ohne gültige Anmeldung gibt es keinen Zugriff auf private Bereiche. Bestätigungslinks werden zuerst durch Supabase geprüft; danach prüft der Server den Token nochmals mit `getUser`. Angaben des Browsers zu einer angeblichen Bestätigung werden ignoriert.

„Confirm email“, **Email** und **Magic Links** im richtigen Supabase-Projekt aktiviert lassen. Unter Authentication → Email müssen **Confirm signup**, **Magic Link** und **Reset Password** den Supabase-Bestätigungslink verwenden (Standardvorlage mit `{{ .ConfirmationURL }}`). Ein Link nur auf die Startseite bestätigt keine Adresse. Es sind keine zusätzlichen Vercel-Variablen erforderlich.

### Wenn die Mail fehlt

Der Owner findet unter **Meine Einstellungen → Anmeldung & E-Mail → Mail-Konfiguration prüfen** das tatsächlich in Vercel verbundene Supabase-Projekt, den Rücksprung-Link, die Provider-Einstellung für „Confirm email“, den Migrationsstand und die letzten zehn Mailanforderungen. Ein anderes Supabase-Projekt im Dashboard zu konfigurieren ändert diese Vercel-Anwendung nicht. Fehler zeigen eine Referenz und den sicheren Provider-Fehlercode. Die Diagnose speichert keine E-Mail-Adressen, Namen, Passwörter oder Links/Tokens und ist für Spielerkonten nicht abrufbar.

**„Angenommen“ belegt die Anfrage beim Maildienst, nicht die Zustellung im Postfach.** Bei einer Ablehnung SMTP-Zugang, Absender, Auth Logs und einen gegebenenfalls eingerichteten Send Email Hook prüfen. Ein Hook kann den Standard-SMTP-Versand ersetzen. Registrierung/Bestätigung und Reset haben weiterhin getrennte Wartezeiten; gemeinsame Anbieterlimits werden mit ihrer Restzeit angezeigt.

Steht die Mail im Gmail-Ordner „Gesendet“, liegt bereits ein Versand über Gmail vor. Fehlt sie bei einer Outlook-/Microsoft-365-Schuladresse auch im Junk-Ordner, kann die Schul-IT anhand Absender, Empfänger und Versandzeit eine **Nachrichtenablaufverfolgung und Quarantäneprüfung** vornehmen. Ein Test mit einem privaten Postfach hilft, eine Empfängerfilterung von einem allgemeinen Versandfehler zu unterscheiden. Gmail „Gesendet“, eine erfolgreiche SMTP-Annahme und eine App-Erfolgsmeldung sind jeweils keine Zustellbestätigung. Produktionszustellung lässt sich ohne Zugriff auf die Versand- und Empfängerprotokolle nicht belegen.

## Navigation und Kontodaten

Private Tabwechsel behalten die geprüfte Anmeldung und bereits geladene Daten im Arbeitsspeicher. Die Daten werden im Hintergrund aktualisiert; die Anmeldung wird regelmäßig und beim erneuten Fokussieren geprüft. Abmelden entfernt den Zwischenspeicher. Er wird weder im Browser dauerhaft gespeichert noch zwischen Konten geteilt. Die Serverberechtigungen werden weiterhin pro Anfrage geprüft.

Freundeslisten, Suchergebnisse und Einladungen zeigen ab 018 den aktuellen öffentlichen Nutzernamen. Freundschaften und Einladungen bleiben an die unveränderte Konto-ID gebunden; nach einer Namensänderung ist kein Entfernen und erneutes Hinzufügen nötig.

## Prüfung

SQL-Migrationen werden mit PGlite/PostgreSQL einschließlich Wiederholung, Berechtigungen, Kontozuordnungen, Training und Ergebnisfortschreibung ausgeführt. Browsertests verwenden kontrollierte API-Antworten auf Desktop und Handy. Echter SMTP-Versand, die produktive Supabase-Datenbank und Autodarts-Hardware müssen nach dem Update mit den eigenen Zugangsdaten geprüft werden.

## Sprache, Suche und gemeinsame Geräte ab 020

Unter **Einstellungen → Sprache** lässt sich die Oberfläche zwischen Deutsch und Englisch umschalten. Die Auswahl gilt auf diesem Gerät, bleibt nach Neuladen erhalten und wird auch für Anmeldung, Match und öffentliche Zuschauerseiten verwendet. Spieler-, Turnier- und Boardnamen werden nicht übersetzt. Texte liegen zentral in `src/i18n/en.json`; React übersetzt nur UI-Texte, keine DOM-Knoten oder gespeicherten Spieldaten. Der sichtbare besondere Owner-Zugang heißt jetzt **Admin**. Interne Rollen und `OWNER_PASSWORD_HASH` bleiben zur Kompatibilität bestehen. Supabase-Mailvorlagen werden weiterhin im Supabase-Dashboard gepflegt.

Freundesuche und Spielerauswahl zeigen bis zu 20 passende öffentliche Nutzernamen bei Teiltreffern an beliebiger Stelle, unabhängig von Groß-/Kleinschreibung. Freunde stehen zuerst. Umlaut-Umschreibungen sind bei der Suche gleichwertig (`müller` / `mueller`, `ß` / `ss`); für die Eindeutigkeit bleiben verschiedene Schreibweisen verschiedene Nutzernamen. Neue und geänderte Nutzernamen werden NFC-normalisiert und kleingeschrieben. E-Mail-Adressen und deaktivierte Konten sind nicht suchbar.

Beim Ausbullen ist die Umschaltung zwischen Scheibe und Tastatureingabe auf allen Geräten sichtbar. Beim gemeinsamen Spiel bestätigt „Weiter“ den Treffer und wählt automatisch den nächsten noch offenen Spieler samt Scheibe. Nach Gleichstand beginnt die nächste Bull-Runde beim ersten Spieler. Bestätigte Treffer können weiterhin über „Zurück“ korrigiert werden. Die gleichen Regeln gelten für Training und Turnier.
