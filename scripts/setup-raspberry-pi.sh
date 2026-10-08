#!/usr/bin/env bash
# NeuroDash on a Raspberry Pi: one command that downloads everything and sets the dashboard up to run by itself.
#
#   bash scripts/setup-raspberry-pi.sh                 (from a copy of the project)
#   curl -fsSL https://raw.githubusercontent.com/SujithChristopher/NeuroDash/<branch>/scripts/setup-raspberry-pi.sh | bash -s -- --branch <branch>
#
# What it does (safe to run again: it keeps your .env, your database and your data folder):
#   1. checks the Pi (64-bit OS, memory) and adds swap if the Pi is short of memory for the build
#   2. installs what is missing: git, Python 3, PostgreSQL and Node.js 22 (apt / NodeSource)
#   3. downloads the project (git clone), or uses the copy you ran this from
#   4. creates the database and a database user, and writes .env (random password, never printed)
#   5. installs the packages, builds the app, applies the schema and loads the demo accounts and patients
#   6. starts two services that survive a reboot: the dashboard (neurodash-web) and the server the training devices
#      talk to (neurodash-server, localserver/s2.py)
#
# Options:  --branch NAME   branch to download (default: main)          --repo URL   another repository
#           --dir PATH      where the project lives (default: ~/NeuroDash)   --data-dir PATH  device data (default: ~/NeuroDashData)
#           --port N        dashboard port (default: 5180)               --update     git pull before building (re-run to upgrade)
#           --no-services   do not create the systemd services           --dry-run   show every step, change nothing
#           --help
set -Eeuo pipefail

REPO_URL="${NEURODASH_REPO:-https://github.com/SujithChristopher/NeuroDash.git}"
BRANCH="${NEURODASH_BRANCH:-main}"
PORT="${NEURODASH_WEB_PORT:-5180}"
APP_DIR=""
DATA_DIR=""
DB_NAME="neurodash"
DB_USER="neurodash"
DRY=0
UPDATE=0
SERVICES=1
NODE_MAJOR=22

# ------------------------------------------------------------------------------------------------------------ helpers

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33mWARNING: %s\033[0m\n' "$*" >&2; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# Run a command, or only show it with --dry-run
run() {
	# stdin is closed so nothing can swallow the rest of this script when it is piped in from curl
	if ((DRY)); then printf '    [dry-run] %s\n' "$*"; else "$@" </dev/null; fi
}

# Write a root-owned file from stdin
write_root_file() {
	local path=$1 content
	content=$(cat)
	if ((DRY)); then
		printf '    [dry-run] would write %s:\n' "$path"
		printf '%s\n' "$content" | sed 's/^/        | /'
	else
		printf '%s\n' "$content" | sudo tee "$path" >/dev/null
	fi
}

# The value of KEY in an env file, without quotes (empty when absent)
get_env_key() {
	local file=$1 key=$2
	[[ -f $file ]] || return 0
	sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" | head -n1 | sed 's/^"//; s/"[[:space:]]*$//; s/[[:space:]]*$//'
}

# Set KEY="value" in an env file: replaces an existing line, otherwise appends one (a commented-out example is left alone)
set_env_key() {
	local file=$1 key=$2 value=$3 tmp
	tmp=$(mktemp)
	if grep -qE "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null; then
		awk -v k="$key" -v v="$value" '
			$0 ~ "^[[:space:]]*" k "[[:space:]]*=" && !done { print k "=\"" v "\""; done = 1; next }
			{ print }
		' "$file" >"$tmp"
	else
		{ [[ -f $file ]] && cat "$file"; printf '%s="%s"\n' "$key" "$value"; } >"$tmp"
	fi
	cat "$tmp" >"$file"
	rm -f "$tmp"
}

random_hex() { openssl rand -hex "${1:-16}"; }

usage() { sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# ------------------------------------------------------------------------------------------------------------ steps

preflight() {
	say "Checking this computer"
	((EUID != 0)) || die "Run this as your normal user (for example pi), not as root: it uses sudo only where it must, and the services run as you."

	local arch
	arch=$(uname -m)
	case "$arch" in
		aarch64 | arm64 | x86_64) note "Architecture: $arch" ;;
		*) die "This needs a 64-bit operating system (found $arch). Install 'Raspberry Pi OS (64-bit)' and run this again." ;;
	esac

	if ! ((DRY)); then
		command -v apt-get >/dev/null || die "This script uses apt (Raspberry Pi OS / Debian / Ubuntu)."
		curl -fsS --max-time 15 -o /dev/null https://deb.nodesource.com || die "No internet connection (could not reach deb.nodesource.com)."
		note "Internet: reachable"
		sudo -v
	fi

	if [[ -r /proc/meminfo ]]; then
		local mem_kb swap_kb
		mem_kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
		swap_kb=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
		note "Memory: $((mem_kb / 1024)) MB, swap: $((swap_kb / 1024)) MB"
		# Building the app needs about 2 GB; add swap on a small Pi rather than let the build be killed
		if ((mem_kb + swap_kb < 3500000)); then
			say "Low memory: adding a 2 GB swap file for the build"
			if [[ -e /swapfile ]]; then
				note "/swapfile already exists"
				run sudo swapon /swapfile 2>/dev/null || true
			else
				run sudo fallocate -l 2G /swapfile
				run sudo chmod 600 /swapfile
				run sudo mkswap /swapfile
				run sudo swapon /swapfile
				if ! ((DRY)); then grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null; fi
			fi
		fi
	fi
}

install_packages() {
	say "Installing git, Python 3, PostgreSQL and the build tools"
	run sudo apt-get update
	run sudo apt-get install -y git curl ca-certificates gnupg openssl python3 postgresql postgresql-contrib build-essential
	run sudo systemctl enable --now postgresql

	local have=0
	if command -v node >/dev/null; then have=$(node -p "process.versions.node.split('.')[0]"); fi
	if ((have >= NODE_MAJOR)); then
		note "Node.js $(node -v) is already installed"
	else
		say "Installing Node.js $NODE_MAJOR"
		run bash -c "curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -"
		run sudo apt-get install -y nodejs
	fi
}

get_project() {
	say "Getting the project"
	local here
	here=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)
	if [[ -z $APP_DIR && -n $here && -f $here/../package.json && -d $here/../prisma ]] && grep -q '"name": "neurodash"' "$here/../package.json"; then
		APP_DIR=$(cd "$here/.." && pwd)
		note "Using the project this script is in: $APP_DIR"
	else
		APP_DIR="${APP_DIR:-$HOME/NeuroDash}"
		if [[ -d $APP_DIR/.git ]]; then
			note "Found $APP_DIR"
			UPDATE=1
		else
			note "Downloading $REPO_URL (branch $BRANCH) to $APP_DIR"
			run git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR" || die "Could not download the project. If the repository is private, clone it yourself (with your login) and run scripts/setup-raspberry-pi.sh from inside it."
		fi
	fi

	if ((UPDATE)) && [[ -d $APP_DIR/.git ]]; then
		note "Updating from $REPO_URL ($BRANCH)"
		run git -C "$APP_DIR" fetch origin "$BRANCH"
		run git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || warn "Could not fast-forward (local changes?): continuing with the files as they are."
	fi
	DATA_DIR="${DATA_DIR:-${NEURODASH_DATA_DIR:-$HOME/NeuroDashData}}"
}

setup_database_and_env() {
	say "Setting up the database and .env"
	local env_file="$APP_DIR/.env" url db_pass="" fresh=0
	url=$(get_env_key "$env_file" DATABASE_URL)
	if [[ -z $url || $url == *USER:PASSWORD* ]]; then
		fresh=1
		db_pass=$(random_hex 16)
	fi

	if ((DRY)); then
		note "[dry-run] would create the PostgreSQL user '$DB_USER' and database '$DB_NAME' if they are missing"
	else
		# from / so the postgres user is not told it cannot enter your home folder
		pg() { (cd / && sudo -u postgres psql -v ON_ERROR_STOP=1 -qtA "$@" </dev/null); }
		if [[ $(pg -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'") != 1 ]]; then
			((fresh)) || db_pass=$(random_hex 16) # a database user that is missing needs a password, whatever .env says
			pg -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$db_pass' CREATEDB"
			fresh=1
		elif ((fresh)); then
			pg -c "ALTER ROLE $DB_USER PASSWORD '$db_pass'"
		fi
		if [[ $(pg -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'") != 1 ]]; then
			pg -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
		fi
		note "PostgreSQL user '$DB_USER' and database '$DB_NAME' are ready"
	fi

	if ((DRY)); then
		note "[dry-run] would write $env_file (DATABASE_URL with a random password, NEURODASH_DATA_DIR=$DATA_DIR, ALLOW_HTTP_COOKIES=1)"
		return 0
	fi
	[[ -f $env_file ]] || cp "$APP_DIR/.env.example" "$env_file"
	if ((fresh)); then set_env_key "$env_file" DATABASE_URL "postgresql://$DB_USER:$db_pass@localhost:5432/$DB_NAME"; fi
	[[ -n $(get_env_key "$env_file" SESSION_SECRET) && $(get_env_key "$env_file" SESSION_SECRET) != "a long random string" ]] || set_env_key "$env_file" SESSION_SECRET "$(random_hex 32)"
	# The folder the training devices' server writes to and the dashboard reads from: it must be the same one
	set_env_key "$env_file" NEURODASH_DATA_DIR "$DATA_DIR"
	# Opened from other devices by IP over plain http: the session cookie must not be Secure (trusted clinic network only)
	set_env_key "$env_file" ALLOW_HTTP_COOKIES "1"
	chmod 600 "$env_file"
	mkdir -p "$DATA_DIR"
	note ".env written (only you can read it): $env_file"
	note "Device data folder: $DATA_DIR"
}

build_app() {
	say "Installing packages and building the dashboard (the first time takes several minutes on a Pi)"
	((DRY)) || cd "$APP_DIR"
	run npm ci --no-audit --no-fund
	run npx prisma generate
	NODE_OPTIONS="--max-old-space-size=2048" run npm run build
}

prepare_database() {
	say "Applying the database schema and loading the demo accounts and patients"
	((DRY)) || cd "$APP_DIR"
	run npm run setup
}

install_services() {
	if ! ((SERVICES)); then
		say "Skipping the services (--no-services). Start by hand:  cd $APP_DIR && npm run serve:lan"
		return 0
	fi
	say "Creating the services (they start at boot and restart if they stop)"
	local user node_bin python_bin
	user=$(id -un)
	node_bin=$(command -v node || echo /usr/bin/node)
	python_bin=$(command -v python3 || echo /usr/bin/python3)

	write_root_file /etc/systemd/system/neurodash-web.service <<EOF
[Unit]
Description=NeuroDash dashboard
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=$user
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=NODE_ENV=production
ExecStart=$node_bin $APP_DIR/node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port $PORT --strictPort
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

	write_root_file /etc/systemd/system/neurodash-server.service <<EOF
[Unit]
Description=NeuroDash device server (training devices upload here)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$user
WorkingDirectory=$APP_DIR/localserver
Environment=NEURODASH_DATA_DIR=$DATA_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$python_bin $APP_DIR/localserver/s2.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

	run sudo systemctl daemon-reload
	run sudo systemctl enable neurodash-web neurodash-server
	run sudo systemctl restart neurodash-web neurodash-server

	# The firewall, if there is one: the dashboard, the device server and its change notices
	if command -v ufw >/dev/null && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
		say "Opening the firewall for the dashboard and the devices"
		run sudo ufw allow "$PORT/tcp"
		run sudo ufw allow 5000/tcp
		run sudo ufw allow 5001/udp
	fi
}

wait_until_up() {
	((DRY)) && return 0
	((SERVICES)) || return 0
	say "Waiting for the dashboard to answer"
	local i
	for i in $(seq 1 60); do
		if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login"; then
			note "The dashboard is up."
			return 0
		fi
		sleep 2
	done
	warn "The dashboard did not answer within two minutes. Look at the log:  journalctl -u neurodash-web -n 50 --no-pager"
	return 1
}

summary() {
	local host ips
	host=$(hostname)
	ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -n3 | tr '\n' ' ' || true)
	cat <<EOF

$(printf '\033[1;32m')NeuroDash is set up.$(printf '\033[0m')

  Open the dashboard from any device on the same network:
      http://$host.local:$PORT
$(for ip in $ips; do echo "      http://$ip:$PORT"; done)

  Sign in with a demo account (every one uses the password  neurodash123):
      priya.nair@neurodash.care   (therapist)      arjun.rao@neurodash.care   (engineer)
      vikram.suresh@neurodash.care (consultant)    biorehabilitationgroup@gmail.com (admin)
  Change these passwords before real use: sign in as the admin, Users, reset password.

  Point each training device at this Pi:  set NEURODASH_SERVER_IP=${ips%% *}   (or SERVER_IP in sender.py)
  Device data folder: $DATA_DIR        Settings: $APP_DIR/.env (the database password is in it)

  Status:    sudo systemctl status neurodash-web neurodash-server
  Logs:      journalctl -u neurodash-web -f        journalctl -u neurodash-server -f
  Restart:   sudo systemctl restart neurodash-web neurodash-server
  Upgrade:   bash $APP_DIR/scripts/setup-raspberry-pi.sh --update
EOF
}

# ------------------------------------------------------------------------------------------------------------ main

parse_args() {
	while (($#)); do
		case "$1" in
			--branch) BRANCH=${2:?--branch needs a name}; shift 2 ;;
			--repo) REPO_URL=${2:?--repo needs a URL}; shift 2 ;;
			--dir) APP_DIR=${2:?--dir needs a path}; shift 2 ;;
			--data-dir) DATA_DIR=${2:?--data-dir needs a path}; shift 2 ;;
			--port) PORT=${2:?--port needs a number}; shift 2 ;;
			--update) UPDATE=1; shift ;;
			--no-services) SERVICES=0; shift ;;
			--dry-run) DRY=1; shift ;;
			-h | --help) usage; exit 0 ;;
			*) die "Unknown option: $1 (see --help)" ;;
		esac
	done
	[[ $PORT =~ ^[0-9]+$ ]] || die "--port must be a number."
}

main() {
	parse_args "$@"
	((DRY)) && say "DRY RUN: nothing will be changed"
	preflight
	install_packages
	get_project
	setup_database_and_env
	build_app
	prepare_database
	install_services
	wait_until_up || true
	summary
}

# Sourced by the tests (scripts/test-setup-raspberry-pi.sh) to try the helpers on their own
if [[ "${NEURODASH_SETUP_LIB:-0}" != 1 ]]; then main "$@"; fi
