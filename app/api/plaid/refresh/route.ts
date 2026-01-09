import { NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { db, plaidItems } from "@/lib/db";

export async function POST() {
  try {
    // Get all items
    const items = await db.select().from(plaidItems);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "No connected accounts" },
        { status: 400 }
      );
    }

    const results = [];

    // Refresh each item
    for (const item of items) {
      try {
        await plaidClient.transactionsRefresh({
          access_token: item.accessToken,
        });
        results.push({
          itemId: item.id,
          institution: item.institutionName,
          status: "success",
        });
      } catch (error: unknown) {
        console.error(`Error refreshing item ${item.id}:`, error);
        results.push({
          itemId: item.id,
          institution: item.institutionName,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Refresh requested. New transactions will arrive via webhook shortly.",
      results,
    });
  } catch (error: unknown) {
    console.error("Error refreshing transactions:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to refresh transactions";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
