# Amniora Runner source

This directory brings the macOS and Windows native applications together with the shared command, pairing, guest, runtime and viewer implementation. It is a coherent source snapshot of the later local-first work. The separate `website/` directory began from the primary web workspace and now provides a local demonstration; these directories are not an artificial merge of different product branches.

## Contents

| Directory | Implementation |
| --- | --- |
| `prototypes/local-first-runner/macos/` | Swift Runner shells, Keychain signer, WebKit lab viewer, application metadata and viewer entitlements. |
| `windows/Amniora.Runner/` | Windows Forms Runner, URI activation, instance routing, diagnostics, account/guest bridge, DPAPI identity and product-state stores. |
| `windows/Amniora.Runner.IdentityHelper/` | Fixed-purpose Ed25519 identity/signing helper. |
| `windows/Amniora.Viewer/` | WebView2 viewer, request bridge and origin policy. |
| Other `windows/` projects | Original contract, lifecycle and integration test sources, with their project references. |
| `lib/web-lab/local-first-*` | Shared one-use ticket/pairing, desktop product clients, guest session, privileged helper, local runtime and isolated viewer logic. |
| Other `lib/web-lab/` files | Package compiler, schemas, execution backends and service-adapter dependencies retained for coherent source review. |
| `scripts/` | New portfolio compilation helpers that create fresh local output. |

Historical service hosts and contact examples use the reserved `portfolio.example.test` domain. There are no private keys, pairing records, account data, VM images, installed applications or signed installers here. The source still contains the real platform APIs and third-party SDK imports it used.

## Validation and local compilation

The root repository's [offline tests](../docs/included-components.md) provide separate reproducible protocol checks. They use synthetic identities and fake Docker and do not change an installed Runner or VM. The website's local demonstration is documented in its own [README](../website/README.md).

Shared TypeScript can be checked and compiled without running its entry points:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run compile:shared
```

The dependencies include the server adapters' genuine Next.js, Supabase, Vercel, Postgres and monitoring packages. Installing or compiling these libraries does not provision those services. No credentials are needed for compilation. A working native application still requires separately configured local guest transport and a deliberately provisioned control-plane service.

The Windows projects target .NET 8 and Windows x64. Their source and `.csproj` files are included. The following compilation commands were verified with .NET SDK 8.0.425:

```sh
dotnet build windows/Amniora.Runner/Amniora.Runner.csproj --configuration Release --nologo
dotnet build windows/Amniora.Viewer/Amniora.Viewer.csproj --configuration Release --nologo
dotnet build windows/Amniora.Runner.IdentityHelper/Amniora.Runner.IdentityHelper.csproj --configuration Release --nologo
```

All three builds completed with no warnings or errors. Compilation does not register the custom URI scheme, write an identity, launch the application or install guest software. Original lifecycle and integration test programmes are retained for review, but they can interact with installed applications and platform stores. They are not part of the portfolio test command and should not be run as a general setup step.

The macOS source requires the Apple SDK and has not been compiled in the Windows preparation environment. `scripts/compile-macos.zsh` provides compile-only commands for a Mac; it does not sign, register, install or launch the outputs. Its existence is not a claim of new macOS validation.

## Deliberate exclusions

Original packaging commands that replaced installation paths, registered desktop applications, copied owner-test installers or built VM media have been left out. This edition contains source/build projects, not a supported distribution. The original implementation remains preserved privately.

The later Runner service interfaces are retained as source. They are not connected to the website's local demonstration. Public signing, updates, guest installation, live pairing and end-to-end native execution are outside this edition's reproduced tests. Platform readiness and historical validation limits are documented in [testing and limitations](../docs/testing-and-limitations.md).

Original work is licensed under the [MIT License](../LICENSE). See [third-party notices](../THIRD_PARTY_NOTICES.md) for dependencies.
