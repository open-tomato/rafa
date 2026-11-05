/** Which way a value moved against its comparison period. */
export type DeltaDirection = 'up' | 'down' | 'flat';

/** A signed change against a named period: "+12% vs last 4 weeks". */
export interface StatDelta {
  readonly text: string;
  readonly direction: DeltaDirection;
  /** Whether a rise is good news; true unless said otherwise (a failure rate rising is bad). */
  readonly upIsGood?: boolean;
}

/** How a delta reads: good news, bad news, or no change. */
export type DeltaReading = 'good' | 'bad' | 'flat';

/** Reads a delta as good, bad or flat from its direction and whether up is good. */
export function readDelta(delta: StatDelta): DeltaReading {
  if (delta.direction === 'flat') return 'flat';
  const upIsGood = delta.upIsGood ?? true;
  return (delta.direction === 'up') === upIsGood
    ? 'good'
    : 'bad';
}
