import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI strings sourced from the app's own en translation file, so a copy edit
 * updates the suite automatically instead of timing out 22 tests. Read at
 * module load — a renamed key fails immediately with a clear TypeError, not
 * a mid-test selector timeout.
 */
const en = JSON.parse(
	readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			'..',
			'..',
			'frontend',
			'src',
			'locales',
			'en',
			'common.json'
		),
		'utf8'
	)
)

function key(path: string): string {
	const value = path
		.split('.')
		.reduce<unknown>(
			(node, part) => (node as Record<string, unknown>)?.[part],
			en
		)
	if (typeof value !== 'string') {
		throw new TypeError(`missing en translation key: ${path}`)
	}
	return value
}

export const S = {
	sendTab: key('send'),
	receiveTab: key('receive'),
	browseFile: key('sender.browseFile'),
	startSharing: key('sender.startSharing'),
	listening: key('sender.listeningForConnection'),
	transferComplete: key('transfer.complete'),
	download: key('receiver.download'),
	done: key('transfer.done'),
	ok: key('ok'),
	// hardcoded aria-label in SharingActiveCard.tsx, not an i18n key
	stopSharing: 'Stop sharing',
} as const
