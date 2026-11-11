# Aufgenommener Caller und Audio

Der Caller unterstützt das bisherige Aufnahmeformat. Diese öffentliche Quelle verteilt die fremden Aufnahmen nicht und verwendet **keine Browser-Sprachsynthese**. Ohne privat installiertes Paket ist die Caller-Steuerung deaktiviert. Die ursprüngliche private Website mit ihren Aufnahmen bleibt davon unabhängig.

## Eigenes berechtigtes Aufnahme-Paket

Nur Aufnahmen verwenden, für die die erforderlichen Rechte vorliegen. Eine Datei in einem öffentlichen Repository ist keine Weiterverbreitungsfreigabe.

1. Dateien im eigenen privaten Arbeits-/Build-Verzeichnis unter `public/audio/caller/` ablegen.
2. Benötigt werden die verfügbaren Zahlendateien `<Zahl>.wav`, `gameon.wav` und `You_require.m4a`. Die erlaubten Zahlen stehen in `src/domain/audio-assets.ts`; Dateien müssen echte, browserlesbare Audio-Dateien sein.
3. `NEXT_PUBLIC_CALLER_PACK_ENABLED=true` setzen und neu bauen/deployen. Die Variable wird beim Build in die Oberfläche übernommen.
4. Auf dem tatsächlichen Endgerät Ton freigeben und Ansagen prüfen. Bei einer fehlenden Aufnahme erscheint ein Hinweis; es wird keine künstliche Browserstimme abgespielt.

`public/audio/caller/` ist von Git ausgeschlossen. Das entfernt keine bereits eingecheckten Dateien aus einer Historie. Vor jedem Push die gestagten Dateien prüfen.

Ein normales Vercel-Deployment aus diesem öffentlichen Repository enthält die ausgeschlossenen Dateien nicht automatisch. Ein privater Build-Prozess muss sie separat bereitstellen. Die vorhandene private Installation ist dafür nicht auf dieses öffentliche Repository umzustellen.

## Mitgelieferte Sounds

Das kurze Intro, Treffer- und Siegeseffekte sind synthetisiert. Quellen und der reproduzierbare Generator sind in [public/audio/SOURCES.md](../public/audio/SOURCES.md) dokumentiert. Sie sind keine Nachbildungen der bisherigen Walk-on-Songs. Python und ffmpeg werden nur zum erneuten Erzeugen benötigt, nicht für den normalen App-Build.
