import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import * as CAR from '@ucanto/transport/car';

import { Message, Receipt } from '@ucanto/core';
import { Signer } from '@ucanto/principal/ed25519';
import { Store } from '@web3-storage/capabilities';
import { DelegationsStorageQuery } from '@web3-storage/upload-api';
import { AgentMessage } from '@web3-storage/upload-api';
import { parseLink } from '@ucanto/core';

import { create as createStore } from '../../../src/stores/delegations/persistent.js';

describe('Stores / Delegations / Persistent', () => {
	it('should store a delegation', async () => {
		const store = createStore(env.bucket, env.kv_store);
		const id = await Signer.generate();

		const delegation = await Store.add.delegate({
			audience: id,
			issuer: id,
			with: id.did(),
			nb: {
				link: parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'),
				size: 0,
			},
		});

		await store.putMany([delegation]);

		const query: DelegationsStorageQuery = { audience: id.did() };
		const results = await store.find(query);
		const del = results.ok[0];

		expect(del?.capabilities?.[0]?.with).toEqual(id.did());
	});
});
