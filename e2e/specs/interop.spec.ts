import { join } from 'node:path'
import {
	capturedBlob,
	clickDownload,
	expectReceiveFailed,
	openApp,
	openReceiveTab,
	pasteTicket,
	receive,
	sha256File,
	startShare,
} from '../fixtures/app'
import {
	NativeSender,
	cargoAvailable,
	ensureHarness,
	nativeReceive,
} from '../fixtures/native-peer'
import { S } from '../fixtures/strings'
import { expect, test } from '../fixtures/test'

/**
 * Cross-target protocol compatibility. The native side is engine/e2e-harness,
 * which calls the same start_share_items/download the Tauri commands wrap —
 * so these are real desktop<->web transfers minus the window chrome.
 */
test.describe('web <-> native interop', () => {
	test.skip(
		!cargoAvailable(),
		'needs a rust toolchain to build engine/e2e-harness'
	)

	test.beforeAll(() => {
		// warm freshness check — global setup already paid the cold build;
		// raised budget covers an incremental rebuild after engine changes
		test.setTimeout(600_000)
		ensureHarness()
	})

	test('web sender -> native receiver, byte-for-byte', async ({
		senderCtx,
		makeFile,
		tmpDir,
	}) => {
		const file = makeFile('web-to-native.bin', 2048)
		const sender = await openApp(senderCtx)
		const ticket = await startShare(sender, file.path)

		const outdir = join(tmpDir, 'native-recv') // harness create_dir_all's it
		const stdout = await nativeReceive(ticket, outdir)
		expect(stdout).toContain('DONE=')

		expect(sha256File(join(outdir, 'web-to-native.bin'))).toBe(file.sha)
	})

	test('native sender (relay ticket) -> web receiver, byte-for-byte', async ({
		receiverCtx,
		makeFile,
	}) => {
		const file = makeFile('native-to-web.bin', 2048)
		const peer = new NativeSender(file.path, 'relay')
		try {
			const { ticket } = await peer.ready

			const receiver = await openApp(receiverCtx)
			await receive(receiver, ticket)

			const blob = await capturedBlob(receiver)
			expect(blob.len).toBe(file.size)
			expect(blob.sha).toBe(file.sha)
		} finally {
			await peer.stop()
		}
	})

	test('native sender with default Id ticket fails readably on web', async ({
		receiverCtx,
		makeFile,
	}) => {
		// The upstream-default ticket type is AddrInfoOptions::Id — node id
		// only, no relay addresses. The browser is relay-only and cannot use
		// it. (The desktop app sends RelayAndAddresses, but bare Id tickets
		// exist in the iroh ecosystem, e.g. the sendme CLI.) The error must
		// be immediate and say why, not spin or crash.
		const file = makeFile('id-ticket.bin', 512)
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
				receiver.getByRole('button', { name: S.download })
			).toBeVisible()
		} finally {
			await peer.stop()
		}
	})
})
