/**
 * Tiny D1 repository for durable application records. D1 is a Workers-native,
 * persistent store; callers address every record through indexed keys and never
 * enumerate the keyspace. The Node replay harness intentionally has no D1, so
 * it receives a null repository and can exercise the UI without fake data.
 */
export interface D1Result<T = unknown> {
  results?: T[];
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export interface QuizUser {
  telegramId: number;
  displayName: string;
  score: number;
  walletAddress: string | null;
  playsToday: number;
  playsDay: string;
}

export interface Payout {
  id: string;
  amount: number;
  status: "pending" | "approved" | "paid" | "failed" | "disputed";
  txId: string | null;
  timestamp: number;
}

export interface AdMetrics {
  adId: string;
  impressions: number;
  clicks: number;
  revenueSats: number;
  timestamp: number;
}

export class QuizPayStore {
  constructor(private readonly db: D1Database) {}

  async ready(): Promise<void> {
    await this.db.prepare("CREATE TABLE IF NOT EXISTS quizpay_users (telegram_id INTEGER PRIMARY KEY, display_name TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0, wallet_address TEXT, plays_day TEXT NOT NULL, plays_today INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)").run();
    await this.db.prepare("CREATE TABLE IF NOT EXISTS quizpay_payouts (id TEXT PRIMARY KEY, telegram_id INTEGER NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, tx_id TEXT, timestamp INTEGER NOT NULL)").run();
    await this.db.prepare("CREATE INDEX IF NOT EXISTS quizpay_payouts_user_time ON quizpay_payouts (telegram_id, timestamp DESC)").run();
    await this.db.prepare("CREATE TABLE IF NOT EXISTS quizpay_ads (ad_id TEXT PRIMARY KEY, impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, revenue_sats INTEGER NOT NULL DEFAULT 0, timestamp INTEGER NOT NULL)").run();
    // Existing deployments may have been created before revenue accounting was
    // added. D1 accepts this migration once; a duplicate-column error is safe.
    try { await this.db.prepare("ALTER TABLE quizpay_ads ADD COLUMN revenue_sats INTEGER NOT NULL DEFAULT 0").run(); } catch { /* already migrated */ }
    await this.db.prepare("CREATE TABLE IF NOT EXISTS quizpay_ad_events (event_id TEXT PRIMARY KEY, ad_id TEXT NOT NULL, event_type TEXT NOT NULL, timestamp INTEGER NOT NULL)").run();
  }

  async user(id: number, name: string, day: string, timestamp: number): Promise<QuizUser> {
    await this.ready();
    const current = await this.db.prepare("SELECT telegram_id AS telegramId, display_name AS displayName, score, wallet_address AS walletAddress, plays_today AS playsToday, plays_day AS playsDay FROM quizpay_users WHERE telegram_id = ?").bind(id).first<QuizUser>();
    if (!current) {
      await this.db.prepare("INSERT INTO quizpay_users (telegram_id, display_name, score, wallet_address, plays_day, plays_today, updated_at) VALUES (?, ?, 0, NULL, ?, 0, ?)").bind(id, name, day, timestamp).run();
      return { telegramId: id, displayName: name, score: 0, walletAddress: null, playsToday: 0, playsDay: day };
    }
    if (current.playsDay !== day) {
      await this.db.prepare("UPDATE quizpay_users SET display_name = ?, plays_day = ?, plays_today = 0, updated_at = ? WHERE telegram_id = ?").bind(name, day, timestamp, id).run();
      return { ...current, displayName: name, playsDay: day, playsToday: 0 };
    }
    return current;
  }

  async startPlay(id: number, name: string, day: string, timestamp: number, limit: number): Promise<QuizUser | null> {
    const user = await this.user(id, name, day, timestamp);
    if (user.playsToday >= limit) return null;
    await this.db.prepare("UPDATE quizpay_users SET plays_today = plays_today + 1, updated_at = ? WHERE telegram_id = ?").bind(timestamp, id).run();
    return { ...user, playsToday: user.playsToday + 1 };
  }

  async addScore(id: number, timestamp: number): Promise<number> {
    await this.db.prepare("UPDATE quizpay_users SET score = score + 1, updated_at = ? WHERE telegram_id = ?").bind(timestamp, id).run();
    const user = await this.db.prepare("SELECT score FROM quizpay_users WHERE telegram_id = ?").bind(id).first<{ score: number }>();
    return user?.score ?? 0;
  }

  async setWallet(id: number, wallet: string, timestamp: number): Promise<void> {
    await this.db.prepare("UPDATE quizpay_users SET wallet_address = ?, updated_at = ? WHERE telegram_id = ?").bind(wallet, timestamp, id).run();
  }

  async payouts(id: number): Promise<Payout[]> {
    const result = await this.db.prepare("SELECT id, amount, status, tx_id AS txId, timestamp FROM quizpay_payouts WHERE telegram_id = ? ORDER BY timestamp DESC LIMIT 10").bind(id).all<Payout>();
    return result.results ?? [];
  }

  async createPayout(id: string, telegramId: number, amount: number, timestamp: number): Promise<void> {
    await this.db.prepare("INSERT INTO quizpay_payouts (id, telegram_id, amount, status, tx_id, timestamp) VALUES (?, ?, ?, 'pending', NULL, ?)").bind(id, telegramId, amount, timestamp).run();
  }

  async recordAdsgramEvent(eventId: string, adId: string, eventType: "impression" | "click" | "payout", revenueSats: number, timestamp: number): Promise<"recorded" | "replay"> {
    await this.ready();
    // INSERT OR IGNORE makes delivery retries safe even when two callback
    // requests race each other; D1 reports the affected-row count in meta.
    const inserted = await this.db.prepare("INSERT OR IGNORE INTO quizpay_ad_events (event_id, ad_id, event_type, timestamp) VALUES (?, ?, ?, ?)").bind(eventId, adId, eventType, timestamp).run() as { meta?: { changes?: number } };
    if (inserted.meta?.changes !== 1) return "replay";
    const impressions = eventType === "impression" ? 1 : 0;
    const clicks = eventType === "click" ? 1 : 0;
    const revenue = eventType === "payout" ? revenueSats : 0;
    await this.db.prepare("INSERT INTO quizpay_ads (ad_id, impressions, clicks, revenue_sats, timestamp) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ad_id) DO UPDATE SET impressions = impressions + excluded.impressions, clicks = clicks + excluded.clicks, revenue_sats = revenue_sats + excluded.revenue_sats, timestamp = excluded.timestamp").bind(adId, impressions, clicks, revenue, timestamp).run();
    return "recorded";
  }

  async adMetrics(adId: string): Promise<AdMetrics | null> {
    await this.ready();
    return this.db.prepare("SELECT ad_id AS adId, impressions, clicks, revenue_sats AS revenueSats, timestamp FROM quizpay_ads WHERE ad_id = ?").bind(adId).first<AdMetrics>();
  }
}

export function persistentStore(env: unknown): QuizPayStore | null {
  const db = (env as { DB?: D1Database } | undefined)?.DB;
  return db ? new QuizPayStore(db) : null;
}
