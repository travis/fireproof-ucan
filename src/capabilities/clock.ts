import { DID, URI, Link } from '@ucanto/core/schema';
import { capability, Schema } from '@ucanto/server';

export const clock = capability({
	can: 'clock/*',
	with: URI.match({ protocol: 'did:' }),
});

/**
 * Advance the clock by adding an event.
 */
export const advance = capability({
	can: 'clock/advance',
	with: URI.match({ protocol: 'did:' }),
	nb: Schema.struct({
		// CAR file CID containing the event.
		// Data format: https://github.com/storacha-network/specs/blob/e04e53f/w3-clock.md#data-format
		event: Link.match({ version: 1 }),
	}),
});

/**
 * List the CIDs of the events at the head of this clock.
 */
export const head = capability({
	can: 'clock/head',
	with: URI.match({ protocol: 'did:' }),
});
