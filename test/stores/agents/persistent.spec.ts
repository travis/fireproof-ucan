import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import * as CAR from '@ucanto/transport/car';

import { Message, Receipt } from '@ucanto/core';
import { Signer } from '@ucanto/principal/ed25519';
import { Store } from '@web3-storage/capabilities';
import { AgentMessage } from '@web3-storage/upload-api';
import { parseLink } from '@ucanto/core';

import { create as createStore } from '../../../src/stores/agents/persistent.js';

describe('Stores / Agents / Persistent', () => {
	it('should store an invocation and a receipt', async () => {
		const store = createStore(env.bucket, env.kv_store);
		const id = await Signer.generate();

		const invocation = await Store.add
			.invoke({
				audience: id,
				issuer: id,
				with: id.did(),
				nb: {
					link: parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'),
					size: 0,
				},
			})
			.delegate();

		const receipt = await Receipt.issue({
			issuer: id,
			ran: invocation,
			result: { ok: {} },
		});

		const message = await Message.build({
			invocations: [invocation],
			receipts: [receipt],
		});

		await store.write({
			data: message,
			source: CAR.request.encode(message),
			index: AgentMessage.index(message),
		});

		const inv = await store.invocations.get(invocation.link());
		const rec = await store.receipts.get(receipt.ran.link());

		expect(inv.ok?.root?.cid?.toString()).toEqual(invocation.cid.toString());
		expect(rec.ok?.ran?.link()?.toString()).toEqual(receipt.ran.link().toString());
	});
});
