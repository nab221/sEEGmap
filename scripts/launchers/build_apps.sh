#!/bin/bash
# Build the Start/Stop/Restart sEEGmap .app launchers.
#
#   ./build_apps.sh            # build into ./build/apps (for inspection)
#   ./build_apps.sh --install  # build in a temp dir, install into /Applications
#
# The launcher scripts carry __PROJECT_DIR__ / __NODE__ placeholders; this
# script substitutes the real values (repo root + resolved `node`) at build
# time so the repo itself never hard-codes a machine path.
#
# SEEGMAP_REPO_ROOT overrides the project dir baked into the launchers. Set it
# when building from a git worktree so the installed apps keep serving the
# main checkout rather than the worktree the script happens to live in.
#
# The bundles are assembled in a temp dir: an .app left under the repo is
# indexed by Spotlight/Launchpad/Raycast and shows up as a second
# "Start sEEGmap" next to the installed one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SEEGMAP_REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/seegmap-launchers.XXXXXX")"
OUT="$BUILD_DIR/apps"
trap 'rm -rf "$BUILD_DIR"' EXIT

NODE="$(command -v node || true)"
[ -n "$NODE" ] || NODE="/opt/homebrew/bin/node"

echo "repo root : $REPO_ROOT"
echo "node      : $NODE"

mkdir -p "$OUT"

# 1. Icons (pure-stdlib generator -> start/stop/restart.icns in $BUILD_DIR).
python3 "$SCRIPT_DIR/generate_icons.py" "$BUILD_DIR"

# 2. Assemble one .app bundle.
#    $1 display name  $2 launcher-script basename  $3 icns  $4 bundle id
#    $5.. extra scripts copied next to the executable.
install_script() {
  sed -e "s#__PROJECT_DIR__#${REPO_ROOT}#g" \
      -e "s#__NODE__#${NODE}#g" \
      "$SCRIPT_DIR/$1" > "$2/$1"
  chmod +x "$2/$1"
}

make_app() {
  local name="$1" execfile="$2" icns="$3" bundleid="$4"
  shift 4
  local app="$OUT/$name.app"
  local macos="$app/Contents/MacOS"
  local res="$app/Contents/Resources"
  mkdir -p "$macos" "$res"

  install_script "$execfile" "$macos"
  for extra in "$@"; do install_script "$extra" "$macos"; done
  cp "$BUILD_DIR/$icns" "$res/icon.icns"

  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>$name</string>
    <key>CFBundleDisplayName</key>
    <string>$name</string>
    <key>CFBundleExecutable</key>
    <string>$execfile</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>CFBundleIdentifier</key>
    <string>$bundleid</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

  echo "APPL????" > "$app/Contents/PkgInfo"
  echo "built $app"
}

APPS=("Start sEEGmap" "Stop sEEGmap" "Restart sEEGmap")
make_app "Start sEEGmap"   "start-seegmap"   "start.icns"   "com.seegmap.launcher.start"
make_app "Stop sEEGmap"    "stop-seegmap"    "stop.icns"    "com.seegmap.launcher.stop"
make_app "Restart sEEGmap" "restart-seegmap" "restart.icns" "com.seegmap.launcher.restart" \
         "stop-seegmap" "start-seegmap"

# 3. Install, or keep a copy for inspection.
if [ "${1:-}" = "--install" ]; then
  LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  for name in "${APPS[@]}"; do
    rm -rf "/Applications/$name.app"
    cp -R "$OUT/$name.app" "/Applications/$name.app"
    xattr -dr com.apple.quarantine "/Applications/$name.app" 2>/dev/null || true
    [ -x "$LSREG" ] && "$LSREG" -f "/Applications/$name.app" 2>/dev/null || true
  done
  echo "installed to /Applications"
else
  rm -rf "$SCRIPT_DIR/build"
  mkdir -p "$SCRIPT_DIR/build"
  cp -R "$OUT" "$SCRIPT_DIR/build/apps"
  echo "kept a copy under $SCRIPT_DIR/build/apps — Spotlight/Raycast will list"
  echo "these next to any installed copies; delete the folder when done."
fi

echo "done."
