"use client";

import { useActionState, useRef } from "react";
import {
  createCodeAction,
  deleteCodeAction,
  regenerateCodeAction,
  revokeAllAccessAction,
  setCodeEnabledAction,
  type BetaActionState,
} from "./actions";

const initialState: BetaActionState = { ok: false };

function OneTimeCode({ code }: { code: string }) {
  return (
    <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">
        Copy now: this code will not be shown again
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <code className="min-w-0 flex-1 break-all rounded bg-slate-950 px-3 py-2 text-sm text-white">
          {code}
        </code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(code)}
          className="min-h-11 rounded-lg border border-white/15 px-4 text-sm font-semibold text-white"
        >
          Copy
        </button>
      </div>
    </div>
  );
}

export function CreateCodeForm() {
  const [state, action, pending] = useActionState(
    createCodeAction,
    initialState,
  );

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <label className="text-sm text-slate-300">
        Label
        <input
          required
          maxLength={80}
          name="label"
          className="mt-1 h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white"
          placeholder="Founders cohort"
        />
      </label>
      <label className="text-sm text-slate-300">
        Maximum redemptions
        <input
          min={1}
          name="maxRedemptions"
          type="number"
          className="mt-1 h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white"
          placeholder="Unlimited"
        />
      </label>
      <label className="text-sm text-slate-300">
        Expiration
        <input
          name="expiresAt"
          type="datetime-local"
          className="mt-1 h-11 w-full rounded-lg border border-white/10 bg-slate-950 px-3 text-white"
        />
      </label>
      <div className="flex items-end">
        <button
          disabled={pending}
          className="min-h-11 w-full rounded-lg bg-cyan-400 px-4 font-semibold text-slate-950 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate Random Code"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="md:col-span-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state.code && (
        <div className="md:col-span-2">
          <OneTimeCode code={state.code} />
        </div>
      )}
    </form>
  );
}

export function CodeActions({
  codeId,
  enabled,
}: {
  codeId: string;
  enabled: boolean;
}) {
  const [state, regenerateAction, pending] = useActionState(
    regenerateCodeAction,
    initialState,
  );
  const deleteForm = useRef<HTMLFormElement>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={setCodeEnabledAction}>
          <input type="hidden" name="codeId" value={codeId} />
          <input type="hidden" name="enabled" value={String(!enabled)} />
          <button className="min-h-10 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white">
            {enabled ? "Disable" : "Enable"}
          </button>
        </form>
        <form action={regenerateAction}>
          <input type="hidden" name="codeId" value={codeId} />
          <button
            disabled={pending}
            className="min-h-10 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            Regenerate
          </button>
        </form>
        <form ref={deleteForm} action={deleteCodeAction}>
          <input type="hidden" name="codeId" value={codeId} />
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Delete this invitation code? Existing users keep access.",
                )
              ) {
                deleteForm.current?.requestSubmit();
              }
            }}
            className="min-h-10 rounded-lg border border-red-400/30 px-3 text-xs font-semibold text-red-300"
          >
            Delete
          </button>
        </form>
      </div>
      {state.error && <p className="text-xs text-red-300">{state.error}</p>}
      {state.code && <OneTimeCode code={state.code} />}
    </div>
  );
}

export function RevokeAllButton() {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={revokeAllAccessAction}>
      <button
        type="button"
        onClick={() => {
          if (
            window.confirm(
              "Revoke private-beta access for every non-admin user? This takes effect immediately.",
            )
          ) {
            form.current?.requestSubmit();
          }
        }}
        className="min-h-11 rounded-lg border border-red-400/40 px-4 text-sm font-semibold text-red-300"
      >
        Revoke All Beta Access
      </button>
    </form>
  );
}
