"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PlaidLinkButton } from "@/components/plaid-link";
import { siAmericanexpress } from "simple-icons";
import { authClient, useSession } from "@/lib/auth-client";

interface Account {
  id: string;
  itemId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  isoCurrencyCode: string | null;
  institutionName: string | null;
  displayName: string;
}

interface Transaction {
  id: string;
  accountId: string;
  amount: number;
  date: string;
  datetime: string | null;
  name: string;
  merchantName: string | null;
  logoUrl: string | null;
  website: string | null;
  paymentChannel: string | null;
  primaryCategory: string | null;
  detailedCategory: string | null;
  categoryIconUrl: string | null;
  pending: boolean;
  location: {
    address: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
  accountName: string | null;
  accountMask: string | null;
  accountType: string | null;
  accountSubtype: string | null;
  institutionName: string | null;
  accountDisplayName: string;
}

interface TransactionSummary {
  totalSpending: number;
  totalIncome: number;
  netCashFlow: number;
  transactionCount: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [showRefreshWarning, setShowRefreshWarning] = useState(false);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  // Fetch accounts
  const fetchAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/plaid/accounts");
      const data = await response.json();

      if (data.error) {
        return;
      }

      setAccounts(data.accounts);
      // Select all accounts by default
      if (data.accounts.length > 0 && selectedAccountIds.size === 0) {
        setSelectedAccountIds(new Set(data.accounts.map((a: Account) => a.id)));
      }
    } catch (err) {
      console.error("Error fetching accounts:", err);
    }
  }, [selectedAccountIds.size]);

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedAccountIds.size > 0 && selectedAccountIds.size < accounts.length) {
        params.append("accountIds", Array.from(selectedAccountIds).join(","));
      }

      const response = await fetch(`/api/plaid/transactions?${params}`);
      const data = await response.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setTransactions(data.transactions);
      setSummary(data.summary);
    } catch (err) {
      console.error("Error fetching transactions:", err);
      setError("Failed to load transactions");
    } finally {
      setIsLoading(false);
    }
  }, [selectedAccountIds, accounts.length]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (accounts.length > 0) {
      fetchTransactions();
    }
  }, [fetchTransactions, accounts.length]);

  // Toggle account selection
  const toggleAccount = (accountId: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  // Select all accounts
  const selectAllAccounts = () => {
    setSelectedAccountIds(new Set(accounts.map((a) => a.id)));
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Math.abs(amount));
    return amount < 0 ? `-${formatted}` : formatted;
  };

  // Format date as "Dec 01"
  const formatDate = (dateString: string) => {
    const date = new Date(dateString + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    });
  };

  // Get current month/year
  const getCurrentPeriod = () => {
    const now = new Date();
    return now.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  };

  // Handle successful Plaid connection
  const handlePlaidSuccess = (itemId: string, institution: string | null) => {
    setConnectionMessage(
      `Successfully connected ${institution || "your account"}! Transactions will sync shortly.`
    );
    setTimeout(() => {
      fetchAccounts();
      fetchTransactions();
      setConnectionMessage(null);
    }, 3000);
  };

  // Handle Plaid error
  const handlePlaidError = (error: string) => {
    setError(error);
  };

  // Force refresh from Plaid (paid API call)
  const handleForceRefresh = async () => {
    setShowRefreshWarning(false);
    setIsRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/plaid/refresh", { method: "POST" });
      const data = await response.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setConnectionMessage(data.message);
      // Poll for new transactions after a delay
      setTimeout(() => {
        fetchTransactions();
        setConnectionMessage(null);
      }, 5000);
    } catch (err) {
      console.error("Error refreshing:", err);
      setError("Failed to refresh transactions");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Get account color based on mask
  const getAccountColor = (mask: string | null, isSelected: boolean) => {
    if (mask === "1009") {
      // Blue card
      return isSelected
        ? "border-blue-500 bg-blue-500 text-white"
        : "border-blue-300 text-blue-600 hover:border-blue-500 hover:text-blue-700";
    }
    if (mask === "1002") {
      // Platinum silver card
      return isSelected
        ? "border-slate-400 bg-gradient-to-r from-slate-300 to-slate-400 text-slate-800"
        : "border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-600";
    }
    // Default
    return isSelected
      ? "border-foreground bg-foreground text-background"
      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground";
  };

  const hasAccounts = accounts.length > 0;

  return (
    <div className="min-h-screen bg-background safe-area-inset">
      {/* Nav */}
      <nav className="border-b border-border safe-area-top">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
          <span className="text-sm tracking-tight">spendalert</span>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { fetchAccounts(); fetchTransactions(); }}>
              refresh
            </Button>
            {hasAccounts && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRefreshWarning(true)}
                disabled={isRefreshing}
                className="text-muted-foreground"
              >
                {isRefreshing ? "syncing..." : "sync"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="text-muted-foreground"
            >
              sign out
            </Button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-6 py-12">
        {/* Connection Message */}
        {connectionMessage && (
          <div className="mb-8 border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            {connectionMessage}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-8 border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            {error}
          </div>
        )}

        {/* No accounts connected state */}
        {!hasAccounts && (
          <div className="py-20 text-center">
            <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
              No accounts connected
            </p>
            <p className="mb-8 text-muted-foreground">
              Connect your bank account to start tracking transactions.
            </p>
            <PlaidLinkButton
              onSuccess={handlePlaidSuccess}
              onError={handlePlaidError}
            />
          </div>
        )}

        {/* Account Selector */}
        {hasAccounts && (
          <>
            <div className="mb-8">
              <div className="mb-4 flex items-baseline justify-between border-b border-dashed border-border pb-4">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Accounts
                </span>
                <button
                  onClick={selectAllAccounts}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  select all
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => toggleAccount(account.id)}
                    className={`flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-mono transition-colors ${
                      getAccountColor(account.mask, selectedAccountIds.has(account.id))
                    }`}
                  >
                    {account.institutionName === "American Express" && (
                      <svg
                        role="img"
                        viewBox="0 0 24 24"
                        className="h-4 w-4 flex-shrink-0"
                        fill="currentColor"
                      >
                        <path d={siAmericanexpress.path} />
                      </svg>
                    )}
                    {account.institutionName || account.name}
                    {account.mask && ` ...${account.mask}`}
                  </button>
                ))}
                <PlaidLinkButton
                  variant="icon"
                  onSuccess={handlePlaidSuccess}
                  onError={handlePlaidError}
                />
              </div>
            </div>

            {/* Account Statement Header */}
            <div className="mb-12 flex items-baseline justify-between border-b border-dashed border-border pb-4">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Account Statement
              </span>
              <span className="text-xs text-muted-foreground">
                {getCurrentPeriod()}
              </span>
            </div>

            {/* Loading State */}
            {isLoading && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Loading transactions...
              </div>
            )}

            {/* Transactions Table */}
            {!isLoading && transactions.length > 0 && (
              <table className="w-full text-sm font-mono tracking-normal">
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className={`border-b border-dashed border-border ${
                        tx.pending ? "text-muted-foreground" : ""
                      }`}
                    >
                      <td className="w-20 py-4 text-muted-foreground align-top">
                        {formatDate(tx.date)}
                      </td>
                      <td className="py-4">
                        <div className={tx.pending ? "italic" : ""}>
                          {tx.merchantName || tx.name}
                          {tx.pending && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (pending)
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {tx.accountDisplayName}
                        </div>
                      </td>
                      <td className="py-4 text-right tabular-nums align-top">
                        {/* Plaid: positive = outflow (spending), negative = inflow (income) */}
                        {tx.amount > 0 ? "-" : ""}
                        {formatCurrency(tx.amount)}
                      </td>
                    </tr>
                  ))}

                  {/* Summary Row */}
                  {summary && (
                    <>
                      <tr>
                        <td className="py-4"></td>
                        <td className="py-4 text-muted-foreground">
                          Total spending
                        </td>
                        <td className="py-4 text-right tabular-nums font-medium">
                          -{formatCurrency(summary.totalSpending)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-4"></td>
                        <td className="py-4 text-muted-foreground">
                          Total income
                        </td>
                        <td className="py-4 text-right tabular-nums font-medium">
                          {formatCurrency(summary.totalIncome)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-4"></td>
                        <td className="py-4 text-muted-foreground">
                          Net cash flow
                        </td>
                        <td className={`py-4 text-right tabular-nums font-medium ${
                          summary.netCashFlow >= 0 ? "" : "text-muted-foreground"
                        }`}>
                          {summary.netCashFlow >= 0 ? "" : "-"}
                          {formatCurrency(summary.netCashFlow)}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            )}

            {/* Empty State */}
            {!isLoading && transactions.length === 0 && selectedAccountIds.size > 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <p>No transactions yet.</p>
                <p className="mt-2">Transactions will appear once your bank syncs.</p>
              </div>
            )}

            {/* No accounts selected */}
            {!isLoading && selectedAccountIds.size === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <p>No accounts selected.</p>
                <p className="mt-2">Select an account above to view transactions.</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border safe-area-bottom">
        <div className="mx-auto max-w-2xl px-6 py-8">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>spendalert</span>
            <span>{summary?.transactionCount || 0} transactions</span>
          </div>
        </div>
      </footer>

      {/* Sync Warning Modal */}
      {showRefreshWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-sm rounded-lg border border-border bg-background p-6 shadow-lg">
            <h3 className="mb-2 font-medium">Sync with Plaid?</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              This will request fresh transaction data from your bank via Plaid.
              This is a <span className="font-medium text-foreground">paid API call</span> (~$0.10-0.50 per request)
              billed to your Plaid account.
            </p>
            <p className="mb-6 text-xs text-muted-foreground">
              Note: Plaid automatically syncs 1-4 times daily for free. Only use this if you need
              immediate updates.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRefreshWarning(false)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleForceRefresh}
              >
                Sync Now
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
