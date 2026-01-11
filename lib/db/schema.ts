import {
  pgTable,
  text,
  timestamp,
  numeric,
  boolean,
  index,
  integer,
} from "drizzle-orm/pg-core";

// ==========================================
// Better Auth Tables
// ==========================================

// User table (required by better-auth)
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Session table (required by better-auth)
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// Account table (required by better-auth for OAuth providers)
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Verification table (required by better-auth)
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Passkey table (required by @better-auth/passkey)
export const passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull().unique(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  aaguid: text("aaguid"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Types for auth tables
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Passkey = typeof passkey.$inferSelect;
export type NewPasskey = typeof passkey.$inferInsert;

// ==========================================
// Plaid Tables
// ==========================================

// Plaid Items (linked bank accounts)
export const plaidItems = pgTable("plaid_items", {
  id: text("id").primaryKey(), // Plaid item_id
  accessToken: text("access_token").notNull(),
  institutionId: text("institution_id"),
  institutionName: text("institution_name"),
  cursor: text("cursor"), // For transactions sync pagination
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Plaid Accounts (individual accounts within an item)
export const plaidAccounts = pgTable(
  "plaid_accounts",
  {
    id: text("id").primaryKey(), // Plaid account_id
    itemId: text("item_id")
      .references(() => plaidItems.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    officialName: text("official_name"),
    type: text("type").notNull(), // depository, credit, loan, investment, other
    subtype: text("subtype"), // checking, savings, credit card, etc.
    mask: text("mask"), // Last 4 digits
    currentBalance: numeric("current_balance"),
    availableBalance: numeric("available_balance"),
    isoCurrencyCode: text("iso_currency_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("plaid_accounts_item_id_idx").on(table.itemId)]
);

// Transactions
export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(), // Plaid transaction_id
    accountId: text("account_id")
      .references(() => plaidAccounts.id, { onDelete: "cascade" })
      .notNull(),
    itemId: text("item_id")
      .references(() => plaidItems.id, { onDelete: "cascade" })
      .notNull(),
    amount: numeric("amount").notNull(), // Positive = money out, negative = money in (Plaid convention)
    isoCurrencyCode: text("iso_currency_code"),
    date: text("date").notNull(), // YYYY-MM-DD
    datetime: timestamp("datetime"), // Full datetime if available
    name: text("name").notNull(), // Transaction description
    merchantName: text("merchant_name"),
    merchantEntityId: text("merchant_entity_id"),
    logoUrl: text("logo_url"),
    website: text("website"),
    paymentChannel: text("payment_channel"), // online, in store, other
    primaryCategory: text("primary_category"),
    detailedCategory: text("detailed_category"),
    categoryIconUrl: text("category_icon_url"),
    pending: boolean("pending").default(false).notNull(),
    pendingTransactionId: text("pending_transaction_id"),
    accountOwner: text("account_owner"),
    transactionCode: text("transaction_code"),
    // Location fields
    locationAddress: text("location_address"),
    locationCity: text("location_city"),
    locationRegion: text("location_region"),
    locationPostalCode: text("location_postal_code"),
    locationCountry: text("location_country"),
    locationLat: numeric("location_lat"),
    locationLon: numeric("location_lon"),
    locationStoreNumber: text("location_store_number"),
    // User-added metadata
    tags: text("tags"), // JSON array of user-defined tags
    notes: text("notes"), // User notes about the transaction
    attachments: text("attachments"), // JSON array of image URLs (receipts, screenshots, etc.)
    // Alert tracking - prevents duplicate notifications when pending->posted
    alertedAt: timestamp("alerted_at"), // When we sent an alert for this transaction (null = not alerted)
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("transactions_account_id_idx").on(table.accountId),
    index("transactions_item_id_idx").on(table.itemId),
    index("transactions_date_idx").on(table.date),
    index("transactions_pending_idx").on(table.pending),
  ]
);

// Types for insert/select
export type PlaidItem = typeof plaidItems.$inferSelect;
export type NewPlaidItem = typeof plaidItems.$inferInsert;
export type PlaidAccount = typeof plaidAccounts.$inferSelect;
export type NewPlaidAccount = typeof plaidAccounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

// ==========================================
// AI Conversation Tables
// ==========================================

// Conversations track ongoing AI chat threads
export const aiConversations = pgTable("ai_conversations", {
  id: text("id").primaryKey(), // UUID
  phoneNumber: text("phone_number").notNull(), // E.164 format
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Messages store the conversation history for context
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: text("id").primaryKey(), // UUID or Loop message_id
    conversationId: text("conversation_id")
      .references(() => aiConversations.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    // Optional: link to transaction that triggered this message
    transactionId: text("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    loopMessageId: text("loop_message_id"), // Loop's message_id for tracking
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("ai_messages_conversation_id_idx").on(table.conversationId),
    index("ai_messages_created_at_idx").on(table.createdAt),
  ]
);

// Pending messages queue - one row per inbound message for atomic claim pattern
export const pendingMessages = pgTable(
  "pending_messages",
  {
    id: text("id").primaryKey(), // UUID
    phoneNumber: text("phone_number").notNull(),
    loopMessageId: text("loop_message_id").notNull(), // Loop's message_id
    text: text("text"), // Message text (can be null for image-only)
    imageUrls: text("image_urls"), // JSON array of image URLs
    isReaction: boolean("is_reaction").default(false).notNull(),
    reactionType: text("reaction_type"), // love, like, laugh, etc.
    processedAt: timestamp("processed_at"), // When claimed/processed (null = pending)
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("pending_messages_phone_idx").on(table.phoneNumber),
    index("pending_messages_processed_idx").on(table.processedAt),
    index("pending_messages_created_idx").on(table.createdAt),
  ]
);

// Types for AI tables
export type AiConversation = typeof aiConversations.$inferSelect;
export type NewAiConversation = typeof aiConversations.$inferInsert;
export type AiMessage = typeof aiMessages.$inferSelect;
export type NewAiMessage = typeof aiMessages.$inferInsert;
export type PendingMessage = typeof pendingMessages.$inferSelect;
export type NewPendingMessage = typeof pendingMessages.$inferInsert;

// ==========================================
// WHOOP Integration Tables
// ==========================================

// WHOOP OAuth tokens - stores access/refresh tokens per user
export const whoopTokens = pgTable("whoop_tokens", {
  id: text("id").primaryKey(), // WHOOP user_id
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  scopes: text("scopes").notNull(), // Space-separated scopes
  // Link to our user (optional - for multi-user support)
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// WHOOP sleep records - cache sleep data for analysis
export const whoopSleep = pgTable(
  "whoop_sleep",
  {
    id: text("id").primaryKey(), // WHOOP sleep UUID
    whoopUserId: text("whoop_user_id")
      .references(() => whoopTokens.id, { onDelete: "cascade" })
      .notNull(),
    cycleId: integer("cycle_id"),
    start: timestamp("start").notNull(),
    end: timestamp("end").notNull(),
    timezoneOffset: text("timezone_offset"),
    isNap: boolean("is_nap").default(false).notNull(),
    scoreState: text("score_state"), // SCORED, PENDING_SCORE, etc.
    // Sleep scores
    sleepPerformance: numeric("sleep_performance"), // percentage
    sleepConsistency: numeric("sleep_consistency"), // percentage
    sleepEfficiency: numeric("sleep_efficiency"), // percentage
    respiratoryRate: numeric("respiratory_rate"),
    // Stage durations (milliseconds)
    totalInBedTime: integer("total_in_bed_time"),
    totalAwakeTime: integer("total_awake_time"),
    totalLightSleep: integer("total_light_sleep"),
    totalSlowWaveSleep: integer("total_slow_wave_sleep"),
    totalRemSleep: integer("total_rem_sleep"),
    sleepCycleCount: integer("sleep_cycle_count"),
    disturbanceCount: integer("disturbance_count"),
    // Sleep need (milliseconds)
    sleepNeededBaseline: integer("sleep_needed_baseline"),
    sleepNeededFromDebt: integer("sleep_needed_from_debt"),
    sleepNeededFromStrain: integer("sleep_needed_from_strain"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("whoop_sleep_user_id_idx").on(table.whoopUserId),
    index("whoop_sleep_start_idx").on(table.start),
  ]
);

// WHOOP recovery records
export const whoopRecovery = pgTable(
  "whoop_recovery",
  {
    id: text("id").primaryKey(), // cycle_id as string
    whoopUserId: text("whoop_user_id")
      .references(() => whoopTokens.id, { onDelete: "cascade" })
      .notNull(),
    cycleId: integer("cycle_id").notNull(),
    sleepId: text("sleep_id"),
    scoreState: text("score_state"),
    // Recovery scores
    recoveryScore: integer("recovery_score"), // 0-100
    restingHeartRate: integer("resting_heart_rate"),
    hrvRmssd: numeric("hrv_rmssd"), // Heart rate variability
    spo2Percentage: numeric("spo2_percentage"),
    skinTempCelsius: numeric("skin_temp_celsius"),
    userCalibrating: boolean("user_calibrating").default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("whoop_recovery_user_id_idx").on(table.whoopUserId),
    index("whoop_recovery_cycle_id_idx").on(table.cycleId),
  ]
);

// Types for WHOOP tables
export type WhoopToken = typeof whoopTokens.$inferSelect;
export type NewWhoopToken = typeof whoopTokens.$inferInsert;
export type WhoopSleep = typeof whoopSleep.$inferSelect;
export type NewWhoopSleep = typeof whoopSleep.$inferInsert;
export type WhoopRecovery = typeof whoopRecovery.$inferSelect;
export type NewWhoopRecovery = typeof whoopRecovery.$inferInsert;
