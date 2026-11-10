# Architecture

This document describes the reviewed Amniora design. The portfolio includes the website, both native Runner implementations and standalone tests. The website runs with local synthetic data; the original hosted services and native VM integration are not enabled by the demo. The [repository overview](../README.md) identifies the included components.

## Local portfolio mode

The website starts with synthetic account and investigation fixtures. The local adapter handles supported API requests and rejects unsupported service operations. The launcher refuses real environment files, binds to loopback and disables outbound service networking. Browser policy keeps application resources local. None of these demo fixtures grants access to the original account service.

Tutor replies and investigation generation use written examples. The full original implementation remains in source for review, including its product prompts, validation rules and service boundaries. The demo does not pair a native Runner, start a guest or execute a vulnerable lab.

## Investigation workspace

The web application used Next.js and React for authentication, saved investigations, task navigation, evidence downloads, progress and the AI Tutor. Supabase supplied authentication and persisted application data. Server routes revalidated the caller and checked access to the relevant investigation or conversation.

Linux investigations began with a deterministic world and incident model. That model produced evidence, task contracts and provenance. Validators checked chronology, identities, supported claims and whether a task could be answered from its supplied evidence. Model-generated narrative was constrained by the established contract; it was not allowed to invent the underlying incident facts.

AI Tutor and task guidance called the OpenAI Responses API from server-side code. Guidance supported explanations, hints, command explanations and quizzes. The Tutor route included conversation ownership checks, content-sharing consent and usage reservations. Product prompts are implementation inputs, distinct from development conversations. Model output still requires validation and can be wrong.

## Local execution

The learner kept the investigation and tasks on the website. A paired desktop Runner managed an Ubuntu guest, which ran the deliberately vulnerable lab in Docker. A separate viewer displayed only the target lab. Reset and Stop were initiated from the website.

The architecture diagram in the [README](../README.md#architecture) separates hosted command authorisation from local lab traffic.

1. The website asks the server to authorise a fixed operation against an owned investigation and paired installation.
2. The server issues a short-lived, opaque, one-use activation ticket. The operating system opens the registered Runner through a URI containing only that ticket.
3. Runner redeems the ticket with an Ed25519 proof. The server resolves the immutable account, device, operation, build and runtime context. The browser cannot supply replacement authority.
4. For Launch, redemption provides signed lab packages for supported guest architectures. Runner checks immediate guest readiness, selects the observed architecture and verifies the selected package.
5. The independently paired guest authenticates Runner and verifies package authority before dispatching fixed lifecycle operations through a narrow privileged helper.
6. The viewer relays bounded HTTP requests over the authenticated local channel. Its destination comes from the active runtime record, never a page-selected URL. Lab HTTP traffic does not pass through the hosted application in this design.
7. Signed command results update website state. Reset creates a new generation and invalidates the old viewer. Stop removes the authoritative lab resources and makes further viewer requests fail.

An activation ticket is a temporary reference to an authorised command. A signed package describes approved lab content, image identity, architecture and resource policy. They are separate objects with different verification rules.

## State and recovery

The later continuity implementation separates three questions:

| State | Meaning |
| --- | --- |
| Presence | Has the paired Runner sent a recent valid heartbeat? |
| Readiness | What did the latest signed operation observe about the VM, guest agent and Docker? |
| Runtime | Which server-authorised build, runtime and generation are active? |

A heartbeat does not establish Docker readiness. Launch, Open Lab, Reset and Stop perform an immediate guest preflight. Stale presence does not by itself remove the ability to request Stop. The server retains runtime binding and the one-active-runtime reservation.

Guest and helper records support reconciliation after interrupted commands. Generation checks reject stale actions. Cleanup requires both an authoritative runtime record and matching resource identity; it does not run broad Docker pruning.

## Platform adapters

The shared protocol and runtime policy are TypeScript. The macOS prototype used AppKit, Keychain and a separate WKWebView process. Windows used a .NET WinForms shell, a DPAPI-protected identity and a separate WebView2 process. These native shells adapt operating-system activation, identity storage and viewer behaviour without creating a generic browser-to-shell interface.

Source support and observed platform behaviour differ. See [testing and limitations](testing-and-limitations.md) before interpreting either implementation as a supported release.
