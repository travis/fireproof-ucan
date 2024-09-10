import * as CAR from '@ucanto/core/car';
import * as Json from 'multiformats/codecs/json';
import * as UCAN from '@web3-storage/capabilities/ucan';
import * as UCANTO from '@ucanto/server';
import { Block } from 'multiformats/block';
import { Delegation, DID, Link, Signer } from '@ucanto/interface';
import { ed25519 } from '@ucanto/principal';
import { env } from 'cloudflare:test';
import { sha256 } from 'multiformats/hashes/sha2';

import * as ClockCaps from '../../src/capabilities/clock';
import { alice, server } from '../common/personas';
import { conn } from '../common/connection';

export type Agent = {
	attestation: Delegation;
	delegation: Delegation;
	signer: Signer<DID<'key'>>;
};

export type Clock = {
	delegation: Delegation;
	did: () => DID<'key'>;
	signer: Signer<DID<'key'>>;
};

export async function advanceClock({ agent, clock, event }: { agent: Agent; clock: Clock; event: UCANTO.Block }) {
	const invocation = ClockCaps.advance.invoke({
		issuer: agent.signer,
		audience: server,
		with: clock.did(),
		nb: { event: event.cid },
		proofs: [agent.delegation, agent.attestation],
	});

	return await invocation.execute(conn);
}

/**
 * Construct an authenticated agent.
 * This represents an agent after it went through the login flow.
 * (`access/*` capabilities)
 */
export async function authenticatedAgent({ account }: { account: typeof alice }): Promise<Agent> {
	const signer = await ed25519.Signer.generate();

	// Delegate all capabilities to the agent.
	// https://github.com/storacha-network/w3up/blob/fb8b8677c4c633cdf8c259db55357a1794eed3ab/packages/w3up-client/test/helpers/utils.js#L14
	const delegation = await UCANTO.delegate({
		issuer: account,
		audience: signer,
		capabilities: [{ can: '*', with: 'ucan:*' }],
		expiration: Infinity,
	});

	// Create an attestation to accompany the above delegation which has an attestion signature.
	// More info: https://github.com/storacha-network/specs/blob/54407171c7c2b3bb0151a9cff47e453e4419531e/w3-account.md#attestation-signature
	const attestation = await UCAN.attest.delegate({
		issuer: server,
		audience: signer,
		with: server.did(),
		nb: { proof: delegation.cid },
		expiration: Infinity,
	});

	// Fin
	return {
		attestation,
		delegation,
		signer,
	};
}

/**
 * Create a clock.
 * Audience is always a `did:mailto` DID.
 */
export async function createClock({ audience }: { audience: typeof alice }): Promise<Clock> {
	const signer = await ed25519.Signer.generate();
	const delegation = await ClockCaps.clock.delegate({
		issuer: signer,
		audience,
		with: signer.did(),
		expiration: Infinity,
	});

	return {
		delegation,
		did: () => signer.did(),
		signer,
	};
}

/**
 * Create a clock event.
 */
export async function createClockEvent({ messageCid }: { messageCid: Link }) {
	const eventData = { metadata: messageCid };
	const event = { parents: [], data: eventData };
	const eventBytes = Json.encode(event);
	const eventLink = UCANTO.Link.create(Json.code, await sha256.digest(eventBytes));

	return await UCANTO.CAR.write({
		roots: [new Block({ cid: eventLink, bytes: eventBytes, value: event })],
	});
}

export async function getClockHead({ agent, clock }: { agent: Agent; clock: Clock }) {
	const invocation = ClockCaps.head.invoke({
		issuer: agent.signer,
		audience: server,
		with: clock.did(),
		proofs: [agent.delegation, agent.attestation],
	});

	return await invocation.execute(conn);
}

/**
 * Register a clock.
 */
export async function registerClock({ clock }: { clock: Clock }) {
	const invocation = ClockCaps.register.invoke({
		issuer: clock.signer,
		audience: server,
		with: clock.did(),
		nb: { proof: clock.delegation.cid },
		proofs: [clock.delegation],
	});

	return await invocation.execute(conn);
}

/**
 * Share a clock.
 * Audience is always a `did:mailto` DID.
 */
export async function shareClock({
	audience,
	clock,
	genesisClockDelegation,
}: {
	audience: typeof alice;
	clock: DID<'key'>;
	genesisClockDelegation: Delegation;
}) {
	const delegation = await ClockCaps.clock.delegate({
		issuer: alice,
		audience,
		with: clock,
		proofs: [genesisClockDelegation],
		expiration: Infinity,
	});

	return { delegation };
}

/**
 * Add data to the server store.
 */
export async function storeOnServer(cid: Link, bytes: Uint8Array) {
	await env.bucket.put(cid.toString(), bytes);
}
