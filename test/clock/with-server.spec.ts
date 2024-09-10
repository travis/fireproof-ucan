import { describe, it, expect } from 'vitest';

import * as Client from './client';
import * as Clock from '../../src/capabilities/clock';
import { parseLink } from '@ucanto/core';

import { alice, server } from '../common/personas';
import { conn } from '../common/connection';

describe('Merkle clocks', () => {
	describe('With server', () => {
		it('can be registered on the server', async () => {
			const clock = await Client.createClock({ audience: alice });
			const res = await Client.registerClock({ clock });

			if (res.out.error) console.error(res.out.error.message);
			expect(res.out.ok).not.toBeUndefined();
		});

		it('can be appended on the server', async () => {
			const clock = await Client.createClock({ audience: alice });
			await Client.registerClock({ clock });

			const agent = await Client.authenticatedAgent({ account: alice });
			const event = await Client.createClockEvent({
				messageCid: parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'),
			});

			await Client.storeOnServer(event.cid, event.bytes);

			const invocation = Clock.advance.invoke({
				issuer: agent.signer,
				audience: server,
				with: clock.did(),
				nb: { event: event.cid },
				proofs: [agent.delegation, agent.attestation],
			});

			const res = await invocation.execute(conn);
			if (res.out.error) console.error(res.out.error);
			expect(res.out.ok?.head).toBe(event.cid.toString());
		});
		it.todo('can fetch the head state from the server');
		it.todo('can use the clock on a second device authenticating with email');
	});
});
