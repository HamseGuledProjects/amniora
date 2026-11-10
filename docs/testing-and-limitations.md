# Testing and limitations

## What the evidence means

There are three distinct kinds of evidence here: source that implements a behaviour, historical reports that describe tests on a particular machine, and checks rerun against the sanitised portfolio checkout. They are not interchangeable. Private histories and raw operational reports are not included in this repository.

The portfolio commands are listed in [Running the included components](../README.md#running-the-included-components). They run the website with synthetic fixtures, test standalone components or compile source. They do not start the hosted service, install a Runner, create a VM, contact production or establish current platform certification.

## Included source boundary

The website includes the application and investigation-engine source, with a local synthetic adapter replacing external services. Root tests separately exercise shared TypeScript ticket and pairing contracts, signed-package verification, runtime/helper policy with fake Docker, viewer generation checks and selected Linux foundations.

The Runner directory contains the macOS Swift applications, Windows C# projects and their shared implementation. Windows project compilation and offline policy checks are separate from installed-application validation. The macOS apps require Apple SDKs and were not compiled on this Windows host.

## Portfolio checks run

The following commands passed against the sanitised checkout on 10 November 2026, using Node 24.18.0, TypeScript 5.9.3 and .NET SDK 8.0.425:

| Command | Observed result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Installed the pinned test dependencies with package lifecycle scripts disabled. |
| `npm test` | Passed six offline suites: Linux foundations, ticket/PKCE contracts, signed packages, helper policy with fake Docker, runtime lifecycle and viewer generation policy. |
| `npm run typecheck` | Passed strict TypeScript checking of the configured portfolio scope. |
| `dotnet run --project tests/windows-policy/WindowsPolicyTests.csproj` | Passed 24 checks covering URI parsing, activation gating, viewer origins and diagnostics. |
| `npm run typecheck` and `npm run compile:shared` in `runner/` | Passed shared Runner TypeScript validation and compilation. |
| Windows Runner, Viewer and IdentityHelper project builds | All three compiled with .NET 8.0.425, with no warnings or errors. Applications were not launched or installed. |
| `npm run typecheck` and `npm run build` in `website/` | Passed after dependency updates and the full supporting-source export; the production build generated 50 static routes. |
| `npm start -- --port 3105` in `website/` | Started the production build on loopback without environment files or service credentials. |
| `node --test tests/portfolio-demo.test.cjs` in `website/` | Passed seven local integration and safety tests against the production server. |

The website tests cover page responses, sample generation and Tutor replies, PDF/ZIP exports, rejected operational requests, host/origin and method checks, blocked external networking, and clean startup settings. Browser checks covered the homepage, dashboard, saved investigation, Tutor and generation flow. Scoped lint checks passed for the new demo modules, proxy, launcher and edited shared layout/consent components. The archived original test suites and migrations were not executed.

The npm dependency installation uses the public package registry. Native Windows project restoration uses NuGet; the root policy project has no NuGet dependencies and clears package sources. The test suites use synthetic data and test doubles. The policy checks do not exercise DPAPI identity storage, an installed URI handler, WebView2 or a real guest. These results are specific to this export and are not combined with historical assertion counts.

## Dependency review

On 10 November 2026, the final website and Runner lockfiles returned no critical or high records from npm's public advisory service. Both retain two moderate transitive dependency advisories: [minimatch pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) and [glob cancellation handling](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4). Their fixes require newer major versions than the parent packages currently request; no unverified override was applied.

The standalone root test dependencies had no returned advisory records. Native Runner and Viewer NuGet checks returned no listed vulnerable packages. These dated results do not establish runtime exploitability, a formal security audit or protection against unknown vulnerabilities.

## Cross-platform evidence

| Platform or layer | Implemented source | Historical live evidence reviewed | Unverified or incomplete |
| --- | --- | --- | --- |
| macOS ARM64 host / Ubuntu 24.04 ARM64 guest | AppKit Runner, Keychain identity, authenticated guest channel, signed packages, Docker lifecycle and WKWebView viewer | Reports describe real guest pairing, launch, hostile viewer probes, reset invalidation, stop cleanup and subsequent relaunch. | Not rerun for this edition; network-layer assurance remained qualified; public distribution unfinished. |
| Windows x64 host / Ubuntu AMD64 guest | WinForms Runner, DPAPI identity, WebView2 viewer, guest bridge, AMD64 media/package path and W2 live harness | W1 reports describe local pairing/proof flows, installed URI lifecycle and hostile WebView2 probes. | W1 evidence used disposable guest-shaped fixtures. Later W2 source exists, but a complete retained W2 result was not established here. Full VM certification is not claimed. |
| Shared continuity | Presence/readiness/runtime separation, immediate lifecycle preflight and signed results | Code and contract coverage are available. | No single final report establishes all platform combinations or promotion state. |
| Windows ARM64 | Architecture contracts exist. | None established. | No live validation or support claim. |
| Linux desktop Runner | Protocol portability was considered. | None established. | No completed native desktop Runner is claimed. |

## Regression strategy

The original suites covered deterministic investigation evidence, narrative constraints, assessment boundaries, strict message parsing, replay rejection, package tampering, stale generations, one-runtime races, helper operations and viewer request policy. Some tests use fakes to probe failure paths without installing a guest or running Docker. Such tests establish behaviour of the tested model, not the isolation of a real operating system.

Native viewer and VM checks require the matching platform, disposable identities, reviewed test artefacts and explicit local setup. They were intentionally not run during this portfolio preparation, which preserves the installed applications and VMs.

## Limits retained in this edition

- Local completion is not universal trusted attestation. A learner can control their host and guest.
- Viewer restrictions do not prove immunity to browser, operating-system or hypervisor exploits.
- macOS destination restrictions relied on layered WebKit/application controls while the viewer retained its required client-network entitlement.
- Windows current-user DPAPI did not resist arbitrary same-user code. Non-exportable identity and public distribution hardening remained incomplete.
- Public installers, application signing and update distribution were not fully released.
- Continuity implementation, live testing and promotion did not all have one demonstrated final state.
- My Computer, Amniora Cloud and public Early Access are not supported products in this edition.
- The local website uses synthetic fixtures. Original authentication, persistence, signing, cloud execution and provider integrations require excluded infrastructure and are not enabled.
- The website and later Runner snapshots are preserved separately. This edition does not establish end-to-end compatibility between them.
- Three reviewed historical captures are included. Their captions distinguish synthetic examples and simulated state from native runtime evidence. No reconstructed screenshots are used as evidence.

Automated publication scans and tests reduce risk but cannot guarantee that every secret, privacy issue or software defect has been found. This portfolio has not been independently audited or certified.
