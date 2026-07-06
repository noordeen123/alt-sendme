import {
	execFile,
	execFileSync,
	spawn,
	type ChildProcess,
} from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANIFEST = join(REPO, 'engine', 'Cargo.toml')
const BINARY = join(REPO, 'engine', 'target', 'debug', 'e2e-interop')

const CARGO_ARGS = ['build', '--manifest-path', MANIFEST, '-p', 'e2e-harness']

export function cargoAvailable(): boolean {
	try {
		execFileSync('cargo', ['--version'], { stdio: 'pipe' })
		return true
	} catch {
		return false
	}
}

/** Async cold build for global setup, where there is no hook timeout and the
 * event loop stays free. A fresh clone builds for minutes; doing that inside
 * a spec's beforeAll would blow Playwright's 120s hook budget. */
export async function buildHarness(): Promise<void> {
	await promisify(execFile)('cargo', CARGO_ARGS, { timeout: 600_000 })
}

let built = false

/** Warm freshness check inside workers (globalSetup already paid the cold
 * build; cargo just verifies up-to-dateness here, typically <2s). */
export function ensureHarness(): string {
	if (!built) {
		execFileSync('cargo', CARGO_ARGS, { stdio: 'pipe', timeout: 600_000 })
		built = true
	}
	if (!existsSync(BINARY)) {
		throw new Error(`cargo build succeeded but ${BINARY} is missing`)
	}
	return BINARY
}

export type TicketType = 'relay' | 'id'

/** A native sender holding a share open, driven over stdio.
 * Stopping closes stdin — the harness exits on EOF, dropping the share the
 * same way ShareHandle teardown does in the desktop app. */
export class NativeSender {
	private child: ChildProcess
	readonly ready: Promise<{ ticket: string; hash: string; size: number }>

	constructor(filePath: string, ticketType: TicketType = 'relay') {
		this.child = spawn(ensureHarness(), ['send', filePath, ticketType], {
			stdio: ['pipe', 'pipe', 'pipe'],
		})
		this.ready = new Promise((resolve, reject) => {
			let out = ''
			const timer = setTimeout(
				() => reject(new Error(`native sender: no ticket after 60s\n${out}`)),
				60_000
			)
			this.child.stdout?.on('data', (chunk: Buffer) => {
				out += chunk.toString()
				const ticket = out.match(/^TICKET=(\S+)$/m)?.[1]
				const hash = out.match(/^HASH=(\S+)$/m)?.[1]
				const size = out.match(/^SIZE=(\d+)$/m)?.[1]
				if (ticket && hash && size) {
					clearTimeout(timer)
					resolve({ ticket, hash, size: Number(size) })
				}
			})
			this.child.on('error', reject)
			this.child.on('exit', (code) => {
				clearTimeout(timer)
				reject(new Error(`native sender exited early (code ${code})\n${out}`))
			})
		})
		// prevents an unhandledRejection warning when the expected post-stop
		// exit fires after ready already resolved; awaiting callers still see
		// real pre-ticket failures because .catch() does not detach them
		this.ready.catch(() => {})
	}

	async stop(): Promise<void> {
		if (this.child.exitCode !== null) return
		const exited = new Promise<void>((resolve) =>
			this.child.once('exit', () => resolve())
		)
		this.child.stdin?.end()
		let killTimer: NodeJS.Timeout | undefined
		const timeout = new Promise<void>((resolve) => {
			killTimer = setTimeout(() => {
				this.child.kill('SIGKILL')
				resolve()
			}, 10_000)
		})
		await Promise.race([exited, timeout])
		clearTimeout(killTimer)
	}
}

/** One-shot native download into `outdir`. Resolves with harness stdout. */
export function nativeReceive(ticket: string, outdir: string): Promise<string> {
	const bin = ensureHarness()
	return new Promise((resolve, reject) => {
		execFile(
			bin,
			['recv', ticket, outdir],
			{ timeout: 120_000 },
			(err, stdout, stderr) => {
				if (err)
					reject(new Error(`native recv failed: ${err.message}\n${stderr}`))
				else resolve(stdout)
			}
		)
	})
}
