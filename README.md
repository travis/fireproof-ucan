### Setup

Generate a key:

```bash
npx ucan-key ed --json
```

and into `.dev.vars`:

```
FIREPROOF_SERVICE_PRIVATE_KEY = <private key>

```

and then https://dash.cloudflare.com/cae1c33213e6c4d3093a01ae8a7e24b0/r2/api-tokens to create API tokens


### Testing

To test uploading using a pre-signed URL (eg. during connector tests), run the local server in 'remote' mode so that it uses the preview bucket and KV.

```shell
npm run dev-remote
```
