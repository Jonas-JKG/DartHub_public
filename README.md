# DartHub

Web-App für Dartturniere, Trainings-Lobbys und Minigames. Spieler verwalten ihr Konto, laden andere Konten ein und spielen per Tastatur, virtueller Scheibe, Autodarts oder freigegebener Smartphone-Kamera. Zuschauer erhalten eine getrennte Ansicht per Link oder QR-Code.

Website: [herr-becher.vercel.app](https://herr-becher.vercel.app). Die laufende Installation wird separat betrieben; die fremden Audio-Pakete sind nicht Bestandteil dieses Quellstands.

## Funktionen

- Turniere mit Vorlobby, Gruppenphase und K.-o.-Runden.
- X01, Around the Clock, Segmenttraining und zufällige Checkouts.
- DartDeck, Bingo, Tic-Tac-Toe und Vier gewinnt.
- Spielerkonten mit E-Mail-Bestätigung und eindeutigem Nutzernamen; Freundschaften und Kontoeinladungen.
- Gemeinsame Geräte und lokale Mitspieler in unterstützten Modi.
- Ergebnisse, Revanchen und Statistiken; deutsche und englische Oberfläche.
- Autodarts sowie optional freigeschaltete Kameraerkennung im mobilen Browser.
- Separater Admin-Zugang; Zuschaueransicht ohne Kontomenü.

## Einstieg

Voraussetzungen: Node.js 22 LTS oder eine mit Next.js 16 kompatible neuere Version, npm und ein Supabase-Projekt. Für Kamera-Zugriff ist außerhalb von localhost HTTPS erforderlich.

```bash
npm ci
```

`.env.example` nach `.env.local` kopieren und die Supabase-Werte eintragen. Danach:

```bash
npm run owner-password
```

Das Werkzeug fragt das Admin-Passwort verdeckt ab und schreibt dessen Hash sowie fehlende Server-Schlüssel in die lokale Konfiguration. Der technische Befehlsname ist aus Kompatibilitätsgründen unverändert.

Vor dem Start die [Datenbank und E-Mail-Anmeldung einrichten](docs/SETUP.md). Danach:

```bash
npm run build:camera
npm run dev
```

Die Anwendung läuft unter `http://localhost:3000`. Eine vollständige Anleitung für lokale Entwicklung, Supabase und Vercel steht in [docs/SETUP.md](docs/SETUP.md).

## Dokumentation

| Thema | Anleitung |
| --- | --- |
| Installation, Umgebungsvariablen, E-Mail und Deployment | [Setup](docs/SETUP.md) |
| Komponenten und Datenwege | [Architektur](docs/ARCHITECTURE.md) |
| Aufgenommener Caller, Musik und öffentliche Assets | [Audio](docs/AUDIO.md) |
| Spielerkonten und Turnier-Lobbys | [Spielerkonten](docs/SPIELERKONTEN.md) |
| Training und Freundschaften | [Training](docs/TRAINING_UND_FREUNDE.md) |
| Minigames und Regeln | [Minigames](docs/MINIGAMES.md) |
| Autodarts-Protokoll und Diagnose | [Autodarts](docs/AUTODARTS_SCHNITTSTELLE.md) |
| Smartphone-Kamera, Freigaben und Diagnose | [Kamera](docs/HANDYKAMERA.md) |
| Geheimnisse und Sicherheitsmeldungen | [Security](SECURITY.md) |
| Änderungen und Tests | [Contributing](CONTRIBUTING.md) |
| Veröffentlichung und Lizenzgrenzen | [Publication](PUBLICATION.md) |

Einige ältere Funktionsleitfäden dokumentieren auch frühere Migrationen und technische Begriffe wie `owner` oder `manager`. Für eine Neuinstallation gilt die aktuelle Setup-Anleitung.

## Technik

Next.js 16, React 19 und TypeScript; Supabase für Datenbank, Kontoanmeldung und Live-Abgleich; Vercel als Hosting-Option. Die eigenständige Kamera-Engine liegt unter `packages/camera-engine` und enthält ihre Modelle, Referenzbilder sowie Lizenz- und Quellenhinweise.

```bash
npm test
npm run typecheck
npm run build
```

Der Produktionsbuild erzeugt zuerst die Kamera-Engine. Der Generator installiert deren gesperrte npm-Abhängigkeiten, falls sie noch fehlen. Modell- und Referenzdateien sind enthalten und werden anhand ihrer Prüfsummen kontrolliert. Informationen zu Browserprüfungen stehen in [CONTRIBUTING.md](CONTRIBUTING.md).

## Audio und Lizenzen

Fremde Caller-Aufnahmen und kommerzielle Walk-on-Musik sind nicht enthalten. Die Unterstützung für aufgenommene Caller bleibt bestehen; ein separat berechtigtes Paket kann privat eingebunden werden. **Es gibt keine Browserstimme als Ersatz.** Ohne installiertes Paket bleibt der Caller deaktiviert. Die mitgelieferten Effekte und das kurze Intro sind synthetisiert.

Für die eigenständige Kamera-Engine gelten die mitgelieferte AGPL-3.0-Lizenz und Drittanbieterhinweise. Quellenangebot und Attributionen müssen erhalten bleiben. Für den übrigen Anwendungscode ist bislang keine allgemeine Open-Source-Lizenz vergeben. Sichtbarkeit auf GitHub allein erteilt keine pauschalen Nutzungsrechte. Details: [PUBLICATION.md](PUBLICATION.md) und [Kamera-Lizenzen](packages/camera-engine/THIRD_PARTY_NOTICES.txt).
