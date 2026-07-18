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

find_cjk_font() {
  for candidate in \
    "${HOME}/Library/Fonts/NotoSansCJKsc-Regular.otf" \
    /Library/Fonts/NotoSansCJKsc-Regular.otf \
    /opt/homebrew/share/fonts/NotoSansCJKsc-Regular.otf \
    /usr/local/share/fonts/NotoSansCJKsc-Regular.otf
  do
    if [[ -f "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
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

check_caption_font() {
  local font_file
  if ! font_file="$(find_cjk_font)"; then
    echo "missing: Noto Sans CJK SC (required for deterministic Chinese subtitles)"
    return 1
  fi
  echo "caption font: ${font_file}"
}

check_all() {
  local missing=0
  check_ffmpeg || missing=1
  check_caption_font || missing=1
  return "${missing}"
}

install_ffmpeg_full() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Install Homebrew first: https://brew.sh"
    return 1
  fi
  brew install ffmpeg-full
  if ! find_cjk_font >/dev/null; then
    brew install --cask font-noto-sans-cjk-sc
  fi
  check_all
}

case "${MODE}" in
  --check|check)
    check_all
    ;;
  --install|install)
    install_ffmpeg_full
    ;;
  *)
    echo "Usage: scripts/bootstrap_macos.sh --check|--install"
    exit 2
    ;;
esac
