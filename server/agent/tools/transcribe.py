"""Local speech recognition. No shell evaluation or remote media inputs."""
import json
import sys
from pathlib import Path
from faster_whisper import WhisperModel

cached = (Path(sys.argv[2]) / 'models--Systran--faster-whisper-base' / 'snapshots').exists()
model = WhisperModel('base', device='cpu', compute_type='int8', download_root=sys.argv[2], local_files_only=cached)
segments, info = model.transcribe(sys.argv[1], beam_size=3, vad_filter=True)
text = '\n'.join(f'[{min(segment.start, info.duration):.1f}–{min(segment.end, info.duration):.1f}s] {segment.text.strip()}' for segment in segments)
print(json.dumps({'text': text, 'language': info.language}, ensure_ascii=True))
