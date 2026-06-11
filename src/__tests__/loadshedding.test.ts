import { calculateCalc, calculateSleepTime, getMinutesToAPIReset } from '../lib/loadshedding'
import type { AreaInfo, StatusInfo } from '../lib/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArea(
  stageSlots: string[][],
  tomorrowSlots: string[][] = stageSlots,
  events: AreaInfo['events'] = []
): AreaInfo {
  return {
    events,
    info: { name: 'Test Area', region: 'Test Region' },
    schedule: {
      days: [
        { date: '2024-01-15', name: 'Monday',  stages: stageSlots    },
        { date: '2024-01-16', name: 'Tuesday', stages: tomorrowSlots }
      ],
      source: 'test'
    }
  }
}

function makeStatus(stage: string, key = 'eskom'): StatusInfo {
  return { status: { [key]: { stage, name: 'National', next_stages: [], stage_updated: '' } } }
}

/** Local Date at a specific clock time on 2024-01-15 */
function at(h: number, m = 0): Date {
  return new Date(2024, 0, 15, h, m, 0)
}

// ---------------------------------------------------------------------------
// getMinutesToAPIReset
// ---------------------------------------------------------------------------

describe('getMinutesToAPIReset', () => {
  it('returns 60 minutes when it is 01:00', () => {
    expect(getMinutesToAPIReset(at(1))).toBe(60)
  })

  it('returns 23 * 60 minutes when it is 03:00 (reset already passed today)', () => {
    expect(getMinutesToAPIReset(at(3))).toBe(23 * 60)
  })

  it('returns 0 minutes at exactly 02:00', () => {
    expect(getMinutesToAPIReset(at(2))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// calculateSleepTime
// ---------------------------------------------------------------------------

describe('calculateSleepTime', () => {
  it('returns 60 when all allowance is consumed', () => {
    expect(calculateSleepTime(50, 50, 0, 120)).toBe(60)
  })

  it('returns 60 when remaining is negative due to buffer', () => {
    expect(calculateSleepTime(50, 48, 5, 120)).toBe(60)
  })

  it('enforces a minimum of 10 minutes', () => {
    // remaining=50, minutesToReset=1 → round(1/ceil(50/2)) = round(1/25) = 0 → min 10
    expect(calculateSleepTime(50, 0, 0, 1)).toBe(10)
  })

  it('distributes remaining calls evenly over minutesToReset', () => {
    // remaining=20, minutesToReset=120 → round(120/ceil(20/2)) = round(120/10) = 12
    expect(calculateSleepTime(50, 30, 0, 120)).toBe(12)
  })

  it('applies buffer when calculating remaining calls', () => {
    // remaining=15 (50-30-5), minutesToReset=120 → round(120/ceil(15/2)) = round(120/8) = 15
    expect(calculateSleepTime(50, 30, 5, 120)).toBe(15)
  })
})

// ---------------------------------------------------------------------------
// calculateCalc
// ---------------------------------------------------------------------------

describe('calculateCalc', () => {
  const SLEEPTIME = 60

  describe('stage 0 (no loadshedding)', () => {
    it('returns inactive with no next period', () => {
      const area = makeArea([[], []])
      const status = makeStatus('0')
      const result = calculateCalc(area, status, 'eskom', SLEEPTIME, at(13))

      expect(result.active).toBe(false)
      expect(result.next).toBeUndefined()
    })
  })

  describe('schedule-based loadshedding', () => {
    // Stage 2 slots on 2024-01-15: 04:00–06:30 and 12:00–14:30
    // Stage 1 slots are in index 0, stage 2 in index 1
    const stageSlots = [
      ['20:00-22:30'],                  // stage 1
      ['04:00-06:30', '12:00-14:30']    // stage 2
    ]
    const tomorrowSlots = [
      ['00:00-02:30'],
      ['00:00-02:30', '08:00-10:30']
    ]

    it('detects an active schedule slot', () => {
      const area = makeArea(stageSlots, tomorrowSlots)
      const result = calculateCalc(area, makeStatus('2'), 'eskom', SLEEPTIME, at(13))

      expect(result.active).toBe(true)
      expect(result.type).toBe('schedule')
      expect(result.stage).toBe('2')
      expect(result.duration).toBe(2.5 * 3600)
      expect(result.islong).toBe(false)
    })

    it('finds the next slot later today when not active', () => {
      const area = makeArea(stageSlots, tomorrowSlots)
      const result = calculateCalc(area, makeStatus('2'), 'eskom', SLEEPTIME, at(8))

      expect(result.active).toBe(false)
      expect(result.next?.type).toBe('schedule')
      expect(result.next?.duration).toBe(2.5 * 3600)
      expect(result.next?.islong).toBe(false)
      // secondstostatechange should be positive (time until 12:00)
      expect(result.secondstostatechange).toBeGreaterThan(0)
    })

    it('falls back to the first slot tomorrow when today has no more slots', () => {
      const area = makeArea(stageSlots, tomorrowSlots)
      const result = calculateCalc(area, makeStatus('2'), 'eskom', SLEEPTIME, at(23))

      expect(result.active).toBe(false)
      expect(result.next?.type).toBe('schedule')
      // The next start should be on 2024-01-16 (tomorrow)
      expect(new Date(result.next!.start).getDate()).toBe(16)
    })

    it('marks islong true for a 4-hour-plus slot', () => {
      const longSlots = [
        ['12:00-16:00']   // stage 1, exactly 4 h
      ]
      const area = makeArea(longSlots)
      const result = calculateCalc(area, makeStatus('1'), 'eskom', SLEEPTIME, at(10))

      expect(result.next?.islong).toBe(true)
    })

    it('handles midnight-crossing slots', () => {
      const midnightSlots = [
        ['22:00-00:30']   // stage 1, crosses midnight
      ]
      const area = makeArea(midnightSlots, midnightSlots)
      const result = calculateCalc(area, makeStatus('1'), 'eskom', SLEEPTIME, at(23))

      expect(result.active).toBe(true)
      expect(result.type).toBe('schedule')
    })

    it('sets secondstostatechange to time until shedding ends when active', () => {
      const area = makeArea(stageSlots, tomorrowSlots)
      const result = calculateCalc(area, makeStatus('2'), 'eskom', SLEEPTIME, at(13))

      // 14:30 − 13:00 = 90 minutes = 5400 seconds
      expect(result.secondstostatechange).toBeCloseTo(5400, -1)
    })

    it('marks isHigherStage true when the next event has a higher stage than current', () => {
      // We need the schedule loop to NOT overwrite calc.next, so we use an area
      // whose stages array has only 1 element — stage 2 (index 1) is out of bounds → break.
      const eventStartMs = Date.UTC(2024, 0, 15, 20, 0)
      const eventEndMs   = Date.UTC(2024, 0, 15, 22, 30)
      const events: AreaInfo['events'] = [{
        start: new Date(eventStartMs).toISOString(),
        end:   new Date(eventEndMs).toISOString(),
        note:  'Stage 4 Loadshedding'
      }]
      const area = makeArea([['20:00-22:30']], [['00:00-02:30']], events)
      const result = calculateCalc(area, makeStatus('2'), 'eskom', SLEEPTIME, at(10))

      expect(result.next?.type).toBe('event')
      expect(result.next?.stage).toBe('4')
      expect(result.next?.isHigherStage).toBe(true)
    })
  })

  describe('event-based loadshedding', () => {
    // Events use ISO timestamps with timezone offset — Date.parse handles them in UTC
    const eventStartMs = Date.UTC(2024, 0, 15, 10, 0)   // 10:00 UTC
    const eventEndMs   = Date.UTC(2024, 0, 15, 12, 30)  // 12:30 UTC
    const events: AreaInfo['events'] = [{
      start: new Date(eventStartMs).toISOString(),
      end:   new Date(eventEndMs).toISOString(),
      note:  'Stage 2 Loadshedding'
    }]

    it('detects an active event', () => {
      const area = makeArea([[]], [[]], events)
      const nowUTC = new Date(Date.UTC(2024, 0, 15, 11, 0)) // 11:00 UTC, inside event

      const result = calculateCalc(area, makeStatus('0'), 'eskom', SLEEPTIME, nowUTC)

      expect(result.active).toBe(true)
      expect(result.type).toBe('event')
      expect(result.stage).toBe('2') // stage overridden from event note
    })

    it('finds an upcoming event when not yet started', () => {
      const area = makeArea([[]], [[]], events)
      const nowUTC = new Date(Date.UTC(2024, 0, 15, 8, 0)) // 08:00 UTC, before event

      const result = calculateCalc(area, makeStatus('0'), 'eskom', SLEEPTIME, nowUTC)

      expect(result.active).toBe(false)
      expect(result.next?.type).toBe('event')
      expect(result.next?.duration).toBe(2.5 * 3600)
    })

    it('ignores a past event', () => {
      const area = makeArea([[]], [[]], events)
      const nowUTC = new Date(Date.UTC(2024, 0, 15, 13, 0)) // 13:00 UTC, after event

      const result = calculateCalc(area, makeStatus('0'), 'eskom', SLEEPTIME, nowUTC)

      expect(result.active).toBe(false)
      expect(result.next).toBeUndefined()
    })

    it('does not crash when event note has no stage pattern', () => {
      const bareEvents: AreaInfo['events'] = [{
        start: new Date(eventStartMs).toISOString(),
        end:   new Date(eventEndMs).toISOString(),
        note:  'Unplanned outage'
      }]
      const area = makeArea([[]], [[]], bareEvents)
      const nowUTC = new Date(Date.UTC(2024, 0, 15, 11, 0))

      expect(() => calculateCalc(area, makeStatus('1'), 'eskom', SLEEPTIME, nowUTC)).not.toThrow()
    })
  })

  describe('statusselect', () => {
    it('reads the stage from the correct statusselect key', () => {
      const statusInfo: StatusInfo = {
        status: {
          eskom:    { stage: '1', name: 'National', next_stages: [], stage_updated: '' },
          capetown: { stage: '3', name: 'Cape Town', next_stages: [], stage_updated: '' }
        }
      }
      const area = makeArea([['20:00-22:30'], [], ['12:00-14:30', '20:00-22:30']])
      const result = calculateCalc(area, statusInfo, 'capetown', SLEEPTIME, at(8))

      expect(result.stage).toBe('3')
    })
  })
})
