import type { WebLabSpec, WebStoredEntry } from "./schema";

export type WebRuntimeEntry = WebStoredEntry & { submittedByLearner: boolean };
export type WebLabRuntimeState = {
  schemaVersion: 1;
  labId: string;
  contentByObject: Record<string, WebRuntimeEntry[]>;
  nextContentNumber: number;
};
export type WebLabStateStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
};

export function createMemoryWebLabStateStorage(): WebLabStateStorage {
  const entries = new Map<string, string>();
  return { get: key => entries.get(key) ?? null, set: (key, value) => { entries.set(key, value); }, delete: key => { entries.delete(key); } };
}

function storedObjects(spec: WebLabSpec) {
  return spec.templateId === "helpdesk"
    ? (spec.tickets ?? []).map(ticket => ({ id: ticket.id, entries: ticket.comments, enabled: ticket.replyEnabled && ticket.ownerId === spec.session.displayUserId }))
    : (spec.products ?? []).map(product => ({ id: product.id, entries: product.reviews, enabled: product.reviewEnabled }));
}

export function canonicalWebLabRuntimeState(spec: WebLabSpec): WebLabRuntimeState {
  return {
    schemaVersion: 1,
    labId: spec.labId,
    contentByObject: Object.fromEntries(storedObjects(spec).map(object => [object.id, object.entries.map(entry => ({ ...entry, submittedByLearner: false }))])),
    nextContentNumber: 1,
  };
}

/** Offline per-instance model. Browser tests also exercise each compiled template's session adapter. */
export function createWebLabRuntimeInstance(spec: WebLabSpec, instanceId: string, storage: WebLabStateStorage) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(instanceId)) throw new Error("Invalid runtime instance ID");
  const key = `${spec.labId}:${instanceId}`;
  const objects = storedObjects(spec);
  const initial = canonicalWebLabRuntimeState(spec);
  let state = initial;
  const serialized = storage.get(key);
  if (serialized) {
    try {
      const candidate = JSON.parse(serialized) as WebLabRuntimeState;
      if (candidate.schemaVersion === 1 && candidate.labId === spec.labId && Number.isSafeInteger(candidate.nextContentNumber) && candidate.nextContentNumber > 0 &&
        objects.every(object => Array.isArray(candidate.contentByObject?.[object.id]))) state = candidate;
    } catch { /* invalid offline state starts canonical */ }
  }
  const submitContent = (objectId: string, body: string) => {
    const object = objects.find(item => item.id === objectId);
    if (!object?.enabled || !body.trim() || body.length > 500) throw new Error("Invalid stored-content submission");
    state = structuredClone(state);
    state.contentByObject[objectId].push({ id: `learner-${state.nextContentNumber}`, authorId: spec.session.displayUserId, body, submittedByLearner: true });
    state.nextContentNumber += 1;
    storage.set(key, JSON.stringify(state));
  };
  const contentFor = (objectId: string): WebRuntimeEntry[] => structuredClone(state.contentByObject[objectId] ?? []);
  return {
    snapshot: (): WebLabRuntimeState => structuredClone(state),
    contentFor,
    submitContent,
    /** Phase-3 test aliases; both invoke the same object-generic transition. */
    commentsFor: contentFor,
    submitComment: submitContent,
    reset() { storage.delete(key); state = initial; },
  };
}
