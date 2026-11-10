# Later website integration source

These eight files preserve the website changes from the later local-first Runner snapshot, alongside the macOS, Windows and shared implementation in this directory's parent. Original `app/` paths are retained so the integration can be reviewed in context.

| Files | Role |
| --- | --- |
| Three `app/api/web-labs/local-first/` route files | Dispatch pairing approval, saved-investigation VM operations and Runner protocol requests. |
| Two `app/dashboard/runner/connect/[requestId]/` files | Render and handle the original pairing approval flow. |
| Three `app/dashboard/saved/[id]/SavedLab*.tsx` files | Connect the saved-investigation interface to Runner status, VM actions and setup state. |

This is a historical source overlay, not a standalone application. Its imports refer to the later `runner/lib/web-lab/` modules and shared components available in the primary `website/` source. The original snapshot's Mac-oriented pairing wording is preserved as historical interface evidence. It is not a claim that every platform flow was completed or validated together.

The files have not been merged into or mounted by the synthetic local website. That demo does not approve pairing, invoke native URI handlers or operate a VM. All eight files were parsed without syntax errors, but the combined overlay was not compiled or exercised end to end. Three interface labels use plain punctuation; behaviour is otherwise unchanged.

Keeping this overlay separate preserves the later native integration work without implying that incompatible snapshots form a tested release. See [Runner instructions](../README.md) and [testing limits](../../docs/testing-and-limitations.md).
