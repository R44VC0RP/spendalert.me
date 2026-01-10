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

interface TransactionAttachment {
  url: string;
  description?: string;
  addedAt: string;
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
  // User-added metadata
  tags: string[];
  notes: string | null;
  attachments: TransactionAttachment[];
  // Account info
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
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/login");
  };

  const handleAddPasskey = async () => {
    setIsAddingPasskey(true);
    setError(null);
    try {
      const result = await authClient.passkey.addPasskey({
        name: session?.user?.email || "passkey",
      });
      if (result.error) {
        setError(result.error.message || "Failed to add passkey");
      } else {
        setConnectionMessage("Passkey Added Successfully!");
        setTimeout(() => setConnectionMessage(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add passkey");
    } finally {
      setIsAddingPasskey(false);
    }
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
      `Successfully Connected ${institution || "Your Account"}! Transactions Will Sync Shortly.`
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
      setError("Failed To Refresh Transactions");
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
    <div className="min-h-screen bg-background safe-area-inset font-sans">
      {/* Nav */}
      <nav className="border-b border-border safe-area-top">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
          <span className="text-sm font-medium tracking-tight">SpendAlert</span>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="font-medium" onClick={() => { fetchAccounts(); fetchTransactions(); }}>
              Refresh
            </Button>
            {hasAccounts && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRefreshWarning(true)}
                disabled={isRefreshing}
                className="font-medium text-muted-foreground"
              >
                {isRefreshing ? "Syncing..." : "Sync"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddPasskey}
              disabled={isAddingPasskey}
              className="font-medium text-muted-foreground"
            >
              {isAddingPasskey ? "Adding..." : "Add Passkey"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="font-medium text-muted-foreground"
            >
              Sign Out
            </Button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-6 py-12">
        {/* Connection Message */}
        {connectionMessage && (
          <div className="mb-8 border border-dashed border-border p-4 text-center text-sm font-medium text-muted-foreground">
            {connectionMessage}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-8 border border-dashed border-border p-4 text-center text-sm font-medium text-muted-foreground">
            {error}
          </div>
        )}

        {/* No accounts connected state */}
        {!hasAccounts && (
          <div className="py-20 text-center">
            <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              No Accounts Connected
            </p>
            <p className="mb-8 font-medium text-muted-foreground">
              Connect Your Bank Account To Start Tracking Transactions.
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
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Accounts
                </span>
                <button
                  onClick={selectAllAccounts}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Select All
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => toggleAccount(account.id)}
                    className={`flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
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
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Account Statement
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {getCurrentPeriod()}
              </span>
            </div>

            {/* Loading State */}
            {isLoading && (
              <div className="py-12 text-center text-sm font-medium text-muted-foreground">
                Loading Transactions...
              </div>
            )}

            {/* Transactions Table */}
            {!isLoading && transactions.length > 0 && (
              <table className="w-full text-sm font-medium tracking-normal">
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
                                (Pending)
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {tx.accountDisplayName}
                          </div>
                          {/* Tags */}
                          {tx.tags.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {tx.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Notes */}
                          {tx.notes && (
                            <div className="mt-1.5 text-xs italic text-muted-foreground">
                              &ldquo;{tx.notes}&rdquo;
                            </div>
                          )}
                          {/* Attachments */}
                          {tx.attachments.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-2">
                              {tx.attachments.map((attachment, idx) => (
                                <a
                                  key={idx}
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                                >
                                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                  </svg>
                                  {attachment.description || "Attachment"}
                                </a>
                              ))}
                            </div>
                          )}
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
                          Total Spending
                        </td>
                        <td className="py-4 text-right tabular-nums font-bold">
                          -{formatCurrency(summary.totalSpending)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-4"></td>
                        <td className="py-4 text-muted-foreground">
                          Total Income
                        </td>
                        <td className="py-4 text-right tabular-nums font-bold">
                          {formatCurrency(summary.totalIncome)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-4"></td>
                        <td className="py-4 text-muted-foreground">
                          Net Cash Flow
                        </td>
                        <td className={`py-4 text-right tabular-nums font-bold ${
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
              <div className="py-12 text-center text-sm font-medium text-muted-foreground">
                <p>No Transactions Yet.</p>
                <p className="mt-2">Transactions Will Appear Once Your Bank Syncs.</p>
              </div>
            )}

            {/* No accounts selected */}
            {!isLoading && selectedAccountIds.size === 0 && (
              <div className="py-12 text-center text-sm font-medium text-muted-foreground">
                <p>No Accounts Selected.</p>
                <p className="mt-2">Select An Account Above To View Transactions.</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border safe-area-bottom">
        <div className="mx-auto max-w-2xl px-6 py-8">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>SpendAlert</span>
            <span>{summary?.transactionCount || 0} Transactions</span>
          </div>
        </div>
      </footer>

      {/* Sync Warning Modal */}
      {showRefreshWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-sm rounded-lg border border-border bg-background p-6 shadow-lg">
            <h3 className="mb-2 font-bold">Sync With Plaid?</h3>
            <p className="mb-4 text-sm font-medium text-muted-foreground">
              This Will Request Fresh Transaction Data From Your Bank Via Plaid.
              This Is A <span className="font-bold text-foreground">Paid API Call</span> (~$0.10-0.50 Per Request)
              Billed To Your Plaid Account.
            </p>
            <p className="mb-6 text-xs font-medium text-muted-foreground">
              Note: Plaid Automatically Syncs 1-4 Times Daily For Free. Only Use This If You Need
              Immediate Updates.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="font-medium"
                onClick={() => setShowRefreshWarning(false)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                className="font-bold"
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
