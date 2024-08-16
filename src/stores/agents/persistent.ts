import * as API from '@web3-storage/upload-api/types';
import { CAR, Invocation, Receipt } from '@ucanto/core';
import { CID } from 'multiformats/cid';
import { RecordNotFound } from '@web3-storage/upload-api/errors';
import { KVNamespace, R2Bucket } from '@cloudflare/workers-types';

// 🚀

export const create = (bucket: R2Bucket, kv: KVNamespace) => new AgentStore(bucket, kv);

// TYPES

interface Model {
	store: Record<string, CAR.Model>;
	index: Record<string, { root: API.Link; at: string }[]>;
}

// IMPLEMENTATION

class AgentStore implements API.AgentStore {
	bucket: R2Bucket;
	kv: KVNamespace;

	invocations: InvocationLookup;
	receipts: ReceiptLookup;

	constructor(bucket: R2Bucket, kv: KVNamespace) {
		this.bucket = bucket;
		this.kv = kv;

		this.invocations = new InvocationLookup(bucket, kv);
		this.receipts = new ReceiptLookup(bucket, kv);
	}

	get messages() {
		return this;
	}

	/**
	 */
	async write(message: API.ParsedAgentMessage): Promise<API.Result<API.Unit, API.WriteError<API.ParsedAgentMessage>>> {
		const dataCid = message.data.root.cid.toString();

		await this.bucket.put(dataCid, message.source.body.subarray());

		for (const { invocation, receipt } of message.index) {
			if (invocation) {
				const taskCid = invocation.task.toString();
				await this.kv.put(`invocation/${taskCid}`, JSON.stringify({ root: invocation.invocation.link().toString(), data: dataCid }));
			}

			if (receipt) {
				const taskCid = receipt.task.toString();
				await this.kv.put(`invocation/${taskCid}`, JSON.stringify({ root: receipt.receipt.link().toString(), data: dataCid }));
			}
		}

		return { ok: {} };
	}
}

class InvocationLookup {
	bucket: R2Bucket;
	kv: KVNamespace;

	constructor(bucket: R2Bucket, kv: KVNamespace) {
		this.bucket = bucket;
		this.kv = kv;
	}

	async get(key: API.UnknownLink): Promise<API.Result<API.Invocation, API.RecordNotFound>> {
		return get('invocation', {
			bucket: this.bucket,
			key,
			kv: this.kv,
		});
	}
}

class ReceiptLookup {
	bucket: R2Bucket;
	kv: KVNamespace;

	constructor(bucket: R2Bucket, kv: KVNamespace) {
		this.bucket = bucket;
		this.kv = kv;
	}

	async get(key: API.UnknownLink): Promise<API.Result<API.Receipt, API.RecordNotFound>> {
		return get('receipt', {
			bucket: this.bucket,
			key,
			kv: this.kv,
		});
	}
}

type GetProps = {
	bucket: R2Bucket;
	key: API.UnknownLink;
	kv: KVNamespace;
};

async function get(kind: 'invocation', props: GetProps): Promise<API.Result<API.Invocation, API.RecordNotFound>>;
async function get(kind: 'receipt', props: GetProps): Promise<API.Result<API.Receipt, API.RecordNotFound>>;
async function get(kind: string, props: GetProps): Promise<API.Result<API.Invocation | API.Receipt, API.RecordNotFound>> {
	const { bucket, key, kv } = props;
	const json = await kv.get(`${kind}/${key.toString()}`);
	if (!json) return { error: new RecordNotFound() };

	const record: unknown = JSON.parse(json);

	if (
		!record ||
		!(typeof record === 'object') ||
		!('root' in record) ||
		!(typeof record.root === 'string') ||
		!('data' in record) ||
		!(typeof record.data === 'string')
	) {
		return { error: new RecordNotFound() };
	}

	const root = CID.parse(record.root).toV1();
	const data = await bucket.get(record.data);
	if (!data) return { error: new RecordNotFound() };

	const car = CAR.decode(new Uint8Array(await data.arrayBuffer()));
	let view;

	switch (kind) {
		case 'invocation':
			view = Invocation.view({ root, blocks: car.blocks }, null);
			break;
		case 'receipt':
			view = Receipt.view({ root, blocks: car.blocks }, null);
			break;
	}

	return view ? { ok: view } : { error: new RecordNotFound() };
}
