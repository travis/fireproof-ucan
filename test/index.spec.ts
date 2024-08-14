import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Agent, connection } from '@web3-storage/access/agent';
import { Store } from '@web3-storage/capabilities';
import { Signer } from '@ucanto/principal/ed25519';
import { parseLink } from '@ucanto/core';
import { Link, DIDKey } from '@ucanto/interface';

import { IncomingRequest } from './request';

////////////////////////////////////////
// SETUP
////////////////////////////////////////

/** did:key:z6Mkqa4oY9Z5Pf5tUcjLHLUsDjKwMC95HGXdE1j22jkbhz6r */
export const alice = Signer.parse('MgCZT5vOnYZoVAeyjnzuJIVY9J4LNtJ+f8Js0cTPuKUpFne0BVEDJjEu6quFIU8yp91/TY/+MYK8GvlKoTDnqOCovCVM=');
const carLink = parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa');

/**
 * Create a W3S access connection.
 */
export const createConnection = () =>
	connection({
		principal: Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY),
		// @ts-ignore this error is coming from a possible mismatch between the node fetch response type and the cloudflare
		fetch: (url, options) => {
			// @ts-ignore I think this is just an articact of the funky typing we're doing here
			return SELF.fetch(new IncomingRequest(url, options));
		},
	});

/**
 * Invoke & execute a `Store.Add` capability.
 */
async function addToStore(params: {
	issuer: Signer.Signer;
	audience: Signer.Signer;
	with: DIDKey;
	nb: {
		link: Link<unknown, 514>;
		size: number;
	};
}) {
	const { issuer, audience, nb } = params;
	const conn = createConnection();
	const invocation = Store.add.invoke({
		issuer,
		audience,
		with: params.with,
		nb,
	});

	// @ts-ignore this is happening because we're using the access client's connection function - TODO get the types right above to fix
	return await invocation.execute(conn);
}

////////////////////////////////////////
// TESTS
////////////////////////////////////////

describe('the fireproof UCAN service', () => {
	it('should be able to store/add and get back a signed upload URL', async () => {
		const serverId = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);

		const response = await addToStore({
			issuer: serverId,
			audience: serverId,
			with: serverId.did(),
			nb: {
				link: carLink,
				size: 0,
			},
		});

		if (response.out.error) {
			throw response.out.error;
		}

		expect(response.out.ok).toBeTruthy();
		expect(response.out.ok.link.toString()).toEqual(carLink.toString());

		// the URL should use https
		expect(response.out.ok.url).match(/^https:\/\/.*$/);

		// the URL should contain the CID
		expect(response.out.ok.url).match(new RegExp(carLink.toString()));
	});

	/**
	 * An invocation issuer doesn't necessarily have to be the server itself.
	 * It just means that the server is the only one allow to invoke a
	 * capability on its own (ie. without any proof)
	 */
	it('cannot invoke a capability without a proof unless invoked by the server itself', async () => {
		const serverId = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);
		const issuerId = await Signer.generate();

		const response = await addToStore({
			issuer: issuerId,
			audience: serverId,
			with: serverId.did(),
			nb: {
				link: carLink,
				size: 0,
			},
		});

		expect(response.out.error).toBeTruthy();
	});

	it('should succeed when using an authorized agent', async () => {
		const serverSigner = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);
		const connection = createConnection();
		const serverAgent = await Agent.create({ principal: serverSigner }, { connection, servicePrincipal: serverSigner });
		const clientAgent = await Agent.create({}, { connection, servicePrincipal: serverSigner });

		const space = await serverAgent.createSpace('test space');
		const authorization = await space.createAuthorization(clientAgent, {
			access: {
				'store/add': {},
			},
		});

		await clientAgent.importSpaceFromDelegation(authorization);

		const result = await clientAgent.invokeAndExecute(Store.add, {
			nb: {
				link: carLink,
				size: 0,
			},
		});

		if (result.out.error) throw result.out.error;
		expect(result.out.ok).toBeTruthy();
	});
});
