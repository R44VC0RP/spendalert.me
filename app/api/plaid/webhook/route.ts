import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { db, plaidItems, plaidAccounts, transactions } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { Transaction as PlaidTransaction, RemovedTransaction } from "plaid";
import { processNewTransactions } from "@/lib/transaction-alerts";
import type { Transaction } from "@/lib/db/schema";

// Plaid webhook types
interface PlaidWebhook {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  initial_update_complete?: boolean;
  historical_update_complete?: boolean;
  error?: {
    error_code: string;
    error_message: string;
  };
}

// Simple in-memory lock to prevent concurrent syncs for the same item
// In production, you'd use Redis or a database lock
const syncLocks = new Map<string, number>();
const LOCK_TIMEOUT_MS = 60000; // 1 minute lock timeout

export async function POST(request: NextRequest) {
  try {
    const webhook: PlaidWebhook = await request.json();

    console.log("Received Plaid webhook:", {
      type: webhook.webhook_type,
      code: webhook.webhook_code,
      item_id: webhook.item_id,
    });

    // Handle TRANSACTIONS webhooks
    if (webhook.webhook_type === "TRANSACTIONS") {
      switch (webhook.webhook_code) {
        case "SYNC_UPDATES_AVAILABLE":
          // Primary webhook for transaction updates - always handle
          await handleSyncUpdatesAvailable(webhook.item_id);
          break;

        case "INITIAL_UPDATE":
        case "HISTORICAL_UPDATE":
        case "DEFAULT_UPDATE":
          // Legacy webhooks - skip if we're using SYNC_UPDATES_AVAILABLE
          // The cursor-based sync handles these automatically
          console.log(`Skipping legacy webhook ${webhook.webhook_code} - using SYNC_UPDATES_AVAILABLE instead`);
          break;

        case "TRANSACTIONS_REMOVED":
          // Handled via sync - removed transactions come back in sync response
          break;

        default:
          console.log("Unhandled TRANSACTIONS webhook code:", webhook.webhook_code);
      }
    }

    // Handle ITEM webhooks
    if (webhook.webhook_type === "ITEM") {
      switch (webhook.webhook_code) {
        case "ERROR":
          console.error("Plaid Item Error:", webhook.error);
          // Could update item status in DB or notify user
          break;

        case "PENDING_EXPIRATION":
          console.warn("Plaid Item pending expiration:", webhook.item_id);
          // User needs to re-authenticate
          break;

        default:
          console.log("Unhandled ITEM webhook code:", webhook.webhook_code);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error("Webhook error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Webhook processing failed";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

async function handleSyncUpdatesAvailable(itemId: string) {
  // Check if sync is already in progress for this item
  const existingLock = syncLocks.get(itemId);
  const now = Date.now();
  
  if (existingLock && (now - existingLock) < LOCK_TIMEOUT_MS) {
    console.log(`Skipping duplicate sync for item ${itemId} - sync already in progress`);
    return;
  }
  
  // Acquire lock
  syncLocks.set(itemId, now);
  
  try {
    // Get the item from database
    const item = await db.query.plaidItems.findFirst({
      where: eq(plaidItems.id, itemId),
    });

    if (!item) {
      console.error("Item not found:", itemId);
      return;
    }

    // Sync transactions with cursor-based pagination
    let cursor = item.cursor || undefined;
    let hasMore = true;
    let added: PlaidTransaction[] = [];
    let modified: PlaidTransaction[] = [];
    let removed: RemovedTransaction[] = [];

    while (hasMore) {
      const response = await plaidClient.transactionsSync({
        access_token: item.accessToken,
        cursor,
        count: 500, // Max per request
      });

      added = added.concat(response.data.added);
      modified = modified.concat(response.data.modified);
      removed = removed.concat(response.data.removed);

      hasMore = response.data.has_more;
      cursor = response.data.next_cursor;
    }

    console.log(
      `Synced transactions for item ${itemId}:`,
      `${added.length} added,`,
      `${modified.length} modified,`,
      `${removed.length} removed`
    );

    // Collect added transactions for alerting
    const addedTransactions: Transaction[] = [];

    // Process added transactions
    for (const tx of added) {
      const dbTx = await upsertTransaction(tx, itemId);
      addedTransactions.push(dbTx);
    }

    // Process modified transactions
    for (const tx of modified) {
      await upsertTransaction(tx, itemId);
    }

    // Process removed transactions
    for (const tx of removed) {
      await db.delete(transactions).where(eq(transactions.id, tx.transaction_id));
    }

    // Update cursor in database
    await db
      .update(plaidItems)
      .set({ cursor, updatedAt: new Date() })
      .where(eq(plaidItems.id, itemId));

    // Update account balances
    try {
      const accountsResponse = await plaidClient.accountsGet({
        access_token: item.accessToken,
      });

      for (const account of accountsResponse.data.accounts) {
        await db
          .update(plaidAccounts)
          .set({
            currentBalance: account.balances.current?.toString(),
            availableBalance: account.balances.available?.toString(),
            updatedAt: new Date(),
          })
          .where(eq(plaidAccounts.id, account.account_id));
      }
    } catch (e) {
      console.warn("Could not update account balances:", e);
    }

    // Send alerts for new transactions (only if there are added transactions)
    if (addedTransactions.length > 0) {
      try {
        await processNewTransactions(addedTransactions);
      } catch (e) {
        console.error("Failed to process transaction alerts:", e);
        // Don't throw - alerts failing shouldn't break the sync
      }
    }
  } finally {
    // Release lock
    syncLocks.delete(itemId);
  }
}

async function upsertTransaction(tx: PlaidTransaction, itemId: string): Promise<Transaction> {
  const location = tx.location;
  const category = tx.personal_finance_category;

  const values = {
    id: tx.transaction_id,
    accountId: tx.account_id,
    itemId,
    amount: tx.amount.toString(),
    isoCurrencyCode: tx.iso_currency_code,
    date: tx.date,
    datetime: tx.datetime ? new Date(tx.datetime) : null,
    name: tx.name,
    merchantName: tx.merchant_name,
    merchantEntityId: tx.merchant_entity_id,
    logoUrl: tx.logo_url,
    website: tx.website,
    paymentChannel: tx.payment_channel,
    primaryCategory: category?.primary,
    detailedCategory: category?.detailed,
    categoryIconUrl: tx.personal_finance_category_icon_url,
    pending: tx.pending,
    pendingTransactionId: tx.pending_transaction_id,
    accountOwner: tx.account_owner,
    transactionCode: tx.transaction_code,
    locationAddress: location?.address,
    locationCity: location?.city,
    locationRegion: location?.region,
    locationPostalCode: location?.postal_code,
    locationCountry: location?.country,
    locationLat: location?.lat?.toString(),
    locationLon: location?.lon?.toString(),
    locationStoreNumber: location?.store_number,
  };

  await db
    .insert(transactions)
    .values(values)
    .onConflictDoUpdate({
      target: transactions.id,
      set: {
        amount: tx.amount.toString(),
        date: tx.date,
        datetime: tx.datetime ? new Date(tx.datetime) : null,
        name: tx.name,
        merchantName: tx.merchant_name,
        merchantEntityId: tx.merchant_entity_id,
        logoUrl: tx.logo_url,
        website: tx.website,
        paymentChannel: tx.payment_channel,
        primaryCategory: category?.primary,
        detailedCategory: category?.detailed,
        categoryIconUrl: tx.personal_finance_category_icon_url,
        pending: tx.pending,
        pendingTransactionId: tx.pending_transaction_id,
        locationAddress: location?.address,
        locationCity: location?.city,
        locationRegion: location?.region,
        locationPostalCode: location?.postal_code,
        locationCountry: location?.country,
        locationLat: location?.lat?.toString(),
        locationLon: location?.lon?.toString(),
        locationStoreNumber: location?.store_number,
        updatedAt: new Date(),
      },
    });

  // Return the transaction in our DB format
  return {
    ...values,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Transaction;
}
