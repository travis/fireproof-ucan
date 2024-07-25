import fromAsync from 'array-from-async';
import * as Server from "@ucanto/server";
import * as Signer from "@ucanto/principal/ed25519";
import { CAR } from "@ucanto/transport";
import * as Store from '@web3-storage/capabilities/store'

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const idPromise = Signer.generate()

const createService = (context: any) => ({
	store: () => {
		return Server.provide(Store.add, async ({ capability, invocation }) => {
			return { error: new Server.Failure("unimplemented") }
		})
	}
})

const createServer = async () => {
	const storedDelegations: Server.API.Delegation[] = []
	return Server.create({
		id: await idPromise,
		codec: CAR.inbound,
		service: createService({
			url: new URL('https://example.com'),
			signer: await idPromise,
		}),
		// validate all for now
		validateAuthorization: async () => ({ ok: {} })
	})
}

const serverPromise = createServer()

export default {
	async fetch (request, env, ctx): Promise<Response> {
		const server = await serverPromise
		if (request.body) {
			const payload = {
				body: await fromAsync(request.body),
				headers: Object.fromEntries(request.headers)
			}
			const result = server.codec.accept(payload)
			if (result.error) {
				throw new Error(`accept failed! ${result.error}`)
			}
			const { encoder, decoder } = result.ok
			const incoming = await decoder.decode(payload)
			// @ts-ignore not totally sure how to fix the "unknown" casting here or check if it's needed
			const outgoing = await Server.execute(incoming, server)
			const response = await encoder.encode(outgoing)
			return new Response(response.body, { headers: response.headers })
		} else {
			throw new Error('no body!')
		}
	},
} satisfies ExportedHandler<Env>;
