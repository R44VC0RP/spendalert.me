import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { refreshTransactionsWorkflow } from "@/workflows/refresh-transactions";

export async function GET(request: NextRequest) {
  try {
    // Verify the request is from Vercel Cron
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.error("Unauthorized cron request");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Start the workflow - it will handle random delay and refresh
    // The workflow runs asynchronously and doesn't block this request
    await start(refreshTransactionsWorkflow, []);

    console.log(`[Cron] Started refresh workflow`);

    return NextResponse.json({
      success: true,
      message: "Refresh workflow started",
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("[Cron] Error starting refresh workflow:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to start workflow";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
