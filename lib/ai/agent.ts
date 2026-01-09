import { generateText, tool, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { db, transactions, aiMessages, aiConversations } from "@/lib/db";
import { eq, desc, and, gte, lte, gt, lt, like, or, sql } from "drizzle-orm";
import type { Transaction, AiMessage } from "@/lib/db/schema";

// Create Anthropic client pointing to OpenCode Zen
const anthropic = createAnthropic({
  baseURL: "https://opencode.ai/zen/v1",
  apiKey: process.env.OPENCODE_ZEN_API_KEY || "",
});

// Base system prompt for the SpendAlert AI agent
const BASE_SYSTEM_PROMPT = `you're a personal finance assistant that texts users about their spending. you help them understand their transactions and answer questions about their money.

your style:
- casual, lowercase texting style like you're a friend
- short and to the point, no fluff
- use natural abbreviations (rn, btw, prob, etc) when it feels right
- never use all caps or markdown formatting
- no emojis unless it really fits
- be real with people about their spending - if they're blowing money somewhere, tell them
- give specific numbers, not vague answers

when alerting about new transactions:
- mention the transaction briefly
- if you notice a pattern (like multiple visits to the same place, or spending a lot in a category), call it out
- be like a friend who's looking out for them: "yo another starbucks run? that's like your 4th this week, you're at $45 already"
- don't be preachy but be real

when answering questions:
- you already have recent transactions in context below - use that first before calling tools
- only use tools if you need to search for something specific not in context
- be specific with numbers and dates
- if you spot something interesting in the data (unusual spending, trends), mention it

spending insights to watch for:
- frequent visits to the same merchant (coffee shops, fast food, etc)
- categories that are unusually high
- spending that's increased compared to usual patterns
- subscriptions or recurring charges

available tools (use sparingly - context usually has what you need):
- searchTransactions: search by keyword, date range, amount filters - use only if searching for something specific
- getSpendingSummary: get spending breakdown by category or merchant
- getTopMerchants: see top spending locations`;

// Get current date/time in EST
function getCurrentDateTimeEST(): { date: string; time: string; dayOfWeek: string } {
  const now = new Date();
  const estOptions: Intl.DateTimeFormatOptions = { timeZone: "America/New_York" };
  
  const date = now.toLocaleDateString("en-US", { 
    ...estOptions, 
    weekday: "long",
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });
  
  const time = now.toLocaleTimeString("en-US", { 
    ...estOptions, 
    hour: "numeric", 
    minute: "2-digit",
    hour12: true 
  });
  
  const dayOfWeek = now.toLocaleDateString("en-US", { 
    ...estOptions, 
    weekday: "long" 
  });
  
  return { date, time, dayOfWeek };
}

// Build dynamic system prompt with context
function buildSystemPrompt(recentTransactions: Transaction[]): string {
  const { date, time, dayOfWeek } = getCurrentDateTimeEST();
  
  let prompt = BASE_SYSTEM_PROMPT;
  
  // Add current date/time
  prompt += `\n\n---\nCURRENT DATE & TIME (EST):\n${dayOfWeek}, ${date}\n${time}\n`;
  
  // Calculate date boundaries for spending summaries
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  
  // Start of this week (Sunday)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const startOfWeekStr = startOfWeek.toISOString().split("T")[0];
  
  // Start of this month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfMonthStr = startOfMonth.toISOString().split("T")[0];
  
  // Calculate spending summaries
  const spendingTxs = recentTransactions.filter(tx => parseFloat(tx.amount) > 0);
  
  const todaySpending = spendingTxs
    .filter(tx => tx.date === todayStr)
    .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
  
  const weekSpending = spendingTxs
    .filter(tx => tx.date >= startOfWeekStr)
    .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
  
  const monthSpending = spendingTxs
    .filter(tx => tx.date >= startOfMonthStr)
    .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
  
  const todayTxCount = spendingTxs.filter(tx => tx.date === todayStr).length;
  const weekTxCount = spendingTxs.filter(tx => tx.date >= startOfWeekStr).length;
  const monthTxCount = spendingTxs.filter(tx => tx.date >= startOfMonthStr).length;
  
  // Add spending summaries
  prompt += `\n---\nSPENDING SUMMARY:\n`;
  prompt += `Today: $${todaySpending.toFixed(2)} (${todayTxCount} transactions)\n`;
  prompt += `This week: $${weekSpending.toFixed(2)} (${weekTxCount} transactions)\n`;
  prompt += `This month: $${monthSpending.toFixed(2)} (${monthTxCount} transactions)\n`;
  
  // Add recent transactions context
  if (recentTransactions.length > 0) {
    prompt += `\n---\nRECENT TRANSACTIONS (last 7 days, for quick reference - you don't need to use tools for basic questions about these):\n`;
    
    // Group by date for readability
    const byDate: Record<string, Transaction[]> = {};
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];
    
    const recentOnly = recentTransactions.filter(tx => tx.date >= sevenDaysAgoStr);
    
    for (const tx of recentOnly.slice(0, 50)) { // Limit to 50 most recent
      if (!byDate[tx.date]) byDate[tx.date] = [];
      byDate[tx.date].push(tx);
    }
    
    for (const [txDate, txs] of Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]))) {
      prompt += `\n${txDate}:\n`;
      for (const tx of txs) {
        const amount = parseFloat(tx.amount);
        const sign = amount > 0 ? "-" : "+";
        prompt += `  ${sign}$${Math.abs(amount).toFixed(2)} ${tx.merchantName || tx.name}${tx.primaryCategory ? ` (${tx.primaryCategory})` : ""}${tx.pending ? " [pending]" : ""}\n`;
      }
    }
  }
  
  return prompt;
}

// Max messages to keep in conversation history (keep as many as practical for context)
const MAX_CONVERSATION_MESSAGES = 100;

interface ConversationContext {
  conversationId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  recentTransactions: Transaction[];
}

// Get or create a conversation for a phone number
export async function getOrCreateConversation(phoneNumber: string): Promise<string> {
  console.log(`[Agent] Getting/creating conversation for ${phoneNumber}`);
  
  const existing = await db.query.aiConversations.findFirst({
    where: eq(aiConversations.phoneNumber, phoneNumber),
  });

  if (existing) {
    console.log(`[Agent] Found existing conversation: ${existing.id}`);
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db.insert(aiConversations).values({
    id,
    phoneNumber,
  });

  console.log(`[Agent] Created new conversation: ${id}`);
  return id;
}

// Load conversation context for the AI
async function loadConversationContext(conversationId: string): Promise<ConversationContext> {
  console.log(`[Agent] Loading conversation context for: ${conversationId}`);
  
  // Get recent messages for context
  const messages = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(desc(aiMessages.createdAt))
    .limit(MAX_CONVERSATION_MESSAGES);

  console.log(`[Agent] Found ${messages.length} previous messages in conversation`);

  // Get recent transactions (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

  const recentTxs = await db
    .select()
    .from(transactions)
    .where(gte(transactions.date, dateStr))
    .orderBy(desc(transactions.date))
    .limit(100);

  console.log(`[Agent] Found ${recentTxs.length} transactions from last 30 days`);

  const formattedMessages = messages.reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Log conversation history
  console.log(`[Agent] === CONVERSATION HISTORY (${formattedMessages.length} messages) ===`);
  formattedMessages.forEach((m, i) => {
    const preview = m.content.length > 100 ? m.content.substring(0, 100) + "..." : m.content;
    console.log(`[Agent]   [${i + 1}] ${m.role.toUpperCase()}: ${preview}`);
  });
  console.log(`[Agent] === END CONVERSATION HISTORY ===`);

  return {
    conversationId,
    messages: formattedMessages,
    recentTransactions: recentTxs,
  };
}

// Format transactions for the AI context
function formatTransactionsForContext(txs: Transaction[]): string {
  if (txs.length === 0) {
    return "no recent transactions found.";
  }

  const lines = txs.map((tx) => {
    const amount = parseFloat(tx.amount);
    const sign = amount > 0 ? "-" : "+";
    const absAmount = Math.abs(amount).toFixed(2);
    return `${tx.date}: ${sign}$${absAmount} at ${tx.merchantName || tx.name}${tx.primaryCategory ? ` (${tx.primaryCategory})` : ""}`;
  });

  return lines.join("\n");
}

// Helper to get date from days ago
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

// Define tools for the AI agent
const transactionTools = {
  searchTransactions: tool({
    description: "Search transactions by keyword, date range, and/or amount. Use this to find specific transactions or filter by criteria.",
    inputSchema: z.object({
      keyword: z.string().optional().describe("Search term to match against merchant name or transaction name"),
      days: z.number().optional().describe("Number of days to look back (e.g., 7, 14, 30, 90). Defaults to 30."),
      startDate: z.string().optional().describe("Start date in YYYY-MM-DD format"),
      endDate: z.string().optional().describe("End date in YYYY-MM-DD format"),
      minAmount: z.number().optional().describe("Minimum transaction amount (positive number)"),
      maxAmount: z.number().optional().describe("Maximum transaction amount (positive number)"),
      amountEquals: z.number().optional().describe("Exact transaction amount to match"),
      category: z.string().optional().describe("Filter by category (e.g., FOOD_AND_DRINK, SHOPPING, TRANSPORTATION)"),
      limit: z.number().optional().describe("Max number of results to return. Defaults to 50."),
    }),
    execute: async ({ keyword, days, startDate, endDate, minAmount, maxAmount, amountEquals, category, limit }) => {
      const conditions = [];

      // Date filtering
      if (startDate) {
        conditions.push(gte(transactions.date, startDate));
      } else if (days) {
        conditions.push(gte(transactions.date, getDateDaysAgo(days)));
      } else {
        // Default to last 30 days
        conditions.push(gte(transactions.date, getDateDaysAgo(30)));
      }

      if (endDate) {
        conditions.push(lte(transactions.date, endDate));
      }

      // Keyword search
      if (keyword) {
        conditions.push(
          or(
            like(transactions.merchantName, `%${keyword}%`),
            like(transactions.name, `%${keyword}%`)
          )
        );
      }

      // Amount filtering (only spending - positive amounts)
      if (amountEquals !== undefined) {
        conditions.push(eq(transactions.amount, amountEquals.toString()));
      } else {
        if (minAmount !== undefined) {
          conditions.push(gte(transactions.amount, minAmount.toString()));
        }
        if (maxAmount !== undefined) {
          conditions.push(lte(transactions.amount, maxAmount.toString()));
        }
      }

      // Category filtering
      if (category) {
        conditions.push(eq(transactions.primaryCategory, category));
      }

      const results = await db
        .select()
        .from(transactions)
        .where(and(...conditions))
        .orderBy(desc(transactions.date))
        .limit(limit || 50);

      // Calculate totals
      const totalSpending = results
        .filter((tx) => parseFloat(tx.amount) > 0)
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

      return {
        count: results.length,
        totalSpending: totalSpending.toFixed(2),
        transactions: results.map((tx) => ({
          date: tx.date,
          merchant: tx.merchantName || tx.name,
          amount: parseFloat(tx.amount).toFixed(2),
          category: tx.primaryCategory,
        })),
      };
    },
  }),

  getSpendingSummary: tool({
    description: "Get a summary of spending grouped by category or merchant for a time period.",
    inputSchema: z.object({
      groupBy: z.enum(["category", "merchant"]).describe("Group spending by category or merchant"),
      days: z.number().optional().describe("Number of days to look back. Defaults to 30."),
      topN: z.number().optional().describe("Return only top N results. Defaults to 10."),
    }),
    execute: async ({ groupBy, days, topN }) => {
      const startDate = getDateDaysAgo(days || 30);

      const results = await db
        .select()
        .from(transactions)
        .where(
          and(
            gte(transactions.date, startDate),
            gt(transactions.amount, "0") // Only spending
          )
        );

      // Group and sum
      const grouped: Record<string, { total: number; count: number }> = {};

      for (const tx of results) {
        const key = groupBy === "category" 
          ? (tx.primaryCategory || "UNCATEGORIZED")
          : (tx.merchantName || tx.name);
        
        if (!grouped[key]) {
          grouped[key] = { total: 0, count: 0 };
        }
        grouped[key].total += parseFloat(tx.amount);
        grouped[key].count += 1;
      }

      // Sort by total and take top N
      const sorted = Object.entries(grouped)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, topN || 10);

      const totalSpending = Object.values(grouped).reduce((sum, g) => sum + g.total, 0);

      return {
        periodDays: days || 30,
        totalSpending: totalSpending.toFixed(2),
        breakdown: sorted.map(([name, data]) => ({
          name,
          total: data.total.toFixed(2),
          count: data.count,
          percentage: ((data.total / totalSpending) * 100).toFixed(1),
        })),
      };
    },
  }),

  getTopMerchants: tool({
    description: "Get the merchants where the user spends the most money.",
    inputSchema: z.object({
      days: z.number().optional().describe("Number of days to look back. Defaults to 30."),
      limit: z.number().optional().describe("Number of top merchants to return. Defaults to 5."),
    }),
    execute: async ({ days, limit }) => {
      const startDate = getDateDaysAgo(days || 30);

      const results = await db
        .select()
        .from(transactions)
        .where(
          and(
            gte(transactions.date, startDate),
            gt(transactions.amount, "0") // Only spending
          )
        );

      // Group by merchant
      const merchants: Record<string, { total: number; count: number; lastVisit: string }> = {};

      for (const tx of results) {
        const merchant = tx.merchantName || tx.name;
        if (!merchants[merchant]) {
          merchants[merchant] = { total: 0, count: 0, lastVisit: tx.date };
        }
        merchants[merchant].total += parseFloat(tx.amount);
        merchants[merchant].count += 1;
        if (tx.date > merchants[merchant].lastVisit) {
          merchants[merchant].lastVisit = tx.date;
        }
      }

      // Sort by total spending
      const sorted = Object.entries(merchants)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, limit || 5);

      return {
        periodDays: days || 30,
        topMerchants: sorted.map(([name, data], index) => ({
          rank: index + 1,
          merchant: name,
          totalSpent: data.total.toFixed(2),
          visits: data.count,
          lastVisit: data.lastVisit,
        })),
      };
    },
  }),
};

// Type for the message sender callback
type MessageSender = (message: string) => Promise<void>;

// Create tools with the sendMessage capability
function createTools(sendMessageFn?: MessageSender) {
  return {
    ...transactionTools,
    
    sendMessage: tool({
      description: "Send an interim text message to the user while you continue working. Use this to acknowledge their question, say you're looking something up, or share partial findings before your final response. Makes the conversation feel more natural.",
      inputSchema: z.object({
        message: z.string().describe("The message to send to the user"),
      }),
      execute: async ({ message }) => {
        if (sendMessageFn) {
          await sendMessageFn(message);
          return { sent: true, message };
        }
        return { sent: false, reason: "no message sender configured" };
      },
    }),
  };
}

// Generate a response to a user message
export async function generateResponse(
  conversationId: string,
  userMessage: string,
  sendMessageFn?: MessageSender
): Promise<string> {
  console.log(`[Agent] ========== GENERATING RESPONSE ==========`);
  console.log(`[Agent] Conversation ID: ${conversationId}`);
  console.log(`[Agent] User message: "${userMessage}"`);
  
  const context = await loadConversationContext(conversationId);

  const messagesForAI = [
    ...context.messages,
    { role: "user" as const, content: userMessage },
  ];

  console.log(`[Agent] === MESSAGES BEING SENT TO AI (${messagesForAI.length} total) ===`);
  messagesForAI.forEach((m, i) => {
    const preview = m.content.length > 150 ? m.content.substring(0, 150) + "..." : m.content;
    console.log(`[Agent]   [${i + 1}] ${m.role.toUpperCase()}: ${preview}`);
  });
  console.log(`[Agent] === END MESSAGES FOR AI ===`);
  
  // Build dynamic system prompt with context
  const systemPrompt = buildSystemPrompt(context.recentTransactions);
  
  console.log(`[Agent] System prompt length: ${systemPrompt.length} chars`);
  console.log(`[Agent] Available tools: searchTransactions, getSpendingSummary, getTopMerchants, sendMessage`);
  console.log(`[Agent] Calling Claude Sonnet 4.5 via OpenCode Zen...`);

  const tools = createTools(sendMessageFn);

  const startTime = Date.now();
  const { text, steps, toolCalls, toolResults } = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    system: systemPrompt,
    messages: messagesForAI,
    tools,
    stopWhen: stepCountIs(5), // Allow multiple tool calls if needed
  });
  const duration = Date.now() - startTime;

  console.log(`[Agent] AI response received in ${duration}ms`);
  console.log(`[Agent] Steps taken: ${steps?.length || 0}`);
  console.log(`[Agent] Tool calls made: ${toolCalls?.length || 0}`);
  
  if (toolCalls && toolCalls.length > 0) {
    console.log(`[Agent] === TOOL CALLS ===`);
    toolCalls.forEach((tc, i) => {
      const args = 'args' in tc ? tc.args : {};
      console.log(`[Agent]   [${i + 1}] ${tc.toolName}(${JSON.stringify(args).substring(0, 200)})`);
    });
    console.log(`[Agent] === END TOOL CALLS ===`);
  }

  console.log(`[Agent] === FINAL RESPONSE ===`);
  console.log(`[Agent] ${text}`);
  console.log(`[Agent] === END FINAL RESPONSE ===`);
  console.log(`[Agent] ========== END GENERATION ==========`);

  return text;
}

// Get recent transaction history for context
async function getRecentTransactionHistory(): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

  const recentTxs = await db
    .select()
    .from(transactions)
    .where(gte(transactions.date, dateStr))
    .orderBy(desc(transactions.date))
    .limit(100);

  return formatTransactionsForContext(recentTxs);
}

// Generate an alert message for a single transaction
export async function generateSingleTransactionAlert(
  tx: Transaction
): Promise<string> {
  const amount = parseFloat(tx.amount);
  
  // Skip non-spending transactions
  if (amount <= 0) {
    return "";
  }

  const merchant = tx.merchantName || tx.name;

  // Get stats for THIS merchant only in the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

  const merchantTxs = await db
    .select()
    .from(transactions)
    .where(
      and(
        gte(transactions.date, dateStr),
        or(
          like(transactions.merchantName, `%${merchant}%`),
          like(transactions.name, `%${merchant}%`)
        )
      )
    );

  // Calculate merchant-specific stats
  const visitCount = merchantTxs.length;
  const totalSpent = merchantTxs.reduce((sum, t) => sum + parseFloat(t.amount), 0);

  const txDetails = {
    merchant,
    amount: amount.toFixed(2),
    category: tx.primaryCategory,
    thisMonthVisits: visitCount,
    thisMonthTotal: totalSpent.toFixed(2),
  };

  // Get recent transactions for context
  const thirtyDaysAgoForContext = new Date();
  thirtyDaysAgoForContext.setDate(thirtyDaysAgoForContext.getDate() - 30);
  const contextDateStr = thirtyDaysAgoForContext.toISOString().split("T")[0];
  
  const recentTxsForContext = await db
    .select()
    .from(transactions)
    .where(gte(transactions.date, contextDateStr))
    .orderBy(desc(transactions.date))
    .limit(100);
  
  const systemPrompt = buildSystemPrompt(recentTxsForContext);

  const { text } = await generateText({
    model: anthropic("claude-sonnet-4-5"),
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `new charge: $${txDetails.amount} at ${txDetails.merchant}

this month's stats for ${txDetails.merchant}: ${txDetails.thisMonthVisits} visits, $${txDetails.thisMonthTotal} total

generate a short, casual text alert (1-2 sentences max). only mention the pattern if it's notable (3+ visits or $50+ at this place this month). otherwise just a quick heads up about the charge. keep it natural like texting a friend.`,
      },
    ],
  });

  return text;
}

// Save a message to the conversation
export async function saveMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  loopMessageId?: string,
  transactionId?: string
): Promise<void> {
  const messageId = crypto.randomUUID();
  const preview = content.length > 100 ? content.substring(0, 100) + "..." : content;
  console.log(`[Agent] Saving ${role} message to conversation ${conversationId}: "${preview}"`);
  
  await db.insert(aiMessages).values({
    id: messageId,
    conversationId,
    role,
    content,
    loopMessageId,
    transactionId,
  });

  // Update conversation's lastMessageAt
  await db
    .update(aiConversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(aiConversations.id, conversationId));
    
  console.log(`[Agent] Message saved with ID: ${messageId}`);
}
