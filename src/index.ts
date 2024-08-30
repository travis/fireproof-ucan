import * as API from '@web3-storage/upload-api/types';
import * as Json from '@ipld/dag-json';
import * as Server from '@ucanto/server';
import * as Signer from '@ucanto/principal/ed25519';
import * as Store from '@web3-storage/capabilities/store';

import fromAsync from 'array-from-async';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CAR } from '@ucanto/transport';
import { AccessServiceContext, ProvisionsStorage } from '@web3-storage/upload-api';
import { createService as createAccessService } from '@web3-storage/upload-api/access';
import { base64pad } from 'multiformats/bases/base64';
import all from 'it-all';

import type { Env } from '../worker-configuration';
import * as Clock from './capabilities/clock';

import { create as createAgentStore } from './stores/agents/persistent';
import { create as createDelegationStore } from './stores/delegations/persistent';

////////////////////////////////////////
// TYPES
////////////////////////////////////////

interface Context {
	accessKeyId: string;
	accountId: string;
	bucket: R2Bucket;
	bucketName: string;
	kvStore: KVNamespace;
	secretAccessKey: string;
}

type FireproofServiceContext = AccessServiceContext & Context;

////////////////////////////////////////
// SERVICE
////////////////////////////////////////

export type Service = ReturnType<typeof createService>;

const createService = (ctx: FireproofServiceContext) => {
	const S3 = new S3Client({
		region: 'auto',
		endpoint: `https://${ctx.accountId}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: ctx.accessKeyId,
			secretAccessKey: ctx.secretAccessKey,
		},
	});

	return {
		access: createAccessService(ctx),
		clock: {
			advance: Server.provide(Clock.advance, async ({ capability, invocation, context }) => {
				// Retrieve event and decode it
				const carBytes = await ctx.bucket.get(capability.nb.event.toString());
				if (!carBytes) return { error: new Server.Failure('Unable to locate event bytes in store. Was the event stored?') };

				const car = Server.CAR.decode(new Uint8Array(await carBytes.arrayBuffer()));
				const blockCid = all(car.blocks.keys())[0];
				const block = car.blocks.get(blockCid);
				if (block === undefined) return { error: new Server.Failure('Unable to locate block in CAR file.') };

				const event = Json.decode(block.bytes);

				// Validate event
				if (event === null || typeof event !== 'object') return { error: new Server.Failure('Associated clock event is not an object.') };
				if ('data' in event === false) return { error: new Server.Failure('Associated clock event does not have the `data` property.') };
				if ('parents' in event === false)
					return { error: new Server.Failure('Associated clock event does not have the `parents` property.') };
				if (Array.isArray(event.parents) === false) {
					error: new Server.Failure('Associated clock event does not have a valid `parents` property, expected an array.');
				}

				// Possible TODO: Check if previous head is in event chain?

				// Update head
				await ctx.kvStore.put(`clock/${capability.with}`, capability.nb.event.toString());

				// Fin
				return {
					ok: {
						head: capability.nb.event.toString(),
					},
				};
			}),
		},
		store: {
			// The client must utilise the presigned url to upload the CAR bytes.
			// For more info, see the `store/add` capability:
			// https://github.com/storacha-network/w3up/blob/e53aa87/packages/capabilities/src/store.js#L41
			add: Server.provide(Store.add, async ({ capability }) => {
				const { link, size } = capability.nb;

				const checksum = base64pad.baseEncode(link.multihash.digest);
				const cmd = new PutObjectCommand({
					Key: link.toString(),
					Bucket: ctx.bucketName,
					ChecksumSHA256: checksum,
					ContentLength: size,
				});

				const expiresIn = 60 * 60 * 24; // 1 day
				const url = new URL(
					await getSignedUrl(S3, cmd, {
						expiresIn,
						unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
					}),
				);

				return {
					ok: {
						status: 'upload',
						allocated: size,
						link,
						url,
					},
				};
			}),
		},
	};
};

////////////////////////////////////////
// SERVER
////////////////////////////////////////

const createServer = async (ctx: FireproofServiceContext) => {
	return Server.create({
		id: ctx.signer,
		codec: CAR.inbound,
		service: createService(ctx),

		// Authorization
		validateAuthorization: async () => ({ ok: {} }),

		// Who can issue capabilities?
		canIssue: (capability, issuer) => {
			// if (capability.uri.protocol === "file:") {
			//   const [did] = capability.uri.pathname.split("/")
			//   return did === issuer
			// }
			return capability.with === issuer;
		},
	});
};

////////////////////////////////////////
// HANDLER
////////////////////////////////////////

export default {
	async fetch(request, env, executionContext): Promise<Response> {
		if (!env.ACCESS_KEY_ID) throw new Error('please set ACCESS_KEY_ID');
		if (!env.ACCOUNT_ID) throw new Error('please set ACCOUNT_ID');
		if (!env.BUCKET_NAME) throw new Error('please set BUCKET_NAME');
		if (!env.FIREPROOF_SERVICE_PRIVATE_KEY) throw new Error('please set FIREPROOF_SERVICE_PRIVATE_KEY');
		if (!env.POSTMARK_TOKEN) throw new Error('please set POSTMARK_TOKEN');
		if (!env.SECRET_ACCESS_KEY) throw new Error('please set SECRET_ACCESS_KEY');
		if (!env.SERVICE_ID) throw new Error('please set SERVICE_ID');

		// @ts-expect-error I think this is unused by the access service
		const provisionsStorage: ProvisionsStorage = null;

		// Context
		const ctx: FireproofServiceContext = {
			// AccessServiceContext
			signer: Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY),
			url: new URL(request.url),
			email: {
				sendValidation: async ({ to, url }) => {
					if (!env.POSTMARK_TOKEN) throw new Error("POSTMARK_TOKEN is not defined, can't send email");

					const rsp = await fetch('https://api.postmarkapp.com/email/withTemplate', {
						method: 'POST',
						headers: {
							Accept: 'text/json',
							'Content-Type': 'text/json',
							'X-Postmark-Server-Token': env.POSTMARK_TOKEN,
						},
						body: JSON.stringify({
							From: 'fireproof <noreply@fireproof.storage>',
							To: to,
							TemplateAlias: 'welcome',
							TemplateModel: {
								product_url: 'https://fireproof.storage',
								product_name: 'Fireproof Storage',
								email: to,
								action_url: url,
							},
						}),
					});

					if (!rsp.ok) {
						throw new Error(`Send email failed with status: ${rsp.status}, body: ${await rsp.text()}`);
					}
				},
			},
			provisionsStorage,
			rateLimitsStorage: {
				add: async () => ({ error: new Server.Failure('Rate limits not supported') }),
				list: async () => ({ ok: [] }),
				remove: async () => ({ error: new Server.Failure('Rate limits not supported') }),
			},
			delegationsStorage: createDelegationStore(env.bucket, env.kv_store),
			agentStore: createAgentStore(env.bucket, env.kv_store),

			// Context
			accessKeyId: env.ACCESS_KEY_ID,
			accountId: env.ACCOUNT_ID,
			bucket: env.bucket,
			bucketName: env.BUCKET_NAME,
			kvStore: env.kv_store,
			secretAccessKey: env.SECRET_ACCESS_KEY,
		};

		// Create server
		const server = await createServer(ctx);

		// Manage request
		if (request.method !== 'POST' || !request.body) {
			throw new Error('Server only accepts POST requests');
		}

		const pieces = await fromAsync(request.body);
		const payload = {
			body: mergeUint8Arrays(...pieces),
			headers: Object.fromEntries(request.headers),
		};

		const result = server.codec.accept(payload);
		if (result.error) {
			throw new Error(`Accept-call failed! ${result.error}`);
		}

		// Response
		const { encoder, decoder } = result.ok;
		const incoming = await decoder.decode<
			Server.AgentMessage<{
				Out: API.InferReceipts<API.Tuple<API.ServiceInvocation<API.Capability, Record<string, any>>>, Record<string, any>>;
				In: never; // API.Tuple<API.Invocation>;
			}>
		>(payload);

		const outgoing = await Server.execute(incoming, server);
		const response = await encoder.encode(outgoing);

		return new Response(response.body, { headers: response.headers });
	},
} satisfies ExportedHandler<Env>;

// 🛠️

function mergeUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
	const totalSize = arrays.reduce((acc, e) => acc + e.length, 0);
	const merged = new Uint8Array(totalSize);

	arrays.forEach((array, i, arrays) => {
		const offset = arrays.slice(0, i).reduce((acc, e) => acc + e.length, 0);
		merged.set(array, offset);
	});

	return merged;
}
