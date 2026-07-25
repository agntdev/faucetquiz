import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now, dayKey } from "../clock.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { DAILY_LIMIT, REWARD_SATS, sats, storeFor, userDetails } from "../quizpay-shared.js";

registerMainMenuItem({ label: "🎮 Play", data: "quiz:start", order: 10 });

const composer = new Composer<Ctx>();

function pick(max: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % max;
}

function question() {
  const left = 2 + pick(18);
  const right = 2 + pick(18);
  const answer = left + right;
  const wrong = [answer - 2, answer + 1, answer + 3].map((n) => Math.max(0, n));
  const choices = [answer, ...wrong].sort(() => pick(2) - 1).map(String);
  return { text: `Quick quiz! What is ${left} + ${right}?`, choices, correctIndex: choices.indexOf(String(answer)) };
}

function questionKeyboard(choices: string[]) {
  return inlineKeyboard(choices.map((choice, index) => [inlineButton(choice, `quiz:answer:${index}`)]));
}

composer.callbackQuery("quiz:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = userDetails(ctx);
  const store = storeFor(ctx);
  if (!user || !store) {
    await ctx.editMessageText("Rewards are getting connected here. Come back in a little while!", { reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]) });
    return;
  }
  let allowed: boolean;
  try {
    allowed = (await store.startPlay(user.id, user.name, dayKey(), now(), DAILY_LIMIT)) !== null;
  } catch {
    await ctx.editMessageText("I couldn't save your play right now. Give it another tap soon!", { reply_markup: inlineKeyboard([[inlineButton("🎮 Play", "quiz:start")]]) });
    return;
  }
  if (!allowed) {
    await ctx.editMessageText("You’ve played 100 quizzes today — amazing stamina! Come back tomorrow for more.", { reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]) });
    return;
  }
  const next = question();
  ctx.session.quiz = { ...next, answered: false, createdAt: now() };
  await ctx.editMessageText(next.text, { reply_markup: questionKeyboard(next.choices) });
});

composer.callbackQuery(/^quiz:answer:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const quiz = ctx.session.quiz;
  const selected = Number(ctx.callbackQuery.data.split(":")[2]);
  if (!quiz || now() - quiz.createdAt > 10 * 60 * 1000) {
    await ctx.editMessageText("That question has cooled off. Tap Play for a fresh one!", { reply_markup: inlineKeyboard([[inlineButton("🎮 Play", "quiz:start")]]) });
    return;
  }
  if (quiz.answered) {
    await ctx.answerCallbackQuery({ text: "That answer is already in — tap Play for another!" });
    return;
  }
  quiz.answered = true;
  ctx.session.quiz = quiz;
  if (selected !== quiz.correctIndex) {
    await ctx.editMessageText(`Nice try! The answer was ${quiz.choices[quiz.correctIndex]}.`, { reply_markup: inlineKeyboard([[inlineButton("🎮 Play again", "quiz:complete")]]) });
    return;
  }
  const user = userDetails(ctx);
  const store = storeFor(ctx);
  if (!user || !store) {
    await ctx.editMessageText("You got it! I couldn't bank that reward just now, so it wasn't counted.", { reply_markup: inlineKeyboard([[inlineButton("🎮 Play again", "quiz:complete")]]) });
    return;
  }
  try {
    const score = await store.addScore(user.id, now());
    await ctx.editMessageText(`You nailed it! +${sats(REWARD_SATS)} earned. Your score is ${score}.`, { reply_markup: inlineKeyboard([[inlineButton("🎮 Next quiz", "quiz:complete")]]) });
  } catch {
    await ctx.editMessageText("You got it! I couldn't bank that reward just now, so it wasn't counted.", { reply_markup: inlineKeyboard([[inlineButton("🎮 Play again", "quiz:complete")]]) });
  }
});

composer.callbackQuery("quiz:complete", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("A quick AdsGram break helps keep your rewards rolling. It’s counted securely by AdsGram’s server callback — then you can keep playing!", { reply_markup: inlineKeyboard([[inlineButton("🎮 Continue", "quiz:start")]]) });
});

export default composer;
