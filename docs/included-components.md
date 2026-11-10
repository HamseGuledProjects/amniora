# Included components

This edition brings the website, macOS and Windows Runner implementations, and shared protocols into one repository. Active product development has been cancelled. The website runs as a local synthetic demonstration; native applications have source and compilation instructions.

## Website

`website/app/` contains the Next.js pages, components and API route source. The libraries include investigation generation and validation, saved-work models, assessment, product guidance, authentication and lab-service interfaces. Reviewed icons and brand images are included.

The demo replaces account and data access with synthetic fixtures. It demonstrates the existing workspace without Supabase, provider credentials or live account data. Original service integrations remain readable in source but are disabled by the demo entry point. Account administration, native pairing, hosted execution and live AI responses are outside the synthetic adapter.

See [website setup](../website/README.md) for commands and supported flows. Do not put real environment files or credentials into this edition.

## Runner

`runner/` preserves the later local-first source snapshot, including:

- macOS Swift Runner shells, Keychain signer, WebKit viewer, application metadata and entitlements
- Windows Runner, IdentityHelper and Viewer projects, including activation, identity, state and viewer integrations
- Shared TypeScript product clients, tickets, pairing, guest transport, package verification, lifecycle and viewer implementation
- Original native test projects for review and new compile-only helpers

The website comes from the primary web workspace. Runner comes from the later continuity work. Its `website-integration/` directory also preserves the eight later pairing, account-API and VM-control files as a historical overlay. These separate snapshots preserve the available implementation without implying an integrated release passed end-to-end validation. The synthetic website does not connect to the native Runner or import that overlay.

[Runner instructions](../runner/README.md) explain compilation and dependencies. Native macOS/Windows packaging, registration, signing and VM-media scripts are excluded because they depend on private operational material or alter installed applications. Historical Linux distribution source remains under `website/runner-distribution/`, with its effects and unconfigured state documented. No packaged installers, VM images, identities or signing keys are supplied.

## Standalone engineering tests

The repository root retains a smaller dependency closure for offline review:

| Location | Behaviour | Test boundary |
| --- | --- | --- |
| `lib/lab-assets/linux/` | Deterministic randomness, hashes, command/CSV parsing, time and response validation | Selected foundations; the wider engine is in `website/`. |
| `lib/web-lab/local-first-runner/` | Pairing, device proof, one-use tickets and replay checks | Synthetic in-memory authorities. |
| `lib/web-lab/local-runner/` | Signed packages, runtime identity, generations and recovery | Injected runtime backends. |
| `lib/web-lab/local-first-guest/` | Guest sessions, helper operations and lifecycle | Temporary synthetic keys and fake Docker. |
| `lib/web-lab/local-first-viewer/` | Viewer origins, bounded relay and stale-runtime rejection | In-memory transport; no native browser. |
| Other `lib/web-lab/` modules | Schemas, lab templates, compiler and package content | Dependencies needed by the protocol tests. |
| `excerpts/` | Focused native modules for review and Windows policy tests | The broader projects are retained in `runner/`. |

`vercel-runtime-bundle.ts` keeps its technical name because the local package builder reuses its pure generation functions. The root tests do not deploy anything or serve generated lab content. Templates contain deliberately vulnerable synthetic training examples for authorised local use only.

From the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
```

Dependency installation contacts the package registry. The six root suites block external requests and child-process execution. They use synthetic temporary fixtures and local named pipes or sockets.

With the .NET 8 SDK:

```sh
dotnet run --project tests/windows-policy/WindowsPolicyTests.csproj
```

This harness runs 24 checks against Windows URI, activation, diagnostics, architecture and viewer-policy modules. It has no NuGet dependencies and does not access identity stores, register a URI handler or start a VM.

These checks differ from native installed-app tests and real Docker or guest-network validation. See [testing and limitations](testing-and-limitations.md).

## Assets and exclusions

The [screenshot gallery](screenshots.md) contains three reviewed development captures using synthetic examples. `assets/brand/` contains existing Amniora artwork. Captions distinguish historical interfaces, simulated runtime state and export fixtures from live native validation.

Production configuration, private data, secrets, operational logs, private screenshots, original Git history and development conversations are excluded. Genuine AI-provider references, product prompts and native signing APIs remain where they form part of the implementation. Third-party names and notices have not been removed to disguise dependencies.
