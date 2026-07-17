#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---check}"

find_ffmpeg_full() {
  if [[ -n "${QIAOMU_FFMPEG:-}" && -x "${QIAOMU_FFMPEG}" ]]; then
    printf '%s\n' "${QIAOMU_FFMPEG}"
    return 0
  fi
  for candidate in \
    /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
    /usr/local/opt/ffmpeg-full/bin/ffmpeg
  do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  if command -v ffmpeg >/dev/null 2>&1; then
    command -v ffmpeg
    return 0
  fi
  return 1
}

check_ffmpeg() {
  local ffmpeg_bin
  if ! ffmpeg_bin="$(find_ffmpeg_full)"; then
    echo "missing: ffmpeg"
    return 1
  fi
  echo "ffmpeg: ${ffmpeg_bin}"
  local version filters
  version="$("${ffmpeg_bin}" -version 2>&1 || true)"
  filters="$("${ffmpeg_bin}" -hide_banner -filters 2>&1 || true)"
  local missing=0
  for needle in drawtext subtitles overlay loudnorm sidechaincompress zoompan xfade; do
    if ! grep -q "${needle}" <<<"${filters}"; then
      echo "missing filter: ${needle}"
      missing=1
    fi
  done
  if ! grep -q -- '--enable-libass' <<<"${version}" && ! grep -q ' ass ' <<<"${filters}"; then
    echo "missing capability: libass/ass"
    missing=1
  fi
  if ! grep -q -- '--enable-libx264' <<<"${version}"; then
    echo "missing encoder capability: libx264"
    missing=1
  fi
  return "${missing}"
}

install_ffmpeg_full() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Install Homebrew first: https://brew.sh"
    return 1
  fi
  brew install ffmpeg-full
  check_ffmpeg
}

case "${MODE}" in
  --check|check)
    check_ffmpeg
    ;;
  --install|install)
    install_ffmpeg_full
    ;;
  *)
    echo "Usage: scripts/bootstrap_macos.sh --check|--install"
    exit 2
    ;;
esac
