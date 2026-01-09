# SpendAlert - Agent Guidelines

## Project Overview

SpendAlert is a personal finance dashboard built with Next.js 16, React 19, and TypeScript. It integrates with Plaid for bank account connections and transaction syncing, storing data in Neon Postgres via Drizzle ORM.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5 (strict mode)
- **Runtime**: Bun
- **Database**: Neon Postgres with Drizzle ORM
- **UI**: Tailwind CSS v4, shadcn/ui (radix-mira style)
- **Banking**: Plaid API (production)
- **Icons**: @hugeicons/react

## Build & Development Commands

```bash
# Install dependencies
bun install

# Development server
bun run dev

# Production build
bun run build

# Start production server
bun run start

# Linting
bun run lint

# Database commands
bun run db:generate  # Generate migrations
bun run db:push      # Push schema to database
bun run db:studio    # Open Drizzle Studio
```

## Testing

No test framework is currently configured. If tests are added, prefer:
- Vitest for unit tests
- Playwright for E2E tests

## Code Style Guidelines

### File Naming
- Use **kebab-case** for files: `plaid-link.tsx`, `create-link-token/route.ts`
- Use **PascalCase** for components: `PlaidLinkButton`
- Use **camelCase** for functions and variables

### Imports
- Use path alias `@/*` for imports from project root
- Group imports: React/Next, external packages, internal modules, types
- Prefer named exports for utilities, default exports for pages/components

```typescript
// Example import order
import { NextRequest, NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { plaidClient } from "@/lib/plaid";
import { db, plaidItems } from "@/lib/db";
import type { Transaction } from "@/lib/db/schema";
```

### TypeScript
- Strict mode enabled - no implicit any
- Define interfaces for data shapes at top of file
- Use `type` for unions/intersections, `interface` for object shapes
- Prefer explicit return types on exported functions

```typescript
interface Transaction {
  id: string;
  amount: number;
  // ...
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ...
}
```

### Error Handling
- Use try/catch for async operations
- Type errors as `unknown`, then narrow with `instanceof Error`
- Return structured error responses with appropriate status codes

```typescript
try {
  // operation
} catch (error: unknown) {
  console.error("Error description:", error);
  const errorMessage =
    error instanceof Error ? error.message : "Fallback message";
  return NextResponse.json({ error: errorMessage }, { status: 500 });
}
```

### API Routes
- Located in `app/api/[feature]/[action]/route.ts`
- Use `NextRequest` and `NextResponse` from `next/server`
- Validate required parameters early
- Return JSON with consistent structure

```typescript
// Success
return NextResponse.json({ data, success: true });

// Error
return NextResponse.json({ error: "message" }, { status: 400 });
```

### Database (Drizzle)
- Schema defined in `lib/db/schema.ts`
- Use `eq`, `and`, `or` from `drizzle-orm` for queries
- Always use `onConflictDoUpdate` for upserts
- Export types with `$inferSelect` and `$inferInsert`

```typescript
import { db, transactions } from "@/lib/db";
import { eq, desc } from "drizzle-orm";

const txs = await db
  .select()
  .from(transactions)
  .where(eq(transactions.accountId, id))
  .orderBy(desc(transactions.date));
```

### React Components
- Use `"use client"` directive for client components
- Functional components only
- Use `useCallback` for memoized callbacks
- Prefer controlled components

### Styling
- Use Tailwind CSS utility classes
- Use `cn()` utility from `@/lib/utils` for conditional classes
- Follow shadcn/ui patterns for component variants
- Use CSS variables defined in `app/globals.css`

```typescript
import { cn } from "@/lib/utils";

<div className={cn("base-classes", condition && "conditional-class")} />
```

## Project Structure

```
spendalert.me/
├── app/
│   ├── api/plaid/           # Plaid API routes
│   │   ├── create-link-token/
│   │   ├── exchange-token/
│   │   ├── transactions/
│   │   └── webhook/
│   ├── dashboard/           # Dashboard page
│   ├── globals.css          # Global styles
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Home page
├── components/
│   ├── ui/                  # shadcn/ui components
│   └── plaid-link.tsx       # Plaid Link component
├── lib/
│   ├── db/
│   │   ├── index.ts         # Drizzle client
│   │   └── schema.ts        # Database schema
│   ├── plaid.ts             # Plaid client
│   └── utils.ts             # Utility functions
├── drizzle.config.ts        # Drizzle Kit config
└── package.json
```

## Environment Variables

Required in `.env.local`:

```env
DATABASE_URL=           # Neon Postgres connection string
PLAID_CLIENT_ID=        # Plaid client ID
PLAID_SECRET=           # Plaid secret key
PLAID_ENV=production    # sandbox | development | production
PLAID_WEBHOOK_URL=      # Public webhook URL
```

## Key Integration: Plaid Webhooks

The app uses Plaid's `SYNC_UPDATES_AVAILABLE` webhook for real-time transaction updates:

1. User connects bank via Plaid Link
2. Access token stored in `plaid_items` table
3. Plaid sends `SYNC_UPDATES_AVAILABLE` webhook when new transactions available
4. Webhook handler calls `/transactions/sync` with cursor-based pagination
5. Transactions upserted to `transactions` table

## Common Patterns

### Adding a new API route
1. Create directory: `app/api/[feature]/[action]/`
2. Create `route.ts` with exported HTTP method handlers
3. Validate inputs, handle errors, return JSON

### Adding a new database table
1. Add schema to `lib/db/schema.ts`
2. Export types and add to `lib/db/index.ts`
3. Run `bun run db:push` to sync schema

### Adding a new component
1. Create in `components/` with kebab-case filename
2. Add `"use client"` if using hooks/interactivity
3. Use shadcn/ui primitives where possible
