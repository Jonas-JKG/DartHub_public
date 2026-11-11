> **Aktuell ab Migration 022:** X01 solo oder zu zweit, lokale Mitspieler und Around the Clock. Zuerst 021, danach [022_clock_multiplayer.sql](../supabase/migrations/022_clock_multiplayer.sql) vollständig im Supabase SQL Editor ausführen. Es sind keine neuen Environment Variables nötig. Ohne 022 bleibt Around the Clock allein verfügbar, die zusätzlichen Plätze bleiben gesperrt. X01 bleibt unverändert.

## Aktuelles Training

- **X01:** 301, 501 oder 701, Single/Double Out und Gewinnlegs auswählen. Ohne zweiten Spieler startet ein Solospiel ohne Ausbullen. Nach jeder Aufnahme und jedem Leg bleibt derselbe Spieler am Zug; Average und Darts werden normal berechnet.
- **Spieler hinzufügen:** Ein bestätigtes Konto einladen oder einen lokalen Spieler mit 1–40 Zeichen Namen hinzufügen. Der lokale Spieler wird ausschließlich als Teilnehmer dieser Lobby angelegt, ohne eigenes Konto, Anmeldung, Suche oder Freundschaftsprofil. Mit dem Löschen der Lobby werden seine Lobbydaten entfernt. Ergebnisse bleiben bis dahin für Revanchen sichtbar.
- **Gemeinsames Gerät:** Bei lokalem Mitspieler werden beide Matchseiten automatisch auf dem Gerät gesteuert. Die gespeicherte Autodarts-Scheibe wertet den jeweils aktiven Spieler; Protokoll, Takeout-Schutz und Bildtransport bleiben unverändert. X01 zu zweit beginnt weiter mit Ausbullen. Ein belegter Kontoplatz muss vor dem Hinzufügen eines lokalen Spielers ausdrücklich entfernt werden.
- **Around the Clock:** Ein bis sechs Konten oder lokale Spieler, ohne Ausbullen: 1 bis 20 nacheinander, dann 25 oder Bull. Single, Double und Triple erfüllen jeweils genau ein Ziel. Fehlwürfe zählen als Darts, ändern das Ziel aber nicht. Drei Darts oder eine kürzere bestätigte Aufnahme, Rückgängig und Korrekturen verwenden denselben Matchweg. Jeder hat einen eigenen Fortschritt. Nach bis zu drei Darts die Aufnahme bestätigen; dann ist der nächste Spieler dran. Wer zuerst alle Ziele erreicht und bestätigt, gewinnt. Im Match wird nur die aktive Spielerseite angezeigt, daneben der nächste Name. In der Lobby stehen danach die Ergebnisse aller Teilnehmer mit Dartzahl und Trefferquote; eine neue Runde ist möglich.

Lokale Teilnehmer verwenden intern eine auf diese Lobby beschränkte Spielberechtigung des Erstellers. Sie bekommen keine eigenen Zugangsdaten. Es entstehen keine zusätzlichen Konten oder Freundeseinträge, und ein Match wird dem bestehenden Konto höchstens einmal zugerechnet. Sitzung, E-Mail-Bestätigung und Kontoverknüpfung werden weiterhin geprüft. Autodarts-Tokens bleiben am angemeldeten Konto; es wird nichts zum lokalen Namen kopiert.

## Frühere Abläufe

> **Aktuell ab Migration 017:** Kontoeinladungen ersetzen Spielerlinks und Codes; Turniere beginnen in einer Vorlobby. Update-Anleitung und aktuelle Abläufe: [SPIELERKONTEN.md](SPIELERKONTEN.md). Die folgenden älteren Abschnitte beschreiben gegebenenfalls den bisherigen Stand.

# Training, Einladungen, Gäste und Freunde

## Supabase aktualisieren

Im SQL Editor des **gleichen Supabase-Projekts wie in Vercel** zuerst alle bisher noch fehlenden Migrationen
011 bis 014, danach die vollständige Datei
[`015_guest_invitations.sql`](../supabase/migrations/015_guest_invitations.sql) ausführen.
015 darf erneut ausgeführt werden und erhält vorhandene Turniere und Konten.
Keine zusätzlichen Environment Variables nötig. Die vorhandenen Schlüssel `ACCESS_ENCRYPTION_KEY` und
`RATE_LIMIT_HMAC_KEY` müssen unverändert bleiben. Ohne 015 melden die neuen Zugangsseiten das fehlende Update.

## Anmeldung und Navigation

Die Startseite bietet Konto-Anmeldung oder einen benannten Gast. Der Gastzugang bleibt ein Jahr als HttpOnly-Cookie
auf diesem Gerät gespeichert; seine Spielerzuordnungen und Autodarts-Verknüpfung bleiben an dieser Identität.
Ein zusätzlich gesicherter Gastcookie ermöglicht die Rückkehr zum Gastzugang nach dem Abmelden eines Kontos.
Ein gelöschter Browsercookie ist kein wiederherstellbarer Gastzugang. Bestehende, noch gültige anonyme Spielerzugänge
werden beim Anlegen eines Gasts übernommen, sofern sie keinem anderen Konto oder Gast gehören.

- **Startseite:** verfügbare Turniere auswählen.
- **Turnier:** zuletzt geöffnetes Turnier ansehen oder entsprechend eigener Rechte bearbeiten.
- **Training:** 1v1-Lobbys erstellen oder betretene Lobbys öffnen.
- **Einstellungen:** Gerät, Anzeige, Sounds und Autodarts.
- **Freunde:** Suche, Onlinefreunde, Anfragen und empfangene Lobby-Einladungen. Eine Zahl zeigt offene Eingänge.
- **Code eingeben:** gemeinsame Einladung öffnen, Spieler auswählen oder gespeicherte Zuordnungen wieder öffnen.
- **Managerverwaltung:** nur Owner. Beim Öffnen der Turniere eines Managers zeigen Überschrift und
  Brotkrumennavigation dessen Namen, auch ohne vorhandene Turniere. Die Kennzahlen beziehen sich auf diesen Manager.

Die festen Zuschauerlinks der Manager bleiben erhalten und gewähren ausschließlich Leserechte in deren Bereich.
Das Öffnen eines Zuschauerlinks erhält eine bestehende Konto-/Gastanmeldung. Turnier-IDs allein gewähren keinen Zugang.
Training erscheint nicht in der Turnierübersicht oder im Zuschauerzugang eines Managers.

## Einladungen und Spielerzuordnung

Pro Turnier oder Trainingsraum gibt es **einen gemeinsamen Einladungscode samt Link/QR**. Der Ersteller teilt ihn
über „Zugänge teilen“ bzw. direkt im Lobbykopf. Auf der Einladungsseite wählt jeder seinen bestehenden freien
Spieler. Bei Training erhält ein freier Gastplatz den Namen der beitretenden Identität. Einladungen erlauben
keine Verwaltung. Die Zuordnung gehört dem angemeldeten Konto bzw. dem gespeicherten Gastzugang.
Unter „Code eingeben“ lassen sich gespeicherte Spieler ohne erneuten Code öffnen; mehrere eigene Spieler desselben
Turniers können gemeinsam auf einem Gerät aktiviert werden.

Ein belegter Spieler erfordert eine ausdrückliche Übernahmebestätigung. Ist der bisherige Spieler aktiv online
(Lebenszeichen innerhalb 45 Sekunden), muss er zusätzlich auf seinem Gerät zustimmen. Der Ersteller kann diese
Zustimmung nicht stellvertretend geben. Ohne aktives Lebenszeichen genügt die Bestätigung des neuen Spielers.
Nach dem Wechsel sind alte Spielerzugänge und alte Zuordnungen ungültig. Ein erneuertes Einladungscode-Paar
widerruft hingegen nur den alten Einladungslink/-code und lässt bestehende Spielerzuordnungen bestehen.
Alte persönliche Codes dienen der Kompatibilität; bereits gebundene Codes können keinen fremden Zugang überschreiben.

## Trainings-Lobby

Manager und Owner wählen beim Erstellen Startpunkte, Checkout und Gewinnlegs. Der Spielername wird aus dem
öffentlichen Nutzernamen unter Freunde übernommen; ohne Nutzernamen wird der gespeicherte Kontoname verwendet.
Im Lobbykopf stehen die Regeln mit Zahnrad sowie Einladungscode, aufklappbarer QR-Link und Freundesauswahl.
Darunter stehen beide Spieler mit Status und Scheiben-/Freundschaftsaktion. Regeln ändern, Spieler entfernen und die Lobby löschen
darf der Ersteller oder Owner. **Jeder der beiden bereiten Spieler darf starten.** Beide Plätze müssen beigetreten sein.
Der Start öffnet direkt das Match; der wartende Mitspieler wird beim nächsten Abruf ebenfalls weitergeleitet.
Fehlermeldungen bleiben auch bei Hintergrundaktualisierungen sichtbar.

Ausbullen, Eingabe, Autodarts, Kamerabilder, Korrekturen, Legs und Sounds verwenden die bestehende Turnier-Spieloberfläche.
Nach dem Match zeigt die Lobby Legs, Darts und 3-Dart-Average; Revanchen behalten den Raum bis zum Löschen bei.
„Lobby löschen“ entfernt nach Bestätigung den Raum samt Matches, Ergebnissen, Einladungen und Spielerzugängen
endgültig. Auch alte geschlossene Lobbys lassen sich aus der Trainingsübersicht löschen.
Zwischen Matches kann der Ersteller den Gastplatz entfernen und dessen Spielerzugang widerrufen.

Der globale Owner benötigt keine Spielerzuordnung: Er darf im Match die aktuell unbesetzten Seiten vertreten.
Ein Spieler mit geöffnetem Match reserviert seine eigenen Seiten durch Lebenszeichen alle vier Sekunden sowie durch
Spielaktionen; die Reservierung läuft nach 15 Sekunden ohne Lebenszeichen aus. Sind beide Seiten besetzt, ist der
Owner Zuschauer. Der Server prüft die Verfügbarkeit bei jeder Eingabe und bei Kamerabildern erneut.
Owner-Präsenz reserviert keine Spielerseite und überschreibt keine gespeicherten Spielerzuordnungen. Auch seine
gespeicherte Namensauswahl ist nur eine Präferenz; sie meldet keinen echten Spieler ab.

## Freunde und Autodarts

Freundschaften gehören bestätigten Konten einschließlich Owner. Die Suche verwendet einen eindeutigen öffentlichen
Nutzernamen (3–24 kleine Buchstaben, Zahlen oder Unterstrich), keine E-Mail-Suche oder öffentliche Kontoliste.
Anfragen sind auch über den festen Freundschaftslink und nachgewiesene gemeinsame Teilnehmer möglich.
Nur bestätigte Freunde sehen die Onlineanzeige; diese läuft nach 90 Sekunden ohne Lebenszeichen aus.
Leere Anfrage-/Einladungsbereiche werden ausgeblendet. Einladungen an Freunde werden **in der geöffneten Lobby** versendet.
Geöffnete oder abgelehnte Einladungen verschwinden aus den offenen Eingängen. Entfernte Freundschaften machen
zugehörige Einladungen unzugänglich. Manager-Löschung widerruft dessen Räume, Freundschaften, Einladungen und Verknüpfungen.

Gespeicherte Autodarts-Verbindungen gehören zum Manager-/Owner-Konto oder zur dauerhaften Gastidentität;
Passwörter werden dafür nicht gespeichert. Bestehende persönliche Codeprofile bleiben kompatibel. Bei Übernahme eines
alten anonymen Zugangs muss dessen bisherige Code-Scheibe gegebenenfalls einmal am neuen Gastprofil verknüpft werden.
Abmelden oder Widerruf einer Kontositzung widerruft ihre untergeordneten Spielerzugänge.

Alle neuen Tabellen haben RLS und sind für `anon`/`authenticated` gesperrt. Änderungen laufen über Serverrouten mit
Origin-Prüfung, Ratenbegrenzung und Datenbankprüfung der Identität, Zuständigkeit und aktuellen Codeversion.
Konto-/Gastcookie und Spielercookie werden nur kombiniert, wenn die Datenbank ihre Bindung bestätigt.

## Vor dem ersten echten Spiel prüfen

Mit getrennten Browsern: Lobby erstellen, Gast benennen, Einladung öffnen, Spieler wählen, auf beiden Geräten starten,
Ausbullen und 301 spielen, Statistiken/Revanche prüfen. Übernahme bei aktivem und geschlossenem zweiten Browser testen.
Owner als Vertretung öffnen und anschließend beide Spieler beitreten lassen: seine Eingabe muss gesperrt werden.
Mit zwei bestätigten Konten Nutzernamen, Freundschaftsanfrage und Einladung aus der Lobby prüfen.
Autodarts zusätzlich mit echten Boards testen; lokale Tests ersetzen Provider und Hardware nicht.

## Matchabruf bei langsamen Verbindungen

Der Matchabruf läuft pro geöffnetem Match höchstens einmal gleichzeitig. Langsame Antworten werden durch
Hintergrundaktualisierungen nicht verworfen. Nach zwölf Sekunden ohne Antwort erscheint eine Fehlermeldung;
„Erneut versuchen“ startet den Abruf neu. Beim Matchwechsel werden alte Abrufe beendet und der lokale Spielzustand
neu angelegt. Das verhindert, dass die Ladeanzeige bei Antwortzeiten über dem Aktualisierungsintervall hängen bleibt.

## Anmeldung auf der Code-Seite

„Code eingeben“ übernimmt die verifizierte primäre Konto-/Gast-Sitzung bereits beim serverseitigen Öffnen.
Ein zusätzlicher Spieler-Cookie ersetzt dabei keinen Owner-Zugang. Fehler beim Laden gespeicherter Spieler
werden als Fehler angezeigt und wechseln nicht zur Gastanmeldung; die Seitennavigation bleibt erhalten.
Die Rollenanzeige gewährt keine Rechte: Jede Code-Aktion prüft weiterhin die aktuelle Sitzung auf dem Server.

## Segmenttraining und zufälliges Checkout (023)

Für bestehende Datenbanken nach 022 einmal
[023_practice_modes.sql](../supabase/migrations/023_practice_modes.sql) im Supabase SQL Editor
vollständig ausführen. Bis dahin bleiben ausschließlich die neuen Modusoptionen deaktiviert;
X01 und Around the Clock sowie die Korrekturen an Anzeige, Caller und Navigation funktionieren
mit dem bisherigen Datenbankstand weiter. Eine Neuinstallation benötigt ebenfalls die bisherigen
Migrationen in aufsteigender Reihenfolge und anschließend 023.

- **Segmenttraining:** Eine oder mehrere Zahlen von 1 bis 20 auswählen, beispielsweise 20, 19
  und 18. Insgesamt 30 Darts; pro bestätigtem Zug wechselt das Ziel zur nächsten ausgewählten
  Zahl. Single, Double und Triple zählen jeweils als ein Treffer. Die Statistik zeigt Treffer,
  Darts und Quote. Ein früh bestätigter Zug verringert nicht die Gesamtzahl von 30 Darts.
- **Zufälliges Checkout:** Single oder Double Out auswählen. Zehn zufällige, mit bis zu drei
  Darts lösbare Aufgaben zwischen 40 und 170; die Aufgaben werden einmal beim Matchstart
  erzeugt und mit dem Match gespeichert. Checkout, Bust oder drei Darts beenden die Eingabe
  der aktuellen Aufgabe. Weiter/Takeout beginnt die nächste. Die Statistik zeigt erfolgreiche
  Checkouts und Quote. Eine neue Runde bekommt neue Aufgaben.

Beide neuen Modi sind Solotraining und verwenden die bestehende Autodarts-Verknüpfung.
Kontoeinladungen und lokale Zusatzplätze bleiben in X01 und Around the Clock verfügbar.
Zuschauerlinks zeigen bei den Solomodi ausschließlich den tatsächlichen Spieler.

Lobby-Löschen aktualisiert die Trainingsübersicht ohne Dokument-Neuladen. Wird eine geöffnete
Lobby gelöscht, führt eine clientseitige Navigation zurück zur Übersicht. Der kontogebundene
Browsercache der entfernten Lobby wird verworfen.
