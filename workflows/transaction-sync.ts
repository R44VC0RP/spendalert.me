import { sleep } from "workflow";
import { plaidClient } from "@/lib/plaid";
import { db, plaidItems, plaidAccounts, transactions } from "@/lib/db";
import { eq, and, inArray, isNull, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Transaction as PlaidTransaction, RemovedTransaction } from "plaid";
import type { Transaction } from "@/lib/db/schema";
import { sendTransactionAlert } from "@/lib/loop";
import {
  generateSingleTransactionAlert,
  getOrCreateConversation,
  saveMessage,
} from "@/lib/ai/agent";

/**
 * Workflow to sync transactions from Plaid when SYNC_UPDATES_AVAILABLE webhook fires.
 * This is durable - if it fails mid-sync, it can resume from where it left off.
 */
export async function transactionSyncWorkflow(itemId: string) {
  "use workflow";

  console.log(`[Workflow] Starting transaction sync for item: ${itemId}`);

  // Step 1: Get the item from database
  const item = await getPlaidItem(itemId);
  
  if (!item) {
    console.error(`[Workflow] Item not found: ${itemId}`);
    return { success: false, error: "Item not found" };
  }

  // Step 2: Sync transactions from Plaid (paginated)
  const syncResult = await syncTransactionsFromPlaid(item.accessToken, item.cursor);

  console.log(
    `[Workflow] Synced transactions for item ${itemId}:`,
    `${syncResult.added.length} added,`,
    `${syncResult.modified.length} modified,`,
    `${syncResult.removed.length} removed`
  );

  // Step 3: Update cursor IMMEDIATELY to prevent duplicate processing by parallel workflows
  // This must happen before processing transactions to avoid race conditions
  if (syncResult.cursor) {
    await updatePlaidItemCursor(itemId, syncResult.cursor);
  }

  // Step 4: Process added transactions
  const addedTransactionIds: string[] = [];
  for (const tx of syncResult.added) {
    await upsertTransaction(tx, itemId);
    addedTransactionIds.push(tx.transaction_id);
  }

  // Step 5: Process modified transactions
  for (const tx of syncResult.modified) {
    await upsertTransaction(tx, itemId);
  }

  // Step 6: Process removed transactions
  for (const tx of syncResult.removed) {
    await deleteTransaction(tx.transaction_id);
  }

  // Step 7: Update account balances
  await updateAccountBalances(item.accessToken);

  // Step 8: Send alerts for new spending transactions that haven't been alerted yet
  // IMPORTANT: We fetch fresh data from DB to get accurate alertedAt status
  // This prevents duplicate alerts when multiple workflow instances run in parallel
  const unalertedTxs = await getUnalertedSpendingTransactions(addedTransactionIds);
  
  console.log(`[Workflow] Found ${unalertedTxs.length} unalerted spending transactions from ${addedTransactionIds.length} added`);
  
  if (unalertedTxs.length > 0) {
    console.log(`[Workflow] Triggering alerts for ${unalertedTxs.length} new spending transactions`);
    
    // Get conversation once for all alerts
    const conversationId = await getConversationForAlerts();
    
    // Send alert for each transaction
    for (const tx of unalertedTxs) {
      // Double-check alertedAt right before sending to prevent race conditions
      const stillUnalerted = await tryClaimTransactionForAlert(tx.id);
      
      if (!stillUnalerted) {
        console.log(`[Workflow] Transaction ${tx.id} was already claimed by another workflow, skipping`);
        continue;
      }
      
      const alertSent = await sendSingleTransactionAlert(tx, conversationId);
      
      // Mark as alerted if we sent an alert (already claimed above)
      if (!alertSent) {
        // If alert failed, unmark the transaction so it can be retried
        await unmarkTransactionAlerted(tx.id);
      }
      
      // Small delay between alerts to avoid rate limiting
      if (unalertedTxs.length > 1) {
        await sleep("1s");
      }
    }
  }

  return {
    success: true,
    added: syncResult.added.length,
    modified: syncResult.modified.length,
    removed: syncResult.removed.length,
    alertsSent: unalertedTxs.length,
  };
}

// === Steps ===

async function getPlaidItem(itemId: string) {
  "use step";
  
  return db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, itemId),
  });
}

async function syncTransactionsFromPlaid(accessToken: string, startCursor: string | null) {
  "use step";
  
  let cursor = startCursor || undefined;
  let hasMore = true;
  let added: PlaidTransaction[] = [];
  let modified: PlaidTransaction[] = [];
  let removed: RemovedTransaction[] = [];

  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500, // Max per request
    });

    added = added.concat(response.data.added);
    modified = modified.concat(response.data.modified);
    removed = removed.concat(response.data.removed);

    hasMore = response.data.has_more;
    cursor = response.data.next_cursor;
  }

  return { added, modified, removed, cursor };
}

async function upsertTransaction(tx: PlaidTransaction, itemId: string): Promise<Transaction> {
  "use step";
  
  const location = tx.location;
  const category = tx.personal_finance_category;

  // Check if this is a posted transaction that replaces a pending one
  // If so, inherit the alertedAt from the pending transaction to avoid duplicate alerts
  let inheritedAlertedAt: Date | null = null;
  if (tx.pending_transaction_id) {
    const pendingTx = await db.query.transactions.findFirst({
      where: eq(transactions.id, tx.pending_transaction_id),
      columns: { alertedAt: true },
    });
    if (pendingTx?.alertedAt) {
      inheritedAlertedAt = pendingTx.alertedAt;
      console.log(`[Workflow] Inheriting alertedAt from pending tx ${tx.pending_transaction_id}`);
    }
  }

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
    alertedAt: inheritedAlertedAt,
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
        // Note: we don't update alertedAt on conflict - preserve existing value
      },
    });

  return {
    ...values,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Transaction;
}

async function deleteTransaction(transactionId: string) {
  "use step";
  
  await db.delete(transactions).where(eq(transactions.id, transactionId));
}

async function updatePlaidItemCursor(itemId: string, cursor: string) {
  "use step";
  
  await db
    .update(plaidItems)
    .set({ cursor, updatedAt: new Date() })
    .where(eq(plaidItems.id, itemId));
}

async function updateAccountBalances(accessToken: string) {
  "use step";
  
  try {
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
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
    console.warn("[Workflow] Could not update account balances:", e);
    // Don't throw - this is non-critical
  }
}

const ALERT_RECIPIENT = process.env.LOOP_RECIPIENT_PHONE || "+19046086893";

async function getConversationForAlerts(): Promise<string> {
  "use step";
  
  return getOrCreateConversation(ALERT_RECIPIENT);
}

async function sendSingleTransactionAlert(tx: Transaction, conversationId: string): Promise<boolean> {
  "use step";
  
  const merchant = tx.merchantName || tx.name;
  const amount = parseFloat(tx.amount);

  console.log(`[Workflow] Sending alert for: $${amount.toFixed(2)} at ${merchant}`);

  // Generate AI alert message
  const alertMessage = await generateSingleTransactionAlert(tx);

  if (!alertMessage) {
    console.log(`[Workflow] AI generated empty alert for ${merchant}, skipping`);
    return false;
  }

  // Send the alert via Loop/iMessage
  const sendResult = await sendTransactionAlert(ALERT_RECIPIENT, alertMessage);

  // Save to conversation history
  await saveMessage(conversationId, "assistant", alertMessage, sendResult.message_id, tx.id);

  console.log(`[Workflow] Alert sent for ${merchant}:`, {
    messageId: sendResult.message_id,
    success: sendResult.success,
  });

  return true;
}

async function markTransactionAlerted(transactionId: string): Promise<void> {
  "use step";
  
  await db
    .update(transactions)
    .set({ alertedAt: new Date() })
    .where(eq(transactions.id, transactionId));
  
  console.log(`[Workflow] Marked transaction ${transactionId} as alerted`);
}

/**
 * Get spending transactions that haven't been alerted yet.
 * Fetches fresh data from DB to ensure we have accurate alertedAt status.
 */
async function getUnalertedSpendingTransactions(transactionIds: string[]): Promise<Transaction[]> {
  "use step";
  
  if (transactionIds.length === 0) {
    return [];
  }
  
  // Fetch transactions from DB with current alertedAt status
  // Filter to: spending (amount > 0), not alerted, and in our list of IDs
  return db
    .select()
    .from(transactions)
    .where(
      and(
        inArray(transactions.id, transactionIds),
        gt(sql`CAST(${transactions.amount} AS DECIMAL)`, 0),
        isNull(transactions.alertedAt)
      )
    );
}

/**
 * Atomically claim a transaction for alerting.
 * Uses UPDATE ... WHERE alertedAt IS NULL to ensure only one workflow wins.
 * Returns true if we successfully claimed the transaction.
 */
async function tryClaimTransactionForAlert(transactionId: string): Promise<boolean> {
  "use step";
  
  const result = await db
    .update(transactions)
    .set({ alertedAt: new Date() })
    .where(
      and(
        eq(transactions.id, transactionId),
        isNull(transactions.alertedAt)
      )
    );
  
  // If rowsAffected is 1, we successfully claimed it
  // Note: Drizzle doesn't expose rowsAffected easily, so we check if the tx is now alerted
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
    columns: { alertedAt: true },
  });
  
  const claimed = tx?.alertedAt !== null;
  if (claimed) {
    console.log(`[Workflow] Claimed transaction ${transactionId} for alerting`);
  }
  
  return claimed;
}

/**
 * Unmark a transaction as alerted (used when alert fails).
 */
async function unmarkTransactionAlerted(transactionId: string): Promise<void> {
  "use step";
  
  await db
    .update(transactions)
    .set({ alertedAt: null })
    .where(eq(transactions.id, transactionId));
  
  console.log(`[Workflow] Unmarked transaction ${transactionId} as alerted (alert failed)`);
}
