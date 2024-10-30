import * as DU from '@ipld/dag-ucan';
import * as UCAN from '@web3-storage/capabilities/ucan';
import * as UCANTO from '@ucanto/server';
import * as Block from 'multiformats/block';
import * as CBOR from '@ipld/dag-cbor';
import { Delegation, DID, Link, Signer } from '@ucanto/interface';
import { ed25519 } from '@ucanto/principal';
import { sha256 } from 'multiformats/hashes/sha2';

import * as ClockCaps from '../../src/capabilities/clock';
import { Service } from '../../src/index';

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

export async function advanceClock({
	agent,
	clock,
	connection,
	event,
	server,
}: {
	agent: Agent;
	clock: Clock;
	connection: UCANTO.ConnectionView<Service>;
	event: UCANTO.Block;
	server: DU.Principal<DID<'key'>>;
}) {
	const invocation = ClockCaps.advance.invoke({
		issuer: agent.signer,
		audience: server,
		with: clock.did(),
		nb: { event: event.cid },
		proofs: [agent.delegation, agent.attestation],
	});

	return await invocation.execute(connection);
}

/**
 * Construct an authorized agent.
 * This represents an agent after it went through the login flow.
 * (`access/*` capabilities)
 */
export async function authorizedAgent({ account, server }: { account: DU.Signer; server: Signer<DID<'key'>> }): Promise<Agent> {
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
 * Construct an authorized share.
 * This represents a share after it went through the email flow.
 * It's basically the server acknowledging the share delegation is valid.
 */
export async function authorizedShare({
	audience,
	server,
	share,
}: {
	audience: DU.Signer;
	server: Signer<DID<'key'>>;
	share: { delegation: Delegation };
}) {
	const attestation = await UCAN.attest.delegate({
		issuer: server,
		audience,
		with: server.did(),
		nb: { proof: share.delegation.cid },
		expiration: Infinity,
	});

	return { attestation };
}

/**
 * Create a clock.
 * Audience is always a `did:mailto` DID.
 */
export async function createClock({ audience }: { audience: DU.Signer }): Promise<Clock> {
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
	const eventData = { metadata: messageCid.toString() };
	const event = { parents: [], data: eventData };

	const block = await Block.encode({
		value: event,
		codec: CBOR,
		hasher: sha256,
	});

	return block;
}

export async function getClockHead({
	agent,
	clock,
	connection,
	server,
}: {
	agent: Agent;
	clock: Clock;
	connection: UCANTO.ConnectionView<Service>;
	server: DU.Principal<DID<'key'>>;
}) {
	const invocation = ClockCaps.head.invoke({
		issuer: agent.signer,
		audience: server,
		with: clock.did(),
		proofs: [agent.delegation, agent.attestation],
	});

	return await invocation.execute(connection);
}

/**
 * Register a clock.
 */
export async function registerClock({
	clock,
	connection,
	server,
}: {
	clock: Clock;
	connection: UCANTO.ConnectionView<Service>;
	server: DU.Principal<DID<'key'>>;
}) {
	const invocation = ClockCaps.register.invoke({
		issuer: clock.signer,
		audience: server,
		with: clock.did(),
		nb: { proof: clock.delegation.cid },
		proofs: [clock.delegation],
	});

	return await invocation.execute(connection);
}

/**
 * Share a clock.
 * Audience is always a `did:mailto` DID.
 */
export async function shareClock({
	audience,
	clock,
	issuer,
	genesisClockDelegation,
}: {
	audience: DU.Signer;
	clock: DID<'key'>;
	issuer: DU.Signer;
	genesisClockDelegation: Delegation;
}) {
	const delegation = await ClockCaps.clock.delegate({
		issuer,
		audience,
		with: clock,
		proofs: [genesisClockDelegation],
		expiration: Infinity,
	});

	return { delegation };
}
