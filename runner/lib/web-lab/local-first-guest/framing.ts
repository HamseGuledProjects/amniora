import type { Duplex } from "node:stream";
import { GUEST_MAX_FRAME_BYTES, GuestChannelError } from "./protocol";

type Waiter = Readonly<{ resolve(value: unknown): void; reject(error: Error): void }>;

export class JsonLineChannel {
  private pending = Buffer.alloc(0);
  private readonly values: unknown[] = [];
  private readonly waiters: Waiter[] = [];
  private failure: Error | null = null;

  constructor(private readonly stream: Duplex, private readonly maximum = GUEST_MAX_FRAME_BYTES) {
    stream.on("data", chunk => this.receive(Buffer.from(chunk)));
    stream.on("error", error => this.fail(error));
    stream.on("close", () => this.fail(new GuestChannelError("TRANSPORT_DENIED")));
  }

  send(value: unknown): void {
    const frame = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    if (frame.length - 1 > this.maximum) throw new GuestChannelError("FRAME_TOO_LARGE");
    if (!this.stream.write(frame)) this.stream.once("drain", () => undefined);
  }

  next(): Promise<unknown> {
    if (this.values.length > 0) return Promise.resolve(this.values.shift());
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  close(): void { this.stream.destroy(); }

  private receive(chunk: Buffer): void {
    if (this.failure) return;
    this.pending = Buffer.concat([this.pending, chunk]);
    if (this.pending.length > this.maximum + 1 && this.pending.indexOf(0x0a) < 0) {
      this.fail(new GuestChannelError("FRAME_TOO_LARGE"));
      this.stream.destroy();
      return;
    }
    for (;;) {
      const newline = this.pending.indexOf(0x0a);
      if (newline < 0) break;
      if (newline === 0 || newline > this.maximum) {
        this.fail(new GuestChannelError(newline > this.maximum ? "FRAME_TOO_LARGE" : "MESSAGE_INVALID"));
        this.stream.destroy();
        return;
      }
      const frame = this.pending.subarray(0, newline);
      this.pending = this.pending.subarray(newline + 1);
      let parsed: unknown;
      try { parsed = JSON.parse(frame.toString("utf8")); }
      catch {
        this.fail(new GuestChannelError("MESSAGE_INVALID"));
        this.stream.destroy();
        return;
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(parsed); else this.values.push(parsed);
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    while (this.waiters.length) this.waiters.shift()!.reject(error);
  }
}
