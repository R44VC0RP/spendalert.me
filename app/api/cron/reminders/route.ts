import { NextRequest, NextResponse } from "next/server";
import { db, reminders } from "@/lib/db";
import { eq, and, lte, or } from "drizzle-orm";
import { sendTransactionAlert } from "@/lib/loop";
import { formatDateEST } from "@/lib/time-parser";

// Follow-up configuration
const FIRST_FOLLOWUP_MINUTES = 10;
const SECOND_FOLLOWUP_MINUTES = 15; // 15 minutes after first (so 25 min total from trigger)
const MAX_FOLLOWUPS = 2;

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.error("[Cron/Reminders] Unauthorized request");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const results = {
      triggered: 0,
      followedUp: 0,
      rescheduled: 0,
      errors: [] as string[],
    };

    console.log(`[Cron/Reminders] Starting reminder check at ${now.toISOString()}`);

    // 1. Process due reminders (pending, triggerAt <= now)
    const dueReminders = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "pending"),
          lte(reminders.triggerAt, now)
        )
      );

    console.log(`[Cron/Reminders] Found ${dueReminders.length} due reminders`);

    for (const reminder of dueReminders) {
      try {
        // Build the reminder message
        let message = `reminder: ${reminder.message}`;
        
        if (reminder.requiresConfirmation) {
          if (reminder.confirmationType === "photo") {
            message += "\n\nsend me a pic when done!";
          } else {
            message += "\n\nlet me know when done!";
          }
        }

        console.log(`[Cron/Reminders] Triggering reminder ${reminder.id} to ${reminder.phoneNumber}`);

        await sendTransactionAlert(reminder.phoneNumber, message);

        // Update status based on whether confirmation is needed
        if (reminder.requiresConfirmation) {
          // Needs confirmation - set to triggered, wait for user response
          await db
            .update(reminders)
            .set({
              status: "triggered",
              triggeredAt: now,
              updatedAt: now,
            })
            .where(eq(reminders.id, reminder.id));
        } else {
          // No confirmation needed
          if (reminder.recurrence && reminder.recurrenceTime) {
            // Recurring - schedule next occurrence
            const nextTrigger = calculateNextOccurrence(reminder);
            await db
              .update(reminders)
              .set({
                triggerAt: nextTrigger,
                status: "pending",
                triggeredAt: null,
                updatedAt: now,
              })
              .where(eq(reminders.id, reminder.id));
            
            console.log(`[Cron/Reminders] Rescheduled recurring reminder ${reminder.id} for ${formatDateEST(nextTrigger)}`);
            results.rescheduled++;
          } else {
            // One-time, no confirmation - mark as confirmed (done)
            await db
              .update(reminders)
              .set({
                status: "confirmed",
                triggeredAt: now,
                confirmedAt: now,
                updatedAt: now,
              })
              .where(eq(reminders.id, reminder.id));
          }
        }

        results.triggered++;
      } catch (error) {
        const errorMsg = `Failed to trigger ${reminder.id}: ${error instanceof Error ? error.message : error}`;
        console.error(`[Cron/Reminders] ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    // 2. Process follow-ups (triggered reminders awaiting confirmation)
    const needsFollowUp = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "triggered"),
          eq(reminders.requiresConfirmation, true)
        )
      );

    console.log(`[Cron/Reminders] Found ${needsFollowUp.length} reminders awaiting confirmation`);

    for (const reminder of needsFollowUp) {
      try {
        if (!reminder.triggeredAt) continue;

        const triggeredAt = reminder.triggeredAt;
        const lastFollowUp = reminder.lastFollowUpAt || triggeredAt;
        const minutesSinceTrigger = (now.getTime() - triggeredAt.getTime()) / 60000;
        const minutesSinceLastFollowUp = (now.getTime() - lastFollowUp.getTime()) / 60000;

        // Determine if we should follow up
        let shouldFollowUp = false;
        let followUpMessage = "";

        if (reminder.followUpCount === 0 && minutesSinceTrigger >= FIRST_FOLLOWUP_MINUTES) {
          // First follow-up after 10 minutes
          shouldFollowUp = true;
          followUpMessage = `hey, just checking - did you ${reminder.message.toLowerCase()}?`;
        } else if (reminder.followUpCount === 1 && minutesSinceLastFollowUp >= (SECOND_FOLLOWUP_MINUTES - FIRST_FOLLOWUP_MINUTES)) {
          // Second follow-up 15 minutes after first (so ~25 min total)
          shouldFollowUp = true;
          followUpMessage = `last reminder: ${reminder.message.toLowerCase()}. let me know when done!`;
        }

        if (shouldFollowUp && reminder.followUpCount < MAX_FOLLOWUPS) {
          console.log(`[Cron/Reminders] Sending follow-up #${reminder.followUpCount + 1} for reminder ${reminder.id}`);
          
          await sendTransactionAlert(reminder.phoneNumber, followUpMessage);

          await db
            .update(reminders)
            .set({
              followUpCount: reminder.followUpCount + 1,
              lastFollowUpAt: now,
              updatedAt: now,
            })
            .where(eq(reminders.id, reminder.id));

          results.followedUp++;
        }
      } catch (error) {
        const errorMsg = `Failed to follow up ${reminder.id}: ${error instanceof Error ? error.message : error}`;
        console.error(`[Cron/Reminders] ${errorMsg}`);
        results.errors.push(errorMsg);
      }
    }

    console.log(`[Cron/Reminders] Completed:`, results);

    return NextResponse.json({
      success: true,
      ...results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("[Cron/Reminders] Fatal error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Calculate the next occurrence for a recurring reminder
 */
function calculateNextOccurrence(reminder: typeof reminders.$inferSelect): Date {
  if (!reminder.recurrence || !reminder.recurrenceTime) {
    throw new Error("Reminder is not recurring");
  }

  const [hours, minutes] = reminder.recurrenceTime.split(":").map(Number);
  const nextTrigger = new Date();

  switch (reminder.recurrence) {
    case "daily":
      nextTrigger.setDate(nextTrigger.getDate() + 1);
      break;
    case "weekly":
      nextTrigger.setDate(nextTrigger.getDate() + 7);
      break;
    case "monthly":
      nextTrigger.setMonth(nextTrigger.getMonth() + 1);
      break;
    default:
      throw new Error(`Unknown recurrence type: ${reminder.recurrence}`);
  }

  nextTrigger.setHours(hours, minutes, 0, 0);
  return nextTrigger;
}
