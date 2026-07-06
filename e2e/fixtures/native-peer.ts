import {
	execFileSync,
	execFile,
	spawn,
	type ChildProcess,
} from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANIFEST = join(REPO, 'engine', 'Cargo.toml')
const BINARY = join(REPO, 'engine', 'target', 'debug', 'e2e-interop')

let built = false

/** Build the `engine/e2e-harness` crate once per run. Warm builds are
 * seconds; a cold one can take minutes, hence the generous timeout. */
export function ensureHarness(): string {
	if (!built) {
		execFileSync(
			'cargo',
			['build', '--manifest-path', MANIFEST, '-p', 'e2e-harness'],
			{ stdio: 'pipe', timeout: 600_000 }
		)
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
		// exit is expected after stop(); swallow the rejection installed above
		this.ready.catch(() => {})
	}

	async stop(): Promise<void> {
		if (this.child.exitCode !== null) return
		const exited = new Promise<void>((resolve) =>
			this.child.once('exit', () => resolve())
		)
		this.child.stdin?.end()
		const timeout = new Promise<void>((resolve) =>
			setTimeout(() => {
				this.child.kill('SIGKILL')
				resolve()
			}, 10_000)
		)
		await Promise.race([exited, timeout])
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
