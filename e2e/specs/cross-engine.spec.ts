import { firefox, webkit } from '@playwright/test'
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

/**
 * Two different browser engines transferring to each other proves the WASM
 * build is engine-portable, not Chromium-shaped: distinct JS runtimes,
 * distinct WebSocket stacks, one relay in the middle.
 */
test('webkit sender -> firefox receiver, byte-for-byte', {
	tag: '@cross-engine',
}, async () => {
	const file = makeTestFile('xengine.bin', 4096)

	const wk = await webkit.launch()
	const ff = await firefox.launch()
	try {
		const sender = await openApp(await wk.newContext())
		const ticket = await startShare(sender, file.path)

		const receiver = await openApp(await ff.newContext())
		await openReceiveTab(receiver)
		await pasteTicket(receiver, ticket)
		await clickDownload(receiver)
		await expectTransferComplete(receiver)

		const blob = await capturedBlob(receiver)
		expect(blob.len).toBe(file.size)
		expect(blob.sha).toBe(file.sha)
	} finally {
		await wk.close()
		await ff.close()
	}
})
