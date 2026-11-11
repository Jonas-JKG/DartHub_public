> **Aktuell ab Migration 017:** Kontoeinladungen ersetzen Spielerlinks und Codes; Turniere beginnen in einer Vorlobby. Update-Anleitung und aktuelle Abläufe: [SPIELERKONTEN.md](SPIELERKONTEN.md). Die folgenden älteren Abschnitte beschreiben gegebenenfalls den bisherigen Stand.

# Manager-Konten einrichten

Dieses Update trennt Turniere nach Manager. Der Owner behält seinen bisherigen
Passwort-Zugang und kann alle Manager und Turniere verwalten. Auf der Anmeldeseite
öffnet der Owner **Spieler-Code** und gibt dort sein Owner-Passwort ein; es gibt
keinen sichtbaren Owner-Tab. Das Feld akzeptiert weiterhin das vollständige Passwort. Manager registrieren
sich mit E-Mail und Passwort; eine bestätigte E-Mail ist erforderlich. Ein
zusätzlicher Freischaltschritt durch den Owner ist nicht nötig.

## Bestehendes Supabase-Projekt aktualisieren

1. Den neuen Code zunächst mit `MANAGER_AUTH_ENABLED=false` deployen.
2. Im **bestehenden** Supabase-Projekt den gesamten Inhalt von
   [011_manager_accounts.sql](../supabase/migrations/011_manager_accounts.sql)
   im SQL Editor ausführen. Die bisherigen Migrationen bis 010 müssen vorhanden sein.
3. Unter Authentication → Providers → Email **Confirm email** einschalten.
   Der SMTP-Server allein erzwingt noch keine Bestätigung. Die Mindestlänge
   für neue Passwörter in Supabase ebenfalls auf 12 Zeichen setzen.
4. Unter Authentication → URL Configuration die endgültige HTTPS-Domain als
   Site URL einstellen. Als Redirect URL ausdrücklich
   `https://DEINE-DOMAIN/auth/confirm` zulassen. Ein vorhandener Eintrag
   `https://DEINE-DOMAIN/**` umfasst diesen Pfad ebenfalls.
5. In Vercel `APP_ORIGIN` auf dieselbe Domain und `MANAGER_AUTH_ENABLED=true`
   setzen und neu deployen. Die bestehenden Schlüssel unverändert lassen.
6. Mit einer echten E-Mail registrieren, Bestätigungslink öffnen, anmelden und
   ein Testturnier anlegen. E-Mail-Versand und echte Autodarts-Hardware müssen am
   eigenen Supabase-Projekt geprüft werden.

Für ein neues Projekt zuerst `supabase/DATENBANK_EINRICHTEN.sql`, anschließend
Migration 011 ausführen. Nach Migration 011 keine ältere Komplett-Einrichtung
oder alte Zugangs-Migration erneut ausführen: Sie würde Funktionen und Rechte
überschreiben. Die neue Migration selbst kann wiederholt werden.

## Was sich für vorhandene Daten ändert

Bestehende Turniere bleiben erhalten und gehören zum Owner-Bereich. Alte gemeinsame
Spieler-PINs und Spieler-Sitzungen werden abgelöst; die Spieler müssen mit ihrem
neuen persönlichen Code wieder einsteigen. Der Owner findet die neue Liste unter
Turnier → Einstellungen → Zugänge teilen. Bei alten Turnieren werden die Codes
beim ersten Öffnen dieser Liste erzeugt.

Der bisherige globale `/live`-QR-Code ist kein anonymer Zugang mehr. Den neuen
Owner-QR einmal neu drucken; danach bleibt er dauerhaft gleich. Jeder Manager
hat seinen eigenen festen QR-Link, der ausschließlich seine nicht archivierten
Turniere freigibt. Auf der Zuschauer-Startseite erscheint nur das aktuelle
Turnier dieses Managers. Es gibt keinen kurzen Zuschauer-Zahlencode. Jeder, der diesen
QR-Link besitzt, darf in diesem Bereich zuschauen; er erlaubt keine Änderungen.
Das Öffnen eines Zuschauerlinks wechselt die App in die Zuschauer-Sitzung. Zur
Verwaltung anschließend wieder anmelden.

Jeder Spieler-Code ist sechsstellig und einem Namen und Turnier zugeordnet.
Persönliche Spieler-Codes erlauben keine Auswahl fremder Namen. Weitere Spieler
auf demselben Gerät benötigen jeweils ihren eigenen Code (Migration 013). Manager und Owner können sich weiterhin zum Spielen
zuordnen und mehrere Spieler an einem Board verwalten. Die Geräteübernahme bleibt
bestätigungspflichtig. Eine Neuauslosung oder „Alle Spielercodes erneuern“ ersetzt
Codes und meldet alte Spieler-Sitzungen ab.

Bei „Mit meiner Autodarts-Scheibe“ erscheint nach der Spielerzuordnung direkt
auf der Auswahlseite die Autodarts-Anmeldung und Board-Auswahl. Das Passwort
wird weiterhin nicht gespeichert; die Provider-Anmeldung bleibt an die App-Sitzung
und Spielerzuordnung gebunden.

## Datenzugriff und Owner-Verwaltung

Im neuen Modus ist die Startseite ohne Zugang leer. Manager sehen ihre eigenen
Turniere, Spieler ihr zugeordnetes Turnier, Zuschauer nur den freigegebenen
Manager-Bereich. Fremde IDs liefern auch an den Spiel-, Bild-, Zugangsdaten- und
Historien-APIs keine Daten. Die SQL-Funktionen prüfen die Manager-Zuordnung
zusätzlich vor Schreiboperationen.

Direkte anonyme/`authenticated`-Leserechte auf Snapshots, Live-Pointer und Spiele
werden entfernt. Die Website liest über ihre geprüften Server-APIs; der schnelle
API-Abgleich bleibt erhalten. Browser-Realtime über globale öffentliche Tabellen
wird im Manager-Modus durch diesen API-Abgleich ersetzt.

Der Owner öffnet „Managerverwaltung“, kann Manager aktivieren/deaktivieren und
über „Turniere ansehen“ ihre Turniere öffnen und bearbeiten. Deaktivierung
sperrt bestehende Manager-, Spieler- und Zuschauer-Sitzungen sofort bei der nächsten
Serverprüfung. Turniere und Ergebnisse bleiben gespeichert. Manager sehen diese
Verwaltung und fremde Kontodaten nicht.

Die Datenbank-Trennung bleibt nach installierter Migration auch dann wirksam,
wenn der UI-Funktionsschalter später ausgeschaltet wird. Zugänge, Spieler-Codes,
verschlüsselte Provider-Tokens und Server-Schlüssel dürfen nicht in öffentliche
Tabellen, Logs oder Browser-Konfiguration gelangen.

Das Repository bleibt privat; dieses Update verändert weder seine Sichtbarkeit
noch die enthaltenen Audiodateien.

## Autodarts dauerhaft mit einem Zugang verknüpfen

Nach Migration 011 zusätzlich `supabase/migrations/012_saved_autodarts.sql` im
Supabase SQL Editor ausführen. Keine neuen Environment Variables nötig.
Die bisherige sitzungsbezogene Anmeldung bleibt ohne Migration 012 verfügbar.

Manager und Owner öffnen **Meine Einstellungen**, melden sich einmal bei
Autodarts an, lassen **Autodarts mit meinem Zugang verknüpfen** aktiviert,
wählen ihr Board und drücken **Meine Scheibe verbinden**. Dies geht bereits
ohne Turnier oder Spielerzuordnung. Persönliche Spieler-Codes können dieselbe
Verknüpfung nach der Namenswahl oder unter Meine Einstellungen anlegen.

Bei der nächsten Anmeldung bleibt die Verknüpfung erhalten. Beim Spielen wird
das gespeicherte Board automatisch verbunden, auch in einem anderen Browser.
Die Spielerzuordnung wird weiterhin gewählt und bei Bedarf übernommen; das
Board erhält dadurch keine fremden Spielrechte. Owner und Manager haben
getrennte Verknüpfungen, ebenso jeder persönliche Spieler-Code. Eine gemeinsame
Manager-/Owner-Sitzung nutzt dasselbe Board für die gewählten Spieler.

Das Autodarts-Passwort wird nicht gespeichert. Das verschlüsselte Refresh-Token
liegt ausschließlich in einer privaten Server-Tabelle. Ein abgelaufenes oder
widerrufenes Token muss einmal durch eine neue Autodarts-Anmeldung ersetzt werden.
**Autodarts abmelden** entfernt die gespeicherte Verknüpfung; gewöhnliches
Dartbracket-Abmelden erhält sie. Neue Spielercodes nach Rotation/Neuauslosung
benötigen eine neue Verknüpfung.

## Gemeinsame Geräte, Kontolöschung und gespeicherte Spielerwahl

Nach 011 und 012 zusätzlich `supabase/migrations/013_shared_players_and_managers.sql`
im bestehenden Supabase-Projekt ausführen. Keine neuen Environment Variables.
Migration 013 kann wiederholt werden. Danach keine ältere Migration erneut ausführen.

Ein Spieler meldet sich mit seinem Code an. Unter **Spieler wählen** kann er
**Weitere Spieler an diesem Gerät** über deren eigene Codes hinzufügen, auch
mehr als zwei. Es werden nur Codes desselben Turniers akzeptiert. Die Anzeige
zeigt ausschließlich die freigeschalteten Namen; für fremde Namen entstehen
keine Spielrechte. Bei bereits belegten Spielern muss die Geräteübernahme
bestätigt werden. Anschließend **Mehrere Spieler an diesem Gerät / einem Board**
verwenden und die Auswahl übernehmen. Die vorhandene gemeinsame Spieleingabe
und ein verbundenes Autodarts-Board gelten für die gewählten Spieler.

Manager und Owner speichern ihre Spielerwahl pro Turnier im Konto, einschließlich
**Ich spiele nicht mit**. Beim nächsten Login wird die letzte noch gültige Auswahl
wiederhergestellt. Ist ein Spieler bereits auf einem anderen Gerät belegt, wird
keine automatische Übernahme durchgeführt: Der Zugang führt zur Spielerwahl.
Nach einer Neuauslosung werden ungültige alte Teilnehmer-IDs nicht wieder benutzt.

Turnierkarten und der Turnierkopf zeigen den Manager-Namen. Der Erstellername
wird bei neuen Turnieren festgehalten; für bestehende Turniere verwendet die
Migration den bisher zugeordneten Manager. Eine historische abweichende Person
ist bei alten Turnieren nicht nachträglich rekonstruierbar.

Das Archiv ist weiterhin funktionsfähig: **Turnier → Einstellungen → Archivieren**.
Unter **Archivierte Turniere** lässt sich ein Turnier wieder öffnen und über
**Aus Archiv holen** wiederherstellen. Spieler und Zuschauer sehen keine Archive.
Ein leerer Archivfilter erklärt, wie archiviert wird.

Nur der globale Owner kann in der Managerverwaltung **Konto löschen** ausführen.
Die E-Mail-Adresse muss exakt bestätigt werden. Zuerst werden Managerzugang,
Zuschauerlink, bestehende Sitzungen, Spieler-Codes und gespeicherte Autodarts-Tokens
widerrufen; Turniere und Ergebnisse wechseln zum Owner. Danach wird das Konto in
Supabase Authentication gelöscht. Der Erstellername bleibt bei den erhaltenen
Turnieren sichtbar. Die Manager-Tabelle behält einen anonymisierten gesperrten
Datensatz gegen Wiederanmeldung mit alten Tokens. Bei einem Fehler der Auth-Löschung
bleibt der Zugang gesperrt; der Owner kann **Löschung erneut versuchen** ausführen.
Erhaltene Turniere benötigen neue Spieler-Codes und eine ausdrückliche Freigabe
unter **Zugänge teilen**. Es werden keine vorhandenen Konten durch die Migration
oder dieses Code-Deployment automatisch gelöscht.

Training, Freunde und die Verknüpfung persönlicher Spielercodes benötigen zusätzlich Migration 014.
Einrichtung und Bedienung: [Training und Freunde](TRAINING_UND_FREUNDE.md).
