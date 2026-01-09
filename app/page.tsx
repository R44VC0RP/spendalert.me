import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Page() {
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Nav */}
      <nav className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
        <span className="text-sm font-medium tracking-tight">SpendAlert</span>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/login" className="font-medium">Login</Link>
        </Button>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-2xl px-6 pt-24 pb-32">
        <p className="mb-6 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Your Wallet&apos;s Conscience
        </p>
        <h1 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
          We Text You When
          <br />
          You&apos;re Spending Too Much.
        </h1>
        <p className="mb-12 max-w-md font-medium text-muted-foreground">
          Connect your bank. Set a limit. Get a text before you blow it. That&apos;s
          it.
        </p>

        {/* Fake SMS preview */}
        <div className="mb-12 max-w-xs">
          <div className="rounded-2xl border border-border bg-muted/30 p-4">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              SMS From SpendAlert
            </p>
            <p className="text-sm font-medium">
              Heads up — you&apos;ve spent $847 of your $1,000 monthly budget. You
              have 11 days left.
            </p>
          </div>
          <div className="ml-4 h-4 w-4 -translate-y-px rotate-45 border-b border-r border-border bg-muted/30" />
        </div>

        <div className="flex max-w-sm flex-col gap-3 sm:flex-row">
          <Input
            type="tel"
            placeholder="(555) 123-4567"
            className="h-10 flex-1 font-medium"
          />
          <Button size="lg" className="h-10 font-bold">
            Get Started
          </Button>
        </div>
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          $5/mo after 14-day trial. Cancel anytime.
        </p>
      </section>

      {/* The pitch - bank statement style */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <div className="mb-12 flex items-baseline justify-between border-b border-dashed border-border pb-4">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              How It Works
            </span>
            <span className="text-xs font-medium text-muted-foreground">3 Steps</span>
          </div>

          <div className="space-y-8">
            <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4">
              <span className="font-medium text-muted-foreground">01</span>
              <span className="font-medium">Link Your Bank Account</span>
              <span className="text-xs font-medium text-muted-foreground">256-Bit Encrypted</span>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4">
              <span className="font-medium text-muted-foreground">02</span>
              <span className="font-medium">Set Your Spending Limit</span>
              <span className="text-xs font-medium text-muted-foreground">Weekly Or Monthly</span>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4">
              <span className="font-medium text-muted-foreground">03</span>
              <span className="font-medium">Receive SMS Alerts</span>
              <span className="text-xs font-medium text-muted-foreground">At 80%, 90%, 100%</span>
            </div>
          </div>
        </div>
      </section>

      {/* Statement style features */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <div className="mb-12 flex items-baseline justify-between border-b border-dashed border-border pb-4">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Account Statement
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              Dec 2025
            </span>
          </div>

          <table className="w-full text-sm font-mono tracking-normal">
            <tbody>
              <tr className="border-b border-dashed border-border">
                <td className="py-3 font-medium text-muted-foreground">Dec 01</td>
                <td className="py-3 font-medium">Monthly Budget Set</td>
                <td className="py-3 text-right font-medium">$2,000.00</td>
              </tr>
              <tr className="border-b border-dashed border-border">
                <td className="py-3 font-medium text-muted-foreground">Dec 05</td>
                <td className="py-3 font-medium">Whole Foods Market</td>
                <td className="py-3 text-right font-medium">-$127.43</td>
              </tr>
              <tr className="border-b border-dashed border-border">
                <td className="py-3 font-medium text-muted-foreground">Dec 07</td>
                <td className="py-3 font-medium">Amazon.com</td>
                <td className="py-3 text-right font-medium">-$89.99</td>
              </tr>
              <tr className="border-b border-dashed border-border">
                <td className="py-3 font-medium text-muted-foreground">Dec 09</td>
                <td className="py-3 font-medium">Shell Gas Station</td>
                <td className="py-3 text-right font-medium">-$52.00</td>
              </tr>
              <tr className="border-b border-dashed border-border bg-muted/50">
                <td className="py-3 font-medium text-muted-foreground">Dec 11</td>
                <td className="py-3 font-bold">
                  SMS Alert Sent — 80% Of Budget Reached
                </td>
                <td className="py-3 text-right font-medium">$1,600.00</td>
              </tr>
              <tr>
                <td className="py-3"></td>
                <td className="py-3 font-medium text-muted-foreground">Remaining Balance</td>
                <td className="py-3 text-right font-bold">$400.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing - receipt style */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <div className="mx-auto max-w-xs">
            <div className="border border-dashed border-border p-6 text-center">
              <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Receipt
              </p>
              <p className="mb-6 text-xs text-muted-foreground">
                --------------------------------
              </p>
              <p className="mb-1 font-mono font-medium tracking-normal">SpendAlert Monthly</p>
              <p className="mb-6 text-3xl font-mono font-bold tracking-normal">$5.00</p>
              <p className="mb-6 text-xs text-muted-foreground">
                --------------------------------
              </p>
              <div className="mb-6 space-y-1 text-left text-xs font-mono tracking-normal">
                <div className="flex justify-between">
                  <span className="font-medium text-muted-foreground">Unlimited Banks</span>
                  <span className="font-medium">Incl.</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-muted-foreground">Unlimited SMS</span>
                  <span className="font-medium">Incl.</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-muted-foreground">Weekly Reports</span>
                  <span className="font-medium">Incl.</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-muted-foreground">Cancel Anytime</span>
                  <span className="font-medium">Yes</span>
                </div>
              </div>
              <Button className="w-full font-bold">Start Free Trial</Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-2xl px-6 py-8">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>SpendAlert</span>
            <div className="flex gap-4">
              <a href="#" className="hover:text-foreground">
                Privacy
              </a>
              <a href="#" className="hover:text-foreground">
                Terms
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
