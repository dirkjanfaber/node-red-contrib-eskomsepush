module.exports = function (RED) {
  'use strict'

  const axios = require('axios')
  let EskomSePushAPI = null
  let Stage = null
  let Schedule = null
  let lastStatusUpdate = new Date()
  let lastStageUpdate = new Date()
  let lastScheduleUpdate = new Date()
  let fill = 'green'
  let shape = 'ring'

  function checkAllowance (node) {
    const options = {}
    const headers = { token: node.config.licensekey }
    axios.get('https://developer.sepush.co.za/business/2.0/api_allowance',
      { params: options, headers }).then(function (response) {
      EskomSePushAPI = response.data
    })
      .catch(error => {
        node.warn({ error: error.message })
      })
  }

  function checkStage (node) {
    const options = {}
    const headers = { token: node.config.licensekey }
    axios.get('https://developer.sepush.co.za/business/2.0/status',
      { params: options, headers }).then(function (response) {
      Stage = response.data
    })
      .catch(error => {
        node.warn({ error: error.message })
      })
  }

  function checkSchedule (node) {
    const options = { id: node.config.area }
    const headers = { token: node.config.licensekey }
    const url = 'https://developer.sepush.co.za/business/2.0/area'
    if (node.config.test) {
      options.test = 'current'
    }
    axios.get(url,
      { params: options, headers }).then(function (response) {
      Schedule = response.data
      Schedule.info.area = node.config.area
    })
      .catch(error => {
        node.warn({ error: error.message })
      })
  }

  function updateStatus (node) {
    const now = new Date()
    let statusText = ''

    if (EskomSePushAPI === null || (now.getTime() - lastStatusUpdate.getTime()) > 600000) {
      checkAllowance(node)
      lastStatusUpdate = now
    }

    if (Schedule && Schedule.info.area !== node.config.area) {
      Schedule = null
    }

    if (EskomSePushAPI && EskomSePushAPI.allowance.count >= EskomSePushAPI.allowance.limit) {
      statusText += 'API quota reached'
      fill = 'red'
      shape = 'dot'
    } else {
      if (Stage === null || (now.getTime() - lastStageUpdate.getTime()) > 3600000) {
        node.status({ fill: 'yellow', shape, text: 'Fetching stage' })
        checkStage(node)
        lastStageUpdate = now
      }

      if (Schedule === null || (now.getTime() - lastScheduleUpdate.getTime()) > 3600000) {
        node.status({ fill: 'yellow', shape, text: 'Fetching schedule' })
        checkSchedule(node)
        lastScheduleUpdate = now
      }
    }

    if (Stage && Schedule && EskomSePushAPI) {
      const stage = Stage.status[node.config.statusselect].stage
      const nowtime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
      const LoadShedding = {
        schedule: {
          next: {},
          active: false
        },
        event: {
          next: {},
          active: false
        },
        checked: nowtime
      }
      fill = 'green'
      for (const schedule of Schedule.schedule.days[0].stages[stage - 1]) {
        if (nowtime >= schedule.split('-')[0] && nowtime <= schedule.split('-')[1]) {
          LoadShedding.schedule = {
            active: true,
            start: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[0]),
            end: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[1])
          }
        }
        if (nowtime < schedule.split('-')[0]) {
          LoadShedding.schedule.next = {
            start: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[0]),
            end: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[1])
          }
        }
      }
      if (Object.keys(LoadShedding.schedule.next).length === 0) {
        const s = Schedule.schedule.days[1].stages[stage - 1][0]
        LoadShedding.schedule.next = {
          start: Date.parse(Schedule.schedule.days[1].date + ' ' + s.split('-')[0]),
          end: Date.parse(Schedule.schedule.days[1].date + ' ' + s.split('-')[1])
        }
      }
      LoadShedding.event.next = {
        start: Date.parse(Schedule.events[0].start),
        end: Date.parse(Schedule.events[0].end)
      }
      if (nowtime >= LoadShedding.event.start && nowtime < LoadShedding.event.end) {
        LoadShedding.event.active = true
        LoadShedding.start = LoadShedding.event.start
        LoadShedding.end = LoadShedding.event.end
      }

      if (!LoadShedding.schedule.next.start || !LoadShedding.event.next.start) {
        node.warn('Unable to find next scheduled event and/or schedule')
        node.warn(LoadShedding)
        return
      }
      if (LoadShedding.schedule.next.start <= LoadShedding.event.next.start) {
        LoadShedding.next = LoadShedding.schedule.next
        LoadShedding.next.type = 'schedule'
      } else {
        LoadShedding.next = LoadShedding.event.next
        LoadShedding.next.type = 'event'
      }

      statusText += 'Stage '+stage
      LoadShedding.active = (LoadShedding.schedule.active || LoadShedding.event.active)
      if (LoadShedding.active) {
        statusText += ' - ' + new Date(LoadShedding.end).toLocaleTimeString()
        fill = 'red'
      } else {
        statusText += ' - ' + new Date(LoadShedding.next.start).toLocaleTimeString()
      }
      node.send([{
        payload: LoadShedding.active,
        LoadShedding,
        stage,
        statusselect: node.config.statusselect,
        api: {
          count: EskomSePushAPI.allowance.count,
          limit: EskomSePushAPI.allowance.limit,
          lastStatusUpdate: lastStatusUpdate.toString(),
          lastScheduleUpdate: lastScheduleUpdate.toString()
        }
      }, {
        stage: Stage,
        schedule: Schedule
      }])
    }

    if (EskomSePushAPI) {
      statusText += ` (API: ${EskomSePushAPI.allowance.count}/${EskomSePushAPI.allowance.limit})`
    }

    node.status({
      fill, shape, text: (statusText || 'Ok')
    })
  }

  function EskomSePush (config) {
    RED.nodes.createNode(this, config)

    const node = this
    node.config = config

    updateStatus(node)
    const intervalId = setInterval(function () {
      updateStatus(node)
    }, 60000)

    node.on('close', function () {
      clearInterval(intervalId)
    })
  }

  RED.nodes.registerType('eskomsepush', EskomSePush)

  RED.httpNode.get('/eskomsepush/search', (req, res) => {
    if (!req.query || !req.query.token || !req.query.search) {
      res.setHeader('Content-Type', 'application/json')
      return res.send('invalid')
    }
    const headers = {
      token: req.query.token
    }
    const options = {
      text: req.query.search
    }

    res.setHeader('Content-Type', 'application/json')
    axios.get('https://developer.sepush.co.za/business/2.0/areas_search',
      { params: options, headers }).then(function (response) {
      return res.send(response.data)
    })
      .catch(error => {
        return res.send({ error: error.message })
      })
  })
}
