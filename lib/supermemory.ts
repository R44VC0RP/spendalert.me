/**
 * Supermemory integration for SpendAlert
 * Provides persistent memory across conversations
 */

/**
 * Convert a phone number to a Supermemory container tag.
 * Container tags are unique identifiers for users in Supermemory.
 * 
 * @param phoneNumber - Phone number in any format (e.g., +19046086893)
 * @returns Container tag (e.g., "user_19046086893")
 */
export function getContainerTag(phoneNumber: string): string {
  // Strip all non-digit characters and prefix with "user_"
  const digits = phoneNumber.replace(/\D/g, "");
  return `user_${digits}`;
}

/**
 * Supermemory API key from environment
 */
export function getSupermemoryApiKey(): string {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) {
    throw new Error("SUPERMEMORY_API_KEY environment variable is not set");
  }
  return key;
}
