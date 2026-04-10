#!/usr/bin/env python3
"""Local Faster Whisper transcription helper for CursorBuddy."""

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        "faster-whisper is not installed. Install it with "
                        "`pip install faster-whisper`. "
                        + str(exc)
                    ),
                }
            )
        )
        return 1

    kwargs = {}
    if args.device and args.device != "auto":
        kwargs["device"] = args.device
    if args.compute_type and args.compute_type != "default":
        kwargs["compute_type"] = args.compute_type

    try:
        model = WhisperModel(args.model, **kwargs)
        transcribe_kwargs = {"vad_filter": True}
        if args.language:
            transcribe_kwargs["language"] = args.language
        segments, info = model.transcribe(args.audio, **transcribe_kwargs)
        text = " ".join(segment.text.strip() for segment in segments).strip()
        print(
            json.dumps(
                {
                    "ok": True,
                    "text": text,
                    "language": getattr(info, "language", None),
                    "duration": getattr(info, "duration", None),
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
