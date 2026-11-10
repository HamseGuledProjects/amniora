# Security design

Amniora deliberately runs vulnerable training content. The design therefore separates learner-facing application state, command authority, native device identity, guest execution and lab rendering. This is a description of implemented controls and their limits, not an independent security audit or certification.

## Website and command authority

The reviewed local-first access path revalidated authentication and read an explicit database entitlement. Browser-provided roles or readiness claims did not grant access. Pairing used a system-browser approval step, PKCE S256, state and a short-lived one-use code bound to the proposed installation key.

Activation URIs carried only opaque tickets. Server-side records bound each ticket to an account, installation, operation and, where applicable, build, runtime and generation. Redemption required an Ed25519 proof. Atomic consumption, short expiry, revocation and replay checks limited reuse. Canonical, domain-separated signing formats bound command results to their exact context.

The browser did not receive a generic localhost command socket. A malicious page could request URI activation, but activation alone did not authorise an operation.

## Package and guest boundaries

The signed package included immutable build identity, content hashes, image digest, supported architecture, expiry and a constrained resource policy. Runner verification did not replace the guest's independent trust configuration. A wrong key, altered package or architecture mismatch was rejected before execution.

Desktop-to-guest pairing established pinned public identities. Subsequent sessions combined encrypted transport with fresh key-possession challenges, sequence checks and session/generation binding. Messages used exact schemas and bounded frames. The protocol exposed fixed operations, rather than shell commands, arbitrary paths, Docker arguments or a user-selected network proxy.

The guest service account had no Docker group membership. A separate privileged helper accepted a narrow protocol over a protected local socket. Giving the general guest agent access to the Docker daemon would have defeated that separation.

## Runtime containment

The helper constructed the Docker invocation from verified policy. The challenge used a non-root user, a read-only root filesystem, dropped capabilities, `no-new-privileges`, bounded resources and an internal network. It did not receive the host Docker socket, host namespaces or arbitrary host mounts. A separate bounded ingress component connected the local viewer path to the challenge.

One active runtime was enforced. Reset invalidated the old generation and recreated clean lab resources. Stop removed only the containers, network, volume and transient data covered by the authoritative record. Resource labels alone were not sufficient cleanup authority.

## Viewer isolation

The viewer was a separate process with fresh storage and an origin derived from the runtime and generation. It did not share the website's authentication session. Native request handling allowed only the current lab origin and bounded requests through the trusted parent. Navigation, downloads, popups, permissions and native bridges were restricted.

The intended stored-XSS payload remained executable inside the lab. The aim was to contain that activity, not remove the vulnerability being taught. Browser policy checks cannot establish immunity to browser, operating-system or hypervisor vulnerabilities.

On macOS, WKWebView required the client-network entitlement for the reviewed prototype. Destination restrictions therefore relied on application and WebKit layers; the implementation did not establish an operating-system-level deny-all network guarantee.

## Identity storage and trust limits

The macOS prototype used Keychain. The Windows prototype protected an exportable Ed25519 seed with current-user DPAPI. DPAPI did not protect it against arbitrary code already running as the same Windows user. Non-exportable identity storage, cross-version validation and signed public distribution remained unfinished Windows release work.

A learner controls their host and can ultimately control their guest. Signed local execution results are useful orchestration evidence, but they are not universal trusted attestation of learning or completion. Trusted My VM grading was explicitly unavailable in the reviewed local-first design.

## AI and assessment boundaries

The original application used the OpenAI API for Tutor responses, task guidance and constrained narrative/extraction work. It retained server-side access and usage checks. Linux assessment code rejected client-supplied scores, rubrics and expected answers, and checked evidence citations against the trusted task contract.

Those controls reduce specific risks; they do not make language-model output authoritative. The offline portfolio tests do not contact an AI provider or reproduce the hosted consent, account and quota systems.

See [testing and limitations](testing-and-limitations.md) for evidence scope and [SECURITY.md](../SECURITY.md) for safe reporting and authorised use.
