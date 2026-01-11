import { NextRequest, NextResponse } from "next/server";
import { db, whoopTokens, whoopSleep, whoopRecovery } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  WhoopClient,
  WhoopWebhookPayload,
  refreshAccessToken,
  formatDuration,
  getRecoveryStatus,
} from "@/lib/whoop";
import { sendMessage } from "@/lib/loop";

// Recipient phone number for notifications
const RECIPIENT_PHONE = process.env.LOOP_RECIPIENT_PHONE;

export async function POST(request: NextRequest) {
  try {
    const payload: WhoopWebhookPayload = await request.json();

    console.log("[WHOOP Webhook] Received:", {
      type: payload.type,
      user_id: payload.user_id,
      id: payload.id,
    });

    // Get the user's tokens from database
    const userTokens = await db
      .select()
      .from(whoopTokens)
      .where(eq(whoopTokens.id, payload.user_id.toString()))
      .limit(1);

    if (userTokens.length === 0) {
      console.error(`[WHOOP Webhook] No tokens found for user: ${payload.user_id}`);
      return NextResponse.json({ received: true, processed: false });
    }

    let tokens = userTokens[0];

    // Check if token needs refresh
    if (new Date() >= tokens.expiresAt) {
      console.log(`[WHOOP Webhook] Refreshing expired token for user: ${payload.user_id}`);
      try {
        const newTokens = await refreshAccessToken(tokens.refreshToken);
        const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

        await db
          .update(whoopTokens)
          .set({
            accessToken: newTokens.access_token,
            refreshToken: newTokens.refresh_token,
            expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(whoopTokens.id, tokens.id));

        tokens = {
          ...tokens,
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token,
          expiresAt,
        };
      } catch (refreshError) {
        console.error("[WHOOP Webhook] Token refresh failed:", refreshError);
        return NextResponse.json({ received: true, processed: false });
      }
    }

    const client = new WhoopClient(tokens.accessToken);

    // Handle different webhook types
    switch (payload.type) {
      case "sleep.updated":
        await handleSleepUpdate(client, payload, tokens.id);
        break;

      case "recovery.updated":
        await handleRecoveryUpdate(client, payload, tokens.id);
        break;

      case "workout.updated":
        await handleWorkoutUpdate(client, payload);
        break;

      case "cycle.updated":
        // Cycles are handled via recovery updates
        console.log(`[WHOOP Webhook] Cycle updated: ${payload.id}`);
        break;

      default:
        console.log(`[WHOOP Webhook] Unhandled webhook type: ${payload.type}`);
    }

    return NextResponse.json({ received: true, processed: true });
  } catch (error: unknown) {
    console.error("[WHOOP Webhook] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Webhook processing failed";
    // Return 200 to prevent WHOOP from retrying
    return NextResponse.json({ received: true, error: errorMessage });
  }
}

async function handleSleepUpdate(
  client: WhoopClient,
  payload: WhoopWebhookPayload,
  whoopUserId: string
) {
  try {
    const sleep = await client.getSleep(payload.id as string);

    console.log(`[WHOOP Webhook] Sleep data:`, {
      id: sleep.id,
      nap: sleep.nap,
      score_state: sleep.score_state,
      start: sleep.start,
      end: sleep.end,
    });

    // Only process scored, non-nap sleep (main sleep)
    if (sleep.score_state !== "SCORED" || sleep.nap) {
      console.log(`[WHOOP Webhook] Skipping sleep: nap=${sleep.nap}, state=${sleep.score_state}`);
      return;
    }

    // Store sleep data
    await db
      .insert(whoopSleep)
      .values({
        id: sleep.id,
        whoopUserId,
        cycleId: sleep.cycle_id,
        start: new Date(sleep.start),
        end: new Date(sleep.end),
        timezoneOffset: sleep.timezone_offset,
        isNap: sleep.nap,
        scoreState: sleep.score_state,
        sleepPerformance: sleep.score?.sleep_performance_percentage?.toString(),
        sleepConsistency: sleep.score?.sleep_consistency_percentage?.toString(),
        sleepEfficiency: sleep.score?.sleep_efficiency_percentage?.toString(),
        respiratoryRate: sleep.score?.respiratory_rate?.toString(),
        totalInBedTime: sleep.score?.stage_summary?.total_in_bed_time_milli,
        totalAwakeTime: sleep.score?.stage_summary?.total_awake_time_milli,
        totalLightSleep: sleep.score?.stage_summary?.total_light_sleep_time_milli,
        totalSlowWaveSleep: sleep.score?.stage_summary?.total_slow_wave_sleep_time_milli,
        totalRemSleep: sleep.score?.stage_summary?.total_rem_sleep_time_milli,
        sleepCycleCount: sleep.score?.stage_summary?.sleep_cycle_count,
        disturbanceCount: sleep.score?.stage_summary?.disturbance_count,
        sleepNeededBaseline: sleep.score?.sleep_needed?.baseline_milli,
        sleepNeededFromDebt: sleep.score?.sleep_needed?.need_from_sleep_debt_milli,
        sleepNeededFromStrain: sleep.score?.sleep_needed?.need_from_recent_strain_milli,
      })
      .onConflictDoUpdate({
        target: whoopSleep.id,
        set: {
          scoreState: sleep.score_state,
          sleepPerformance: sleep.score?.sleep_performance_percentage?.toString(),
          sleepConsistency: sleep.score?.sleep_consistency_percentage?.toString(),
          sleepEfficiency: sleep.score?.sleep_efficiency_percentage?.toString(),
          respiratoryRate: sleep.score?.respiratory_rate?.toString(),
          totalInBedTime: sleep.score?.stage_summary?.total_in_bed_time_milli,
          totalAwakeTime: sleep.score?.stage_summary?.total_awake_time_milli,
          totalLightSleep: sleep.score?.stage_summary?.total_light_sleep_time_milli,
          totalSlowWaveSleep: sleep.score?.stage_summary?.total_slow_wave_sleep_time_milli,
          totalRemSleep: sleep.score?.stage_summary?.total_rem_sleep_time_milli,
          sleepCycleCount: sleep.score?.stage_summary?.sleep_cycle_count,
          disturbanceCount: sleep.score?.stage_summary?.disturbance_count,
        },
      });

    // Send good morning message!
    if (RECIPIENT_PHONE && sleep.score) {
      await sendGoodMorningMessage(sleep);
    }
  } catch (error) {
    console.error("[WHOOP Webhook] Failed to handle sleep update:", error);
  }
}

async function handleRecoveryUpdate(
  client: WhoopClient,
  payload: WhoopWebhookPayload,
  whoopUserId: string
) {
  try {
    const cycleId = payload.id as number;
    const recovery = await client.getRecovery(cycleId);

    console.log(`[WHOOP Webhook] Recovery data:`, {
      cycle_id: recovery.cycle_id,
      score_state: recovery.score_state,
      recovery_score: recovery.score?.recovery_score,
    });

    if (recovery.score_state !== "SCORED") {
      return;
    }

    // Store recovery data
    await db
      .insert(whoopRecovery)
      .values({
        id: cycleId.toString(),
        whoopUserId,
        cycleId: recovery.cycle_id,
        sleepId: recovery.sleep_id,
        scoreState: recovery.score_state,
        recoveryScore: recovery.score?.recovery_score,
        restingHeartRate: recovery.score?.resting_heart_rate,
        hrvRmssd: recovery.score?.hrv_rmssd_milli?.toString(),
        spo2Percentage: recovery.score?.spo2_percentage?.toString(),
        skinTempCelsius: recovery.score?.skin_temp_celsius?.toString(),
        userCalibrating: recovery.score?.user_calibrating,
      })
      .onConflictDoUpdate({
        target: whoopRecovery.id,
        set: {
          scoreState: recovery.score_state,
          recoveryScore: recovery.score?.recovery_score,
          restingHeartRate: recovery.score?.resting_heart_rate,
          hrvRmssd: recovery.score?.hrv_rmssd_milli?.toString(),
          spo2Percentage: recovery.score?.spo2_percentage?.toString(),
          skinTempCelsius: recovery.score?.skin_temp_celsius?.toString(),
          userCalibrating: recovery.score?.user_calibrating,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    console.error("[WHOOP Webhook] Failed to handle recovery update:", error);
  }
}

async function handleWorkoutUpdate(
  client: WhoopClient,
  payload: WhoopWebhookPayload
) {
  try {
    const workout = await client.getWorkout(payload.id as string);

    console.log(`[WHOOP Webhook] Workout completed:`, {
      id: workout.id,
      sport: workout.sport_name,
      strain: workout.score?.strain,
    });

    // Could store workout data or send notification here
    // For now just logging
  } catch (error) {
    console.error("[WHOOP Webhook] Failed to handle workout update:", error);
  }
}

async function sendGoodMorningMessage(
  sleep: Awaited<ReturnType<WhoopClient["getSleep"]>>
) {
  if (!RECIPIENT_PHONE || !sleep.score) return;

  const score = sleep.score;
  const performance = Math.round(score.sleep_performance_percentage);
  const totalSleep = score.stage_summary.total_in_bed_time_milli - score.stage_summary.total_awake_time_milli;
  const sleepDuration = formatDuration(totalSleep);
  const remSleep = formatDuration(score.stage_summary.total_rem_sleep_time_milli);
  const deepSleep = formatDuration(score.stage_summary.total_slow_wave_sleep_time_milli);

  // Build a friendly morning message
  let greeting = "Good morning!";
  let emoji = "";

  if (performance >= 85) {
    greeting = "Good morning! You crushed it last night";
    emoji = "high performance";
  } else if (performance >= 70) {
    greeting = "Good morning! Solid sleep";
    emoji = "good sleep";
  } else if (performance >= 50) {
    greeting = "Morning! Your sleep was okay";
    emoji = "okay sleep";
  } else {
    greeting = "Morning. Rough night";
    emoji = "low sleep";
  }

  const message = `${greeting}

Sleep: ${sleepDuration} (${performance}% performance)
Deep: ${deepSleep} | REM: ${remSleep}
Disturbances: ${score.stage_summary.disturbance_count}

Have a great day!`;

  try {
    await sendMessage({
      contact: RECIPIENT_PHONE,
      text: message,
    });
    console.log(`[WHOOP] Sent good morning message to ${RECIPIENT_PHONE}`);
  } catch (error) {
    console.error("[WHOOP] Failed to send good morning message:", error);
  }
}
