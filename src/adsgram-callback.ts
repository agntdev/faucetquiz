import { now } from "./clock.js";
import { QuizPayStore, type D1Database } from "./toolkit/persistent.js";

export interface AdsgramCallbackEnv {
  DB?: D1Database;
  /** Reuses the deployment's existing webhook secret; no AdsGram API key is stored or requested. */
  WEBHOOK_SECRET?: string;
}

interface AdsgramEvent {
  event_id?: unknown;
  id?: unknown;
  ad_id?: unknown;
  event?: unknown;
  type?: unknown;
  amount_sats?: unknown;
  revenue_sats?: unknown;
}

function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stringField(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/**
 * Receives signed AdsGram server callbacks. Events are intentionally accepted
 * only from this endpoint: Telegram button taps never change ad accounting.
 */
export async function handleAdsgramCallback(request: Request, env: AdsgramCallbackEnv): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!env.WEBHOOK_SECRET) return new Response("callback verification is not configured", { status: 503 });
  const body = await request.text();
  const supplied = request.headers.get("X-AdsGram-Signature")?.replace(/^sha256=/i, "");
  if (!supplied || !secureEqual(supplied.toLowerCase(), await hmac(env.WEBHOOK_SECRET, body))) {
    return new Response("invalid signature", { status: 401 });
  }
  let event: AdsgramEvent;
  try { event = JSON.parse(body) as AdsgramEvent; } catch { return new Response("invalid payload", { status: 400 }); }
  const eventId = stringField(event.event_id ?? event.id, 128);
  const adId = stringField(event.ad_id, 128);
  const type = event.event ?? event.type;
  if (!eventId || !adId || (type !== "impression" && type !== "click" && type !== "payout")) {
    return new Response("invalid payload", { status: 400 });
  }
  const rawRevenue = event.amount_sats ?? event.revenue_sats ?? 0;
  const revenueSats = typeof rawRevenue === "number" && Number.isSafeInteger(rawRevenue) && rawRevenue >= 0 ? rawRevenue : null;
  if (revenueSats === null) return new Response("invalid payload", { status: 400 });
  if (!env.DB) return new Response("ad accounting is not ready", { status: 503 });
  try {
    const outcome = await new QuizPayStore(env.DB).recordAdsgramEvent(eventId, adId, type, revenueSats, now());
    return Response.json({ ok: true, replay: outcome === "replay" });
  } catch {
    return new Response("could not record event", { status: 503 });
  }
}
