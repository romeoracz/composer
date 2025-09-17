export type DiffSegment = {
  type: 'context' | 'added' | 'removed';
  value: string;
};

function pushSegment(segments: DiffSegment[], type: DiffSegment['type'], value: string) {
  if (!value.length) return;
  const last = segments[segments.length - 1];
  if (last && last.type === type) {
    last.value += "\n" + value;
  } else {
    segments.push({ type, value });
  }
}

export function diffLines(previous: string, next: string): DiffSegment[] {
  const prevLines = previous.split(/\r?\n/);
  const nextLines = next.split(/\r?\n/);
  const m = prevLines.length;
  const n = nextLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (prevLines[i] === nextLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (prevLines[i] === nextLines[j]) {
      pushSegment(segments, 'context', prevLines[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushSegment(segments, 'removed', prevLines[i]);
      i += 1;
    } else {
      pushSegment(segments, 'added', nextLines[j]);
      j += 1;
    }
  }

  while (i < m) {
    pushSegment(segments, 'removed', prevLines[i]);
    i += 1;
  }
  while (j < n) {
    pushSegment(segments, 'added', nextLines[j]);
    j += 1;
  }

  return segments;
}
