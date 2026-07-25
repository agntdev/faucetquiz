import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { sats, loadUser, storeFor, userDetails } from "../quizpay-shared.js";

registerMainMenuItem({ label: "📊 My progress", data: "profile:show", order: 20 });
const composer = new Composer<Ctx>();

async function profileText(ctx: Ctx): Promise<string> {
  const user = await loadUser(ctx);
  const details = userDetails(ctx);
  const store = storeFor(ctx);
  if (!user || !details || !store) return "Your rewards profile is getting connected. Come back soon!";
  const payouts = await store.payouts(details.id);
  const latest = payouts[0];
  const wallet = user.walletAddress ? "Wallet saved" : "No wallet yet";
  const payoutLine = latest ? `Latest withdrawal: ${sats(latest.amount)} · ${latest.status}` : "No withdrawals yet — earn rewards, then tap Withdraw!";
  return `You’ve earned ${user.score} quiz rewards.\n${wallet}.\n${payoutLine}`;
}

async function showProfile(ctx: Ctx, edit: boolean): Promise<void> {
  let text: string;
  try { text = await profileText(ctx); } catch { text = "I couldn't load your progress right now. Give it another tap soon!"; }
  const markup = inlineKeyboard([[inlineButton("💸 Withdraw", "payout:init")], [inlineButton("⬅️ Menu", "menu:main")]]);
  if (edit) await ctx.editMessageText(text, { reply_markup: markup });
  else await ctx.reply(text, { reply_markup: markup });
}

composer.callbackQuery("profile:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showProfile(ctx, true);
});

export default composer;
