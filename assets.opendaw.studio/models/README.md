# Inference models

This directory mirrors the layout of `https://assets.opendaw.studio/models/`.
The text files (`README.md`, per-model `LICENSE.txt`, per-model `meta.json`)
are tracked in the repo so the layout, attribution, and SHA-256 of every
model are reviewable. The `model.onnx` binaries (hundreds of MB each) are
gitignored and fetched on demand by the download script.

```
models/
├── README.md                          this file (tracked)
├── htdemucs/
│   └── v4/                            stem separation, primary (smank, MIT)
│       ├── model.onnx                 304,321,552 bytes  (gitignored, downloaded)
│       ├── LICENSE.txt                MIT + attribution  (tracked)
│       └── meta.json                  SHA-256 + bytes    (tracked)
├── htdemucs-jx/
│   └── v4/                            stem separation, alternate (jackjiangxinfa, Apache-2.0)
│       ├── model.onnx                 304,330,587 bytes  (gitignored, downloaded)
│       ├── LICENSE.txt
│       └── meta.json
└── basic-pitch/
    └── v0.4.0/                        audio-to-MIDI (Spotify Basic Pitch, Apache-2.0)
        ├── model.onnx                 230,444 bytes      (gitignored, downloaded)
        ├── LICENSE.txt
        └── meta.json
```

After upload, the runtime URLs are:

```
https://assets.opendaw.studio/models/htdemucs/v4/model.onnx
https://assets.opendaw.studio/models/htdemucs-jx/v4/model.onnx
https://assets.opendaw.studio/models/basic-pitch/v0.4.0/model.onnx
```

The lib (`@opendaw/lib-inference`) and the studio reference these URLs.
SHA-256 is verified at download time. If the file on the CDN ever drifts
from the SHA pinned in the task definition, the runtime download fails
loudly rather than silently corrupting playback.

## Populating the model files locally

After a fresh clone, the `model.onnx` files are missing. Run the download
script to fetch all of them from their upstream sources:

```
./scripts/download-inference-models.sh
```

The script is idempotent: it skips any model that's already present, so
re-running after adding a new model only fetches the missing one. SHA-256
digests are printed at the end; cross-check against the matching
`TaskDefinition.model.sha256` in `packages/lib/inference/src/tasks/`.

## Adding a new model

1. Add a download entry in `scripts/download-inference-models.sh` pointing
   at the upstream URL (Hugging Face, GitHub release, etc.).
2. Run the script to fetch the file into `<task>/<version>/model.onnx`.
3. Note the printed SHA-256 and `bytes` (`stat -f%z` / `wc -c`).
4. Drop a `LICENSE.txt` next to it with the upstream license text and a
   short attribution paragraph.
5. Add a `meta.json` with `{task, model, version, bytes, sha256, license, upstream}`
   for traceability.
6. Update the corresponding `TaskDefinition.model` in
   `packages/lib/inference/src/tasks/` with URL + SHA + bytes + version.
7. Commit `LICENSE.txt`, `meta.json`, and the script entry. The
   `model.onnx` itself stays gitignored.
8. Upload the `model.onnx` to the CDN preserving the relative path.

## CORS / COEP requirements when serving

`assets.opendaw.studio` already serves with the headers needed for the
studio (cross-origin-isolated context). Each model file specifically
needs:

- `Access-Control-Allow-Origin` matching the studio origin (or `*` if
  the CDN policy allows it).
- `Cross-Origin-Resource-Policy: cross-origin` so the studio's COEP
  context can fetch it.
- `Cache-Control: public, max-age=31536000` (or similar long TTL); the
  file is content-addressable by version + SHA so caching aggressively
  is safe.
