import { generateText, tool, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { withSupermemory, supermemoryTools } from "@supermemory/tools/ai-sdk";
import { z } from "zod";
import { db, transactions, aiMessages, aiConversations } from "@/lib/db";
import { eq, desc, and, gte, lte, gt, lt, like, or, sql } from "drizzle-orm";
import type { Transaction, AiMessage } from "@/lib/db/schema";
import { sendReaction as loopSendReaction } from "@/lib/loop";
import { searchWeb, searchNews, askQuestion } from "@/lib/exa";
import { getContainerTag, getSupermemoryApiKey } from "@/lib/supermemory";

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
- NEVER use markdown formatting (no **bold**, *italics*, \`code\`, bullet points, headers, etc) - this is plain text over iMessage, markdown won't render
- no emojis unless it really fits
- be real with people about their spending - if they're blowing money somewhere, tell them
- give specific numbers, not vague answers

when alerting about new transactions:
- keep it super short: emoji + amount + merchant
- examples: "☕ $5.52 at foxtail coffee" or "🍕 $32.50 at dominos" or "⛽ $45.00 at shell"
- pick an emoji that matches the category (coffee, food, gas, shopping, etc)
- ONLY add extra commentary if there's a notable pattern worth mentioning
- if it's their 3rd+ visit somewhere this week or they're spending a lot in one category, then add a short note like "3rd coffee this week, $18 total"
- don't say things like "just saw" or "hit your account" - just the emoji, amount, and place

categorizing transactions:
- when you see a transaction, decide if you understand what it is
- if you recognize it (clear merchant name, known category like food/gas/shopping), tag it with an appropriate category before sending the alert
- use the tagTransaction tool to add tags like "food", "coffee", "gas", "groceries", "entertainment", "shopping", "subscription", etc
- do this silently - don't mention that you're tagging it
- if the merchant name is cryptic, vague, or you genuinely don't know what it is (random letters, POS DEBIT, unclear abbreviations), ask the user
- vary how you ask - don't use the same phrasing every time. examples of asking:
  - "$34.23 from VELOMIX, what is this?"
  - "$12.50 at XYZ CORP - what was that for?"
  - "got a $67.00 charge from MTNVIEW LLC, do you know what that is?"
  - "$25.00 from STRIPE* something - ring a bell?"
- when they reply and explain what it was, tag it appropriately and react with 👍 or just say something brief like "got it" or "ah cool"

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
- getTopMerchants: see top spending locations
- tagTransaction: add tags to a transaction (e.g., "business", "vacation", "reimbursable") - great for tracking expenses
- addTransactionNote: add a note to a transaction (e.g., "lunch with client", "birthday gift for mom")
- attachImageToTransaction: attach a receipt or screenshot to a transaction
- getTransactionsByTag: find all transactions with a specific tag
- searchWeb: search the internet for information (companies, products, general knowledge)
- searchNews: search recent news articles
- askQuestion: get a direct answer to a factual question with sources
- sendReaction: react to a message with love/like/laugh/etc - use this like you would in a normal text convo
- noResponse: use this when you don't need to say anything (e.g., user just reacted to your message, or sent something that doesn't need a reply)

web search:
- use search tools when the user asks about something you don't know or need current info on
- great for: "what is [company]?", "latest news about [topic]", "is [store] having a sale?"
- if they ask about a merchant they spent money at, you can search to learn more about it

tagging & notes:
- if the user asks you to remember something about a transaction, tag it or add a note
- if they send a receipt image, ask if they want to attach it to a recent transaction
- common tags: "business", "personal", "reimbursable", "tax deductible", "vacation", "gift", "split"
- you can search transactions first to find the right one, then tag/note it

reacting to messages:
- you can react to messages just like a human would
- if someone sends you something funny, laugh at it
- if they share good news, heart it
- if they just react to your message (like hearting it), you usually don't need to respond at all - just use noResponse
- be natural about it - don't react to everything, only when it feels right

images:
- users can send you screenshots or images
- if they send an image, describe what you see and help them with whatever they're asking about
- if it's a screenshot of a transaction or receipt, help them understand it

memory & personalization:
- you have long-term memory about this user - their profile info is automatically available to you
- memories include things they've told you: budgets, preferences, goals, personal info
- if the user tells you something important (budget, preference, goal, name, etc), it gets automatically saved
- you can also explicitly save a memory using addMemory tool for important things
- use searchMemories tool to recall specific past conversations or find relevant memories
- example things to remember: "my eating out budget is $400/month", "i want to cut back on coffee", "my name is Ryan"
- use their memories to personalize responses - if you know their budget, mention when they're close to it`;

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
        let line = `  ${sign}$${Math.abs(amount).toFixed(2)} ${tx.merchantName || tx.name}`;
        if (tx.primaryCategory) line += ` (${tx.primaryCategory})`;
        if (tx.pending) line += " [pending]";
        if (tx.tags) {
          try {
            const tags = JSON.parse(tx.tags) as string[];
            if (tags.length > 0) line += ` [tags: ${tags.join(", ")}]`;
          } catch {}
        }
        if (tx.notes) line += ` [note: ${tx.notes}]`;
        line += ` | id:${tx.id}`;
        prompt += line + "\n";
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
          id: tx.id,
          date: tx.date,
          merchant: tx.merchantName || tx.name,
          amount: parseFloat(tx.amount).toFixed(2),
          category: tx.primaryCategory,
          tags: tx.tags ? JSON.parse(tx.tags) : undefined,
          note: tx.notes || undefined,
          hasAttachments: !!tx.attachments,
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

  tagTransaction: tool({
    description: "Add or update tags on a transaction. Tags help categorize transactions for tracking purposes (e.g., 'business expense', 'vacation', 'reimbursable', 'gift'). You can find transactions first using searchTransactions, then tag them.",
    inputSchema: z.object({
      transactionId: z.string().describe("The transaction ID to tag"),
      tags: z.array(z.string()).describe("Array of tags to set on the transaction (replaces existing tags)"),
    }),
    execute: async ({ transactionId, tags }) => {
      // Verify transaction exists
      const tx = await db.query.transactions.findFirst({
        where: eq(transactions.id, transactionId),
      });

      if (!tx) {
        return { success: false, error: "Transaction not found" };
      }

      // Update tags
      await db
        .update(transactions)
        .set({ 
          tags: JSON.stringify(tags),
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));

      return { 
        success: true, 
        transactionId,
        merchant: tx.merchantName || tx.name,
        amount: tx.amount,
        date: tx.date,
        tags,
      };
    },
  }),

  addTransactionNote: tool({
    description: "Add or update a note on a transaction. Notes are free-form text for recording context about a transaction (e.g., 'Lunch with client John', 'Birthday gift for mom', 'Split with roommate').",
    inputSchema: z.object({
      transactionId: z.string().describe("The transaction ID to add a note to"),
      note: z.string().describe("The note text to save"),
    }),
    execute: async ({ transactionId, note }) => {
      // Verify transaction exists
      const tx = await db.query.transactions.findFirst({
        where: eq(transactions.id, transactionId),
      });

      if (!tx) {
        return { success: false, error: "Transaction not found" };
      }

      // Update note
      await db
        .update(transactions)
        .set({ 
          notes: note,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));

      return { 
        success: true, 
        transactionId,
        merchant: tx.merchantName || tx.name,
        amount: tx.amount,
        date: tx.date,
        note,
      };
    },
  }),

  getTransactionsByTag: tool({
    description: "Find all transactions with a specific tag.",
    inputSchema: z.object({
      tag: z.string().describe("The tag to search for"),
      days: z.number().optional().describe("Number of days to look back. Defaults to 90."),
    }),
    execute: async ({ tag, days }) => {
      const startDate = getDateDaysAgo(days || 90);

      // Get all transactions with tags in the date range
      const results = await db
        .select()
        .from(transactions)
        .where(
          and(
            gte(transactions.date, startDate),
            sql`${transactions.tags} IS NOT NULL`
          )
        )
        .orderBy(desc(transactions.date));

      // Filter by tag (need to parse JSON and check)
      const tagged = results.filter(tx => {
        if (!tx.tags) return false;
        try {
          const txTags = JSON.parse(tx.tags) as string[];
          return txTags.some(t => t.toLowerCase() === tag.toLowerCase());
        } catch {
          return false;
        }
      });

      const totalSpending = tagged
        .filter(tx => parseFloat(tx.amount) > 0)
        .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

      return {
        tag,
        count: tagged.length,
        totalSpending: totalSpending.toFixed(2),
        transactions: tagged.map(tx => ({
          id: tx.id,
          date: tx.date,
          merchant: tx.merchantName || tx.name,
          amount: parseFloat(tx.amount).toFixed(2),
          tags: tx.tags ? JSON.parse(tx.tags) : [],
          note: tx.notes,
        })),
      };
    },
  }),

  attachImageToTransaction: tool({
    description: "Attach an image (receipt, screenshot, etc.) to a transaction. Use this when the user sends you an image and wants to associate it with a specific transaction. You can attach multiple images by calling this multiple times.",
    inputSchema: z.object({
      transactionId: z.string().describe("The transaction ID to attach the image to"),
      imageUrl: z.string().describe("The URL of the image to attach"),
      description: z.string().optional().describe("Optional description of what the image is (e.g., 'receipt', 'order confirmation')"),
    }),
    execute: async ({ transactionId, imageUrl, description }) => {
      // Verify transaction exists
      const tx = await db.query.transactions.findFirst({
        where: eq(transactions.id, transactionId),
      });

      if (!tx) {
        return { success: false, error: "Transaction not found" };
      }

      // Get existing attachments or start fresh
      let attachments: Array<{ url: string; description?: string; addedAt: string }> = [];
      if (tx.attachments) {
        try {
          attachments = JSON.parse(tx.attachments);
        } catch {
          attachments = [];
        }
      }

      // Add new attachment
      attachments.push({
        url: imageUrl,
        description,
        addedAt: new Date().toISOString(),
      });

      // Update transaction
      await db
        .update(transactions)
        .set({ 
          attachments: JSON.stringify(attachments),
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transactionId));

      return { 
        success: true, 
        transactionId,
        merchant: tx.merchantName || tx.name,
        amount: tx.amount,
        date: tx.date,
        attachmentCount: attachments.length,
        latestAttachment: { url: imageUrl, description },
      };
    },
  }),

  // === Web Search Tools (powered by Exa) ===

  searchWebTool: tool({
    description: "Search the internet for information about companies, products, services, or general knowledge. Use this when you need to look up something you don't know or need current information about.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
      numResults: z.number().optional().describe("Number of results to return (default 5)"),
    }),
    execute: async ({ query, numResults }) => {
      try {
        const results = await searchWeb({
          query,
          numResults: numResults || 5,
          type: "auto",
        });

        return {
          success: true,
          query,
          results: results.results.map(r => ({
            title: r.title,
            url: r.url,
            summary: r.summary || r.text?.substring(0, 300),
            publishedDate: r.publishedDate,
          })),
        };
      } catch (error) {
        console.error("Web search error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Search failed",
        };
      }
    },
  }),

  searchNewsTool: tool({
    description: "Search for recent news articles about a topic. Great for finding current events, company news, or trending topics.",
    inputSchema: z.object({
      query: z.string().describe("The news search query"),
      daysBack: z.number().optional().describe("How many days back to search (default 7)"),
      numResults: z.number().optional().describe("Number of results to return (default 5)"),
    }),
    execute: async ({ query, daysBack, numResults }) => {
      try {
        const results = await searchNews(query, {
          daysBack: daysBack || 7,
          numResults: numResults || 5,
        });

        return {
          success: true,
          query,
          daysBack: daysBack || 7,
          results: results.results.map(r => ({
            title: r.title,
            url: r.url,
            summary: r.summary || r.text?.substring(0, 300),
            publishedDate: r.publishedDate,
            author: r.author,
          })),
        };
      } catch (error) {
        console.error("News search error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "News search failed",
        };
      }
    },
  }),

  askQuestionTool: tool({
    description: "Get a direct, factual answer to a question with sources. Best for specific questions like 'What is X?', 'How much does Y cost?', 'When did Z happen?'",
    inputSchema: z.object({
      question: z.string().describe("The question to answer"),
    }),
    execute: async ({ question }) => {
      try {
        const result = await askQuestion({ query: question });

        return {
          success: true,
          question,
          answer: result.answer,
          sources: result.citations.map(c => ({
            title: c.title,
            url: c.url,
          })),
        };
      } catch (error) {
        console.error("Ask question error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get answer",
        };
      }
    },
  }),
};

// Type for the message sender callback
type MessageSender = (message: string) => Promise<void>;

// Type for the reaction sender callback
type ReactionSender = (messageId: string, reaction: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question") => Promise<void>;

// Response result that can indicate no response needed
export interface AgentResponse {
  text: string | null;
  didReact: boolean;
  noResponseNeeded: boolean;
}

// State tracker for tool execution
interface ToolState {
  noResponseCalled: boolean;
  didReact: boolean;
}

// Create tools with the sendMessage and sendReaction capabilities
function createTools(
  state: ToolState,
  sendMessageFn?: MessageSender,
  sendReactionFn?: ReactionSender,
  inboundMessageId?: string
) {
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
    
    sendReaction: tool({
      description: "React to the user's message with an iMessage tapback reaction. Use this naturally like you would in a real text conversation - heart something nice, laugh at something funny, etc. You can react AND send a text response, or just react without saying anything.",
      inputSchema: z.object({
        reaction: z.enum(["love", "like", "dislike", "laugh", "emphasize", "question"]).describe("The reaction to send: love (heart), like (thumbs up), dislike (thumbs down), laugh (haha), emphasize (!!), question (?)"),
      }),
      execute: async ({ reaction }) => {
        if (sendReactionFn && inboundMessageId) {
          await sendReactionFn(inboundMessageId, reaction);
          state.didReact = true;
          return { sent: true, reaction, messageId: inboundMessageId };
        }
        return { sent: false, reason: "no reaction sender configured or no message to react to" };
      },
    }),
    
    noResponse: tool({
      description: "Use this when you don't need to send a text response. For example: when the user just reacted to your message (like hearting it), when they sent something that doesn't need a reply, or after you've already reacted and don't want to add text.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Optional: why no response is needed"),
      }),
      execute: async ({ reason }) => {
        state.noResponseCalled = true;
        console.log(`[Agent] noResponse called: ${reason || "no reason given"}`);
        return { noResponse: true, reason };
      },
    }),
  };
}

// Input options for generateResponse
export interface GenerateResponseOptions {
  conversationId: string;
  phoneNumber: string;
  userMessage: string;
  imageUrls?: string[];
  inboundMessageId?: string;
  isReaction?: boolean;
  reactionType?: string;
  sendMessageFn?: MessageSender;
  sendReactionFn?: ReactionSender;
}

// Generate a response to a user message
export async function generateResponse(
  options: GenerateResponseOptions
): Promise<AgentResponse> {
  const {
    conversationId,
    phoneNumber,
    userMessage,
    imageUrls,
    inboundMessageId,
    isReaction,
    reactionType,
    sendMessageFn,
    sendReactionFn,
  } = options;

  console.log(`[Agent] ========== GENERATING RESPONSE ==========`);
  console.log(`[Agent] Conversation ID: ${conversationId}`);
  console.log(`[Agent] Phone number: ${phoneNumber}`);
  console.log(`[Agent] User message: "${userMessage}"`);
  console.log(`[Agent] Images: ${imageUrls?.length || 0}`);
  console.log(`[Agent] Is reaction: ${isReaction}, type: ${reactionType}`);
  console.log(`[Agent] Inbound message ID: ${inboundMessageId}`);
  
  // Get Supermemory container tag for this user
  const containerTag = getContainerTag(phoneNumber);
  console.log(`[Agent] Supermemory container tag: ${containerTag}`);
  
  const context = await loadConversationContext(conversationId);

  // Build the user message content (text + optional images)
  let userContent: string | Array<{ type: "text"; text: string } | { type: "image"; image: URL }>;
  
  if (imageUrls && imageUrls.length > 0) {
    // Multi-part message with images
    const parts: Array<{ type: "text"; text: string } | { type: "image"; image: URL }> = [];
    
    // Add images first
    for (const url of imageUrls) {
      parts.push({ type: "image", image: new URL(url) });
    }
    
    // Add text (or a prompt if no text)
    const textPart = userMessage || "[User sent an image]";
    parts.push({ type: "text", text: textPart });
    
    userContent = parts;
  } else {
    userContent = userMessage;
  }

  const messagesForAI = [
    ...context.messages,
    { role: "user" as const, content: userContent },
  ];

  console.log(`[Agent] === MESSAGES BEING SENT TO AI (${messagesForAI.length} total) ===`);
  messagesForAI.forEach((m, i) => {
    const preview = typeof m.content === "string" 
      ? (m.content.length > 150 ? m.content.substring(0, 150) + "..." : m.content)
      : `[Multi-part: ${Array.isArray(m.content) ? m.content.length : 1} parts]`;
    console.log(`[Agent]   [${i + 1}] ${m.role.toUpperCase()}: ${preview}`);
  });
  console.log(`[Agent] === END MESSAGES FOR AI ===`);
  
  // Build dynamic system prompt with context
  const systemPrompt = buildSystemPrompt(context.recentTransactions);
  
  console.log(`[Agent] System prompt length: ${systemPrompt.length} chars`);
  console.log(`[Agent] Available tools: searchTransactions, getSpendingSummary, getTopMerchants, sendMessage, sendReaction, noResponse, searchMemories, addMemory`);
  console.log(`[Agent] Calling Claude Opus 4.5 via OpenCode Zen with Supermemory...`);

  // Create state tracker and tools
  const state: ToolState = { noResponseCalled: false, didReact: false };
  const baseTools = createTools(state, sendMessageFn, sendReactionFn, inboundMessageId);
  
  // Add Supermemory tools for explicit memory operations
  const supermemoryApiKey = getSupermemoryApiKey();
  const memoryTools = supermemoryTools(supermemoryApiKey, { containerTags: [containerTag] });
  const tools = {
    ...baseTools,
    // Cast to any to avoid TypeScript version mismatch between supermemory and ai SDK
    searchMemories: memoryTools.searchMemories as any,
    addMemory: memoryTools.addMemory as any,
  };

  // Wrap the model with Supermemory for automatic profile injection and memory saving
  const baseModel = anthropic("claude-opus-4-5");
  const modelWithMemory = withSupermemory(baseModel, containerTag, {
    apiKey: supermemoryApiKey,
    mode: "full", // Use both profile and query-based memory search
    addMemory: "always", // Automatically save memories from conversations
  });

  const startTime = Date.now();
  const { text, steps, toolCalls, toolResults } = await generateText({
    model: modelWithMemory,
    system: systemPrompt,
    messages: messagesForAI,
    tools,
    stopWhen: stepCountIs(5), // Allow multiple tool calls if needed
  });
  const duration = Date.now() - startTime;

  console.log(`[Agent] AI response received in ${duration}ms`);
  console.log(`[Agent] Steps taken: ${steps?.length || 0}`);
  console.log(`[Agent] Tool calls made: ${toolCalls?.length || 0}`);
  console.log(`[Agent] State: noResponseCalled=${state.noResponseCalled}, didReact=${state.didReact}`);
  
  if (toolCalls && toolCalls.length > 0) {
    console.log(`[Agent] === TOOL CALLS ===`);
    toolCalls.forEach((tc, i) => {
      const args = 'args' in tc ? tc.args : {};
      console.log(`[Agent]   [${i + 1}] ${tc.toolName}(${JSON.stringify(args).substring(0, 200)})`);
    });
    console.log(`[Agent] === END TOOL CALLS ===`);
  }

  console.log(`[Agent] === FINAL RESPONSE ===`);
  console.log(`[Agent] ${text || "(no text response)"}`);
  console.log(`[Agent] === END FINAL RESPONSE ===`);
  console.log(`[Agent] ========== END GENERATION ==========`);

  return {
    text: state.noResponseCalled ? null : (text || null),
    didReact: state.didReact,
    noResponseNeeded: state.noResponseCalled,
  };
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
    transactionId: tx.id,
    merchant,
    amount: amount.toFixed(2),
    category: tx.primaryCategory,
    detailedCategory: tx.detailedCategory,
    thisMonthVisits: visitCount,
    thisMonthTotal: totalSpent.toFixed(2),
  };

  // Check if the merchant name looks cryptic/unknown
  const isCrypticMerchant = detectCrypticMerchant(merchant, tx.primaryCategory);

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

  // Create a minimal tool state for the tagTransaction tool
  const state: ToolState = { noResponseCalled: false, didReact: false };
  const tools = createTools(state);

  const { text } = await generateText({
    model: anthropic("claude-opus-4-5"),
    system: systemPrompt,
    tools: {
      tagTransaction: tools.tagTransaction,
    },
    messages: [
      {
        role: "user",
        content: `new transaction to alert on:
- transaction id: ${txDetails.transactionId}
- amount: $${txDetails.amount}
- merchant: ${txDetails.merchant}
- plaid category: ${txDetails.category || "unknown"}
- detailed category: ${txDetails.detailedCategory || "unknown"}
- this month stats for this merchant: ${txDetails.thisMonthVisits} visits, $${txDetails.thisMonthTotal} total
- merchant name appears cryptic: ${isCrypticMerchant ? "YES" : "no"}

your job:
1. first, decide: do you understand what this transaction is for?
   - if YES (clear merchant like "starbucks", "amazon", "shell", or recognizable category): tag it with an appropriate category tag (food, coffee, gas, groceries, shopping, entertainment, subscription, etc) using the tagTransaction tool, then send a normal alert
   - if NO (cryptic merchant name, vague category, random abbreviations): ask the user what it is

2. for known transactions:
   - use tagTransaction to add a category tag (silently, don't mention it)
   - then respond with: [emoji] $amount at merchant
   - example: "☕ $5.52 at foxtail coffee"
   - only add extra text if notable pattern (3+ visits this week or $50+ total this month)

3. for unknown/cryptic transactions:
   - DON'T tag it yet (wait for user to explain)
   - ask what it is in a casual, varied way. examples:
     - "$34.23 from VELOMIX, what is this?"
     - "$12.50 at XYZ CORP - what was that for?"
     - "got a $67.00 charge from MTNVIEW LLC, do you know what that is?"
   - keep it short and natural`,
      },
    ],
    stopWhen: stepCountIs(2), // Allow one tool call + final response
  });

  return text;
}

// Detect if a merchant name looks cryptic/unknown
function detectCrypticMerchant(merchantName: string, category: string | null): boolean {
  const name = merchantName.toUpperCase();
  
  // Patterns that suggest a cryptic/unclear merchant
  const crypticPatterns = [
    /^POS\s/,           // POS DEBIT, POS PURCHASE
    /^CHECKCARD\s/,     // CHECKCARD transactions
    /^DEBIT\s/,         // Generic debit
    /^ACH\s/,           // ACH transfers
    /^PURCHASE\s/,      // Generic purchase
    /^SQ\s?\*/,         // Square transactions (SQ *SOMETHING)
    /^TST\s?\*/,        // Toast transactions (TST* or TST *)
    /^STRIPE\s?\*/,     // Stripe transactions
    /^PP\s?\*/,         // PayPal transactions
    /^PAYPAL\s?\*/,     // PayPal
    /^VENMO\s/,         // Venmo (often unclear what for)
    /^ZELLE\s/,         // Zelle transfers
    /^CKE\s/,           // Check card
    /^[A-Z]{2,4}\d{5,}/, // Random letter+number combos
    /^\d{5,}/,          // Starts with lots of numbers
    /^[A-Z]{10,}$/,     // Very long single word with no spaces
  ];
  
  // Check if name matches cryptic patterns
  for (const pattern of crypticPatterns) {
    if (pattern.test(name)) {
      return true;
    }
  }
  
  // If category is null, OTHER, or very generic, lean toward cryptic
  if (!category || category === "OTHER" || category === "GENERAL_SERVICES") {
    // But only if the name also looks weird (short, all caps abbreviation, etc)
    if (name.length <= 6 && !/\s/.test(name)) {
      return true; // Short single word, no spaces - probably cryptic
    }
  }
  
  return false;
}

// Generate a spending summary (midweek or end-of-week)
export async function generateSpendingSummary(
  type: "midweek" | "end-of-week"
): Promise<string> {
  const now = new Date();
  const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  
  // Calculate date ranges
  const today = now.toISOString().split("T")[0];
  
  // Start of this week (Sunday)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const startOfWeekStr = startOfWeek.toISOString().split("T")[0];
  
  // Start of this month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfMonthStr = startOfMonth.toISOString().split("T")[0];
  
  // Get this week's transactions
  const weekTxs = await db
    .select()
    .from(transactions)
    .where(
      and(
        gte(transactions.date, startOfWeekStr),
        gt(transactions.amount, "0") // Only spending
      )
    )
    .orderBy(desc(transactions.date));
  
  // Get this month's transactions
  const monthTxs = await db
    .select()
    .from(transactions)
    .where(
      and(
        gte(transactions.date, startOfMonthStr),
        gt(transactions.amount, "0")
      )
    )
    .orderBy(desc(transactions.date));
  
  // Calculate totals
  const weekTotal = weekTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
  const monthTotal = monthTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
  
  // Group by category
  const categorySpending: Record<string, { total: number; count: number }> = {};
  for (const tx of weekTxs) {
    const cat = tx.primaryCategory || "UNCATEGORIZED";
    if (!categorySpending[cat]) categorySpending[cat] = { total: 0, count: 0 };
    categorySpending[cat].total += parseFloat(tx.amount);
    categorySpending[cat].count += 1;
  }
  
  // Top merchants this week
  const merchantSpending: Record<string, { total: number; count: number }> = {};
  for (const tx of weekTxs) {
    const merchant = tx.merchantName || tx.name;
    if (!merchantSpending[merchant]) merchantSpending[merchant] = { total: 0, count: 0 };
    merchantSpending[merchant].total += parseFloat(tx.amount);
    merchantSpending[merchant].count += 1;
  }
  
  // Sort categories and merchants
  const topCategories = Object.entries(categorySpending)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);
  
  const topMerchants = Object.entries(merchantSpending)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);
  
  // Build the prompt based on type
  const dayOfWeek = estNow.toLocaleDateString("en-US", { weekday: "long" });
  const promptType = type === "midweek" 
    ? "midweek check-in (Wednesday)" 
    : "end-of-week summary (Sunday)";
  
  const dataBlock = `
SUMMARY TYPE: ${promptType}
TODAY: ${dayOfWeek}, ${today}

THIS WEEK SO FAR:
- Total spent: $${weekTotal.toFixed(2)}
- Transactions: ${weekTxs.length}

TOP CATEGORIES THIS WEEK:
${topCategories.map(([cat, data]) => `- ${cat}: $${data.total.toFixed(2)} (${data.count} transactions)`).join("\n")}

TOP MERCHANTS THIS WEEK:
${topMerchants.map(([merchant, data]) => `- ${merchant}: $${data.total.toFixed(2)} (${data.count} visits)`).join("\n")}

MONTH TO DATE:
- Total spent: $${monthTotal.toFixed(2)}
- Transactions: ${monthTxs.length}
`;

  // Get recent transactions for context
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const contextDateStr = thirtyDaysAgo.toISOString().split("T")[0];
  
  const recentTxsForContext = await db
    .select()
    .from(transactions)
    .where(gte(transactions.date, contextDateStr))
    .orderBy(desc(transactions.date))
    .limit(100);
  
  const systemPrompt = buildSystemPrompt(recentTxsForContext);

  const { text } = await generateText({
    model: anthropic("claude-opus-4-5"),
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `generate a ${type} spending summary text message.

${dataBlock}

guidelines:
- keep it casual and brief like a text from a friend
- lead with the most important insight (biggest category, notable pattern, etc)
- mention 2-3 key things: total spent, top category, maybe a standout merchant
- ${type === "midweek" ? "this is a midweek check-in to help them stay on track for the rest of the week" : "this is an end-of-week wrap-up, give them a sense of how the week went"}
- if there are any concerning patterns (lots of eating out, frequent small purchases adding up), mention it gently
- keep it SHORT - this is a text message, not a report
- no emojis unless they really fit
- example style: "hey, quick ${type === "midweek" ? "midweek" : "weekly"} update - you've spent $X so far this week, mostly on [category]. [one insight or observation]"`,
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
