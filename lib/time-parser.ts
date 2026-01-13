import * as chrono from "chrono-node";

export interface ParsedTime {
  triggerAt: Date;
  isRecurring: boolean;
  recurrence?: "daily" | "weekly" | "monthly";
  recurrenceTime?: string; // HH:MM
  recurrenceDays?: string[]; // For weekly: ["mon", "wed", "fri"]
}

// Create a custom chrono instance configured for EST
const chronoEST = chrono.casual.clone();

/**
 * Get current time in EST timezone
 */
function getESTDate(): Date {
  const now = new Date();
  // Create a date string in EST timezone and parse it back
  const estString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(estString);
}

/**
 * Convert a Date to EST timezone
 */
function toEST(date: Date): Date {
  const estString = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(estString);
}

/**
 * Parse natural language time expressions into a structured format.
 * All times are interpreted as EST.
 * 
 * Supports:
 * - Relative: "in 30 minutes", "in an hour", "in 2 hours"
 * - Absolute: "tomorrow at 9am", "next monday at 3pm", "at 5pm"
 * - Recurring: "every day at 9am", "daily at 8pm", "every monday at 10am"
 */
export function parseNaturalTime(input: string, referenceDate?: Date): ParsedTime | null {
  // Use EST as the reference time
  const ref = referenceDate || getESTDate();
  const lowerInput = input.toLowerCase().trim();

  // Check for recurring patterns first
  
  // Daily: "every day at 9am", "daily at 8pm"
  if (lowerInput.includes("every day") || lowerInput.match(/^daily\b/)) {
    const parsed = chrono.parse(input, ref)[0];
    if (parsed) {
      const start = parsed.start;
      const hours = start.get("hour") ?? 9;
      const minutes = start.get("minute") ?? 0;

      // Calculate next occurrence
      const triggerAt = new Date(ref);
      triggerAt.setHours(hours, minutes, 0, 0);
      if (triggerAt <= ref) {
        triggerAt.setDate(triggerAt.getDate() + 1);
      }

      return {
        triggerAt,
        isRecurring: true,
        recurrence: "daily",
        recurrenceTime: `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`,
      };
    }
  }

  // Weekly: "every monday at 9am", "every tuesday", "weekly on fridays"
  const weeklyMatch = lowerInput.match(
    /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
  );
  if (weeklyMatch) {
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const targetDay = dayMap[weeklyMatch[1].toLowerCase()];
    const parsed = chrono.parse(input, ref)[0];

    const hours = parsed?.start.get("hour") ?? 9;
    const minutes = parsed?.start.get("minute") ?? 0;

    // Calculate next occurrence
    const triggerAt = new Date(ref);
    triggerAt.setHours(hours, minutes, 0, 0);

    const currentDay = triggerAt.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    // If it's today but the time has passed, go to next week
    if (daysUntil === 0 && triggerAt <= ref) daysUntil = 7;
    triggerAt.setDate(triggerAt.getDate() + daysUntil);

    return {
      triggerAt,
      isRecurring: true,
      recurrence: "weekly",
      recurrenceTime: `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`,
      recurrenceDays: [weeklyMatch[1].toLowerCase().substring(0, 3)],
    };
  }

  // Monthly: "every month on the 1st at 9am", "monthly on the 15th"
  const monthlyMatch = lowerInput.match(/every\s+month|monthly/i);
  if (monthlyMatch) {
    const parsed = chrono.parse(input, ref)[0];
    if (parsed) {
      const start = parsed.start;
      const day = start.get("day") ?? ref.getDate();
      const hours = start.get("hour") ?? 9;
      const minutes = start.get("minute") ?? 0;

      const triggerAt = new Date(ref);
      triggerAt.setDate(day);
      triggerAt.setHours(hours, minutes, 0, 0);
      
      // If this month's date has passed, go to next month
      if (triggerAt <= ref) {
        triggerAt.setMonth(triggerAt.getMonth() + 1);
      }

      return {
        triggerAt,
        isRecurring: true,
        recurrence: "monthly",
        recurrenceTime: `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`,
      };
    }
  }

  // One-time: "in an hour", "tomorrow at 3pm", "next friday at noon", etc.
  const parsed = chrono.parseDate(input, ref, { forwardDate: true });
  if (parsed) {
    return {
      triggerAt: parsed,
      isRecurring: false,
    };
  }

  return null;
}

/**
 * Format a date as a human-readable relative time string.
 */
export function formatRelativeTime(date: Date): string {
  const now = getESTDate();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) return "past due";
  if (diffMins < 1) return "now";
  if (diffMins === 1) return "in 1 minute";
  if (diffMins < 60) return `in ${diffMins} minutes`;

  const diffHours = Math.round(diffMins / 60);
  if (diffHours === 1) return "in 1 hour";
  if (diffHours < 24) return `in ${diffHours} hours`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;

  // For dates more than a week out, show the actual date/time
  return date.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a date for display in EST.
 */
export function formatDateEST(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
