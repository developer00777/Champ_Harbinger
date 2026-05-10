import Link from "next/link";

const currentYear = new Date().getFullYear();

export function MarketingFooter() {
  return (
    <footer className="border-t border-champions-border bg-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 lg:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-bold text-champions-ink"
            >
              <span className="text-champions-orange">●</span>
              ChampHarbinger
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-champions-warm-gray">
              Detect buying signals before they become deals.
            </p>
            <p className="mt-3 text-xs text-champions-warm-gray">
              A{" "}
              <a
                href="https://championsgroup.io"
                className="underline hover:text-champions-orange transition-colors"
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
            <h3 className="text-sm font-semibold uppercase tracking-widest text-champions-warm-gray">
              Product
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link
                  href="#features"
                  className="text-champions-ink-soft hover:text-champions-orange transition-colors"
                >
                  Features
                </Link>
              </li>
              <li>
                <Link
                  href="/signup"
                  className="text-champions-ink-soft hover:text-champions-orange transition-colors"
                >
                  Get started
                </Link>
              </li>
              <li>
                <Link
                  href="/login"
                  className="text-champions-ink-soft hover:text-champions-orange transition-colors"
                >
                  Sign in
                </Link>
              </li>
            </ul>
          </div>

          {/* Champions Group links */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-champions-warm-gray">
              Champions Group
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <a
                  href="https://championsgroup.io"
                  className="text-champions-ink-soft hover:text-champions-orange transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  championsgroup.io
                </a>
              </li>
              <li>
                <a
                  href="https://lakeb2b.com"
                  className="text-champions-ink-soft hover:text-champions-orange transition-colors"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Lake B2B
                </a>
              </li>
              <li>
                <a
                  href="https://ampliz.com"
                  className="text-champions-ink-soft hover:text-champions-orange transition-colors"
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
            <h3 className="text-sm font-semibold uppercase tracking-widest text-champions-warm-gray">
              Legal
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <a
                  href="/privacy"
                  className="text-champions-ink-soft hover:text-champions-orange transition-colors"
                >
                  Privacy
                </a>
              </li>
              <li>
                <a
                  href="/terms"
                  className="text-champions-ink-soft hover:text-champions-orange transition-colors"
                >
                  Terms
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-champions-border pt-6 sm:flex-row">
          <p className="text-xs text-champions-warm-gray">
            &copy; {currentYear} Champions Group. All rights reserved.
          </p>
          <p className="text-xs text-champions-warm-gray">
            Released under the{" "}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              className="underline hover:text-champions-orange transition-colors"
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
