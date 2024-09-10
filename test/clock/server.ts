import * as UCANTO from '@ucanto/server';
import { Block } from 'multiformats/block';

import { Event } from './client';

export async function createEventCar(event: Event) {
	return await UCANTO.CAR.write({
		roots: [new Block({ cid: event.cid, bytes: event.bytes, value: event.value })],
	});
}
