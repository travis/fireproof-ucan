import * as Agent from '@web3-storage/access/agent';
import * as CAR from '@ucanto/transport/car';
import * as DidMailto from '@web3-storage/did-mailto';
import * as HTTP from '@ucanto/transport/http';
import * as W3 from '@web3-storage/w3up-client';
import { Absentee } from '@ucanto/principal';
import { ParsedArgs } from 'minimist';
import { Service } from '../src/index';
import { Store as StoreCapabilities } from '@web3-storage/capabilities';
import { Signer } from '@ucanto/principal/ed25519';
import { connect } from '@ucanto/client';
import { parseLink } from '@ucanto/core';
import minimist from 'minimist';

import * as Client from '../test/common/client';

// PREP

const HOST = new URL('https://fireproof-ucan.jchris.workers.dev');

const args: ParsedArgs = minimist(process.argv.slice(2));
const email = args.email;
if (!email) throw new Error('`email` flag is required');

const persona = Absentee.from({ id: DidMailto.fromEmail(email) });

// TODO: Use env var
const server = Signer.parse('MgCZc476L5pn6Kiw5YdLHEy5CHZgw5gRWxNj/UcLRQoxaHu0BREgGEsI7N8cQxjO6fdgA/lEAphNmR/um1DEfmBTBByY=');
const connection = Agent.connection<`did:key:${string}`, Service>({
	principal: server,
	url: HOST,
	fetch: (url, options) => {
		console.log('🔮', url, options);
		return fetch(url, options);
	},
});

const service = connect<any>({
	id: server,
	codec: CAR.outbound,
	channel: HTTP.open({
		url: HOST,
		method: 'POST',
	}),
});

const w3 = await W3.create({
	serviceConf: {
		access: service,
		filecoin: service,
		upload: service,
	},
});

// CREATE CLOCK

const clock = await Client.createClock({ audience: persona });
const registration = await Client.registerClock({ clock, connection, server });

console.log('⏰ Clock registration', registration.out);
if (registration.out.error) process.exit(1);

// LOGIN / AUTHORISE USING EMAIL
// NOTE: Could opt for the simpler `@web3-storage/access` package instead using the whole w3up package.
const account = await w3.login(email);
console.log(
	'🤹 Account proofs',
	account.proofs.map((p) => p.capabilities),
);

const attestation = account.proofs.find((p) => p.capabilities[0].can === 'ucan/attest');
const delegation = account.proofs.find((p) => p.capabilities[0].can === '*');

if (!attestation || !delegation) {
	console.error('Unable to locate agent attestion or delegation');
	process.exit(1);
}

const agent: Client.Agent = {
	attestation,
	delegation,
	signer: account.agent.issuer,
};

// CREATE & STORE CLOCK EVENT

const event = await Client.createClockEvent({
	messageCid: parseLink('bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'),
});

const storeInvocation = StoreCapabilities.add.invoke({
	issuer: agent.signer,
	audience: server,
	with: agent.signer.did(),
	nb: {
		link: event.cid,
		size: event.bytes.length,
	},
});

const storeResp = await storeInvocation.execute(connection);

console.log('📦 store/add', storeResp.out);
if (storeResp.out.error) process.exit(1);

const storeUrl = storeResp.out.ok.url;

const r2 = await fetch(storeUrl, {
	method: 'PUT',
	body: event.bytes,
});

console.log('📦 R2 upload, succeeded', r2.ok);

if (!r2.ok) {
	console.error(await r2.text());
	console.error(`Couldn't store event on R2, status: ${r2.status}`);
	process.exit(1);
}

// ADVANCE CLOCK

const advancement = await Client.advanceClock({ agent, clock, connection, event, server });

console.log('⏰ Clock advancement', advancement.out);
if (advancement.out.error) process.exit(1);

// GET CLOCK HEAD

const head = await Client.getClockHead({ agent, clock, connection, server });

console.log('⏰ Clock head', head.out);
if (head.out.error) process.exit(1);

// SHARE TO BOB

if (!args.shareEmail) process.exit(0);
const sharePersona = Absentee.from({ id: DidMailto.fromEmail(args.shareEmail) });

const share = await Client.shareClock({
	issuer: persona,
	audience: sharePersona,
	clock: clock.did(),
	genesisClockDelegation: clock.delegation,
});

// BOB CAN VERIFY ALICE USING AN ATTESTATION FROM THE SERVER
// NOTE: See tests for more details about the flow

const w3Bob = await W3.create({
	serviceConf: {
		access: service,
		filecoin: service,
		upload: service,
	},
});

const accountBob = await w3Bob.login(args.shareEmail);

const attestationAlice = attestation;
const delegationAlice = delegation;

const attestationBob = accountBob.proofs.find((p) => p.capabilities[0].can === 'ucan/attest');
const delegationBob = accountBob.proofs.find((p) => p.capabilities[0].can === '*');

if (!attestationBob || !delegationBob) {
	console.error('Unable to locate agent attestion or delegation');
	process.exit(1);
}

const aliceIsVerifiedOffline = (() => {
	// @ts-ignore
	const proof = attestationAlice.capabilities[0].nb?.proof;

	return (
		attestationAlice.issuer.did() === attestationBob.issuer.did() &&
		delegationAlice.link().toString() === proof.toString() &&
		share.delegation.issuer.did() === delegationAlice.issuer.did()
	);
})();

console.log('Offline verification of Alice, verified:', aliceIsVerifiedOffline);

// SHARER CAN USE CLOCK ABILITIES ON THE SERVER
