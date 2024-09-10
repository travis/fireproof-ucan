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

		it('can be advanced on the server', async () => {
			const clock = await Client.createClock({ audience: alice });
			await Client.registerClock({ clock });

			const agent = await Client.authenticatedAgent({ account: alice });
			const event = await Client.createClockEvent({
				messageCid: parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'),
			});

			await Client.storeOnServer(event.cid, event.bytes);
			const res = await Client.advanceClock({ agent, clock, event });

			if (res.out.error) console.error(res.out.error);
			expect(res.out.ok?.head).toBe(event.cid.toString());
		});
		it('can fetch the head state from the server', async () => {
			const clock = await Client.createClock({ audience: alice });
			await Client.registerClock({ clock });

			const agent = await Client.authenticatedAgent({ account: alice });
			const resBefore = await Client.getClockHead({ agent, clock });

			// Clock hasn't been advanced yet
			expect(resBefore.out.ok?.head).toBe(undefined);

			// Advance clock and check again
			const event = await Client.createClockEvent({
				messageCid: parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'),
			});

			await Client.storeOnServer(event.cid, event.bytes);
			const advancement = await Client.advanceClock({ agent, clock, event });
			const resAfter = await Client.getClockHead({ agent, clock });

			if (advancement.out.error) console.error(advancement.out.error.message);
			if (resAfter.out.error) console.error(resAfter.out.error.message);

			expect(advancement.out.ok?.head).toBe(event.cid.toString());
			expect(resAfter.out.ok?.head).toBe(advancement.out.ok?.head);
		});
		it.todo('can use the clock on a second device authenticating with email');
	});
});
