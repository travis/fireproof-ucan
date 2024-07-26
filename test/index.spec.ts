// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { connection } from '@web3-storage/access/agent';
import { Store } from '@web3-storage/capabilities';
import { Signer } from '@ucanto/principal/ed25519';
import { delegate, parseLink } from '@ucanto/core'

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

/** did:key:z6Mkqa4oY9Z5Pf5tUcjLHLUsDjKwMC95HGXdE1j22jkbhz6r */
export const alice = Signer.parse(
	'MgCZT5vOnYZoVAeyjnzuJIVY9J4LNtJ+f8Js0cTPuKUpFne0BVEDJjEu6quFIU8yp91/TY/+MYK8GvlKoTDnqOCovCVM='
)
const carLink = parseLink(
	'bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'
)

describe('the fireproof UCAN service', () => {
	it('', async () => {
		const ctx = createExecutionContext();
		const conn = connection({
			// @ts-ignore this error is coming from a possible mismatch between the node fetch response type and the cloudflare 
			fetch: (url, options) => {
				// @ts-ignore I think this is just an articact of the funky typing we're doing here
				return SELF.fetch(new IncomingRequest(url, options))
			}
		})
		// @ts-ignore TODO figure out how to give env the right type - currently ProvidedEnv when it should be Env
		const serverId = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY)
		const invocation = Store.add.invoke({
			audience: serverId,
			issuer: serverId,
			with: serverId.did(),
			nb: {
				link: carLink,
				size: 0
			}
		})

		// @ts-ignore this is happening because we're using the access client's connection function - TODO get the types right above to fix
		const response = await invocation.execute(conn)
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		if (response.out.error) {
			throw response.out.error
		}

		expect(response.out.ok).toBeTruthy()
		expect(response.out.ok.link.toString()).toEqual(carLink.toString())

		// the URL should use https
		expect(response.out.ok.url).match(/^https:\/\/.*$/)

		// the URL should contain the CID
		expect(response.out.ok.url).match(new RegExp(carLink.toString()))
	});
});
