import { describe, it, expect } from 'vitest';

import * as Client from './client';
import { alice, bob } from '../common/personas';

describe('Merkle clocks', () => {
	describe('Offline', () => {
		it('can be created offline', async () => {
			const { signer } = await Client.createClock({ audience: alice });

			expect(signer.did().startsWith('did:key:')).toBe(true);
		});

		it('can be shared offline, with an email address (which might, or might not, be server user)', async () => {
			const genesis = await Client.createClock({ audience: alice });
			const share = await Client.shareClock({ audience: bob, clock: genesis.did(), genesisClockDelegation: genesis.delegation });

			expect(share.delegation.proofs[0].link().toString()).toEqual(genesis.delegation.link().toString());
		});

		it('can be shared offline, having proof of email addresses using logged in agents', async () => {
			const genesis = await Client.createClock({ audience: alice });
			const share = await Client.shareClock({ audience: bob, clock: genesis.did(), genesisClockDelegation: genesis.delegation });

			// TODO
		});
	});
});
