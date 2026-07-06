import {
	capturedBlob,
	expectTransferComplete,
	openApp,
	openReceiveTab,
	pasteTicket,
	receive,
	startShare,
	stopSharing,
} from '../fixtures/app'
import { S } from '../fixtures/strings'
import { expect, test } from '../fixtures/test'

test.describe('core transfer path', () => {
	test('web to web: single file arrives byte-for-byte, both sides report completion', {
		tag: '@core',
	}, async ({ senderCtx, receiverCtx, makeFile }) => {
		const file = makeFile('roundtrip.bin', 4096)

		const sender = await openApp(senderCtx)
		const ticket = await startShare(sender, file.path)

		const receiver = await openApp(receiverCtx)
		await receive(receiver, ticket)

		// integrity: what came out of the WASM engine === what went in
		const blob = await capturedBlob(receiver)
		expect(blob.len).toBe(file.size)
		expect(blob.sha).toBe(file.sha)

		// the sender observed the same transfer
		await expectTransferComplete(sender, 15_000)
	})

	test('receiver previews file name and size before downloading', {
		tag: '@core',
	}, async ({ senderCtx, receiverCtx, makeFile }) => {
		const file = makeFile('preview-me.txt', 96)

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
	}, async ({ senderCtx, makeFile }) => {
		const first = makeFile('first.bin', 512)
		const second = makeFile('second.bin', 512)

		const sender = await openApp(senderCtx)
		const firstTicket = await startShare(sender, first.path)

		await stopSharing(sender)

		const secondTicket = await startShare(sender, second.path)
		expect(secondTicket).not.toBe(firstTicket)
	})

	test('download stays disabled for empty and whitespace tickets', {
		tag: '@core',
	}, async ({ receiverCtx }) => {
		const receiver = await openApp(receiverCtx)
		await openReceiveTab(receiver)

		const download = receiver.getByRole('button', { name: S.download })
		await expect(download).toBeDisabled()

		await pasteTicket(receiver, '   \n  ')
		await expect(download).toBeDisabled()
	})
})
