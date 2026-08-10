# Managed identity and OBO credential roadmap

Managed identity is recommended for a service calling Azure with its own workload permissions. OBO is different: it also requires a confidential server application to exchange a user's assertion.

The current OBO implementation accepts `IMAGE_ENTRA_CLIENT_SECRET`; production operators must inject it from a secure platform secret or Key Vault reference and rotate it. It does **not yet** accept certificate or federated client-assertion configuration, so do not configure those and assume they are active.

A future credential extension should add an MSAL `clientCertificate` or `clientAssertion` callback backed by a managed/workload identity and a matching federated identity credential on the server app registration. That work must retain the same inbound token validation and per-user OBO isolation.

For services that do not need user-specific Azure authorization, use a separate managed-identity mode rather than pretending it is OBO.
