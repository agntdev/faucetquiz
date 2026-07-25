import type { Ctx } from "./bot.js";
import { dayKey, now } from "./clock.js";
import { persistentStore } from "./toolkit/persistent.js";

export const REWARD_SATS = 100;
export const DAILY_LIMIT = 100;

export function userDetails(ctx: Ctx): { id: number; name: string } | null {
  const from = ctx.from;
  if (!from) return null;
  return { id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(" ") || "Quiz player" };
}

export function storeFor(ctx: Ctx) {
  return persistentStore((ctx as Ctx & { env?: unknown }).env);
}

export async function loadUser(ctx: Ctx) {
  const user = userDetails(ctx);
  const store = storeFor(ctx);
  if (!user || !store) return null;
  return store.user(user.id, user.name, dayKey(), now());
}

export function sats(amount: number): string {
  return `${amount} sats`;
}
