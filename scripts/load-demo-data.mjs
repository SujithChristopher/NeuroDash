// Copies the demo device CSVs (localserver/testdata) into the data folder the same way the local server would
// store them: <data dir>/<user>/<DEVICE>01/sessions.csv. The web app then imports them within ~30 seconds.
//   npm run demo:data            (uses NEURODASH_DATA_DIR from .env, else D:/NeuroDashData)
import fs from 'node:fs';
import path from 'node:path';

function fromEnvFile() {
	try {
		const m = /^NEURODASH_DATA_DIR\s*=\s*"?([^"\r\n]+)"?/m.exec(fs.readFileSync('.env', 'utf8'));
		return m?.[1].trim();
	} catch {
		return undefined;
	}
}

const root = path.resolve(process.env.NEURODASH_DATA_DIR || fromEnvFile() || 'D:/NeuroDashData');
const src = path.resolve('localserver/testdata');
const header = (text, key) => new RegExp(`^:${key}:\s*(.+)$`, 'mi').exec(text)?.[1].trim();

let copied = 0;
for (const f of fs.readdirSync(src).filter((n) => n.toLowerCase().endsWith('_sessions.csv'))) {
	const text = fs.readFileSync(path.join(src, f), 'utf8');
	const user = header(text, 'User')?.replace(/[^A-Za-z0-9_-]/g, '');
	const device = header(text, 'Device')?.toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (!user || !device) {
		console.warn(`skipped ${f}: no :User: / :Device: header`);
		continue;
	}
	const dir = path.join(root, user, `${device}01`);
	fs.mkdirSync(dir, { recursive: true });
	fs.copyFileSync(path.join(src, f), path.join(dir, 'sessions.csv'));
	console.log(`${f} -> ${path.join(dir, 'sessions.csv')}`);
	copied++;
}
console.log(copied ? `Done. Make sure the patient exists (npm run db:seed creates it).` : 'Nothing copied.');
