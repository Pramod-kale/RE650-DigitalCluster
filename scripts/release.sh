#!/usr/bin/env bash
# Build a release APK on EAS and publish it as a GitHub release.
#
#   npm run release                 # notes generated from commits since the last release
#   npm run release -- notes.md     # notes from a file
#
# Before running: set "version" in app.json, commit and push. The tag is
# v<version>; versions with a "-" (e.g. 0.2.0-beta.1) become pre-releases.
# EAS signs every build with the same key, so each APK installs over the last.
set -euo pipefail
cd "$(dirname "$0")/.."

NOTES_FILE="${1:-}"
VERSION=$(node -p "require('./app.json').expo.version")
TAG="v$VERSION"
APK="builds/RE650-Cluster-$TAG.apk"

fail() { echo "✖ $*" >&2; exit 1; }

# ---- checks: the release must match a pushed commit -------------------------
git diff --quiet && git diff --cached --quiet || fail "Uncommitted changes. Commit (and push) first."
git fetch -q origin
[ "$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 1)" = "0" ] || fail "Local commits not pushed. Run: git push"
gh release view "$TAG" >/dev/null 2>&1 && fail "Release $TAG already exists. Bump \"version\" in app.json."
[ -z "$NOTES_FILE" ] || [ -f "$NOTES_FILE" ] || fail "Notes file not found: $NOTES_FILE"

PRERELEASE=()
[[ "$VERSION" == *-* ]] && PRERELEASE=(--prerelease)
COMMIT=$(git rev-parse HEAD)

echo "▶ Building $TAG on EAS (profile: release). This takes a while…"
mkdir -p builds
npx eas-cli@latest build --platform android --profile release --non-interactive --wait --json > "builds/eas-$TAG.json"
URL=$(node -e "
  const b = JSON.parse(require('fs').readFileSync('builds/eas-$TAG.json', 'utf8'));
  const build = Array.isArray(b) ? b[0] : b;
  if (build.status !== 'FINISHED') { console.error('EAS build status: ' + build.status); process.exit(1); }
  console.log(build.artifacts.buildUrl);
")

echo "▶ Downloading APK"
curl -fL --progress-bar -o "$APK" "$URL"
echo "  $APK ($(du -h "$APK" | cut -f1))"

echo
echo "Ready to publish ${TAG}${PRERELEASE:+ (pre-release)} on GitHub at commit ${COMMIT:0:7}."
read -r -p "Publish now? [y/N] " ok
[[ "$ok" == [yY] ]] || { echo "Not published. The APK is in $APK"; exit 0; }

NOTES=(--generate-notes)
[ -n "$NOTES_FILE" ] && NOTES=(--notes-file "$NOTES_FILE")
gh release create "$TAG" "$APK" \
  --target "$COMMIT" \
  --title "RE650 Cluster $VERSION" \
  "${NOTES[@]}" \
  ${PRERELEASE[@]+"${PRERELEASE[@]}"}

echo "✔ Published: $(gh release view "$TAG" --json url -q .url)"
