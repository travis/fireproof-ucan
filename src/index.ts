import * as API from '@web3-storage/upload-api/types';
import * as DidMailto from '@web3-storage/did-mailto';
import * as Json from 'multiformats/codecs/json';
import * as Server from '@ucanto/server';
import * as Signer from '@ucanto/principal/ed25519';
import * as Store from '@web3-storage/capabilities/store';
import * as UCAN from '@web3-storage/capabilities/ucan';

import fromAsync from 'array-from-async';

import { Message } from '@ucanto/core';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CAR } from '@ucanto/transport';
import { AgentMessage } from '@web3-storage/upload-api';
import { AccessServiceContext, AccessConfirm, ProvisionsStorage } from '@web3-storage/upload-api';
import { createService as createAccessService } from '@web3-storage/upload-api/access';
import { base64pad } from 'multiformats/bases/base64';
import { UnavailableProof } from '@ucanto/validator';
import { extract } from '@ucanto/core/delegation';
import { delegationsToBytes, delegationToString, stringToDelegation } from '@web3-storage/access/encoding';
import all from 'it-all';

import type { Env } from '../worker-configuration';
import * as Clock from './capabilities/clock';
import * as Email from './email';

import { create as createAgentStore } from './stores/agents/persistent';
import { create as createDelegationStore } from './stores/delegations/persistent';
import { provideConstructor } from './provide';

////////////////////////////////////////
// TYPES
////////////////////////////////////////

interface Context {
	accessKeyId: string;
	accountId: string;
	bucket: R2Bucket;
	bucketName: string;
	emailAddress?: string;
	kvStore: KVNamespace;
	postmarkToken: string;
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

	const provide = provideConstructor({
		// Provide additional delegations from store
		fromStore: async (audience: `did:key:${string}` | `did:mailto:${string}`) => {
			const result = await ctx.delegationsStorage.find({ audience });
			if (result.ok) return result.ok;
			return [];
		},
	});

	return {
		access: createAccessService(ctx),
		clock: {
			advance: provide(Clock.advance, async ({ capability }) => {
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
			'authorize-share': provide(Clock.authorizeShare, async ({ capability, invocation }) => {
				const accountDID = capability.nb.issuer;
				const email = DidMailto.toEmail(DidMailto.fromString(accountDID));

				if (invocation.proofs[0]?.link().toString() !== capability.nb.proof.toString()) {
					return { error: new Server.Failure('Proof linked in capability does not match proof in invocation') };
				}

				// Store share delegation (account A → account B)
				// This one is useless without an attestation,
				// which we'll acquire through the email flow.
				const delegations = invocation.proofs.filter((proof) => {
					return 'archive' in proof;
				});

				await ctx.delegationsStorage.putMany(delegations, { cause: invocation.link() });

				// Start email flow
				const confirmation = await Clock.confirmShare
					.invoke({
						issuer: ctx.signer,
						audience: ctx.signer,
						with: ctx.signer.did(),
						lifetimeInSeconds: 60 * 60 * 24 * 2, // 2 days
						nb: {
							cause: invocation.cid,
						},
					})
					.delegate();

				const encoded = delegationToString(confirmation);
				const url = `${ctx.url.protocol}//${ctx.url.host}/validate-email?ucan=${encoded}&mode=share`;

				if (ctx.emailAddress)
					await Email.send({
						postmarkToken: ctx.postmarkToken,
						recipient: email,
						sender: ctx.emailAddress,
						template: 'share',
						templateData: {
							product_url: 'https://fireproof.storage',
							product_name: 'Fireproof Storage',
							email: email,
							email_share_recipient: DidMailto.toEmail(DidMailto.fromString(capability.nb.recipient)),
							action_url: url,
						},
					});

				// Store invocation
				const message = await Message.build({
					invocations: [invocation],
				});

				await ctx.agentStore.messages.write({
					data: message,
					source: CAR.request.encode(message),
					index: AgentMessage.index(message),
				});

				return { ok: { url } };
			}),
			'claim-share': provide(Clock.claimShare, async ({ capability }) => {
				const shareLink = capability.nb.proof.toString();

				// Find attestation for the confirmation of the share
				const resA = await ctx.delegationsStorage.find({ audience: capability.nb.recipient });
				if (resA.error) return { error: resA.error };

				const attestation = resA.ok.find((d) => {
					const cap = d.capabilities[0];
					return cap && d.issuer.did() === ctx.signer.did() && cap.can === 'ucan/attest' && (cap.nb as any).proof.toString() === shareLink;
				});

				if (!attestation) return { ok: { delegations: {} } };

				// Find share delegation
				const resB = await ctx.delegationsStorage.find({ audience: capability.nb.recipient });
				if (resB.error) return { error: resB.error };

				const delegation = resB.ok.find((d) => {
					return d.cid.toString() === shareLink;
				});

				if (!delegation) return { ok: { delegations: {} } };

				// Fin
				return {
					ok: {
						delegations: {
							[attestation.cid.toString()]: delegationsToBytes([attestation]),
							[delegation.cid.toString()]: delegationsToBytes([delegation]),
						},
					},
				};
			}),
			'claim-shares': provide(Clock.claimShares, async ({ capability }) => {
				// Find share attestations
				const resA = await ctx.delegationsStorage.find({ audience: capability.nb.recipient });
				if (resA.error) return { error: resA.error };

				const attestations = resA.ok.filter((d) => {
					const cap = d.capabilities[0];
					return cap && d.issuer.did() === ctx.signer.did() && cap.can === 'ucan/attest';
				});

				// Recipient delegations
				const resB = await ctx.delegationsStorage.find({ audience: capability.nb.recipient });
				if (resB.error) return { error: resB.error };

				type DelegationType = (typeof resB.ok)[number];

				const delegations = resB.ok.reduce((acc: Record<string, DelegationType>, del: DelegationType) => {
					acc[del.cid.toString()] = del;
					return acc;
				}, {});

				// Find associated share delegations
				const items = (
					await Promise.all(
						attestations.map(async (att) => {
							const cap = att.capabilities[0];
							const delegation = cap && delegations[(cap.nb as any).proof.toString()];
							if (!delegation) return null;

							return {
								attestation: att,
								delegation,
							};
						}),
					)
				).filter((a) => a !== null);

				// Fin
				return {
					ok: {
						delegations: Object.fromEntries(
							items.flatMap((item) => {
								return [
									[item.attestation.cid.toString(), delegationsToBytes([item.attestation])],
									[item.delegation.cid.toString(), delegationsToBytes([item.delegation])],
								];
							}),
						),
					},
				};
			}),
			'confirm-share': provide(Clock.confirmShare, async ({ capability, invocation }) => {
				const causeLink = capability.nb.cause;

				// Extra info from causal invocation
				const causeResult = await ctx.agentStore.invocations.get(causeLink);
				if (causeResult.error) return { error: causeResult.error };

				const cause = causeResult.ok;
				const nb: any = cause.capabilities[0]?.nb;
				if (!nb) return { error: new Error('Unable to retrieve capabilities from cause') };

				const proof = nb.proof;
				const audience = nb.recipient;

				// Create attestation & store it
				const attestation = await UCAN.attest.delegate({
					issuer: ctx.signer,
					audience: Server.DID.parse(audience),
					with: ctx.signer.did(),
					nb: { proof },
					expiration: Infinity,
				});

				await ctx.delegationsStorage.putMany([attestation]);

				// Fin
				return { ok: {} };
			}),
			head: provide(Clock.head, async ({ capability }) => {
				const head = await ctx.kvStore.get(`clock/${capability.with}`);

				return {
					ok: { head: head || undefined },
				};
			}),
			register: provide(Clock.register, async ({ capability, invocation, context }) => {
				// This basically only exists to store the clock's genesis delegation on the server.
				if (invocation.proofs[0]?.link().toString() === capability.nb.proof.toString()) {
					const delegations = invocation.proofs.filter((proof) => {
						return 'archive' in proof;
					});

					await ctx.delegationsStorage.putMany(delegations, { cause: invocation.link() });

					return { ok: {} };
				} else {
					return { error: new Server.Failure('Proof linked in capability does not match proof in invocation') };
				}
			}),
		},
		store: {
			// The client must utilise the presigned url to upload the CAR bytes.
			// For more info, see the `store/add` capability:
			// https://github.com/storacha-network/w3up/blob/e53aa87/packages/capabilities/src/store.js#L41
			add: provide(Store.add, async ({ capability }) => {
				const { link, size } = capability.nb;

				const checksum = base64pad.baseEncode(link.multihash.digest);
				const cmd = new PutObjectCommand({
					Key: link.toString(),
					Bucket: ctx.bucketName,
					// TODO: ChecksumSHA256: checksum,
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

		// Manage revocations
		validateAuthorization: async () => ({ ok: {} }),

		// Resolve proofs referenced by CID
		resolve: async (proof) => {
			const data = await ctx.bucket.get(proof.toString());
			if (!data) return { error: new UnavailableProof(proof) };

			const result = await extract(new Uint8Array(await data.arrayBuffer()));
			if (result.error) return { error: new UnavailableProof(proof, result.error) };

			return { ok: result.ok };
		},

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

		// @ts-expect-error I think this is unused by the access service
		const provisionsStorage: ProvisionsStorage = null;

		// Parse URL
		const url = new URL(request.url);

		// Signer
		const signer = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);

		// Context
		const ctx: FireproofServiceContext = {
			// AccessServiceContext
			signer,
			url,
			email: {
				sendValidation: async ({ to, url }) => {
					if (ctx.emailAddress)
						await Email.send({
							postmarkToken: env.POSTMARK_TOKEN,
							recipient: to,
							sender: ctx.emailAddress,
							template: 'login',
							templateData: {
								product_url: 'https://fireproof.storage',
								product_name: 'Fireproof Storage',
								email: to,
								action_url: url,
							},
						});
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
			emailAddress: env.EMAIL,
			kvStore: env.kv_store,
			postmarkToken: env.POSTMARK_TOKEN,
			secretAccessKey: env.SECRET_ACCESS_KEY,
		};

		// Create server
		const server = await createServer(ctx);

		// Validate email if asked so
		if (request.method === 'GET' && url.pathname === '/validate-email') {
			await validateEmail({ url, request, server });
			return new Response('Email validated successfully.', { headers: { ContentType: 'text/html' } });
		}

		if (request.method === 'GET' && url.pathname === '/did') {
			return new Response(signer.did(), { headers: { ContentType: 'text/html' } });
		}

		// Otherwise manage UCANTO RPC request
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

		// Decode incoming invocations, execute them and render response
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

async function validateEmail({ url, request, server }: { url: URL; request: Request; server: API.ServerView<Service> }) {
	const delegation = stringToDelegation(url.searchParams.get('ucan') ?? '');

	if (delegation.capabilities.length !== 1) {
		throw new Error(`Invalidate delegation in validate-email confirmation url`);
	}

	const can = delegation.capabilities[0].can;
	let invocation;

	switch (can) {
		case 'access/confirm':
			invocation = delegation as API.Invocation<AccessConfirm>;
			break;

		case 'clock/confirm-share':
			invocation = delegation as API.Invocation<Server.InferInvokedCapability<typeof Clock.confirmShare>>;
			break;

		default:
			throw new Error(`Invalidate delegation in validate-email confirmation url`);
	}

	const message = (await Message.build({
		invocations: [invocation],
	})) as Server.AgentMessage<{
		Out: API.InferReceipts<API.Tuple<API.ServiceInvocation<API.Capability, Record<string, any>>>, Record<string, any>>;
		In: never; // API.Tuple<API.Invocation>;
	}>;

	server.codec.accept({
		body: new Uint8Array(),
		headers: Object.fromEntries(request.headers),
	});

	const resp = await Server.execute(message, server);
	const err = Array.from(resp.receipts).find(([_, r]) => !!r.out.error)?.[1]?.out?.error;
	if (err) throw err;
}
