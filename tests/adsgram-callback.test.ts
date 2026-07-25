import { describe, expect, it } from "vitest";
import { handleAdsgramCallback } from "../src/adsgram-callback.js";

class CallbackDb {
  readonly events = new Set<string>();
  readonly calls: Array<{ query: string; values: unknown[] }> = [];

  prepare(query: string) {
    const call = { query, values: [] as unknown[] };
    this.calls.push(call);
    return {
      bind: (...values: unknown[]) => {
        call.values = values;
        return {
          first: async <T>() => null as T | null,
          all: async <T>() => ({ results: [] as T[] }),
          run: async () => {
            if (query.includes("INSERT OR IGNORE INTO quizpay_ad_events")) {
              const id = String(values[0]);
              if (this.events.has(id)) return { meta: { changes: 0 } };
              this.events.add(id);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        };
      },
      first: async <T>() => null as T | null,
      all: async <T>() => ({ results: [] as T[] }),
      run: async () => ({}),
    };
  }
}

async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("AdsGram server callbacks", () => {
  it("records a signed impression and treats a duplicate event as a replay", async () => {
    const db = new CallbackDb();
    const body = JSON.stringify({ event_id: "evt-1", ad_id: "between-games", event: "impression" });
    const headers = { "X-AdsGram-Signature": await signature("shared-secret", body) };

    const first = await handleAdsgramCallback(new Request("https://quizpay.example/adsgram/callback", { method: "POST", headers, body }), { DB: db, WEBHOOK_SECRET: "shared-secret" });
    const second = await handleAdsgramCallback(new Request("https://quizpay.example/adsgram/callback", { method: "POST", headers, body }), { DB: db, WEBHOOK_SECRET: "shared-secret" });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, replay: false });
    expect(await second.json()).toEqual({ ok: true, replay: true });
  });

  it("rejects a forged callback before it reaches ad accounting", async () => {
    const db = new CallbackDb();
    const response = await handleAdsgramCallback(
      new Request("https://quizpay.example/adsgram/callback", { method: "POST", headers: { "X-AdsGram-Signature": "forged" }, body: "{}" }),
      { DB: db, WEBHOOK_SECRET: "shared-secret" },
    );
    expect(response.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });
});
