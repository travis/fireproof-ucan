import { env } from 'cloudflare:test';
import { it, expect } from 'vitest';

import * as UCANTO from '@ucanto/client';
import * as CAR from '@ucanto/transport/car';
import * as HTTP from '@ucanto/transport/http';
import { Store } from '@web3-storage/capabilities';
import { Signer } from '@ucanto/principal/ed25519';
import { parseLink } from '@ucanto/core';
import { bytesToDelegations } from '@web3-storage/access/encoding';

import * as Client from '../common/client';
import * as Clock from '../../src/capabilities/clock';
import { Service } from '../../src/index';
import { alice, bob, server } from '../common/personas';
import { storeOnServer } from '../common/store';

////////////////////////////////////////
// PREP
////////////////////////////////////////

const serverId = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);

function connection(options = {}) {
	return UCANTO.connect<Service>({
		id: serverId,
		codec: CAR.outbound,
		// @ts-ignore typing error we can fix later
		channel: HTTP.open({
			url: new URL('http://localhost:8787'),
			method: 'POST',
		}),
	});
}

////////////////////////////////////////
// TESTS
////////////////////////////////////////

it('exercises the API with a real invocation', async () => {
	const carLink = parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa');

	const response = await Store.add
		.invoke({
			audience: serverId,
			issuer: serverId,
			with: serverId.did(),
			nb: {
				link: carLink,
				size: 0,
			},
		})
		.execute(connection());

	expect(response.out?.ok).toBeTruthy();
	if (response.out.error) console.log(response.out.error);
});

it('authorizes, confirms and claims clock share', async () => {
	const clock = await Client.createClock({ audience: alice });
	await Client.registerClock({ clock, connection: connection(), server });

	const share = await Client.shareClock({
		issuer: alice,
		audience: bob,
		clock: clock.did(),
		genesisClockDelegation: clock.delegation,
	});

	const agent = await Client.authorizedAgent({ account: alice, server });
	const response = await Clock.authorizeShare
		.invoke({
			issuer: agent.signer,
			audience: server,
			with: clock.did(),
			nb: {
				issuer: alice.did(),
				recipient: bob.did(),
				proof: share.delegation.link(),
			},
			proofs: [share.delegation, agent.delegation, agent.attestation],
		})
		.execute(connection());

	if (response.out.error) throw response.out.error;
	expect(response.out?.ok).toBeTruthy();

	const url = response.out.ok.url;
	await fetch(url);

	// Bob's turn
	const agentBob = await Client.authorizedAgent({ account: bob, server });
	const claim = await Clock.claimShare
		.invoke({
			issuer: agentBob.signer,
			audience: server,
			with: agentBob.signer.did(),
			nb: {
				issuer: alice.did(),
				recipient: bob.did(),
				proof: share.delegation.link(),
			},
		})
		.execute(connection());

	if (claim.out.error) throw claim.out.error;
	expect(claim.out?.ok).toBeTruthy();

	const delegations = Object.values(claim.out.ok.delegations).flatMap((bytes) => bytesToDelegations(bytes));
	expect(delegations.length).toBe(2);

	const att = delegations.find((d) => d.capabilities[0].can === 'ucan/attest');
	const del = delegations.find((d) => d.capabilities[0].can === 'clock/*');

	if (!att) throw new Error('Missing attenuation');
	if (!del) throw new Error('Missing delegation');

	const head = await Client.getClockHead({
		agent: agentBob,
		clock: clock,
		connection: connection(),
		server,
	});

	if (head.out.error) throw head.out.error;
	expect(head.out.ok).toBeTruthy();
});
