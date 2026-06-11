import { fetchAllowance, fetchArea, fetchStatus, migrateAreaId, searchAreas } from '../lib/api'
import { calculateCalc, calculateSleepTime, getMinutesToAPIReset } from '../lib/loadshedding'
import type {
  AllowanceInfo,
  AreaInfo,
  CalcResult,
  NodeConfig,
  NodeRed,
  NodeRedNode,
  StatusInfo
} from '../lib/types'

module.exports = function (RED: NodeRed) {
  'use strict'

  function EskomSePush(this: NodeRedNode, config: NodeConfig) {
    RED.nodes.createNode(this, config)
    this.config = config

    const node = this

    // Per-instance state — avoids shared-state bugs when multiple nodes exist in the same flow
    const info = {
      api:    { lastUpdate: null as Date | null, info: {} as Partial<AllowanceInfo> },
      status: { lastUpdate: null as Date | null, info: {} as Partial<StatusInfo>    },
      area:   { lastUpdate: null as Date | null, info: {} as Partial<AreaInfo>      },
      calc:   {} as Partial<CalcResult>
    }

    async function updateSheddingStatus(msg?: { payload?: unknown }) {
      const now = new Date()

      // Refresh allowance every 10 minutes or on demand
      if (msg?.payload === 'allowance' ||
          info.api.lastUpdate === null ||
          (now.getTime() - info.api.lastUpdate.getTime()) > 600_000) {
        try {
          if (node.config.verbose) node.warn('Running fetchAllowance')
          info.api.info = await fetchAllowance(node.config.licensekey)
          info.api.lastUpdate = now
        } catch (err) {
          node.warn({ error: (err as Error).message })
        }
      }

      if (Object.keys(info.api.info).length === 0) {
        node.warn('No API info (yet), refusing to continue')
        return
      }

      const allowance = (info.api.info as AllowanceInfo).allowance
      if (allowance.count >= allowance.limit) {
        node.warn('No API calls left, not checking status/schedule')
        node.status({ fill: 'red', shape: 'ring', text: 'API quota reached' })
        return
      }

      const minutesToReset = getMinutesToAPIReset(now)
      info.calc.sleeptime = calculateSleepTime(
        allowance.limit,
        allowance.count,
        node.config.api_allowance_buffer,
        minutesToReset
      )
      if (node.config.verbose) node.warn('Calculated sleeptime: ' + info.calc.sleeptime)

      const sleepMs = info.calc.sleeptime * 60_000

      const { id: resolvedAreaId, migrated } = migrateAreaId(node.config.area)
      if (migrated) {
        node.warn(
          `Area ID "${node.config.area}" is a v2-style ID. ` +
          `Using "${resolvedAreaId}" for the v3 API. ` +
          `Please update the area ID in the node configuration.`
        )
      }

      // Refresh stage on demand or when sleeptime has elapsed
      if (msg?.payload === 'stage' ||
          info.status.lastUpdate === null ||
          (now.getTime() - info.status.lastUpdate.getTime()) > sleepMs) {
        try {
          if (node.config.verbose) {
            node.warn(
              info.status.lastUpdate === null
                ? 'Running fetchStatus - initial run'
                : `Running fetchStatus after ${((now.getTime() - info.status.lastUpdate.getTime()) / 60_000).toFixed(0)} minutes`
            )
          }
          node.status({ fill: 'yellow', shape: 'ring', text: 'Fetching status' })
          info.status.info = await fetchStatus(node.config.licensekey)
          info.status.lastUpdate = now
        } catch (err) {
          node.warn({ error: (err as Error).message })
        }
      }

      // Refresh area schedule on demand or when sleeptime has elapsed
      if (msg?.payload === 'area' ||
          info.area.lastUpdate === null ||
          (now.getTime() - info.area.lastUpdate.getTime()) > sleepMs) {
        try {
          if (node.config.verbose) {
            node.warn(
              info.area.lastUpdate === null
                ? 'Running fetchArea - initial run'
                : `Running fetchArea after ${((now.getTime() - info.area.lastUpdate.getTime()) / 60_000).toFixed(0)} minutes`
            )
          }
          node.status({ fill: 'yellow', shape: 'ring', text: 'Fetching schedule' })
          info.area.info = await fetchArea(node.config.licensekey, resolvedAreaId, node.config.test)
          info.area.lastUpdate = now
        } catch (err) {
          node.warn({ error: (err as Error).message })
        }
      }

      if (!info.api.lastUpdate || !info.status.lastUpdate || !info.area.lastUpdate) {
        if (node.config.verbose) node.warn('Not enough info to continue')
        return
      }

      const calc = calculateCalc(
        info.area.info as AreaInfo,
        info.status.info as StatusInfo,
        node.config.statusselect,
        info.calc.sleeptime,
        now
      )
      info.calc = calc

      if (node.config.verbose) node.warn(calc)

      node.send([
        {
          payload: calc.active,
          stage: calc.stage,
          statusselect: node.config.statusselect,
          api: { count: allowance.count, limit: allowance.limit },
          calc
        },
        {
          stage: info.status,
          schedule: info.area
        }
      ])

      const fill = calc.active ? 'yellow' : 'green'
      const shape = calc.active && calc.type === 'event' ? 'dot' : 'ring'
      let statusText = `Stage ${calc.stage}: `

      if (calc.active && calc.start !== undefined && calc.end !== undefined) {
        statusText += new Date(calc.start).toLocaleTimeString([], { timeStyle: 'short' })
        statusText += ' - ' + new Date(calc.end).toLocaleTimeString([], { timeStyle: 'short' })
      } else if (calc.next) {
        const nextDate = new Date(calc.next.start)
        // Fix: original code compared getUTCDay() (0–6) with getUTCDate() (1–31), always unequal
        if (nextDate.toDateString() !== now.toDateString()) {
          statusText += nextDate.toLocaleString([], { weekday: 'short' }) + ' '
        }
        statusText += nextDate.toLocaleTimeString([], { timeStyle: 'short' })
        statusText += ' - ' + new Date(calc.next.end).toLocaleTimeString([], { timeStyle: 'short' })
      }

      statusText += ` (API: ${allowance.count}/${allowance.limit})`
      node.status({ fill, shape, text: statusText })
    }

    updateSheddingStatus()
    const intervalId = setInterval(() => updateSheddingStatus(), 60_000)

    node.on('input', (msg) => updateSheddingStatus(msg as { payload?: unknown }))
    node.on('close', () => clearInterval(intervalId))
  }

  RED.nodes.registerType('eskomsepush', EskomSePush)

  RED.httpNode.get('/eskomsepush/search', async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (!req.query?.token || !req.query?.search) {
      return res.send(JSON.stringify({ error: 'invalid' }))
    }
    try {
      const data = await searchAreas(req.query.token, req.query.search)
      return res.send(data)
    } catch (err) {
      return res.send({ error: (err as Error).message })
    }
  })

  RED.httpNode.get('/eskomsepush/api', async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (!req.query?.token) {
      return res.send(JSON.stringify({ error: 'invalid' }))
    }
    try {
      const data = await fetchAllowance(req.query.token)
      return res.send(data)
    } catch (err) {
      return res.send({ error: (err as Error).message })
    }
  })
}
