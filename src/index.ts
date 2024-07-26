import fromAsync from 'array-from-async';
import * as Server from "@ucanto/server";
import * as Signer from "@ucanto/principal/ed25519";
import { CAR } from "@ucanto/transport";
import * as Store from '@web3-storage/capabilities/store'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
	S3Client,
	PutObjectCommand
} from "@aws-sdk/client-s3";
import { base64pad } from 'multiformats/bases/base64'

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

const createService = (env: Env) => ({
	store: {
		add: Server.provide(Store.add, async ({ capability }) => {
			const { ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET_NAME } = env // TODO should this be bindings?
			if (!(ACCESS_KEY_ID)) {
				throw new Error('please set ACCESS_KEY_ID')
			}
			if (!(SECRET_ACCESS_KEY)) {
				throw new Error('please set SECRET_ACCESS_KEY')
			}
			if (!(ACCOUNT_ID)) {
				throw new Error('please set ACCOUNT_ID')
			}
			if (!(BUCKET_NAME)) {
				throw new Error('please set BUCKET_NAME')
			}
			const S3 = new S3Client({
				region: "auto",
				endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
				credentials: {
					accessKeyId: ACCESS_KEY_ID,
					secretAccessKey: SECRET_ACCESS_KEY,
				},
			})
			const { link, size } = capability.nb

			const checksum = base64pad.baseEncode(link.multihash.digest)
			const cmd = new PutObjectCommand({
				Key: `${link}/${link}.car`,
				Bucket: BUCKET_NAME,
				ChecksumSHA256: checksum,
				ContentLength: size,
			})
			const expiresIn = 60 * 60 * 24 // 1 day
			const url = new URL(
				await getSignedUrl(S3, cmd, {
					expiresIn,
					unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
				})
			)
			return {
				ok: {
					status: 'upload',
					allocated: size,
					link,
					url,
				},
			}
		})

	}
})

// TODO introduce server context object
const createServer = async (context: any, env: Env) => {
	const storedDelegations: Server.API.Delegation[] = []
	return Server.create({
		id: context.signer,
		codec: CAR.inbound,
		service: createService(env),
		// validate all for now
		validateAuthorization: async () => ({ ok: {} })
	})
}

function mergeUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalSize = arrays.reduce((acc, e) => acc + e.length, 0);
  const merged = new Uint8Array(totalSize);

  arrays.forEach((array, i, arrays) => {
    const offset = arrays.slice(0, i).reduce((acc, e) => acc + e.length, 0);
    merged.set(array, offset);
  });

  return merged;
}

export default {
	async fetch (request, env, ctx): Promise<Response> {
		const server = await createServer({
			signer: Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY),
		}, env)

		if (request.method === 'POST' && request.body) {
			const pieces = await fromAsync(request.body)
			const payload = {
				body: mergeUint8Arrays(...pieces),
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
			throw new Error('must post body!')
		}
	},
} satisfies ExportedHandler<Env>;
