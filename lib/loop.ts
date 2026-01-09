// Loop Message API client for iMessage sending/receiving

const LOOP_API_URL = "https://server.loopmessage.com/api/v1/message/send/";

interface SendMessageParams {
  recipient: string; // E.164 phone number or email
  text: string;
  senderName: string;
  passthrough?: string; // Metadata for tracking
  statusCallback?: string; // Webhook URL for delivery status
  attachments?: string[]; // Array of image URLs (max 3, must be https)
}

interface SendMessageResponse {
  message_id: string;
  success: boolean;
  recipient: string;
  text: string;
  message?: string; // Error message if failed
}

interface LoopError {
  success: false;
  code: number;
  message: string;
}

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
  const authKey = process.env.LOOP_AUTH_KEY;
  const secretKey = process.env.LOOP_API_KEY;

  if (!authKey || !secretKey) {
    throw new Error("LOOP_AUTH_KEY and LOOP_API_KEY environment variables must be set");
  }

  const response = await fetch(LOOP_API_URL, {
    method: "POST",
    headers: {
      "Authorization": authKey,
      "Loop-Secret-Key": secretKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: params.recipient,
      text: params.text,
      sender_name: params.senderName,
      passthrough: params.passthrough,
      status_callback: params.statusCallback,
      attachments: params.attachments,
    }),
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
  // New API field names
  event?: 
    | "message_inbound"
    | "message_sent"
    | "message_failed"
    | "message_scheduled"
    | "message_reaction"
    | "message_timeout"
    | "conversation_inited"
    | "group_created"
    | "inbound_call"
    | "unknown";
  contact?: string; // Phone number of the user
  type?: "text" | "reaction" | "audio" | "attachments" | "sticker" | "location";
  sender?: string; // Sender ID
  sender_name?: string;
  organization_id?: string;
  
  // Legacy/documented field names (keeping for compatibility)
  alert_type?: 
    | "message_inbound"
    | "message_sent"
    | "message_failed"
    | "message_scheduled"
    | "message_reaction"
    | "message_timeout"
    | "conversation_inited"
    | "group_created"
    | "inbound_call"
    | "unknown";
  recipient?: string;
  
  // Common fields
  text: string;
  message_id: string;
  webhook_id: string;
  api_version?: string;
  message_type?: "text" | "reaction" | "audio" | "attachments" | "sticker" | "location";
  delivery_type?: "imessage" | "sms";
  success?: boolean;
  error_code?: number;
  passthrough?: string;
  attachments?: string[];
  reaction?: "love" | "like" | "dislike" | "laugh" | "exclaim" | "question" | "unknown";
  thread_id?: string;
  sandbox?: boolean;
  language?: {
    code: string;
    name: string;
    script?: string;
  };
  group?: {
    group_id: string;
    name?: string;
    participants: string[];
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
  const senderName = process.env.LOOP_SENDER_NAME;

  if (!senderName) {
    throw new Error("LOOP_SENDER_NAME environment variable is not set");
  }

  return sendMessage({
    recipient: phoneNumber,
    text: message,
    senderName,
    passthrough: transactionId ? JSON.stringify({ transactionId }) : undefined,
  });
}
