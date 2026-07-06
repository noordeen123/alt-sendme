import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	capturedBlob,
	clickDownload,
	expectReceiveFailed,
	expectTransferComplete,
	makeTestFile,
	openApp,
	openReceiveTab,
	pasteTicket,
	sha256File,
	startShare,
} from '../fixtures/app'
import {
	NativeSender,
	ensureHarness,
	nativeReceive,
} from '../fixtures/native-peer'
import { expect, test } from '../fixtures/test'

function cargoAvailable(): boolean {
	try {
		execFileSync('cargo', ['--version'], { stdio: 'pipe' })
		return true
	} catch {
		return false
	}
}

/**
 * Cross-target protocol compatibility. The native side is engine/e2e-harness,
 * which calls the same start_share/download the Tauri commands wrap — so
 * these are real desktop<->web transfers minus the window chrome.
 */
test.describe('web <-> native interop', () => {
	test.skip(
		!cargoAvailable(),
		'needs a rust toolchain to build engine/e2e-harness'
	)

	test.beforeAll(() => {
		ensureHarness()
	})

	test('web sender -> native receiver, byte-for-byte', async ({
		senderCtx,
	}) => {
		const file = makeTestFile('web-to-native.bin', 2048)
		const sender = await openApp(senderCtx)
		const ticket = await startShare(sender, file.path)

		const outdir = mkdtempSync(join(tmpdir(), 'altsendme-native-recv-'))
		const stdout = await nativeReceive(ticket, outdir)
		expect(stdout).toContain('DONE=')

		expect(sha256File(join(outdir, 'web-to-native.bin'))).toBe(file.sha)
	})

	test('native sender (relay ticket) -> web receiver, byte-for-byte', async ({
		receiverCtx,
	}) => {
		const file = makeTestFile('native-to-web.bin', 2048)
		const peer = new NativeSender(file.path, 'relay')
		try {
			const { ticket } = await peer.ready

			const receiver = await openApp(receiverCtx)
			await openReceiveTab(receiver)
			await pasteTicket(receiver, ticket)
			await clickDownload(receiver)
			await expectTransferComplete(receiver)

			const blob = await capturedBlob(receiver)
			expect(blob.len).toBe(file.size)
			expect(blob.sha).toBe(file.sha)
		} finally {
			await peer.stop()
		}
	})

	test('native sender with default Id ticket fails readably on web', async ({
		receiverCtx,
	}) => {
		// The desktop app's default ticket type is AddrInfoOptions::Id — node id
		// only, no relay addresses. The browser is relay-only and cannot use it.
		// This pins the UX a real desktop->web user hits out of the box: the
		// error must be immediate and say why, not spin or crash.
		const file = makeTestFile('id-ticket.bin', 512)
		const peer = new NativeSender(file.path, 'id')
		try {
			const { ticket } = await peer.ready

			const receiver = await openApp(receiverCtx)
			await openReceiveTab(receiver)
			await pasteTicket(receiver, ticket)
			await clickDownload(receiver)

			const message = await expectReceiveFailed(receiver, 60_000)
			expect(message).toMatch(/relay/i)

			// still usable afterwards
			await expect(
				receiver.getByRole('button', { name: /^Download/ })
			).toBeVisible()
		} finally {
			await peer.stop()
		}
	})
})
