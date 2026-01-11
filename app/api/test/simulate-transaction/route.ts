import { NextRequest, NextResponse } from "next/server";
import { processNewTransactions } from "@/lib/transaction-alerts";
import type { Transaction } from "@/lib/db/schema";

function createFakeTransaction(
  merchantName: string,
  amount: number,
  category: string,
  datetime: Date
): Transaction {
  return {
    id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    accountId: "test_account",
    itemId: "test_item",
    amount: amount.toString(),
    isoCurrencyCode: "USD",
    date: datetime.toISOString().split("T")[0],
    datetime,
    name: merchantName,
    merchantName: merchantName,
    merchantEntityId: null,
    logoUrl: null,
    website: null,
    paymentChannel: "in store",
    primaryCategory: category,
    detailedCategory: category,
    categoryIconUrl: null,
    pending: false,
    pendingTransactionId: null,
    accountOwner: null,
    transactionCode: null,
    locationAddress: null,
    locationCity: "Jacksonville",
    locationRegion: "FL",
    locationPostalCode: null,
    locationCountry: "US",
    locationLat: null,
    locationLon: null,
    locationStoreNumber: null,
    tags: null,
    notes: null,
    attachments: null,
    alertedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Simulate a new transaction sync for testing alerts
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scenario = body.scenario || "single";

    let transactionsToProcess: Transaction[] = [];

    if (scenario === "starbucks-day") {
      // Simulate 4 Starbucks transactions throughout the day
      const today = new Date();
      const starbucksPrices = [
        { amount: 6.45, hour: 7, desc: "morning coffee" },
        { amount: 8.95, hour: 10, desc: "mid-morning latte" },
        { amount: 12.50, hour: 13, desc: "lunch + drink" },
        { amount: 5.75, hour: 15, desc: "afternoon pick-me-up" },
      ];

      transactionsToProcess = starbucksPrices.map(({ amount, hour }) => {
        const datetime = new Date(today);
        datetime.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
        return createFakeTransaction("Starbucks", amount, "FOOD_AND_DRINK", datetime);
      });

      console.log("Simulating Starbucks day:", transactionsToProcess.length, "transactions");
    } else {
      // Single transaction (default)
      const merchantName = body.merchantName || "Starbucks";
      const amount = body.amount || 7.45;
      const category = body.category || "FOOD_AND_DRINK";

      transactionsToProcess = [
        createFakeTransaction(merchantName, amount, category, new Date()),
      ];

      console.log("Simulating transaction:", { merchant: merchantName, amount, category });
    }

    // Process the transactions (this will trigger AI alert)
    await processNewTransactions(transactionsToProcess);

    return NextResponse.json({
      success: true,
      message: "Transaction alert sent",
      transactions: transactionsToProcess.map((tx) => ({
        merchant: tx.merchantName,
        amount: parseFloat(tx.amount),
        time: tx.datetime?.toLocaleTimeString(),
      })),
    });
  } catch (error: unknown) {
    console.error("Simulate transaction error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to simulate transaction";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
