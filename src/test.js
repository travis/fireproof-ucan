import * as Client from "@ucanto/client"
import * as Signer from "@ucanto/principal/ed25519";
import * as CAR from '@ucanto/transport/car'
import * as HTTP from '@ucanto/transport/http'
import { Store } from '@web3-storage/capabilities';
import { parseLink } from '@ucanto/core'

const serverId = Signer.parse("MgCbI52HESAu29h07/iTwgfJZjVDUN+mm6k6e4TF7nnDvTe0BKn8LUopGK2m/bnvEErRa378h83+3HUtFHQLleouuUqY=")
const carLink = parseLink(
  'bagbaierale63ypabqutmxxbz3qg2yzcp2xhz2yairorogfptwdd5n4lsz5xa'
)
export function connection (options = {}) {
  return Client.connect({
    id: serverId,
    codec: CAR.outbound,
    // @ts-ignore typing error we can fix later
    channel:
      HTTP.open({
        url: new URL("https://fireproof-ucan.travis-fireproof.workers.dev"),
//        url: new URL("http://localhost:8787"),
        method: 'POST',
        //fetch: globalThis.fetch.bind(globalThis),
      }),
  })
}

console.log(serverId.did())

const invocation = Store.add.invoke({
  audience: serverId,
  issuer: serverId,
  with: serverId.did(),
  nb: {
    link: carLink,
    size: 0
  }
})

const conn = connection()

// @ts-ignore TODO fix conn 
try {
const response = await invocation.execute(conn)
console.log(response.out)
} catch (e) {
  console.log("ERROR", e.stack)
  console.log("-----")
}