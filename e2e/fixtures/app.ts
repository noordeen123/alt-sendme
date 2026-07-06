import { createHash, randomFillSync } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { APP_URL } from '../playwright.config'

type CapturedBlob = { sha: string; len: number }

declare global {
	interface Window {
		__e2eBlobs: CapturedBlob[]
	}
}

/**
 * Intercept URL.createObjectURL and record SHA-256 + length of every Blob.
 *
 * Headless browsers don't persist anchor-click downloads, and the receiver's
 * "Browser downloads" fallback funnels the received file through
 * createObjectURL — so this hook is how a test asserts byte-for-byte
 * integrity without touching the download machinery. Must be installed via
 * addInitScript (before app code runs).
 */
function blobCaptureHook() {
	window.__e2eBlobs = []
	const orig = URL.createObjectURL.bind(URL)
	URL.createObjectURL = (obj: Blob | MediaSource) => {
		if (obj instanceof Blob) {
			obj.arrayBuffer().then(async (buf) => {
				const bytes = new Uint8Array(buf)
				const digest = await crypto.subtle.digest('SHA-256', bytes)
				const sha = [...new Uint8Array(digest)]
					.map((b) => b.toString(16).padStart(2, '0'))
					.join('')
				window.__e2eBlobs.push({ sha, len: bytes.length })
			})
		}
		return orig(obj)
	}
}

/** New page with the blob-capture hook installed, navigated to the app. */
export async function openApp(context: BrowserContext): Promise<Page> {
	const page = await context.newPage()
	await page.addInitScript(blobCaptureHook)
	await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
	await expect(page.getByRole('tab', { name: 'Send' })).toBeVisible()
	return page
}

/** Select a file through the real file chooser and start sharing.
 * Resolves with the ticket once the sender reports it is listening. */
export async function startShare(
	page: Page,
	filePath: string
): Promise<string> {
	const chooser = page.waitForEvent('filechooser')
	await page.getByRole('button', { name: 'Browse File' }).click()
	await (await chooser).setFiles(filePath)
	await page.getByRole('button', { name: /Start Sharing/i }).click()
	await expect(page.getByText('Listening for connection')).toBeVisible({
		timeout: 45_000,
	})
	const ticket = await page.locator('input[readonly]').first().inputValue()
	expect(ticket).toMatch(/^blob/)
	return ticket
}

export async function openReceiveTab(page: Page): Promise<void> {
	await page.getByRole('tab', { name: 'Receive' }).click()
	await expect(page.getByRole('button', { name: /^Download/ })).toBeVisible()
}

/** Playwright's fill() drives the real input pipeline, so React's controlled
 * textarea picks the value up (unlike a bare DOM value assignment). */
export async function pasteTicket(page: Page, ticket: string): Promise<void> {
	await page.locator('textarea').fill(ticket)
}

export async function clickDownload(page: Page): Promise<void> {
	const button = page.getByRole('button', { name: /^Download/ })
	await expect(button).toBeEnabled()
	await button.click()
}

export async function expectTransferComplete(
	page: Page,
	timeout = 90_000
): Promise<void> {
	await expect(page.getByText('Transfer Complete!')).toBeVisible({ timeout })
}

/** The "Receive Failed" alert dialog. Returns its message text. */
export async function expectReceiveFailed(
	page: Page,
	timeout = 60_000
): Promise<string> {
	const dialog = page.getByRole('alertdialog')
	await expect(dialog).toBeVisible({ timeout })
	const text = (await dialog.innerText()).replace(/\s+/g, ' ').trim()
	await dialog.getByRole('button', { name: 'OK' }).click()
	return text
}

/** Wait for the receiver to hand its bytes to createObjectURL, return digest. */
export async function capturedBlob(page: Page): Promise<CapturedBlob> {
	await page.waitForFunction(() => window.__e2eBlobs.length > 0, undefined, {
		timeout: 15_000,
	})
	const blobs = await page.evaluate(() => window.__e2eBlobs)
	return blobs[blobs.length - 1]
}

export function sha256(buf: Buffer): string {
	return createHash('sha256').update(buf).digest('hex')
}

export function sha256File(path: string): string {
	return sha256(readFileSync(path))
}

/** Unique random file in a fresh temp dir; content differs per call so a
 * stale share from a previous test can never satisfy a checksum. */
export function makeTestFile(
	name: string,
	size = 96
): { path: string; sha: string; size: number } {
	const dir = mkdtempSync(join(tmpdir(), 'altsendme-e2e-'))
	const buf = Buffer.alloc(size)
	randomFillSync(buf)
	const path = join(dir, name)
	writeFileSync(path, buf)
	return { path, sha: sha256(buf), size }
}
