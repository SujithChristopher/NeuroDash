import { defineConfig } from 'vitest/config';

// Backend API tests: they boot a real dev server against a real (throwaway) Postgres database.
//   TEST_DATABASE_URL="postgresql://user:pw@localhost:5432/neurodash_test" npm run test:api
export default defineConfig({
	test: {
		include: ['tests/api/**/*.test.ts'],
		globalSetup: ['tests/api/global-setup.ts'],
		// Suites share one database and one server, and some assert on global state (notifications, audit).
		fileParallelism: false,
		testTimeout: 30_000,
		hookTimeout: 120_000
	}
});
