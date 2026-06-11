import type { AreaInfo, CalcResult, StatusInfo } from './types'

export function getMinutesToAPIReset(now: Date = new Date()): number {
  const resetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0)
  if (now > resetTime) {
    resetTime.setDate(resetTime.getDate() + 1)
  }
  return Math.floor((resetTime.getTime() - now.getTime()) / 60_000)
}

export function calculateSleepTime(
  limit: number,
  count: number,
  buffer: number,
  minutesToReset: number
): number {
  const remaining = limit - buffer - count
  if (remaining <= 0) return 60
  const sleeptime = Math.round(minutesToReset / Math.ceil(remaining / 2))
  return Math.max(sleeptime, 10)
}

function parseScheduleTime(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute).getTime()
}

export function calculateCalc(
  areaInfo: AreaInfo,
  statusInfo: StatusInfo,
  statusselect: string,
  sleeptime: number,
  now: Date = new Date()
): CalcResult {
  const statusStage = statusInfo.status[statusselect]?.stage ?? '0'
  const calc: CalcResult = {
    sleeptime,
    stage: statusStage,
    active: false
  }

  // Check events first — an active event can override the effective stage
  if (areaInfo.events.length > 0) {
    const firstEvent = areaInfo.events[0]
    const eventStart = Date.parse(firstEvent.start)
    const eventEnd = Date.parse(firstEvent.end)

    if (now.getTime() >= eventStart && now.getTime() < eventEnd) {
      calc.type = 'event'
      calc.active = true
      const stageMatch = firstEvent.note.match(/Stage (\d+)/i)
      if (stageMatch) calc.stage = stageMatch[1]
      calc.start = eventStart
      calc.end = eventEnd
    } else if (now.getTime() < eventStart) {
      const stageMatch = firstEvent.note.match(/Stage (\d+)/i)
      calc.next = {
        type: 'event',
        start: eventStart,
        end: eventEnd,
        duration: 0,   // computed in post-loop block
        islong: false, // computed in post-loop block
        stage: stageMatch ? stageMatch[1] : statusStage
      }
    }
  }

  // Check scheduled downtime — uses local time (schedule times have no timezone info)
  const effectiveStageNum = parseInt(String(calc.stage), 10)
  let breakLoop = false

  for (const day of areaInfo.schedule.days) {
    const stageIndex = effectiveStageNum - 1

    if (stageIndex < 0 || stageIndex >= day.stages.length) {
      break // Stage 0 or out of range → no scheduled loadshedding
    }

    const slots = day.stages[stageIndex]
    if (!Array.isArray(slots)) break

    for (const slot of slots) {
      const [startStr, endStr] = slot.split('-')
      let schedStart = parseScheduleTime(day.date, startStr)
      let schedEnd = parseScheduleTime(day.date, endStr)

      // Handle slots that cross midnight (e.g. "22:00-00:30")
      if (schedEnd < schedStart) {
        schedEnd += 24 * 60 * 60 * 1000
      }

      if (now.getTime() < schedEnd) {
        breakLoop = true
        if (now.getTime() >= schedStart) {
          calc.active = true
          calc.type = 'schedule'
          calc.start = schedStart
          calc.end = schedEnd
        } else {
          calc.next = {
            type: 'schedule',
            start: schedStart,
            end: schedEnd,
            duration: 0,   // computed below
            islong: false, // computed below
            stage: calc.stage
          }
        }
        break
      }
    }
    if (breakLoop) break
  }

  // Compute derived fields — next block runs first so active block can overwrite secondstostatechange
  if (calc.next) {
    calc.next.duration = (calc.next.end - calc.next.start) / 1000
    calc.next.islong = calc.next.duration >= 4 * 3600
    calc.secondstostatechange = Math.floor((calc.next.start - now.getTime()) / 1000)
    calc.next.isHigherStage = Number(calc.next.stage) > Number(calc.stage)
  }

  if (calc.active && calc.start !== undefined && calc.end !== undefined) {
    calc.duration = (calc.end - calc.start) / 1000
    calc.islong = calc.duration >= 4 * 3600
    calc.secondstostatechange = Math.floor((calc.end - now.getTime()) / 1000)
  }

  return calc
}
