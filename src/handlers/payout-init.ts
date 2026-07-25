import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { dayKey, now } from "../clock.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { REWARD_SATS, sats, storeFor, userDetails } from "../quizpay-shared.js";

registerMainMenuItem({ label: "💸 Withdraw", data: "payout:init", order: 30 });

const composer = new Composer<Ctx>();
const walletPrompt = { force_reply: true, input_field_placeholder: "Paste your BTC wallet address" } as const;

function walletLooksValid(value: string): boolean {
  return /^(bc1[ac-hj-np-z02-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(value);
}

function payoutId(userId: number): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `p${userId.toString(36)}${bytes[0].toString(36)}${bytes[1].toString(36)}`;
}

async function requestPayout(ctx: Ctx): Promise<void> {
  const user = userDetails(ctx);
  const store = storeFor(ctx);
  if (!user || !store) {
    await ctx.reply("Withdrawals are getting connected here. Please try again a little later!");
    return;
  }
  try {
    const profile = await store.user(user.id, user.name, dayKey(), now());
    if (!profile.walletAddress) {
      ctx.session.step = "awaiting_wallet";
      ctx.session.stepStartedAt = now();
      await ctx.reply("First, send the BTC wallet address where you’d like rewards to land.", { reply_markup: walletPrompt });
      return;
    }
    const history = await store.payouts(user.id);
    const held = history.filter((p) => p.status === "pending" || p.status === "approved" || p.status === "paid").reduce((sum, p) => sum + p.amount, 0);
    const eligible = profile.score * REWARD_SATS - held;
    if (eligible <= 0) {
      await ctx.reply("No rewards are ready to withdraw yet — play a quiz to earn some!");
      return;
    }
    await store.createPayout(payoutId(user.id), user.id, eligible, now());
    await ctx.reply(`Your ${sats(eligible)} withdrawal is queued for approval. I’ll confirm it here once it’s sent!`, { reply_markup: inlineKeyboard([[inlineButton("📊 View profile", "profile:show")]]) });
  } catch {
    await ctx.reply("I couldn't create that withdrawal right now. Tap Withdraw again in a moment.");
  }
}

composer.callbackQuery("payout:init", async (ctx) => {
  await ctx.answerCallbackQuery();
  await requestPayout(ctx);
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_wallet") return next();
  if (ctx.message.text.startsWith("/start") || ctx.message.text.startsWith("/help")) return next();
  if (ctx.session.stepStartedAt && now() - ctx.session.stepStartedAt > 5 * 60 * 1000) {
    ctx.session.step = undefined;
    ctx.session.stepStartedAt = undefined;
    await ctx.reply("That wallet step timed out. Tap Withdraw when you’re ready to try again!");
    return;
  }
  const wallet = ctx.message.text.trim();
  if (!walletLooksValid(wallet)) {
    await ctx.reply("That doesn’t look like a BTC wallet address. Check it and send it again.", { reply_markup: walletPrompt });
    return;
  }
  const user = userDetails(ctx);
  const store = storeFor(ctx);
  if (!user || !store) {
    ctx.session.step = undefined;
    ctx.session.stepStartedAt = undefined;
    await ctx.reply("I couldn't save that wallet yet. Please try Withdraw again soon.");
    return;
  }
  try {
    await store.user(user.id, user.name, dayKey(), now());
    await store.setWallet(user.id, wallet, now());
    ctx.session.step = undefined;
    ctx.session.stepStartedAt = undefined;
    await ctx.reply("Your wallet is saved safely. Let’s get your rewards moving!");
    await requestPayout(ctx);
  } catch {
    await ctx.reply("I couldn't save that wallet yet. Please try Withdraw again soon.");
  }
});

/** A retry button remains useful after a transient storage or payment-review failure. */
composer.callbackQuery("payout:retry", async (ctx) => {
  await ctx.answerCallbackQuery();
  await requestPayout(ctx);
});

export default composer;
