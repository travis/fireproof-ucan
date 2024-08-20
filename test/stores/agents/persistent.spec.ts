import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

import * as CAR from '@ucanto/transport/car';
// import * as Client from '@ucanto/client';
// import * as API from '@web3-storage/upload-api/types';

import { Message, Receipt } from '@ucanto/core';
import { Signer } from '@ucanto/principal/ed25519';
// import { Agent, connection } from '@web3-storage/access/agent';
import { Store } from '@web3-storage/capabilities';
import { AgentMessage } from '@web3-storage/upload-api';
import { parseLink } from '@ucanto/core';

import { create as createStore } from '../../../src/stores/agents/persistent.js';

describe('Stores / Agent / Persistent', () => {
	it('should store an invocation', async () => {
		const store = createStore(env.bucket, env.delegation_store);
		const id = await Signer.generate();

		const invocation = Store.add.invoke({
			audience: id,
			issuer: id,
			with: id.did(),
			nb: {
				link: parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'),
				size: 0,
			},
		});

		const message = await Message.build({
			invocations: [invocation],
		});

		await store.write({
			data: message,
			source: CAR.request.encode(message),
			index: AgentMessage.index(message),
		});

		const delegation = await invocation.delegate();
		const result = await store.invocations.get(delegation.link());

		expect(result?.ok?.root?.cid?.toString()).toEqual(delegation.cid.toString());
	});
});
