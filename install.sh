#!/bin/bash
set -euo pipefail

APP_NAME="Oxygen"
INSTALL_DIR="/Applications"
TMP_DIR="$(mktemp -d)"
GITHUB_REPO="Zerite29/Oxygen"
API_URL="https://api.github.com/repos/$GITHUB_REPO/releases/latest"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

detect_arch() {
  case "$(uname -m)" in
    arm64)   echo "arm64" ;;
    x86_64)  echo "x86_64" ;;
    *)
      echo "Unsupported CPU architecture"
      exit 1
      ;;
  esac
}

fetch_latest_asset() {
  local arch="$1"

  curl -s "$API_URL" \
    | grep "browser_download_url" \
    | grep -i "$arch" \
    | grep -i "mac" \
    | grep ".zip" \
    | head -n 1 \
    | cut -d '"' -f 4
}

remove_existing_install() {
  if [[ -d "$INSTALL_DIR/$APP_NAME.app" ]]; then
    echo "$APP_NAME already exists — removing old install"
    rm -rf "$INSTALL_DIR/$APP_NAME.app"
  fi
}

main() {
  ARCH="$(detect_arch)"
  echo "Detected architecture: $ARCH"

  DOWNLOAD_URL="$(fetch_latest_asset "$ARCH")"

  if [[ -z "$DOWNLOAD_URL" ]]; then
    echo "Could not find a compatible $APP_NAME release for $ARCH"
    exit 1
  fi

  echo "Latest release found:"
  echo "$DOWNLOAD_URL"
  echo

  remove_existing_install

  curl -L "$DOWNLOAD_URL" -o "$TMP_DIR/$APP_NAME.zip"

  echo "Extracting…"
  unzip -q "$TMP_DIR/$APP_NAME.zip" -d "$TMP_DIR"

  echo "Installing to $INSTALL_DIR"
  find "$TMP_DIR" -maxdepth 1 -name "$APP_NAME.app" -exec mv {} "$INSTALL_DIR" \;

  echo
  echo "$APP_NAME installation complete ✅"
}

clear
main
