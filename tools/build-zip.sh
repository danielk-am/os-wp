#!/usr/bin/env bash
#
# Build the release zip.
#
# The published os.zip has always been the git tree at the tag, under a
# top-level os/ directory, with nothing added and nothing excluded. Verified
# against v3.3.0: 199 files, every one byte-identical. So the build is
# `git archive`, and this script is the checks around it that stop a bad
# release going out.
#
# It builds from a committed ref, never the working tree, so the artifact is
# reproducible from the repository alone.
#
# Usage:
#   tools/build-zip.sh              # build from HEAD
#   tools/build-zip.sh v3.4.0       # build from a tag
#   tools/build-zip.sh --check      # verify only, build nothing

set -euo pipefail

cd "$(dirname "$0")/.."

REF="HEAD"
CHECK_ONLY=0
OUT="dist"

for arg in "$@"; do
	case "$arg" in
		--check) CHECK_ONLY=1 ;;
		-*) echo "Unknown option: $arg" >&2; exit 1 ;;
		*) REF="$arg" ;;
	esac
done

fail() { echo "  FAIL $*" >&2; FAILED=1; }
ok()   { echo "  ok   $*"; }

FAILED=0

git rev-parse --verify "$REF" >/dev/null 2>&1 || { echo "Unknown ref: $REF" >&2; exit 1; }

echo
echo "Building from $REF"
echo

# 1. The tree must be clean. A release built from uncommitted work cannot be
#    rebuilt later from the tag it claims to be.
if [ -n "$(git status --porcelain)" ]; then
	fail "working tree is dirty; commit or stash before releasing"
else
	ok "working tree is clean"
fi

# 2. The version lives in four places and every one has to agree. This is the
#    step a human gets wrong, which is why it is checked rather than trusted.
PLUGIN_HEADER=$(git show "$REF:os.php" | sed -n 's/^ \* Version:[[:space:]]*\(.*\)$/\1/p' | tr -d '[:space:]')
PLUGIN_CONST=$(git show "$REF:os.php" | sed -n "s/^define( 'OS_VERSION', '\(.*\)' );.*$/\1/p" | tr -d '[:space:]')
MANIFEST_VERSION=$(git show "$REF:manifest.json" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
MANIFEST_PACKAGE=$(git show "$REF:manifest.json" | sed -n 's|.*/releases/download/v\([^/]*\)/os.zip.*|\1|p')

VERSION="$PLUGIN_HEADER"

if [ -z "$VERSION" ]; then
	fail "no Version header in os.php"
fi
for pair in "os.php OS_VERSION:$PLUGIN_CONST" "manifest.json version:$MANIFEST_VERSION" "manifest.json package URL:$MANIFEST_PACKAGE"; do
	label="${pair%%:*}"
	value="${pair#*:}"
	if [ "$value" = "$VERSION" ]; then
		ok "$label is $value"
	else
		fail "$label is '$value', expected '$VERSION'"
	fi
done

# 3. A tag, if one exists for this version, must point at what is being built.
if git rev-parse --verify "v$VERSION" >/dev/null 2>&1; then
	if [ "$(git rev-parse "v$VERSION")" = "$(git rev-parse "$REF")" ]; then
		ok "tag v$VERSION points at $REF"
	else
		fail "tag v$VERSION exists and points somewhere else"
	fi
else
	ok "no v$VERSION tag yet, tag after building"
fi

# 4. Tests. A green suite is the only evidence the zip is worth shipping.
for suite in tests/verify-*.php; do
	[ -e "$suite" ] || continue
	if output=$(php "$suite" 2>&1); then
		ok "$(basename "$suite"): $(echo "$output" | tail -1)"
	else
		fail "$(basename "$suite"): $(echo "$output" | tail -1)"
	fi
done

if [ "$FAILED" -ne 0 ]; then
	echo
	echo "Not building. Fix the above first." >&2
	exit 1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
	echo
	echo "Checks pass. Nothing built (--check)."
	exit 0
fi

# 5. Build. The prefix matters: WordPress installs the zip's top directory as
#    the plugin folder, so it has to be os/ and not the repository name.
mkdir -p "$OUT"
git archive --format=zip --prefix=os/ "$REF" -o "$OUT/os.zip"
git show "$REF:manifest.json" > "$OUT/manifest.json"

COUNT=$(unzip -Z1 "$OUT/os.zip" | grep -vc '/$' || true)
SIZE=$(wc -c < "$OUT/os.zip" | tr -d '[:space:]')
SHA=$(shasum -a 256 "$OUT/os.zip" | cut -d' ' -f1)

echo
echo "Built $OUT/os.zip"
echo "  version   $VERSION"
echo "  files     $COUNT"
echo "  size      $SIZE bytes"
echo "  sha256    $SHA"
echo
echo "Next, when you are ready to publish:"
echo "  git tag -a v$VERSION -m 'OS $VERSION'"
echo "  git push origin v$VERSION"
echo "  gh release create v$VERSION $OUT/os.zip $OUT/manifest.json --title 'OS $VERSION' --notes-file <notes>"
echo
