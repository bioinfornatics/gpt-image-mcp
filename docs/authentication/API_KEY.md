# Mode 1 — Azure API key

Best for compatibility and the shortest setup. Existing Azure configurations continue to infer this mode when `IMAGE_API_KEY` exists.

```env
IMAGE_PROVIDER=azure
IMAGE_AZURE_AUTH_MODE=api_key
IMAGE_API_KEY=<azure-openai-key>
IMAGE_BASE_URL=https://RESOURCE.openai.azure.com
IMAGE_DEPLOYMENT=DEPLOYMENT
IMAGE_MCP_TRANSPORT=stdio
```

For Goose, place only `IMAGE_API_KEY` in `env_keys`; all other values belong in `envs`.

## Verify

Call `provider_validate`, then generate one image and confirm its saved path.

## Failures

A 401 means the key is invalid or expired; a 403 means the key authenticated but model/resource access is denied.

## Cleanup and rotation

Rotate the key in Azure, update the Goose secret store, and remove old `_FILE` mounts or keychain entries. Prefer Azure CLI or OBO when enterprise policy prohibits static keys.
