import { describe, it, expect } from 'vitest'
import { scaleLinear, projectPoints, buildLinePath, niceTicks, type Point, type Domain } from './chart-paths'

// --- scaleLinear ----------------------------------------------------------------

describe('scaleLinear', () => {
  it('maps the domain min/max to the range min/max', () => {
    const scale = scaleLinear([0, 100], [0, 200])
    expect(scale(0)).toBe(0)
    expect(scale(100)).toBe(200)
  })

  it('interpolates linearly between the endpoints', () => {
    const scale = scaleLinear([0, 100], [0, 200])
    expect(scale(50)).toBe(100)
    expect(scale(25)).toBe(50)
  })

  it('extrapolates beyond the domain (no clamping)', () => {
    const scale = scaleLinear([0, 100], [0, 200])
    expect(scale(150)).toBe(300)
    expect(scale(-10)).toBe(-20)
  })

  it('supports an inverted range (e.g. flipping the y axis)', () => {
    const scale = scaleLinear([0, 100], [200, 0])
    expect(scale(0)).toBe(200)
    expect(scale(100)).toBe(0)
    expect(scale(50)).toBe(100)
  })

  it('a degenerate domain (min === max) maps every value to the range midpoint, not NaN', () => {
    const scale = scaleLinear([50, 50], [0, 200])
    expect(scale(50)).toBe(100)
    expect(scale(0)).toBe(100)
    expect(scale(999)).toBe(100)
  })
})

// --- projectPoints ----------------------------------------------------------------

describe('projectPoints', () => {
  const domain: Domain = { x: [0, 100], y: [0, 100] }

  it('empty points -> empty array', () => {
    expect(projectPoints([], 300, 150, domain)).toEqual([])
  })

  it('projects a point into pixel space with the y axis flipped (higher value -> smaller y)', () => {
    const points: Point[] = [{ t: 0, v: 0 }, { t: 100, v: 100 }]
    const pixels = projectPoints(points, 300, 150, domain)
    expect(pixels).toEqual([
      { x: 0, y: 150 }, // v=0 (min) -> bottom of the box
      { x: 300, y: 0 }, // v=100 (max) -> top of the box
    ])
  })

  it('a single point projects to one pixel coordinate', () => {
    const points: Point[] = [{ t: 50, v: 50 }]
    expect(projectPoints(points, 300, 150, domain)).toEqual([{ x: 150, y: 75 }])
  })

  it('a flat series (all same value) projects onto a single horizontal line', () => {
    const flatDomain: Domain = { x: [0, 100], y: [40, 40] }
    const points: Point[] = [{ t: 0, v: 40 }, { t: 100, v: 40 }]
    const pixels = projectPoints(points, 300, 150, flatDomain)
    expect(pixels[0].y).toBe(75)
    expect(pixels[1].y).toBe(75)
  })
})

// --- buildLinePath ----------------------------------------------------------------

describe('buildLinePath', () => {
  const domain: Domain = { x: [0, 100], y: [0, 100] }

  it('empty points -> empty path string', () => {
    expect(buildLinePath([], 300, 150, domain)).toBe('')
  })

  it('a single point -> a moveto with no line segment', () => {
    const points: Point[] = [{ t: 50, v: 50 }]
    expect(buildLinePath(points, 300, 150, domain)).toBe('M150,75')
  })

  it('multiple points -> a moveto followed by linetos in order', () => {
    const points: Point[] = [
      { t: 0, v: 0 },
      { t: 50, v: 100 },
      { t: 100, v: 0 },
    ]
    expect(buildLinePath(points, 300, 150, domain)).toBe('M0,150 L150,0 L300,150')
  })

  it('a flat series still produces a valid horizontal path, not a degenerate/NaN path', () => {
    const flatDomain: Domain = { x: [0, 100], y: [40, 40] }
    const points: Point[] = [
      { t: 0, v: 40 },
      { t: 50, v: 40 },
      { t: 100, v: 40 },
    ]
    expect(buildLinePath(points, 300, 150, flatDomain)).toBe('M0,75 L150,75 L300,75')
  })

  it('rounds coordinates to 2 decimal places', () => {
    const points: Point[] = [
      { t: 0, v: 0 },
      { t: 33, v: 33 },
    ]
    const path = buildLinePath(points, 100, 100, domain)
    // 33/100*100 = 33 exactly; assert no long float tails appear for a case
    // that would produce one (1/3-style domain).
    const thirdsDomain: Domain = { x: [0, 3], y: [0, 3] }
    const thirdsPath = buildLinePath([{ t: 0, v: 0 }, { t: 1, v: 1 }], 100, 100, thirdsDomain)
    expect(thirdsPath).toBe('M0,100 L33.33,66.67')
    expect(path).toBe('M0,100 L33,67')
  })
})

// --- niceTicks ----------------------------------------------------------------

describe('niceTicks', () => {
  it('count <= 0 -> no ticks', () => {
    expect(niceTicks([0, 100], 0)).toEqual([])
    expect(niceTicks([0, 100], -1)).toEqual([])
  })

  it('a degenerate domain (min === max) -> a single tick at that value', () => {
    expect(niceTicks([50, 50], 5)).toEqual([50])
  })

  it('produces round, evenly-spaced ticks spanning a 0-100 domain', () => {
    // count=5 -> a target step of 100/4=25, which nice-number-rounds to the
    // nearest 1/2/5/10 multiple: 25 rounds to the "2" bucket -> step 20.
    const ticks = niceTicks([0, 100], 5)
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('a smaller requested count nice-rounds to a coarser step', () => {
    // count=3 -> target step 100/2=50, which is already a nice number.
    const ticks = niceTicks([0, 100], 3)
    expect(ticks).toEqual([0, 50, 100])
  })

  it('covers the full domain (first tick <= min, last tick >= max)', () => {
    const ticks = niceTicks([3, 97], 5)
    expect(ticks[0]).toBeLessThanOrEqual(3)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(97)
  })

  it('produces ticks in ascending order with a consistent step', () => {
    const ticks = niceTicks([0, 43], 4)
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(ticks[i - 1])
    }
  })

  it('handles a domain smaller than 1 without producing NaN/Infinity ticks', () => {
    const ticks = niceTicks([0, 0.4], 4)
    expect(ticks.every((t) => Number.isFinite(t))).toBe(true)
    expect(ticks.length).toBeGreaterThan(0)
  })

  it('handles a reversed domain (max, min) the same as (min, max)', () => {
    expect(niceTicks([100, 0], 5)).toEqual(niceTicks([0, 100], 5))
  })
})
