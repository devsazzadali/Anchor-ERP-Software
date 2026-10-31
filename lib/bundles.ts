// Cash bundle denominations — ONE canonical table (audit Part D:
// the ৳-per-bundle values were hardcoded in three places — the
// bundle-requests API route, the email service, and the dashboard
// page — free to drift apart). Bangladesh banking convention:
// 1 bundle = 100 notes.

export interface BundleDenomination {
  note: number;        // face value of one note (৳)
  notesPerBundle: number;
  bundleValue: number; // ৳ per bundle = note × notesPerBundle
}

export const BUNDLE_DENOMINATIONS: readonly BundleDenomination[] = [
  { note: 10, notesPerBundle: 100, bundleValue: 1000 },
  { note: 20, notesPerBundle: 100, bundleValue: 2000 },
  { note: 50, notesPerBundle: 100, bundleValue: 5000 },
  { note: 100, notesPerBundle: 100, bundleValue: 10000 },
] as const;

export interface BundleCounts {
  b10: number;
  b20: number;
  b50: number;
  b100: number;
}

export function bundleValueFor(note: number, bundles: number): number {
  const denom = BUNDLE_DENOMINATIONS.find((d) => d.note === note);
  return denom ? denom.bundleValue * bundles : 0;
}

export function bundleTotal(counts: BundleCounts): number {
  return (
    bundleValueFor(10, counts.b10) +
    bundleValueFor(20, counts.b20) +
    bundleValueFor(50, counts.b50) +
    bundleValueFor(100, counts.b100)
  );
}
