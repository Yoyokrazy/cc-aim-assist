#!/usr/bin/env bash
# Build a distributable .ccmod from the mod source folder.
#
# A .ccmod is just a ZIP of the mod directory's CONTENTS (ccmod.json at the archive root).
# The same artifact installs on desktop CrossCode (via CCLoader / CCModManager) and on
# cc-ios (via the in-game Mods tab or tools/setup-ccloader.sh --add-mod).
#
# Usage:
#   tools/build-ccmod.sh            # -> dist/cc-aim-assist-<version>.ccmod
#   tools/build-ccmod.sh -o OUT     # write to a specific path
#
# No game assets are bundled (this mod ships none), so the archive is tiny and safe to share.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mod_dir="$repo_root/mods/cc-aim-assist"
out=""

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--out) out="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[ -f "$mod_dir/ccmod.json" ] || { echo "error: $mod_dir/ccmod.json not found" >&2; exit 1; }
[ -f "$mod_dir/prestart.js" ] || { echo "error: $mod_dir/prestart.js not found" >&2; exit 1; }

# Read id + version from the manifest (validates JSON via python3).
read -r id version < <(python3 - "$mod_dir/ccmod.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(m.get("id", "cc-aim-assist"), m.get("version", "0.0.0"))
PY
)

# Syntax-check prestart.js if a JS engine is available (node), so we never ship a broken mod.
if command -v node >/dev/null 2>&1; then
  node --check "$mod_dir/prestart.js"
  echo "prestart.js: syntax OK"
fi

if [ -z "$out" ]; then
  mkdir -p "$repo_root/dist"
  out="$repo_root/dist/${id}-${version}.ccmod"
fi
mkdir -p "$(dirname "$out")"
rm -f "$out"

# Zip the folder CONTENTS (so ccmod.json lands at the archive root, not under cc-aim-assist/).
# Exclude junk that should never ship.
( cd "$mod_dir" && zip -rq "$out" . -x '.DS_Store' -x '__MACOSX/*' -x '*.map' )

echo "Built: $out"
echo "Contents:"
unzip -l "$out" | sed 's/^/  /'
cat <<EOF

Install:
  desktop  CrossCode/assets/mods/  (drop the .ccmod in, CCLoader unpacks it) — or use CCModManager.
  cc-ios   in-game Mods tab, or:  tools/setup-ccloader.sh --add-mod $mod_dir
After launching, check the JS console for "[cc-aim-assist] loaded".
EOF
