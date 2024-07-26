// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
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

describe('Hello World worker', () => {
	it('responds with Hello World! (unit style)', async () => {
		const ctx = createExecutionContext();
		const conn = connection({
			// @ts-ignore this error is coming from a possible mismatch between the node fetch response type and the cloudflare 
			fetch: (url, options) => {
				// @ts-ignore I think this is just an articact of the funky typing we're doing here
				const request = new IncomingRequest(url, options);
				// Create an empty context to pass to `worker.fetch()`.
				return worker.fetch(
					request,
					env,
					ctx)
			}
		})
		// @ts-ignore TODO figure out how to give env the right type
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
		if (response.out.error){
			throw response.out.error
		}
		expect(response.out.ok).toBeTruthy()
		console.log(response.out.ok)
	});

	/**
	it('responds with Hello World! (integration style)', async () => {
		const response = await SELF.fetch('https://example.com');
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});
	**/
});
