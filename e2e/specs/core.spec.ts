import {
	capturedBlob,
	clickDownload,
	expectTransferComplete,
	makeTestFile,
	openApp,
	openReceiveTab,
	pasteTicket,
	startShare,
} from '../fixtures/app'
import { expect, test } from '../fixtures/test'

test.describe('core transfer path', () => {
	test('web to web: single file arrives byte-for-byte, both sides report completion', {
		tag: '@core',
	}, async ({ senderCtx, receiverCtx }) => {
		const file = makeTestFile('roundtrip.bin', 4096)

		const sender = await openApp(senderCtx)
		const ticket = await startShare(sender, file.path)

		const receiver = await openApp(receiverCtx)
		await openReceiveTab(receiver)
		await pasteTicket(receiver, ticket)
		await clickDownload(receiver)
		await expectTransferComplete(receiver)

		// integrity: what came out of the WASM engine === what went in
		const blob = await capturedBlob(receiver)
		expect(blob.len).toBe(file.size)
		expect(blob.sha).toBe(file.sha)

		// the sender observed the same transfer
		await expectTransferComplete(sender, 15_000)
	})

	test('receiver previews file name and size before downloading', {
		tag: '@core',
	}, async ({ senderCtx, receiverCtx }) => {
		const file = makeTestFile('preview-me.txt', 96)

		const sender = await openApp(senderCtx)
		const ticket = await startShare(sender, file.path)

		const receiver = await openApp(receiverCtx)
		await openReceiveTab(receiver)
		await pasteTicket(receiver, ticket)

		// metadata is served over METADATA_ALPN without transferring the blob
		await expect(receiver.getByText('preview-me.txt')).toBeVisible({
			timeout: 30_000,
		})
		await expect(receiver.getByText(/96(\.0)?\s?B/)).toBeVisible()
	})

	test('stop sharing returns sender to idle and a new share works', {
		tag: '@core',
	}, async ({ senderCtx }) => {
		const first = makeTestFile('first.bin', 512)
		const second = makeTestFile('second.bin', 512)

		const sender = await openApp(senderCtx)
		const firstTicket = await startShare(sender, first.path)

		await sender.getByRole('button', { name: /stop sharing/i }).click()
		// stopping mid-transfer asks for confirmation; stopping while idle may not
		const dialog = sender.getByRole('alertdialog')
		const confirming = await dialog
			.waitFor({ state: 'visible', timeout: 1_500 })
			.then(() => true)
			.catch(() => false)
		if (confirming) {
			await dialog.getByRole('button', { name: /stop/i }).click()
		}
		await expect(
			sender.getByRole('button', { name: 'Browse File' })
		).toBeVisible({
			timeout: 15_000,
		})

		const secondTicket = await startShare(sender, second.path)
		expect(secondTicket).not.toBe(firstTicket)
	})

	test('download stays disabled for empty and whitespace tickets', {
		tag: '@core',
	}, async ({ receiverCtx }) => {
		const receiver = await openApp(receiverCtx)
		await openReceiveTab(receiver)

		const download = receiver.getByRole('button', { name: /^Download/ })
		await expect(download).toBeDisabled()

		await pasteTicket(receiver, '   \n  ')
		await expect(download).toBeDisabled()
	})
})
