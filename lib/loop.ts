// Loop Message API client for iMessage sending/receiving
// Using the new Conversation API: https://docs-beta.loopmessage.com

const LOOP_API_URL = "https://a.loopmessage.com/api/v1/message/send/";

interface SendMessageParams {
  contact: string; // E.164 phone number or email
  text: string;
  sender?: string; // Optional sender ID
  subject?: string; // Optional bold title before text
  passthrough?: string; // Metadata for tracking (max 1000 chars)
  attachments?: string[]; // Array of https URLs (max 3)
  effect?: "slam" | "loud" | "gentle" | "invisibleInk" | "echo" | "spotlight" | "balloons" | "confetti" | "love" | "lasers" | "fireworks" | "shootingStar" | "celebration";
  reply_to_id?: string; // message_id to reply to
}

interface SendMessageResponse {
  message_id: string;
  success: boolean;
  contact: string;
  text: string;
  message?: string; // Error message if failed
}

interface LoopError {
  success: false;
  code: number;
  message: string;
}

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
  const apiKey = process.env.LOOP_API_KEY;

  if (!apiKey) {
    throw new Error("LOOP_API_KEY environment variable must be set");
  }

  const body: Record<string, unknown> = {
    contact: params.contact,
    text: params.text,
  };

  // Only include optional fields if provided
  if (params.sender) body.sender = params.sender;
  if (params.subject) body.subject = params.subject;
  if (params.passthrough) body.passthrough = params.passthrough;
  if (params.attachments?.length) body.attachments = params.attachments;
  if (params.effect) body.effect = params.effect;
  if (params.reply_to_id) body.reply_to_id = params.reply_to_id;

  const response = await fetch(LOOP_API_URL, {
    method: "POST",
    headers: {
      "Authorization": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data as LoopError;
    throw new Error(`Loop API error (${error.code}): ${error.message}`);
  }

  return data as SendMessageResponse;
}

// Webhook payload types from Loop
export interface LoopWebhookPayload {
  event:
    | "message_inbound"
    | "message_delivered"
    | "message_failed"
    | "message_scheduled"
    | "message_reaction"
    | "opt-in"
    | "inbound_call"
    | "unknown";
  contact: string; // Phone number in E.164 format or email
  text: string;
  message_id: string;
  webhook_id: string;
  api_version?: string;
  message_type?: "text" | "reaction" | "audio" | "attachments" | "sticker" | "location";
  channel?: "imessage" | "sms" | "rcs";
  sender?: string; // Sender ID
  subject?: string;
  attachments?: string[]; // URLs to download files (for inbound)
  reaction?: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question" | "unknown";
  thread_id?: string;
  error_code?: number; // For message_failed
  passthrough?: string;
  language?: {
    code: string; // ISO 639-1 code
    name: string;
    script?: "Hans" | "Hant"; // For Chinese
  };
  group?: {
    id: string;
    name?: string;
    participants: string[];
  };
  speech?: {
    text: string;
    language: {
      code: string;
      name: string;
    };
    metadata?: {
      speaking_rate?: number;
      average_pause_duration?: number;
      speech_start_timestamp?: number;
      speech_duration?: number;
      jitter?: number;
      shimmer?: number;
      pitch?: number;
      voicing?: number;
    };
  };
}

// Response to return from webhook to show typing indicator and read status
export interface LoopWebhookResponse {
  typing?: number; // Seconds to show typing indicator (max 60)
  read?: boolean; // Mark conversation as read
}

// Helper to send a transaction alert
export async function sendTransactionAlert(
  phoneNumber: string,
  message: string,
  transactionId?: string
): Promise<SendMessageResponse> {
  return sendMessage({
    contact: phoneNumber,
    text: message,
    passthrough: transactionId ? JSON.stringify({ transactionId }) : undefined,
  });
}

// Show typing indicator
export async function showTypingIndicator(
  contact: string,
  sender: string,
  seconds: number = 5
): Promise<void> {
  const apiKey = process.env.LOOP_API_KEY;

  if (!apiKey) {
    throw new Error("LOOP_API_KEY environment variable must be set");
  }

  await fetch("https://a.loopmessage.com/api/v1/message/show-typing/", {
    method: "POST",
    headers: {
      "Authorization": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contact,
      sender,
      typing: Math.min(seconds, 60),
      read: true,
    }),
  });
}

// Send a reaction to a message
export async function sendReaction(
  contact: string,
  messageId: string,
  reaction: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question" | "-love" | "-like" | "-dislike" | "-laugh" | "-emphasize" | "-question"
): Promise<SendMessageResponse> {
  const apiKey = process.env.LOOP_API_KEY;

  if (!apiKey) {
    throw new Error("LOOP_API_KEY environment variable must be set");
  }

  const response = await fetch(LOOP_API_URL, {
    method: "POST",
    headers: {
      "Authorization": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contact,
      message_id: messageId,
      reaction,
    }),
  });

  return response.json();
}
