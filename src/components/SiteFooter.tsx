import Link from "next/link";
import { FIRST_YEAR, OWNER, REPO_URL, fmtBuilt, getBuildInfo } from "@/lib/build-info";

/** Build stamp on every page, so local and deployed builds are obviously different. Server component. */
export function SiteFooter() {
  const b = getBuildInfo();
  const year = b.builtAt.getUTCFullYear();
  const years = year > FIRST_YEAR ? `${FIRST_YEAR}–${year}` : String(FIRST_YEAR);
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p className="site-footer-copy">
          © {years} {OWNER} · All rights reserved
        </p>
        <nav className="site-footer-nav" aria-label="Footer">
          <Link href="/">Finder</Link>
          <Link href="/brief">Brief</Link>
          <Link href="/settings">Settings</Link>
          <a href={REPO_URL} rel="noopener noreferrer" target="_blank">
            GitHub
          </a>
        </nav>
        <p className="site-footer-build" aria-label="Build information">
          <span>v{b.version}</span>
          <span>
            {b.commitUrl ? (
              <a href={b.commitUrl} rel="noopener noreferrer" target="_blank" title="View this commit on GitHub">
                {b.commit}
              </a>
            ) : (
              "unknown commit"
            )}
            {b.branch && <span className="muted"> ({b.branch})</span>}
            {b.dirty && <strong className="site-footer-dirty"> + uncommitted changes</strong>}
          </span>
          <span>
            built <time dateTime={b.builtAt.toISOString()}>{fmtBuilt(b.builtAt)}</time>
          </span>
          <span>env {b.environment}</span>
        </p>
      </div>
    </footer>
  );
}
