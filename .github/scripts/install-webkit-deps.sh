#!/usr/bin/env bash
set -euo pipefail

# Runtime libraries only; no media plugins or extra fonts.
pkgs=(
  libavif16
  libevent-2.1-7t64
  libflite1
  libgles2
  libgstreamer-gl1.0-0
  libgstreamer-plugins-extra1.0-0
  libgtk-4-1
  libharfbuzz-icu0
  libhyphen0
  libmanette-0.2-0
  libopus0
  libsecret-1-0
  libsoup-3.0-0
  libwayland-server0
  libx264-165
)
opts=(-o Acquire::Languages=none -o Acquire::http::Timeout=15)

apt_get() {
  sudo timeout 30 apt-get "${opts[@]}" "$@" && return
  sudo sed -i '/azure\.archive\.ubuntu\.com/d' /etc/apt/apt-mirrors.txt
  sudo timeout 120 apt-get "${opts[@]}" "$@"
}

apt_get --error-on=any update
apt_get install -y --no-install-recommends --download-only "${pkgs[@]}"
sudo NEEDRESTART_SUSPEND=1 apt-get install -y --no-install-recommends --no-download \
  -o Dpkg::Options::=--force-unsafe-io "${pkgs[@]}"
