import { NextRequest, NextResponse } from "next/server";
import { spendingSummaryWorkflow } from "@/workflows/spending-summary";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Cron] Midweek summary triggered");

  try {
    const result = await spendingSummaryWorkflow("midweek");
    
    console.log("[Cron] Midweek summary result:", result);
    
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: unknown) {
    console.error("[Cron] Midweek summary failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
