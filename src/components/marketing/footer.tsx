import Link from "next/link";

const currentYear = new Date().getFullYear();

export function MarketingFooter() {
  return (
    <footer className="border-border bg-background border-t">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 lg:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2.5"
              aria-label="ChampHarbinger home"
            >
              <span className="bg-champions-gradient flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm">
                CH
              </span>
              <span className="text-foreground text-lg font-bold tracking-tight">
                ChampHarbinger
              </span>
            </Link>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              Detect buying signals before they become deals.
            </p>
            <p className="text-muted-foreground mt-3 text-xs">
              A{" "}
              <a
                href="https://championsgroup.io"
                className="hover:text-champions-orange underline transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                Champions Group
              </a>{" "}
              product.
            </p>
          </div>

          {/* Product links */}
          <div>
            <p className="eyebrow">Product</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link
                  href="#features"
                  className="text-muted-foreground hover:text-champions-orange transition-colors"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  href="/signup"
                  className="text-muted-foreground hover:text-champions-orange transition-colors"
                >
                  Get started
                </Link>
              </li>
              <li>
                <Link
                  href="/login"
                  className="text-muted-foreground hover:text-champions-orange transition-colors"
                >
                  Sign in
                </Link>
              </li>
            </ul>
          </div>

          {/* Champions Group links */}
          <div>
            <p className="eyebrow">Champions Group</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a
                  href="https://championsgroup.io"
                  className="text-muted-foreground hover:text-champions-orange transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  championsgroup.io
                </a>
              </li>
              <li>
                <a
                  href="https://lakeb2b.com"
                  className="text-muted-foreground hover:text-champions-orange transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Lake B2B
                </a>
              </li>
              <li>
                <a
                  href="https://ampliz.com"
                  className="text-muted-foreground hover:text-champions-orange transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ampliz
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="eyebrow">Legal</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a
                  href="/privacy"
                  className="text-muted-foreground hover:text-champions-orange transition-colors"
                >
                  Privacy
                </a>
              </li>
              <li>
                <a
                  href="/terms"
                  className="text-muted-foreground hover:text-champions-orange transition-colors"
                >
                  Terms
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-border mt-12 flex flex-col items-center justify-between gap-4 border-t pt-6 sm:flex-row">
          <p className="text-muted-foreground text-xs">
            &copy; {currentYear} Champions Group. All rights reserved.
          </p>
          <p className="text-muted-foreground text-xs">
            Released under the{" "}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              className="hover:text-champions-orange underline transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              AGPL-3.0
            </a>{" "}
            license.
          </p>
        </div>
      </div>
    </footer>
  );
}
