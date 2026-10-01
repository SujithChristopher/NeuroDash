#!/usr/bin/env node
// One-command setup:  npm run setup
//   1. makes sure .env has a real DATABASE_URL (asks for it the first time)
//   2. creates the PostgreSQL database if it doesn't exist (no psql needed)
//   3. applies the schema (prisma migrate deploy), generates the client, loads the demo data
// Safe to re-run. Flags:  --reset  wipe and rebuild the database   --no-seed  skip the demo data

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import pg from 'pg';

const args = new Set(process.argv.slice(2));
const ENV = '.env';
const PLACEHOLDER = /USER:PASSWORD/;

const say = (m = '') => console.log(m);
const step = (n, m) => say(`\n[${n}/4] ${m}`);
const fail = (m) => {
	console.error(`\n✖ ${m}\n`);
	process.exit(1);
};

function readDatabaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL; // an explicit environment variable wins
	if (!existsSync(ENV)) return null;
	const m = /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(ENV, 'utf8'));
	return m ? m[1] : null;
}

function writeDatabaseUrl(url) {
	let text = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
	if (/^\s*DATABASE_URL\s*=/m.test(text)) text = text.replace(/^\s*DATABASE_URL\s*=.*$/m, `DATABASE_URL="${url}"`);
	else text = `DATABASE_URL="${url}"\n${text}`;
	writeFileSync(ENV, text);
}

async function askForUrl() {
	if (!stdin.isTTY) {
		fail('DATABASE_URL is not set. Put it in .env (see .env.example) or export it, then run `npm run setup` again.');
	}
	say('Let’s connect to PostgreSQL. Press Enter to accept the value in [brackets].\n');
	const rl = createInterface({ input: stdin, output: stdout });
	const ask = async (q, d) => (await rl.question(`${q} [${d}]: `)).trim() || d;
	const host = await ask('Host', 'localhost');
	const port = await ask('Port', '5432');
	const user = await ask('User', 'postgres');
	const password = (await rl.question('Password: ')).trim();
	const name = await ask('Database name', 'neurodash');
	rl.close();
	return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

function run(cmd, label) {
	const r = spawnSync(cmd, { shell: true, stdio: 'inherit', env: process.env });
	if (r.status !== 0) fail(`${label} failed (see the output above).`);
}

// ---------------------------------------------------------------- 1. .env
step(1, 'Checking .env');
if (!existsSync(ENV) && existsSync('.env.example')) copyFileSync('.env.example', ENV);
let url = readDatabaseUrl();
if (!url || PLACEHOLDER.test(url)) {
	url = await askForUrl();
	writeDatabaseUrl(url);
	say('Saved DATABASE_URL to .env (this file is git-ignored).');
} else {
	say('Using DATABASE_URL from ' + (process.env.DATABASE_URL ? 'the environment.' : '.env.'));
}
process.env.DATABASE_URL = url;

let target;
try {
	target = new URL(url);
} catch {
	fail('DATABASE_URL is not a valid URL. It should look like postgresql://USER:PASSWORD@localhost:5432/neurodash');
}
const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
if (!/^[A-Za-z0-9_-]+$/.test(dbName)) fail(`"${dbName}" is not a safe database name. Use letters, digits, _ or -.`);

// ---------------------------------------------------------------- 2. database
step(2, `Making sure the database "${dbName}" exists`);
const admin = new pg.Client({ connectionString: url.replace(/\/[^/?]*(\?|$)/, '/postgres$1') });
try {
	await admin.connect();
} catch (e) {
	// `localhost` resolves to both ::1 and 127.0.0.1, so a refused connection arrives as an AggregateError with no message.
	const codes = [e?.code, ...(e?.errors ?? []).map((x) => x?.code)];
	const msg = String(e?.message || codes.filter(Boolean).join(', ') || e);
	if (codes.some((c) => c === 'ECONNREFUSED' || c === 'ETIMEDOUT' || c === 'ENOTFOUND')) {
		fail(`Can't reach PostgreSQL at ${target.hostname}:${target.port || 5432}. Is it running, and are the host and port right?`);
	}
	if (/password authentication failed|SASL|no password/i.test(msg)) {
		fail('PostgreSQL rejected the user/password in DATABASE_URL. Fix it in .env (URL-encode special characters, e.g. @ → %40).');
	}
	fail(`Couldn't connect to PostgreSQL: ${msg}`);
}
try {
	const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
	if (exists.rowCount) say(`"${dbName}" already exists.`);
	else {
		await admin.query(`CREATE DATABASE "${dbName}"`);
		say(`Created "${dbName}".`);
	}
} catch (e) {
	fail(`Couldn't create the database: ${e.message}\nThe PostgreSQL user needs the CREATEDB privilege, or create "${dbName}" yourself and re-run.`);
} finally {
	await admin.end();
}

// ---------------------------------------------------------------- 3. schema
step(3, args.has('--reset') ? 'Resetting the schema (this erases the database)' : 'Applying the schema');
if (args.has('--reset')) // Prisma 7 no longer seeds after a reset, so the demo data is loaded in step 4 like any other run.
	run('npx prisma migrate reset --force', 'Resetting the database');
else run('npx prisma migrate deploy', 'Applying migrations');
run('npx prisma generate', 'Generating the Prisma client');

// ---------------------------------------------------------------- 4. demo data
step(4, args.has('--no-seed') ? 'Skipping demo data (--no-seed)' : 'Loading demo data');
if (!args.has('--no-seed')) run('npx prisma db seed', 'Seeding the database');

say('\n✔ Setup complete.\n');
say('  Start the app:   npm run dev      → http://localhost:5173');
say('  Sign in:         priya.nair@neurodash.care   /   neurodash123');
say('  Browse the data: npx prisma studio\n');
