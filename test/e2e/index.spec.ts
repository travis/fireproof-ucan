import { env } from 'cloudflare:test';
import { it, expect } from 'vitest';

import * as Client from '@ucanto/client';
import * as CAR from '@ucanto/transport/car';
import * as HTTP from '@ucanto/transport/http';
import { Store } from '@web3-storage/capabilities';
import { Signer } from '@ucanto/principal/ed25519';
import { parseLink } from '@ucanto/core';

////////////////////////////////////////
// TESTS
////////////////////////////////////////

it('exercises the API with a real invocation', async () => {
	// Cloudflare server ID:    MgCbI52HESAu29h07/iTwgfJZjVDUN+mm6k6e4TF7nnDvTe0BKn8LUopGK2m/bnvEErRa378h83+3HUtFHQLleouuUqY=
	// Cloudflare server URL:   https://fireproof-ucan.travis-fireproof.workers.dev
	const serverId = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);
	const carLink = parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa');

	function connection(options = {}) {
		return Client.connect({
			id: serverId,
			codec: CAR.outbound,
			// @ts-ignore typing error we can fix later
			channel: HTTP.open({
				url: new URL('http://localhost:8787'),
				method: 'POST',
			}),
		});
	}

	const invocation = Store.add.invoke({
		audience: serverId,
		issuer: serverId,
		with: serverId.did(),
		nb: {
			link: carLink,
			size: 0,
		},
	});

	const conn = connection();

	try {
		// @ts-ignore TODO fix conn
		const response = await invocation.execute(conn);
		// console.log('👀', response?.out);
		expect(response?.out?.ok).toBeTruthy();
	} catch (e) {
		if (e && typeof e == 'object' && 'stack' in e) {
			console.log('ERROR', e.stack);
			console.log('-----');
		}
		throw e;
	}
});
