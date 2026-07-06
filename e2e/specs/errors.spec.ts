import {
	clickDownload,
	expectReceiveFailed,
	openApp,
	openReceiveTab,
	pasteTicket,
	receive,
	startShare,
	stopSharing,
} from '../fixtures/app'
import { S } from '../fixtures/strings'
import { expect, test } from '../fixtures/test'

test.describe('failure handling', () => {
	test('garbage ticket fails with a dialog and the UI stays usable', async ({
		receiverCtx,
	}) => {
		const receiver = await openApp(receiverCtx)
		await openReceiveTab(receiver)
		await pasteTicket(receiver, 'blobnotarealticketatall1234567890abcdef')
		await clickDownload(receiver)

		const message = await expectReceiveFailed(receiver)
		expect(message).toMatch(/failed/i)

		// recoverable: input still editable, button still wired
		await pasteTicket(receiver, 'blobstillgarbage')
		await expect(
			receiver.getByRole('button', { name: S.download })
		).toBeEnabled()
	})

	test('ticket whose sender stopped sharing fails within bounded time', async ({
		senderCtx,
		receiverCtx,
		makeFile,
	}) => {
		const file = makeFile('gone.bin', 512)
		const sender = await openApp(senderCtx)
		const ticket = await startShare(sender, file.path)
		await stopSharing(sender)

		const receiver = await openApp(receiverCtx)
		await openReceiveTab(receiver)
		await pasteTicket(receiver, ticket)
		await clickDownload(receiver)

		// must error, not hang: a dead endpoint should surface inside the test
		// timeout, or this documents a real UX bug
		await expectReceiveFailed(receiver, 100_000)
	})

	test('ticket whose sender tab closed fails within bounded time', async ({
		senderCtx,
		receiverCtx,
		makeFile,
	}) => {
		const file = makeFile('closed.bin', 512)
		const sender = await openApp(senderCtx)
		const ticket = await startShare(sender, file.path)

		// pagehide teardown closes the endpoint and shuts the store
		await senderCtx.close()

		const receiver = await openApp(receiverCtx)
		await openReceiveTab(receiver)
		await pasteTicket(receiver, ticket)
		await clickDownload(receiver)
		await expectReceiveFailed(receiver, 100_000)
	})

	test('second download of the same ticket resolves instead of hanging', async ({
		senderCtx,
		receiverCtx,
		makeFile,
	}, testInfo) => {
		const file = makeFile('twice.bin', 1024)
		const sender = await openApp(senderCtx)
		const ticket = await startShare(sender, file.path)

		const receiver = await openApp(receiverCtx)
		await receive(receiver, ticket)
		await receiver.getByRole('button', { name: S.done }).click()

		await pasteTicket(receiver, ticket)
		await clickDownload(receiver)

		// documents actual behavior: web shares may or may not survive their
		// first download — either outcome is acceptable, a hang is not
		const outcome = receiver
			.getByText(S.transferComplete)
			.or(receiver.getByRole('alertdialog'))
		await expect(outcome.first()).toBeVisible({ timeout: 100_000 })
		const succeeded = await receiver
			.getByText(S.transferComplete)
			.isVisible()
			.catch(() => false)
		testInfo.annotations.push({
			type: 'observed',
			description: `second download ${succeeded ? 'succeeded (share survives first transfer)' : 'failed gracefully (one-shot share)'}`,
		})
	})

	test('reload during an active share resets to idle', async ({
		senderCtx,
		makeFile,
	}) => {
		const file = makeFile('reload.bin', 512)
		const sender = await openApp(senderCtx)
		await startShare(sender, file.path)

		await sender.reload({ waitUntil: 'domcontentloaded' })

		// the share dies with the WASM instance (documented limitation);
		// what must not happen is a stuck "sharing" UI with no session behind it
		await expect(
			sender.getByRole('button', { name: S.browseFile })
		).toBeVisible({
			timeout: 15_000,
		})
	})
})
