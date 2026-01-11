import { NextResponse } from "next/server";
import { db, whoopTokens, whoopSleep, whoopRecovery } from "@/lib/db";
import { desc, eq } from "drizzle-orm";
import { WhoopClient, refreshAccessToken } from "@/lib/whoop";

export async function GET() {
  try {
    // Get the first WHOOP user (single-user app for now)
    const tokens = await db
      .select()
      .from(whoopTokens)
      .limit(1);

    if (tokens.length === 0) {
      return NextResponse.json({
        connected: false,
        user: null,
        lastSleep: null,
        lastRecovery: null,
      });
    }

    let token = tokens[0];
    let profile = null;

    // Try to get profile (and refresh token if needed)
    try {
      // Check if token needs refresh
      if (new Date() >= token.expiresAt) {
        const newTokens = await refreshAccessToken(token.refreshToken);
        const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

        await db
          .update(whoopTokens)
          .set({
            accessToken: newTokens.access_token,
            refreshToken: newTokens.refresh_token,
            expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(whoopTokens.id, token.id));

        token = {
          ...token,
          accessToken: newTokens.access_token,
        };
      }

      const client = new WhoopClient(token.accessToken);
      profile = await client.getProfile();
    } catch (error) {
      console.error("[WHOOP Status] Failed to get profile:", error);
      // Token might be invalid, but we still show as connected
    }

    // Get last sleep record
    const lastSleep = await db
      .select()
      .from(whoopSleep)
      .where(eq(whoopSleep.whoopUserId, token.id))
      .orderBy(desc(whoopSleep.start))
      .limit(1);

    // Get last recovery record
    const lastRecovery = await db
      .select()
      .from(whoopRecovery)
      .where(eq(whoopRecovery.whoopUserId, token.id))
      .orderBy(desc(whoopRecovery.createdAt))
      .limit(1);

    return NextResponse.json({
      connected: true,
      user: profile
        ? {
            id: profile.user_id,
            firstName: profile.first_name,
            lastName: profile.last_name,
            email: profile.email,
          }
        : null,
      lastSleep: lastSleep[0]
        ? {
            id: lastSleep[0].id,
            start: lastSleep[0].start,
            end: lastSleep[0].end,
            performance: lastSleep[0].sleepPerformance,
            efficiency: lastSleep[0].sleepEfficiency,
            totalSleepMs:
              (lastSleep[0].totalInBedTime || 0) -
              (lastSleep[0].totalAwakeTime || 0),
          }
        : null,
      lastRecovery: lastRecovery[0]
        ? {
            cycleId: lastRecovery[0].cycleId,
            score: lastRecovery[0].recoveryScore,
            hrv: lastRecovery[0].hrvRmssd,
            restingHr: lastRecovery[0].restingHeartRate,
          }
        : null,
    });
  } catch (error: unknown) {
    console.error("[WHOOP Status] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to get WHOOP status";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
