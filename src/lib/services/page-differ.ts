import "server-only";

/**
 * Diff two HTML pages by reducing to plain text and running an LCS-based
 * line diff. Used by the Wayback "what changed?" tools.
 */

const MAX_OUTPUT_LINES = 100;

/**
 * Mirror the lightweight regex pipeline used by src/app/api/v1/enrich/company.
 * Strips script/style/HTML, collapses whitespace, returns trimmed text.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Standard Myers-style LCS diff over arrays of lines. Returns a sequence of
 * ops describing how to transform `a` into `b`. The matrix is O(n*m) memory,
 * which is fine for typical web-page text (a few thousand lines max).
 */
type DiffOp =
  | { type: "equal"; value: string }
  | { type: "add"; value: string }
  | { type: "remove"; value: string };

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length for a[0..i), b[0..j)
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: "equal", value: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "remove", value: a[i - 1] });
      i--;
    } else {
      ops.push({ type: "add", value: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: "remove", value: a[--i] });
  }
  while (j > 0) {
    ops.push({ type: "add", value: b[--j] });
  }
  return ops.reverse();
}

export interface DiffResult {
  /** Lines present in `after` but not in `before`. */
  added: string[];
  /** Lines present in `before` but not in `after`. */
  removed: string[];
  /**
   * Pairs where a remove was immediately followed by an add at the same
   * position — likely modifications of the same logical line.
   * Each entry is formatted "before → after".
   */
  modified: string[];
}

/**
 * Line-by-line plain-text diff. Groups consecutive same-type ops (so multiple
 * neighbouring removes show as one bundle in the lists). Caps each output to
 * `MAX_OUTPUT_LINES` lines.
 */
export function diffPlainText(before: string, after: string): DiffResult {
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = lcsDiff(a, b);

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  // Detect remove+add pairs (modifications) and otherwise group consecutive
  // ops of the same type into single bundles.
  let pendingRemoves: string[] = [];
  let pendingAdds: string[] = [];

  const flush = () => {
    // Pair as many removes with adds as we can; the rest become pure add/remove.
    const pairs = Math.min(pendingRemoves.length, pendingAdds.length);
    for (let k = 0; k < pairs; k++) {
      modified.push(`${pendingRemoves[k]} → ${pendingAdds[k]}`);
    }
    for (let k = pairs; k < pendingRemoves.length; k++) {
      removed.push(pendingRemoves[k]);
    }
    for (let k = pairs; k < pendingAdds.length; k++) {
      added.push(pendingAdds[k]);
    }
    pendingRemoves = [];
    pendingAdds = [];
  };

  for (const op of ops) {
    if (op.type === "remove") {
      pendingRemoves.push(op.value);
    } else if (op.type === "add") {
      pendingAdds.push(op.value);
    } else {
      flush();
    }
  }
  flush();

  return {
    added: added.slice(0, MAX_OUTPUT_LINES),
    removed: removed.slice(0, MAX_OUTPUT_LINES),
    modified: modified.slice(0, MAX_OUTPUT_LINES),
  };
}
