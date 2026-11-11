# Öffentlicher Quellstand

Dieses Repository enthält Anwendungscode, Dokumentation und die lizenzierte eigenständige Kamera-Engine. Fremde Caller-Aufnahmen, kommerzielle Walk-on-Musik, private Konfiguration und die frühere Git-Historie sind nicht enthalten.

Die bestehende Website unter https://herr-becher.vercel.app wird unabhängig davon betrieben. Ihre privaten Audiodateien werden nicht in dieses Repository übertragen. Der aufgenommene Caller bleibt als optionale Integration unterstützt; eine Browserstimme wird nicht verwendet. Einrichtung: [docs/AUDIO.md](docs/AUDIO.md).

## Rechte

Für den eigenen Anwendungscode wurde mit dieser Veröffentlichung keine pauschale Open-Source-Lizenz vergeben. Öffentlich sichtbar bedeutet nicht automatisch frei nachnutzbar. Wer den Code unter einer allgemeinen Lizenz freigeben möchte, muss eine passende Lizenz festlegen und die Vereinbarkeit der eingebundenen Komponenten beachten.

Für die eigenständige Kamera-Engine gelten die AGPL-3.0-Lizenz, Quellenangebote und Drittanbieterhinweise unter `packages/camera-engine/`. Diese Dateien, Attributionen und die bereitgestellten vollständigen Quellen einschließlich Modelle müssen erhalten bleiben. Abhängigkeiten haben eigene Lizenzen. Die mitgelieferten Effekte werden durch `scripts/generate-public-audio.py` ohne fremde Aufnahmen oder Vorlagen erzeugt.

Ungeklärte Audio-Pakete nicht hochladen. Ein öffentlich auffindbarer Download ist keine Weiterverbreitungsfreigabe. Für eine eigene Installation sind außerdem die jeweiligen Anbieterbedingungen zu beachten.

## Änderungen sicher veröffentlichen

- Vor jedem Push die gestagten Dateien mit `git diff --cached` prüfen.
- Keine echte `.env`, Diagnoseaufzeichnungen, Schlüssel oder Datenbank-Dumps hinzufügen.
- Für öffentliche Commits eine GitHub-Noreply-Adresse verwenden.
- GitHubs Secret Scanning und Push Protection aktivieren, soweit verfügbar.
- Änderungen an Vercel/Supabase nicht allein deshalb vornehmen, weil das Quellrepository öffentlich ist.

Die statische Dateiprüfung kann nicht jede mögliche Sicherheitslücke ausschließen. Private Vercel-/Supabase-Einstellungen und Datenbankinhalte sind nicht Teil des öffentlichen Quellstands. Weitere Hinweise: [SECURITY.md](SECURITY.md).
