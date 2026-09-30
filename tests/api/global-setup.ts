import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

const PORT = 5198;
let server: ChildProcess | undefined;

function sh(cmd: string, env: NodeJS.ProcessEnv) {
	const r = spawnSync(cmd, { shell: true, env, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stdout}\n${r.stderr}`);
}

export default async function setup() {
	const url = process.env.TEST_DATABASE_URL;
	if (!url) {
		throw new Error(
			'Set TEST_DATABASE_URL to a throwaway database whose name contains "test", e.g.\n' +
				'  TEST_DATABASE_URL="postgresql://postgres:pw@localhost:5432/neurodash_test" npm run test:api'
		);
	}
	// The seed and these tests mutate data: never let them near a real database.
	const dbName = new URL(url).pathname.replace(/^\//, '');
	if (!/test/i.test(dbName)) throw new Error(`Refusing to run against "${dbName}": the database name must contain "test".`);

	const env = { ...process.env, DATABASE_URL: url };
	sh('npx prisma migrate deploy', env);
	sh('npx prisma db seed', env);

	// Test the production build: SvelteKit's CSRF origin check and the Secure cookie flag are both
	// disabled in `vite dev`, so a dev server would hide real behaviour.
	sh('npx vite build', env);
	server = spawn(`npx vite preview --port ${PORT} --strictPort`, { shell: true, env: { ...env, NODE_ENV: 'production' }, stdio: 'ignore' });

	const deadline = Date.now() + 90_000;
	for (;;) {
		try {
			const res = await fetch(`http://localhost:${PORT}/login`);
			if (res.ok) break;
		} catch {
			/* not up yet */
		}
		if (Date.now() > deadline) throw new Error('Preview server did not start in time.');
		await new Promise((r) => setTimeout(r, 500));
	}

	process.env.TEST_BASE_URL = `http://localhost:${PORT}`;
	process.env.TEST_DATABASE_URL = url;

	return async () => {
		if (!server?.pid) return;
		if (process.platform === 'win32') spawnSync(`taskkill /PID ${server.pid} /T /F`, { shell: true });
		else server.kill('SIGTERM');
	};
}
