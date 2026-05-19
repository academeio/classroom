#!/usr/bin/env python3
"""Kokoro 82M TTS synthesizer — writes a single audio file for one text+voice.

Output format is inferred from the --output extension (.mp3 / .wav / .flac etc.)
or can be forced via --format. Defaults to MP3 for smaller files.
Requires soundfile >= 0.13 with libsndfile >= 1.2 for MP3 support.
"""
import argparse
import os
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline


# Map our short-form flag values to soundfile format codes.
FORMAT_MAP = {
    'mp3': 'MP3',
    'wav': 'WAV',
    'flac': 'FLAC',
    'ogg': 'OGG',
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--text', required=True)
    p.add_argument('--voice', default='af_heart')
    p.add_argument('--lang', default='a', help='a=American, b=British, etc.')
    p.add_argument('--speed', type=float, default=1.0)
    p.add_argument('--output', required=True)
    p.add_argument('--sample-rate', type=int, default=24000)
    p.add_argument(
        '--format',
        default=None,
        choices=list(FORMAT_MAP.keys()),
        help='Output container (mp3|wav|flac|ogg). Defaults to extension of --output.',
    )
    args = p.parse_args()

    pipeline = KPipeline(lang_code=args.lang)
    chunks = []
    for (_graphemes, _phonemes, audio) in pipeline(args.text, voice=args.voice, speed=args.speed):
        chunks.append(audio)
    if not chunks:
        print('kokoro: produced no audio', file=sys.stderr)
        sys.exit(2)
    full = np.concatenate([c.numpy() if hasattr(c, 'numpy') else c for c in chunks])

    # Pick the container: explicit --format wins, else infer from extension.
    fmt = args.format
    if not fmt:
        ext = os.path.splitext(args.output)[1].lstrip('.').lower()
        fmt = ext if ext in FORMAT_MAP else 'wav'
    sf_format = FORMAT_MAP[fmt]

    sf.write(args.output, full, args.sample_rate, format=sf_format)
    print(
        f'kokoro: wrote {len(full)} samples at {args.sample_rate}Hz as {sf_format} -> {args.output}',
        file=sys.stderr,
    )


if __name__ == '__main__':
    main()
