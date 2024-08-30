import { DIDKey, Link, Signer } from '@ucanto/principal/ed25519';
import { Store } from '@web3-storage/capabilities';

import { create as createConnection } from './connection';

/**
 * Invoke & execute a `Store.Add` capability.
 */
export async function addToStore(params: {
	issuer: Signer.Signer;
	audience: Signer.Signer;
	with: DIDKey;
	nb: {
		link: Link<unknown, 514>;
		size: number;
	};
}) {
	const { issuer, audience, nb } = params;
	const conn = createConnection();
	const invocation = Store.add.invoke({
		issuer,
		audience,
		with: params.with,
		nb,
	});

	// @ts-ignore this is happening because we're using the access client's connection function - TODO get the types right above to fix
	return await invocation.execute(conn);
}
