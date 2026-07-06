import { existsSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

export default async function globalSetup() {
	// The web build loads the wasm-bindgen bundle at runtime; without it every
	// transfer test fails with an unhelpful dynamic-import error. Fail fast.
	const wasmPkg = join(REPO, 'frontend/src/wasm/pkg/wasm_bridge.js')
	if (!existsSync(wasmPkg)) {
		throw new Error(
			`missing ${wasmPkg}\n` +
				'the e2e suite drives the real WASM engine — build it first:\n' +
				'  pnpm build:wasm'
		)
	}

	// Transfers need the public iroh relay network. A DNS failure here means
	// no connectivity: abort with a readable message instead of 20 timeouts.
	try {
		await lookup('n0.computer')
	} catch {
		throw new Error(
			'offline? e2e transfers round-trip through public iroh relays and need internet'
		)
	}
}
