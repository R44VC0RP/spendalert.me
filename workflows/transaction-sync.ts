import { sleep } from "workflow";
import { plaidClient } from "@/lib/plaid";
import { db, plaidItems, plaidAccounts, transactions } from "@/lib/db";
import { eq } from "drizzle-orm";
import type { Transaction as PlaidTransaction, RemovedTransaction } from "plaid";
import type { Transaction } from "@/lib/db/schema";
import { start } from "workflow/api";
import { sendTransactionAlertWorkflow } from "@/workflows/transaction-alert";

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

  // Step 3: Process added transactions
  const addedTransactions: Transaction[] = [];
  for (const tx of syncResult.added) {
    const dbTx = await upsertTransaction(tx, itemId);
    addedTransactions.push(dbTx);
  }

  // Step 4: Process modified transactions
  for (const tx of syncResult.modified) {
    await upsertTransaction(tx, itemId);
  }

  // Step 5: Process removed transactions
  for (const tx of syncResult.removed) {
    await deleteTransaction(tx.transaction_id);
  }

  // Step 6: Update cursor in database
  if (syncResult.cursor) {
    await updatePlaidItemCursor(itemId, syncResult.cursor);
  }

  // Step 7: Update account balances
  await updateAccountBalances(item.accessToken);

  // Step 8: Send alerts for new spending transactions
  const spendingTxs = addedTransactions.filter((tx) => parseFloat(tx.amount) > 0);
  
  if (spendingTxs.length > 0) {
    console.log(`[Workflow] Triggering alerts for ${spendingTxs.length} spending transactions`);
    
    // Start a separate workflow for each transaction alert (run in parallel)
    for (const tx of spendingTxs) {
      await start(sendTransactionAlertWorkflow, [tx]);
      
      // Small delay between starting alert workflows to avoid rate limiting
      if (spendingTxs.length > 1) {
        await sleep("1s");
      }
    }
  }

  return {
    success: true,
    added: syncResult.added.length,
    modified: syncResult.modified.length,
    removed: syncResult.removed.length,
    alertsSent: spendingTxs.length,
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
