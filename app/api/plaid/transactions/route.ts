import { NextRequest, NextResponse } from "next/server";
import { db, transactions, plaidAccounts, plaidItems } from "@/lib/db";
import { eq, desc, and, gte, lte, like, or, inArray } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId");
    const accountIds = searchParams.get("accountIds"); // comma-separated list
    const startDate = searchParams.get("startDate"); // YYYY-MM-DD
    const endDate = searchParams.get("endDate"); // YYYY-MM-DD
    const search = searchParams.get("search");
    const pending = searchParams.get("pending");
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build where conditions
    const conditions = [];

    if (accountId) {
      conditions.push(eq(transactions.accountId, accountId));
    }

    if (accountIds) {
      const ids = accountIds.split(",").filter(Boolean);
      if (ids.length > 0) {
        conditions.push(inArray(transactions.accountId, ids));
      }
    }

    if (startDate) {
      conditions.push(gte(transactions.date, startDate));
    }

    if (endDate) {
      conditions.push(lte(transactions.date, endDate));
    }

    if (pending !== null && pending !== undefined) {
      conditions.push(eq(transactions.pending, pending === "true"));
    }

    if (search) {
      conditions.push(
        or(
          like(transactions.name, `%${search}%`),
          like(transactions.merchantName, `%${search}%`)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch transactions with account info
    const txs = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        amount: transactions.amount,
        date: transactions.date,
        datetime: transactions.datetime,
        name: transactions.name,
        merchantName: transactions.merchantName,
        logoUrl: transactions.logoUrl,
        website: transactions.website,
        paymentChannel: transactions.paymentChannel,
        primaryCategory: transactions.primaryCategory,
        detailedCategory: transactions.detailedCategory,
        categoryIconUrl: transactions.categoryIconUrl,
        pending: transactions.pending,
        locationAddress: transactions.locationAddress,
        locationCity: transactions.locationCity,
        locationRegion: transactions.locationRegion,
        locationPostalCode: transactions.locationPostalCode,
        locationCountry: transactions.locationCountry,
        // Account info
        accountName: plaidAccounts.name,
        accountMask: plaidAccounts.mask,
        accountType: plaidAccounts.type,
        accountSubtype: plaidAccounts.subtype,
        institutionName: plaidItems.institutionName,
      })
      .from(transactions)
      .leftJoin(plaidAccounts, eq(transactions.accountId, plaidAccounts.id))
      .leftJoin(plaidItems, eq(plaidAccounts.itemId, plaidItems.id))
      .where(whereClause)
      .orderBy(desc(transactions.pending), desc(transactions.date), desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Calculate summary stats
    let totalSpending = 0;
    let totalIncome = 0;

    for (const tx of txs) {
      const amount = parseFloat(tx.amount);
      if (amount > 0) {
        totalSpending += amount; // Plaid: positive = money out
      } else {
        totalIncome += Math.abs(amount); // Plaid: negative = money in
      }
    }

    return NextResponse.json({
      transactions: txs.map((tx) => ({
        id: tx.id,
        accountId: tx.accountId,
        amount: parseFloat(tx.amount),
        date: tx.date,
        datetime: tx.datetime,
        name: tx.name,
        merchantName: tx.merchantName,
        logoUrl: tx.logoUrl,
        website: tx.website,
        paymentChannel: tx.paymentChannel,
        primaryCategory: tx.primaryCategory,
        detailedCategory: tx.detailedCategory,
        categoryIconUrl: tx.categoryIconUrl,
        pending: tx.pending,
        location: tx.locationCity
          ? {
              address: tx.locationAddress,
              city: tx.locationCity,
              region: tx.locationRegion,
              postalCode: tx.locationPostalCode,
              country: tx.locationCountry,
            }
          : null,
        // Account display info
        accountName: tx.accountName,
        accountMask: tx.accountMask,
        accountType: tx.accountType,
        accountSubtype: tx.accountSubtype,
        institutionName: tx.institutionName,
        accountDisplayName: tx.institutionName
          ? `${tx.institutionName}${tx.accountMask ? ` ...${tx.accountMask}` : ""}`
          : tx.accountName || "Unknown Account",
      })),
      summary: {
        totalSpending,
        totalIncome,
        netCashFlow: totalIncome - totalSpending,
        transactionCount: txs.length,
      },
      pagination: {
        limit,
        offset,
        hasMore: txs.length === limit,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching transactions:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch transactions";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
