import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))

// Dedicated strict port. The dev ports (1420/3001) stay untouched, and
// --host 127.0.0.1 pins the stack: `localhost` can resolve to ::1 or
// 127.0.0.1 per browser, and anything else bound to the same port on the
// other stack silently answers instead (observed in practice).
export const E2E_PORT = 3199
export const APP_URL = `http://127.0.0.1:${E2E_PORT}/web/`

export default defineConfig({
	testDir: './specs',
	globalSetup: './global-setup.ts',
	outputDir: './.artifacts/results',

	// Transfers round-trip through the public iroh relay network: they are
	// integration tests with real network latency. Serialize to keep relay
	// bandwidth contention from turning into flaky timeouts.
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	retries: process.env.CI ? 1 : 0,

	reporter: [
		['list'],
		['html', { outputFolder: './.artifacts/report', open: 'never' }],
	],

	use: {
		baseURL: APP_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},

	webServer: {
		command: `npx vite --mode web --port ${E2E_PORT} --strictPort --host 127.0.0.1`,
		cwd: `${HERE}/..`,
		url: APP_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},

	projects: [
		// Default: tiers 1-3 (core, errors, interop)
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			grepInvert: /@scale|@cross-engine/,
		},
		// Engine matrix: core happy path on the other two engines
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] },
			grep: /@core/,
		},
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] },
			grep: /@core/,
		},
		// Cross-engine pair (spec launches webkit+firefox itself)
		{
			name: 'cross-engine',
			use: { ...devices['Desktop Chrome'] },
			grep: /@cross-engine/,
		},
		// Large transfers, longer budget
		{
			name: 'scale',
			use: { ...devices['Desktop Chrome'] },
			grep: /@scale/,
			timeout: 300_000,
		},
	],
})
