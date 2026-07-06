import {
	capturedBlob,
	clickDownload,
	expectTransferComplete,
	openApp,
	openReceiveTab,
	pasteTicket,
	startShare,
} from '../fixtures/app'
import { expect, test } from '../fixtures/test'

/**
 * The web path holds the whole payload in WASM linear memory on both ends
 * (MemStore, no streaming) — this is the documented size limitation. 50 MB
 * is the regression floor: it worked at suite creation, it must keep working.
 * Random bytes, so OS page compression can't flatter the numbers.
 *
 * Uses the step helpers instead of receive() so the timer brackets exactly
 * the download, not the tab-switch/paste setup.
 */
test('50 MB file transfers intact through the relay', {
	tag: '@scale',
}, async ({ senderCtx, receiverCtx, makeFile }) => {
	const file = makeFile('big-50mb.bin', 50 * 1024 * 1024)

	const sender = await openApp(senderCtx)
	const ticket = await startShare(sender, file.path)

	const receiver = await openApp(receiverCtx)
	await openReceiveTab(receiver)
	await pasteTicket(receiver, ticket)

	const started = Date.now()
	await clickDownload(receiver)
	// ~28s at the ~1.8 MB/s observed relay throughput; 240s is the
	// perf-regression budget, not an expectation
	await expectTransferComplete(receiver, 240_000)
	const elapsed = Date.now() - started

	const blob = await capturedBlob(receiver)
	expect(blob.len).toBe(file.size)
	expect(blob.sha).toBe(file.sha)

	test.info().annotations.push({
		type: 'perf',
		description: `50 MB in ${(elapsed / 1000).toFixed(1)}s (${(50 / (elapsed / 1000)).toFixed(2)} MB/s)`,
	})
})
