#!/usr/bin/env bash
# Tests for scripts/setup-raspberry-pi.sh that need no Raspberry Pi:  bash scripts/test-setup-raspberry-pi.sh
# They try the helpers on a temporary .env and run the whole script with --dry-run, which must change nothing.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/setup-raspberry-pi.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0
TESTS=0

ok() { TESTS=$((TESTS + 1)); printf '  ok   %s\n' "$1"; }
bad() { TESTS=$((TESTS + 1)); FAILS=$((FAILS + 1)); printf '  FAIL %s\n' "$1"; [[ -n ${2:-} ]] && printf '       %s\n' "$2"; }
equal() { if [[ $2 == "$3" ]]; then ok "$1"; else bad "$1" "expected [$3] but got [$2]"; fi; }
has() { if grep -qF -- "$3" <<<"$2"; then ok "$1"; else bad "$1" "missing: $3"; fi; }
lacks() { if grep -qF -- "$3" <<<"$2"; then bad "$1" "should not contain: $3"; else ok "$1"; fi; }

# the helpers, without running the installer
# shellcheck disable=SC1090
NEURODASH_SETUP_LIB=1 source "$SCRIPT"

echo "env file helpers"
ENV_FILE="$TMP/.env"
cat >"$ENV_FILE" <<'EOF'
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/neurodash"
SESSION_SECRET="a long random string"
# NEURODASH_DATA_DIR="D:/NeuroDashData"
NEURODASH_DATA_DIR="D:/NeuroDashData"
INGEST_INTERVAL_SECONDS=30
# ALLOW_HTTP_COOKIES=1
EOF

equal "reads a quoted value" "$(get_env_key "$ENV_FILE" DATABASE_URL)" "postgresql://USER:PASSWORD@localhost:5432/neurodash"
equal "reads an unquoted value" "$(get_env_key "$ENV_FILE" INGEST_INTERVAL_SECONDS)" "30"
equal "a missing key is empty" "$(get_env_key "$ENV_FILE" NOPE)" ""
equal "a commented-out key is not read" "$(get_env_key "$ENV_FILE" ALLOW_HTTP_COOKIES)" ""
equal "a missing file is empty" "$(get_env_key "$TMP/none.env" DATABASE_URL)" ""

set_env_key "$ENV_FILE" DATABASE_URL "postgresql://neurodash:abc123@localhost:5432/neurodash"
equal "replaces the URL, with its @ : / characters intact" "$(get_env_key "$ENV_FILE" DATABASE_URL)" "postgresql://neurodash:abc123@localhost:5432/neurodash"
set_env_key "$ENV_FILE" NEURODASH_DATA_DIR "/home/pi/NeuroDashData"
equal "replaces the live data folder line" "$(get_env_key "$ENV_FILE" NEURODASH_DATA_DIR)" "/home/pi/NeuroDashData"
has "leaves the commented example alone" "$(cat "$ENV_FILE")" '# NEURODASH_DATA_DIR="D:/NeuroDashData"'
set_env_key "$ENV_FILE" ALLOW_HTTP_COOKIES 1
equal "adds a key that only had a commented example" "$(get_env_key "$ENV_FILE" ALLOW_HTTP_COOKIES)" "1"
equal "does not duplicate a key" "$(grep -c '^NEURODASH_DATA_DIR=' "$ENV_FILE")" "1"
has "keeps the other lines" "$(cat "$ENV_FILE")" "INGEST_INTERVAL_SECONDS=30"
set_env_key "$TMP/new.env" SESSION_SECRET "xyz"
equal "creates a file that did not exist" "$(get_env_key "$TMP/new.env" SESSION_SECRET)" "xyz"

echo "random values"
a=$(random_hex 16)
b=$(random_hex 16)
equal "a hex password is 32 characters" "${#a}" "32"
[[ $a != "$b" ]] && ok "two are different" || bad "two are different"
[[ $a =~ ^[0-9a-f]+$ ]] && ok "it is only hex, so it is safe in a URL and in SQL" || bad "it is only hex"

echo "options"
out=$(bash "$SCRIPT" --nope 2>&1) && bad "an unknown option fails" || has "an unknown option fails with a message" "$out" "Unknown option"
out=$(bash "$SCRIPT" --dry-run --port abc 2>&1) && bad "a non-numeric port fails" || has "a non-numeric port fails with a message" "$out" "--port must be a number"
out=$(bash "$SCRIPT" --help 2>&1)
has "--help shows what it does" "$out" "one command that downloads everything"

echo "dry run"
HOME_DIR="$TMP/home"
mkdir -p "$HOME_DIR"
out=$(HOME="$HOME_DIR" bash "$SCRIPT" --dry-run --dir "$HOME_DIR/NeuroDash" --port 5190 2>&1)
status=$?
equal "exits successfully" "$status" "0"
has "installs PostgreSQL" "$out" "postgresql"
has "downloads the project" "$out" "git clone --branch main"
has "builds the app" "$out" "npm run build"
has "applies the schema and demo data" "$out" "npm run setup"
has "writes the dashboard service" "$out" "/etc/systemd/system/neurodash-web.service"
has "writes the device server service" "$out" "/etc/systemd/system/neurodash-server.service"
has "uses the chosen port" "$out" "--port 5190"
has "points the device server at the data folder" "$out" "NEURODASH_DATA_DIR=$HOME_DIR/NeuroDashData"
has "starts both at boot" "$out" "systemctl enable neurodash-web neurodash-server"
lacks "never prints a database password" "$out" "postgresql://neurodash:"
equal "creates nothing" "$(find "$HOME_DIR" -mindepth 1 | wc -l | tr -d ' ')" "0"

out=$(HOME="$HOME_DIR" bash "$SCRIPT" --dry-run --no-services --dir "$HOME_DIR/NeuroDash" 2>&1)
lacks "--no-services writes no service" "$out" "would write /etc/systemd"

printf '\n%d tests, %d failed\n' "$TESTS" "$FAILS"
exit $((FAILS > 0))
