/**
 * Chart path/point math for the scorecard reports trend chart
 * (docs/plans/2026-07-01-scorecard-reports.md, WP2). PURE geometry only —
 * no React, no DOM, no Payload. `TrendChart.tsx` (WP3) renders these
 * outputs inside an `<svg>`; keeping the math here makes it exhaustively
 * unit-testable and swappable for a real charting library later without
 * touching layout.
 */

/** A single data point in domain space (e.g. { t: epoch-ms, v: score 0-100 }). */
export interface Point {
  t: number
  v: number
}

/** The domain (data-space extent) a chart maps into its pixel box. */
export interface Domain {
  x: [number, number]
  y: [number, number]
}

/** A projected point in pixel space. */
export interface PixelPoint {
  x: number
  y: number
}

/**
 * Builds a linear scale function mapping `domain` -> `range`. A degenerate
 * domain (min === max — a single data point, or a perfectly flat series)
 * has no meaningful ratio to project, so every value maps to the midpoint
 * of the range instead of dividing by zero.
 */
export function scaleLinear(
  domain: [number, number],
  range: [number, number],
): (value: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  if (d0 === d1) {
    const mid = (r0 + r1) / 2
    return () => mid
  }
  const ratio = (r1 - r0) / (d1 - d0)
  return (value: number) => r0 + (value - d0) * ratio
}

/** Rounds to 2 decimal places — keeps generated path/point coordinates
 *  stable and short without visible precision loss at chart scale. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Projects data points into SVG pixel coordinates within a `[0,width] x
 * [0,height]` box. The y-axis is flipped (domain max -> pixel 0) so larger
 * values sit higher on screen, matching normal chart conventions. Used both
 * to build the line path and to place dot/hover markers at each point.
 */
export function projectPoints(
  points: Point[],
  width: number,
  height: number,
  domain: Domain,
): PixelPoint[] {
  const x = scaleLinear(domain.x, [0, width])
  const y = scaleLinear(domain.y, [height, 0])
  return points.map((p) => ({ x: round2(x(p.t)), y: round2(y(p.v)) }))
}

/**
 * SVG path `d` string for the trend line. Empty input -> empty string (no
 * `<path>` to render — the chart component shows its own "no history yet"
 * empty state instead). A single point -> a single moveto with no line
 * segment (the chart component draws a dot + caption for that case, per
 * the plan's single-point graceful state). Multiple points assume `points`
 * is already sorted ascending by `t` (as `buildTrendSeries` produces).
 */
export function buildLinePath(points: Point[], width: number, height: number, domain: Domain): string {
  if (points.length === 0) return ''
  const pixels = projectPoints(points, width, height, domain)
  const [first, ...rest] = pixels
  if (rest.length === 0) return `M${first.x},${first.y}`
  return `M${first.x},${first.y} ${rest.map((p) => `L${p.x},${p.y}`).join(' ')}`
}

/** Rounds `range` to a "nice" 1 / 2 / 5 / 10 * 10^n neighbor (the classic
 *  nice-number tick algorithm). `round=true` snaps to the nearest of the
 *  four; `round=false` rounds UP so the resulting span still covers `range`. */
function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / 10 ** exponent
  let niceFraction: number
  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }
  return niceFraction * 10 ** exponent
}

/**
 * "Nice" round-number tick values spanning `domain`, approximately `count`
 * of them (the classic nice-number axis-tick algorithm — steps of
 * 1/2/5/10 * 10^n). A degenerate domain (min === max) has nothing to
 * subdivide -> a single tick at that value. `count <= 0` -> no ticks.
 */
export function niceTicks(domain: [number, number], count: number): number[] {
  const [d0, d1] = domain
  if (count <= 0) return []
  if (d0 === d1) return [d0]

  const lo = Math.min(d0, d1)
  const hi = Math.max(d0, d1)
  const span = niceNumber(hi - lo, false)
  const step = niceNumber(span / Math.max(1, count - 1), true)
  const niceMin = Math.floor(lo / step) * step
  const niceMax = Math.ceil(hi / step) * step

  const ticks: number[] = []
  // Half-step slack on the upper bound guards against float drift (e.g.
  // 0.1 + 0.2 style error) prematurely excluding the last tick.
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(round2(v))
  }
  return ticks
}
