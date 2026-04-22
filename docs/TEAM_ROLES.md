# Team Roles & Responsibilities

> This document defines the team roles required to successfully deliver the `gpt-image-mcp` project, their responsibilities, and how they interact.

---

## Role Matrix

| Role | Abbrev | Primary Focus | TDD Touchpoint |
|------|--------|---------------|----------------|
| Software Architect | SA | Design, ADRs, MCP conformance | Defines test contracts |
| Backend Engineer | BE | NestJS, providers, MCP tools | Writes tests first (Red/Green/Refactor) |
| QA Automation Engineer | QA | Test suites, CI gates, quality | Owns test strategy, reviews tests |
| Security Champion | SC | Threat model, secret hygiene | Reviews security-sensitive test cases |
| Container/DevOps Engineer | CD | Docker, CI/CD, Helm, metrics | Owns infra-level integration tests |

---

## 1. Software Architect (SA)

### Responsibilities
- Own the overall system design and ensure MCP protocol compliance
- Author Architecture Decision Records (ADRs) for all significant technical choices
- Define module boundaries, interfaces, and the NestJS dependency injection graph
- Validate that Elicitation, Sampling, and Roots are implemented per spec
- Review PRs for architectural coherence and coupling violations
- Maintain `ARCHITECTURE.md` and `SPECIFICATION.md`

### Key Deliverables
- System architecture diagram (C4 model)
- ADR documents in `docs/adr/`
- Module interface definitions (TypeScript interfaces)
- MCP capability matrix (what the server declares vs. implements)

### TDD Touchpoint
- Defines **contract tests** (interface-level) that both backend engineers and QA must satisfy
- Signs off on acceptance criteria in Beads issues before implementation starts

### Interactions
- Works closely with BE to translate design into code
- Reviews SC's threat model to ensure security is designed-in, not bolted-on
- Coordinates with CD on deployment topology

---

## 2. Backend Engineer (BE)

### Responsibilities
- Implement all NestJS modules: `McpModule`, `ProvidersModule`, `SecurityModule`, `HealthModule`
- Build all MCP tools: `image_generate`, `image_edit`, `image_variation`, `provider_list`, `provider_validate`
- Implement MCP protocol features: Elicitation, Sampling, Roots handlers
- Integrate OpenAI SDK (`openai` npm package) and Azure OpenAI provider
- Write **tests first** following strict TDD: Red → Green → Refactor
- Implement Zod schemas for all tool inputs/outputs

### Key Deliverables
- All source code under `src/`
- Unit tests co-located with source (`*.spec.ts`)
- Integration tests in `test/`
- `.env.example` with all required variables documented

### TDD Touchpoint
- **NEVER** writes production code before a failing test exists
- Each PR must show the Red commit (failing test) before the Green commit
- Works with QA to ensure test coverage ≥ 90% for business logic

### Interactions
- Reports blockers to SA for architectural guidance
- Pairs with SC for security-sensitive code (API key handling, input sanitisation)
- Hands off Docker build to CD

---

## 3. QA Automation Engineer (QA)

### Responsibilities
- Own the overall **test strategy** (see `TDD_STRATEGY.md`)
- Define test pyramid: unit → integration → e2e
- Write shared test utilities, factories, and fixtures
- Configure and maintain CI quality gates (coverage thresholds, mutation score)
- Perform exploratory testing of MCP tool behaviour with real clients (Claude Desktop, Goose)
- Validate MCP protocol compliance using `@modelcontextprotocol/inspector`
- Write regression tests for every bug found
- Review all test code in PRs

### Key Deliverables
- `test/` directory structure and conventions
- Test factories and builders for image generation scenarios
- CI pipeline test stages configuration
- Coverage and mutation testing reports
- MCP conformance test suite

### TDD Touchpoint
- Reviews all test code to ensure tests are meaningful (not tautological)
- Enforces "test first" discipline via PR checklist
- Owns the mutation testing configuration (e.g. Stryker)

### Interactions
- Works with BE to establish testing patterns early
- Reports quality risks to SA and PM
- Collaborates with SC on security test cases

---

## 4. Security Champion (SC)

### Responsibilities
- Own the **threat model** for the service (see `SECURITY.md`)
- Ensure API keys are never logged, committed, or transmitted in clear text
- Define and enforce secret management strategy (env vars, vault, rotation)
- Review all code that handles: credentials, file paths, user input, external API calls
- Implement and test rate limiting and abuse prevention
- Validate MCP Elicitation never requests passwords/secrets via form mode
- Perform OWASP-aligned security review before each release
- Define security acceptance criteria for each milestone

### Key Deliverables
- `SECURITY.md` threat model
- Security-focused test cases (injection, path traversal, secret leakage)
- Rate limiting configuration and tests
- Dependency vulnerability scanning (Snyk/Trivy) in CI
- Security review checklist for PRs

### TDD Touchpoint
- Writes security-specific tests (e.g. "API key must never appear in logs")
- Reviews test cases for security regressions
- Ensures test environment never uses production secrets

### Interactions
- Works with BE on input validation and sanitisation
- Reviews CD's Docker image for hardened baseline
- Reports vulnerabilities to SA for architectural remediation

---

## 5. Container/DevOps Engineer (CD)

### Responsibilities
- Own the `Dockerfile` and `.dockerignore` — multi-stage, minimal attack surface
- Configure CI/CD pipeline (GitHub Actions): lint → test → build → scan → publish
- Publish OCI image to `ghcr.io` with proper tagging strategy
- Write `docker-compose.yml` for local development + integration testing
- Configure Prometheus metrics endpoint and Grafana dashboard
- Write Helm chart (optional, M6+) for Kubernetes deployment
- Implement health check endpoints (`/health/live`, `/health/ready`)
- Manage environment-specific configuration (dev / staging / prod)

### Key Deliverables
- `Dockerfile` (multi-stage, Bun-based)
- `.github/workflows/ci.yml`
- `docker-compose.yml` and `docker-compose.test.yml`
- `charts/gpt-image-mcp/` Helm chart
- Observability stack configuration

### TDD Touchpoint
- Writes **infra-level integration tests**: "container starts", "health endpoint returns 200", "env var validation fails fast"
- Ensures the CI pipeline runs all test stages and blocks merge on failure

### Interactions
- Works with BE to ensure the application is container-friendly (12-factor)
- Collaborates with SC on image scanning and hardened base images
- Reports infra constraints to SA

---

## RACI Matrix

| Activity | SA | BE | QA | SC | CD |
|----------|----|----|----|----|----|
| System design | **R/A** | C | I | C | I |
| MCP tool implementation | C | **R/A** | C | C | I |
| Test strategy | C | C | **R/A** | C | I |
| Security review | C | C | C | **R/A** | C |
| CI/CD pipeline | I | I | C | C | **R/A** |
| Docker image | I | C | C | C | **R/A** |
| ADR authorship | **R/A** | C | I | C | I |
| Deployment | C | I | I | C | **R/A** |
| Incident response | I | C | C | C | **R/A** |

*R = Responsible, A = Accountable, C = Consulted, I = Informed*

---

## Communication Norms

- **Daily**: Async stand-up in team channel (status, blockers)
- **Per PR**: All roles review issues in their domain (BE code → QA + SC review)
- **Per Milestone**: Architecture review session (SA leads, all attend)
- **Security incidents**: SC pages all roles immediately

---

*Updated: 2026-04-22*
