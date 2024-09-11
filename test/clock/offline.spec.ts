import { describe, it, expect } from 'vitest';

import * as Client from '../common/client';
import { alice, bob, server } from '../common/personas';

describe('Merkle clocks', () => {
	describe('Offline', () => {
		it('can be created offline', async () => {
			const { signer } = await Client.createClock({ audience: alice });

			expect(signer.did().startsWith('did:key:')).toBe(true);
		});

		it('can be shared offline, with an email address (which might, or might not, be server user)', async () => {
			const genesis = await Client.createClock({ audience: alice });
			const share = await Client.shareClock({
				audience: bob,
				clock: genesis.did(),
				genesisClockDelegation: genesis.delegation,
				issuer: alice,
			});

			expect(share.delegation.proofs[0].link().toString()).toEqual(genesis.delegation.link().toString());
		});

		it('can be shared offline, having proof of email addresses using logged in agents', async () => {
			const genesis = await Client.createClock({ audience: alice });
			const share = await Client.shareClock({
				audience: bob,
				clock: genesis.did(),
				genesisClockDelegation: genesis.delegation,
				issuer: alice,
			});

			const agentAlice = await Client.authenticatedAgent({ account: alice, server });
			const agentBob = await Client.authenticatedAgent({ account: bob, server });

			// Bob can verify the share was actually made by Alice if both have an authenticated agent.
			// 1st, verify if Bob and Alice are using the same source of truth.
			expect(agentAlice.attestation.issuer.did() === agentBob.attestation.issuer.did()).toBe(true);

			// 2nd, verify Alice's attestion is valid by checking the signature.
			// NOTE: I think ucanto does this by default, but doesn't hurt to mention it.

			// 3rd, verify the proof in Alice's attestation and their agent delegation are a match
			// @ts-ignore
			const proof = agentAlice.attestation.capabilities[0].nb?.proof;
			expect(agentAlice.delegation.link().toString()).toBe(proof.toString());

			// 4th, verify Alice's delegation and the share DIDs match.
			expect(share.delegation.issuer.did() === agentAlice.delegation.issuer.did()).toBe(true);

			// At this point we know the server has validated Alice's email existence,
			// so we're pretty sure we are talking to the real Alice.
		});
	});
});
