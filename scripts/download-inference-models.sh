#!/usr/bin/env bash
#
# Fetches missing inference ONNX models into the local staging folder
# `assets.opendaw.studio/models/<task>/<version>/model.onnx`.
#
# Only the *.onnx weight files are gitignored; the matching README.md,
# LICENSE.txt, and meta.json sit alongside them and ARE tracked in the
# repo. So after a fresh clone the layout and attribution are visible
# but the heavy binaries are missing, and this script populates them.
#
# Idempotent: each entry is skipped if the destination already exists.
# Re-run after a fresh clone, or whenever a task adds a new model or
# bumps its version. SHA-256 digests printed at the end must match the
# matching `TaskDefinition.model.sha256` in
# packages/lib/inference/src/tasks/ — runtime download verifies the SHA.
#
# Once the files are present, upload the contents of
# assets.opendaw.studio/ to the CDN preserving the relative paths. The
# lib (`@opendaw/lib-inference`) fetches from
# https://assets.opendaw.studio/...
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING_DIR="${REPO_ROOT}/assets.opendaw.studio/models"

mkdir -p "${STAGING_DIR}"

download_if_missing() {
    local url="$1"
    local dest="$2"
    if [[ -f "${dest}" ]]; then
        echo "[skip] ${dest} already exists"
        return 0
    fi
    mkdir -p "$(dirname "${dest}")"
    echo "[fetch] ${url}"
    curl -fL --progress-bar -o "${dest}.partial" "${url}"
    mv "${dest}.partial" "${dest}"
    echo "[done] ${dest}"
}

print_sha() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "${file}" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "${file}" | awk '{print $1}'
    else
        echo "(no sha256 tool found)"
    fi
}

# ---------------------------------------------------------------------------
# Stem separation: htdemucs v4 (Demucs Hybrid Transformer, 4-stem split)
# License: MIT (facebookresearch/demucs); ONNX export by smank/htdemucs-onnx.
# ---------------------------------------------------------------------------
HTDEMUCS_DEST="${STAGING_DIR}/htdemucs/v4/model.onnx"
HTDEMUCS_URL="${HTDEMUCS_URL:-https://huggingface.co/smank/htdemucs-onnx/resolve/469b019bf7ac20e03dc68a8fa791323434862390/htdemucs.onnx}"

# ---------------------------------------------------------------------------
# Stem separation alt: htdemucs v4 (jackjiangxinfa/demucs-onnx)
# License: Apache-2.0. Same architecture, different export. Useful for A/B.
# ---------------------------------------------------------------------------
HTDEMUCS_JX_DEST="${STAGING_DIR}/htdemucs-jx/v4/model.onnx"
HTDEMUCS_JX_URL="${HTDEMUCS_JX_URL:-https://huggingface.co/jackjiangxinfa/demucs-onnx/resolve/49fcb820b3fa39937e955dda5cef1ad35dec1f7c/model.onnx}"

# ---------------------------------------------------------------------------
# Audio-to-MIDI: Spotify Basic Pitch (polyphonic transcription)
# License: Apache-2.0 (spotify/basic-pitch); ONNX via AEmotionStudio.
# ---------------------------------------------------------------------------
BASIC_PITCH_DEST="${STAGING_DIR}/basic-pitch/v0.4.0/model.onnx"
BASIC_PITCH_URL="${BASIC_PITCH_URL:-https://huggingface.co/AEmotionStudio/basic-pitch-onnx-models/resolve/327fd8ccd2f0bb84cbe56b4a0e9d318398ddf763/nmp.onnx}"

# ---------------------------------------------------------------------------
# Tempo detection: TempoCNN cnn.h5 (Schreiber & Müller, default global-tempo
# classifier). License: AGPL-3.0 — used at runtime only, NOT bundled into
# the openDAW SDK. Upstream ships a Keras .h5; convert to ONNX in a
# throwaway venv with tf2onnx.
# ---------------------------------------------------------------------------
TEMPO_CNN_DEST="${STAGING_DIR}/tempo-cnn/v0/model.onnx"
TEMPO_CNN_H5_URL="${TEMPO_CNN_H5_URL:-https://github.com/hendriks73/tempo-cnn/raw/main/tempocnn/models/cnn.h5}"

convert_tempo_cnn() {
    if [[ -f "${TEMPO_CNN_DEST}" ]]; then
        echo "[skip] ${TEMPO_CNN_DEST} already exists"
        return 0
    fi
    # TensorFlow lags Python releases — prefer 3.12 / 3.11 if installed,
    # fall back to whatever `python3` points at otherwise.
    local python_bin=""
    for candidate in python3.12 python3.11 python3; do
        if command -v "${candidate}" >/dev/null 2>&1; then
            python_bin="${candidate}"
            break
        fi
    done
    if [[ -z "${python_bin}" ]]; then
        echo "[warn] no python3 found — skipping tempo-cnn conversion"
        return 0
    fi
    local h5_file venv_dir
    h5_file="$(mktemp -t tempo-cnn-XXXXXX).h5"
    venv_dir="$(mktemp -d -t tempo-cnn-venv-XXXXXX)"
    echo "[fetch] ${TEMPO_CNN_H5_URL}"
    curl -fL --progress-bar -o "${h5_file}" "${TEMPO_CNN_H5_URL}"
    echo "[venv]  ${venv_dir} (tensorflow + tf2onnx, ${python_bin})"
    "${python_bin}" -m venv "${venv_dir}"
    # shellcheck disable=SC1091
    source "${venv_dir}/bin/activate"
    pip install --quiet --upgrade pip
    pip install --quiet 'tensorflow' 'tf2onnx'
    mkdir -p "$(dirname "${TEMPO_CNN_DEST}")"
    echo "[convert] tf2onnx → ${TEMPO_CNN_DEST}"
    python -m tf2onnx.convert \
        --keras "${h5_file}" \
        --output "${TEMPO_CNN_DEST}" \
        --opset 13
    deactivate
    rm -f "${h5_file}"
    rm -rf "${venv_dir}"
}

echo "Staging models into ${STAGING_DIR} for upload to assets.opendaw.studio"
echo

download_if_missing "${HTDEMUCS_URL}" "${HTDEMUCS_DEST}" || echo "[warn] htdemucs download failed; set HTDEMUCS_URL and retry"
download_if_missing "${HTDEMUCS_JX_URL}" "${HTDEMUCS_JX_DEST}" || echo "[warn] htdemucs-jx download failed; set HTDEMUCS_JX_URL and retry"
download_if_missing "${BASIC_PITCH_URL}" "${BASIC_PITCH_DEST}" || echo "[warn] basic-pitch download failed; set BASIC_PITCH_URL and retry"
convert_tempo_cnn || echo "[warn] tempo-cnn conversion failed; install python3 + retry, or set TEMPO_CNN_H5_URL"

echo
echo "SHA-256 digests (cross-check against TaskDefinition.model.sha256):"
for file in "${HTDEMUCS_DEST}" "${HTDEMUCS_JX_DEST}" "${BASIC_PITCH_DEST}" "${TEMPO_CNN_DEST}"; do
    if [[ -f "${file}" ]]; then
        printf "  %-60s %s\n" "${file#${REPO_ROOT}/}" "$(print_sha "${file}")"
    fi
done
echo
echo "Next step: upload the contents of assets.opendaw.studio/ to the CDN"
echo "preserving the relative paths. The runtime URLs are then live."
