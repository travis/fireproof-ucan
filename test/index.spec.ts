// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { connection, Agent, AgentData } from '@web3-storage/access/agent';
import { Store } from '@web3-storage/capabilities';
import { Signer } from '@ucanto/principal/ed25519';
import { parseLink } from '@ucanto/core'
import * as UcantoClient from "@ucanto/client"
import * as CAR from '@ucanto/transport/car'
import * as HTTP from '@ucanto/transport/http'
import { Link, DIDKey } from '@ucanto/interface'
import { MemoryDriver } from '@web3-storage/access/drivers/memory';
import { create } from '@web3-storage/w3up-client'


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

const createConnection = () => connection({
	// @ts-ignore need to figure out how to type env properly
	principal: Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY),
	// @ts-ignore this error is coming from a possible mismatch between the node fetch response type and the cloudflare 
	fetch: (url, options) => {
		// @ts-ignore I think this is just an articact of the funky typing we're doing here
		return SELF.fetch(new IncomingRequest(url, options))
	}
})

interface StoreAddParameters {
	issuer: Signer.Signer
	audience: Signer.Signer
	with: DIDKey
	nb: {
		link: Link<unknown>,
		size: number
	}

}

async function invokeAndExecuteStoreAdd (params: StoreAddParameters) {
	const { issuer, audience, nb } = params
	const conn = createConnection();
	const invocation = Store.add.invoke({
		issuer,
		audience,
		'with': params.with,
		// @ts-ignore annoying Link typing issue
		nb
	});

	// @ts-ignore this is happening because we're using the access client's connection function - TODO get the types right above to fix
	return await invocation.execute(conn)
}

describe('the fireproof UCAN service', () => {
	it('should be able to store/add and get back a signed upload URL', async () => {
		// @ts-ignore TODO figure out how to give env the right type - currently ProvidedEnv when it should be Env
		const serverId = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);

		const response = await invokeAndExecuteStoreAdd({
			issuer: serverId,
			audience: serverId,
			with: serverId.did(),
			nb: {
				link: carLink,
				size: 0
			}
		})

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

	it('should fail for issuers other than the server', async () => {
		// @ts-ignore TODO figure out how to give env the right type - currently ProvidedEnv when it should be Env
		const serverId = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);
		const issuerId = await Signer.generate()

		const response = await invokeAndExecuteStoreAdd({
			issuer: issuerId,
			audience: serverId,
			with: serverId.did(),
			nb: {
				link: carLink,
				size: 0
			}
		})
		expect(response.out.error).toBeTruthy()
	})

	it('should succeed when using an authorized agent', async () => {
		// @ts-ignore TODO figure out how to give env the right type - currently ProvidedEnv when it should be Env
		const serverSigner = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);
		const connection = createConnection()
		const serverAgent = await Agent.create({ principal: serverSigner }, { connection, servicePrincipal: serverSigner })
		const clientAgent = await Agent.create({}, { connection, servicePrincipal: serverSigner })

		const space = await serverAgent.createSpace('test space')
		const authorization = await space.createAuthorization(clientAgent, {
			access: {
				'store/add': {}
			},
		})
		await clientAgent.importSpaceFromDelegation(authorization)

		const result = await clientAgent.invokeAndExecute(Store.add, {
			nb: {
				link: carLink,
				size: 0
			}
		})
		if (result.out.error) {
			throw result.out.error
		}
		expect(result.out.ok).toBeTruthy()
	})

	it('should work when logging in via the auth service', async () => {
		// @ts-ignore TODO figure out how to give env the right type - currently ProvidedEnv when it should be Env
		const serverSigner = Signer.parse(env.FIREPROOF_SERVICE_PRIVATE_KEY);
		const connection = createConnection()
		const serverAgent = await Agent.create({ principal: serverSigner }, { connection, servicePrincipal: serverSigner })

		const clientAgent = await Agent.create({}, { connection, servicePrincipal: serverSigner })

		// @ts-ignore we don't need the other two services TODO: fix types
		//const client = await create({ serviceConf: { access: connection } })
		console.log("DADDAD")
		// const data = await AgentData.create({
		// 	principal: await Signer.generate()
		// }, {
		// 	store: new MemoryDriver()
		// })
		console.log("FAHSDF")
		// const client = new Client(data, {
		// 	// @ts-ignore we don't need the other two services TODO: fix types
		// 	serviceConf: { access: connection }
		// })
		const client = await create({
			principal: await Signer.generate(),
			store: new MemoryDriver()
		})
		console.log("A")
		const account = await client.login('travis@example.com')
		const space = await client.createSpace('test space')
		await space.save()
		console.log("C")
		const recovery = await space.createRecovery(account.did())
		console.log("D")
		await client.capability.access.delegate({
			space: space.did(),
			delegations: [recovery],
		})
		console.log("E")
		// const space = await serverAgent.createSpace('test space')
		// const authorization = await space.createAuthorization(clientAgent, {
		// 	access: {
		// 		'store/add': {}
		// 	},
		// })
		// await clientAgent.importSpaceFromDelegation(authorization)

		const result = await client.agent.invokeAndExecute(Store.add, {
			nb: {
				link: carLink,
				size: 0
			}
		})
		if (result.out.error) {
			throw result.out.error
		}
		expect(result.out.ok).toBeTruthy()
	})
});


it('exercises the API with a real invocation', async () => {
	const serverId = Signer.parse("MgCbI52HESAu29h07/iTwgfJZjVDUN+mm6k6e4TF7nnDvTe0BKn8LUopGK2m/bnvEErRa378h83+3HUtFHQLleouuUqY=");
	const carLink = parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa');

	function connection (options = {}) {
		return UcantoClient.connect({
			id: serverId,
			codec: CAR.outbound,
			// @ts-ignore typing error we can fix later
			channel: HTTP.open({
				url: new URL("https://fireproof-ucan.travis-fireproof.workers.dev"),
				method: 'POST',
			}),
		});
	}

	const invocation = Store.add.invoke({
		audience: serverId,
		issuer: serverId,
		with: serverId.did(),
		nb: {
			link: carLink,
			size: 0
		}
	});

	const conn = connection();

	try {
		// @ts-ignore TODO fix conn 
		const response = await invocation.execute(conn);
		expect(response.out.ok).toBeTruthy();
	} catch (e) {
		console.log("ERROR", e.stack);
		console.log("-----");
		throw e;
	}
});




