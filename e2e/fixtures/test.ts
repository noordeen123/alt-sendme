import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, type BrowserContext } from '@playwright/test'
import { writeTestFile } from './app'

type MakeFile = (
	name: string,
	size?: number
) => { path: string; sha: string; size: number }

/**
 * senderCtx/receiverCtx: sender and receiver live in separate
 * BrowserContexts — separate storage, separate WASM instances, separate iroh
 * node identities. Two real peers, not two tabs sharing state. Closed per
 * test so a lingering share can't hold relay connections into the next test.
 *
 * tmpDir/makeFile: every test's payloads live in one temp dir that is
 * removed in teardown (pass or fail), so repeated runs don't accumulate
 * orphaned files — the scale test alone writes 50 MB per run.
 */
export const test = base.extend<{
	senderCtx: BrowserContext
	receiverCtx: BrowserContext
	tmpDir: string
	makeFile: MakeFile
}>({
	senderCtx: async ({ browser }, use) => {
		const ctx = await browser.newContext()
		await use(ctx)
		await ctx.close()
	},
	receiverCtx: async ({ browser }, use) => {
		const ctx = await browser.newContext()
		await use(ctx)
		await ctx.close()
	},
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures declare their dependencies via first-param destructuring
	tmpDir: async ({}, use) => {
		const dir = mkdtempSync(join(tmpdir(), 'altsendme-e2e-'))
		await use(dir)
		rmSync(dir, { recursive: true, force: true })
	},
	makeFile: async ({ tmpDir }, use) => {
		await use((name, size = 96) => writeTestFile(tmpDir, name, size))
	},
})

export { expect } from '@playwright/test'
