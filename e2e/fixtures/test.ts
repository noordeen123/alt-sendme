import { test as base, type BrowserContext } from '@playwright/test'

/**
 * Sender and receiver live in separate BrowserContexts: separate storage,
 * separate WASM instances, separate iroh node identities — two real peers,
 * not two tabs sharing state. Contexts are closed per test so a lingering
 * share can't hold relay connections into the next test.
 */
export const test = base.extend<{
	senderCtx: BrowserContext
	receiverCtx: BrowserContext
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
})

export { expect } from '@playwright/test'
