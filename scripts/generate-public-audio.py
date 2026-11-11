#!/usr/bin/env python3
"""Generate original procedural tones. Python 3 and ffmpeg (for MP3) required.

No recordings, samples, downloaded music or third-party melodies are used.
Not needed when building the app: generated files are already included.
"""
import math
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'public/audio'
RATE = 22050

def render(path, duration, notes):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        wav = Path(directory) / 'tone.wav'
        frames = bytearray()
        for i in range(round(RATE * duration)):
            t = i / RATE
            # Repeating arpeggio with a short attack/release on every note.
            phase = t % .24
            frequency = notes[int(t / .24) % len(notes)]
            envelope = min(1, phase / .012) * max(0, 1 - phase / .24)
            fade = min(1, t / .025, max(0, (duration - t) / .12))
            sample = .22 * envelope * fade * (math.sin(2*math.pi*frequency*t) + .2*math.sin(4*math.pi*frequency*t))
            frames.extend(struct.pack('<h', round(sample * 32767)))
        with wave.open(str(wav), 'wb') as output:
            output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            output.writeframes(frames)
        if path.suffix == '.wav':
            path.write_bytes(wav.read_bytes())
        else:
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-map_metadata','-1','-codec:a','libmp3lame','-b:a','64k',str(path)],check=True)

if __name__ == '__main__':
    for filename, duration, notes in [
        ('effects/triple-low.wav',.48,[330,440]),
        ('effects/triple-mid.mp3',.48,[440,550]),
        ('effects/triple-high.wav',.48,[550,770]),
        ('effects/bull.mp3',.72,[440,660,880]),
        ('effects/single-bull.wav',.48,[392,588]),
        ('effects/double.wav',.48,[349,523]),
        ('effects/leg-win.wav',3.2,[392,494,588,784,588,494,440]),
        ('effects/match-win.mp3',25,[294,392,494,440,588,494,392,330,440,523,392]),
        ('walk-on/intro.mp3',8,[262,330,440,392,294,440,523,349,392]),
    ]:
        render(ROOT / filename, duration, notes)
    with wave.open(str(ROOT / 'silence.wav'), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(b'\0\0' * (RATE // 10))
