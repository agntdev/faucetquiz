# QuizPay — Bot specification

**Archetype:** custom

**Voice:** playful and encouraging — write every user-facing message, button label, error, and empty state in this voice.

A Telegram quiz bot where users answer trivia questions to earn micro crypto rewards via FaucetPay, with AdsGram monetization between games. Tracks scores, payout history, and daily quizzes with anti-abuse rate limits.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- general Telegram users
- crypto enthusiasts
- quiz/trivia players

## Success criteria

- Users receive crypto rewards for correct answers
- Ad impressions/clicks tracked for revenue
- Payout requests processed with status tracking

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with play/history options
- **Play** (button, actor: user, callback: quiz:start) — Begin quiz session with random question
  - inputs: Telegram user ID
  - outputs: Question with multiple-choice buttons
- **/profile** (command, actor: user, command: /profile) — View score history and payout status
- **Withdraw** (button, actor: user, callback: payout:init) — Initiate crypto withdrawal request

## Flows

### Quiz Session
_Trigger:_ quiz:start

1. Display question with choices
2. Validate answer selection
3. Show feedback and update score
4. Display reward if correct

_Data touched:_ Quiz Session, User Score

### Payout Request
_Trigger:_ payout:init

1. Verify wallet address
2. Calculate eligible amount
3. Initiate FaucetPay transaction
4. Notify admin on failure

_Data touched:_ Payout Record

### Ad Insertion
_Trigger:_ quiz:complete

1. Show AdsGram ad
2. Track impressions/clicks
3. Resume quiz button

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Telegram user profile with quiz stats and wallet address
  - fields: telegram_id, display_name, score, wallet_address, payout_history
- **Quiz Session** _(retention: session)_ — Active question with choices and correct answer
  - fields: question_text, choices, correct_index, timestamp
- **Payout Record** _(retention: persistent)_ — Crypto withdrawal requests and status tracking
  - fields: amount, status, tx_id, timestamp
- **Ad Placement** _(retention: persistent)_ — AdsGram ad impressions and clicks
  - fields: ad_id, impressions, clicks, timestamp

## Integrations

- **FaucetPay** (required) — Crypto micro-payouts for correct answers
- **AdsGram** (required) — Monetization through quiz ad placements
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure reward amounts per question
- Set daily play limits
- Approve/dispute payout requests
- Monitor ad performance metrics

## Notifications

- Payout failure alerts to admin
- Ad performance daily summary
- User withdrawal confirmation

## Permissions & privacy

- Telegram account linking required
- Wallet address stored for payouts
- Score history retained for 90 days

## Edge cases

- Users selecting multiple answers
- FaucetPay transaction failures
- Rate limit violations
- Ad block detection

## Required tests

- End-to-end quiz flow with payout
- Ad insertion between games
- Payout retry logic

## Assumptions

- Fixed 0.000001 BTC-equivalent per correct answer
- Manual payout approval by default
- Basic rate limits (100 plays/day)
