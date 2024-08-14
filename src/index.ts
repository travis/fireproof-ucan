import type { Env } from '../worker-configuration';

import fromAsync from 'array-from-async';
import * as Server from '@ucanto/server';
import * as Signer from '@ucanto/principal/ed25519';
import { CAR } from '@ucanto/transport';
import * as Store from '@web3-storage/capabilities/store';
import { AccessServiceContext, ProvisionsStorage, DelegationsStorageQuery } from '@web3-storage/upload-api';
import { createService as createAccessService } from '@web3-storage/upload-api/access';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { base64pad } from 'multiformats/bases/base64';
import { createInMemoryAgentStore } from './agent-store';

////////////////////////////////////////
// TYPES
////////////////////////////////////////

interface StoreAddContext {
	accessKeyId: string;
	secretAccessKey: string;
	accountId: string;
	bucketName: string;
}

type FireproofServiceContext = AccessServiceContext & StoreAddContext;

////////////////////////////////////////
// SERVICE
////////////////////////////////////////

const createService = (context: FireproofServiceContext) => ({
	access: createAccessService(context),
	store: {
		add: Server.provide(Store.add, async ({ capability }) => {
			const S3 = new S3Client({
				region: 'auto',
				endpoint: `https://${context.accountId}.r2.cloudflarestorage.com`,
				credentials: {
					accessKeyId: context.accessKeyId,
					secretAccessKey: context.secretAccessKey,
				},
			});
			const { link, size } = capability.nb;

			const checksum = base64pad.baseEncode(link.multihash.digest);
			const cmd = new PutObjectCommand({
				Key: `${link}/${link}.car`,
				Bucket: context.bucketName,
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
});

////////////////////////////////////////
// SERVER
////////////////////////////////////////

const createServer = async (context: FireproofServiceContext) => {
	return Server.create({
		id: context.signer,
		codec: CAR.inbound,
		service: createService(context),
		validateAuthorization: async () => ({ ok: {} }),
	});
};

////////////////////////////////////////
// DELEGATION STORAGE
////////////////////////////////////////

const storedDelegations: Server.API.Delegation[] = [];

const delegationsStorage = {
	putMany: async (delegations: Server.API.Delegation[]) => {
		storedDelegations.push(...delegations);
		return { ok: {} };
	},
	count: async () => BigInt(storedDelegations.length),
	find: async (query: DelegationsStorageQuery) => {
		return { ok: storedDelegations.filter((delegation) => delegation.audience.did() === query.audience) };
	},
};

////////////////////////////////////////
// HANDLER
////////////////////////////////////////

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (!env.ACCESS_KEY_ID) throw new Error('please set ACCESS_KEY_ID');
		if (!env.ACCOUNT_ID) throw new Error('please set ACCOUNT_ID');
		if (!env.BUCKET_NAME) throw new Error('please set BUCKET_NAME');
		if (!env.FIREPROOF_SERVICE_PRIVATE_KEY) throw new Error('please set FIREPROOF_SERVICE_PRIVATE_KEY');
		if (!env.POSTMARK_TOKEN) throw new Error('please set POSTMARK_TOKEN');
		if (!env.SECRET_ACCESS_KEY) throw new Error('please set SECRET_ACCESS_KEY');
		if (!env.SERVICE_ID) throw new Error('please set SERVICE_ID');

		// @ts-expect-error I think this is unused by the access service
		const provisionsStorage: ProvisionsStorage = null;
		const context: FireproofServiceContext = {
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
				add: async () => ({ error: new Error('rate limits not supported') }),
				list: async () => ({ ok: [] }),
				remove: async () => ({ error: new Error('rate limits not supported') }),
			},
			delegationsStorage,
			agentStore: createInMemoryAgentStore(),
			accountId: env.ACCOUNT_ID,
			bucketName: env.BUCKET_NAME,
			accessKeyId: env.ACCESS_KEY_ID,
			secretAccessKey: env.SECRET_ACCESS_KEY,
		};

		const server = await createServer(context);

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
			throw new Error(`accept failed! ${result.error}`);
		}
		const { encoder, decoder } = result.ok;
		const incoming = await decoder.decode(payload);
		// @ts-ignore not totally sure how to fix the "unknown" casting here or check if it's needed
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
