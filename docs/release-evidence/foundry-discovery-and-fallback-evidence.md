# Foundry discovery and controlled image fallback evidence

Date: 2026-08-19

- Uses the documented Foundry project endpoint `GET /deployments?api-version=v1`.
- Live metadata confirmed both image deployments: OpenAI `gpt-image-2` version `2026-04-21` and Microsoft `MAI-Image-2.5` version `2026-06-02`.
- Routing uses the authoritative deployment name, modelName and modelPublisher tuple.
- Unsupported publishers/models are excluded; ambiguous model aliases require an exact deployment.
- Optional `fallback_model=gpt-image-2` is explicit, transparent and restricted to output-stage safety blocks; prompt-stage blocks do not fallback.
- Prometheus fallback metrics contain only model/reason labels, never prompts, users or request IDs.
