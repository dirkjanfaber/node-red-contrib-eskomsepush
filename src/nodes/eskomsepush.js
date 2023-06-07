module.exports = function (RED) {
  'use strict'

  const axios = require('axios')
  let EskomSePushAPI = null
  let Stage = null
  let Schedule = null
  let LoadShedding = null
  let lastStatusUpdate = new Date()
  let lastStageUpdate = new Date()
  let lastScheduleUpdate = new Date()

  function updateStatus (node) {
    let fill = 'green'
    let shape = 'ring'
    let statusText = ''
    if (Stage && Stage.status && Stage.status[node.config.statusselect].stage) {
      statusText += 'Stage ' + Stage.status[node.config.statusselect].stage
    }
    if (LoadShedding && LoadShedding.active && LoadShedding.next && LoadShedding.next.end) {
      statusText += ' - ' + new Date(LoadShedding.next.end).toLocaleTimeString()
      fill = 'yellow'
      if (LoadShedding.type === 'event') {
        shape = 'dot'
      }
    } else {
      if (LoadShedding && LoadShedding.next && LoadShedding.next.start) {
        statusText += ' - ' + new Date(LoadShedding.next.start).toLocaleTimeString()
      }
    }
    if (EskomSePushAPI) {
      statusText += ` (API: ${EskomSePushAPI.allowance.count}/${EskomSePushAPI.allowance.limit})`
      if (EskomSePushAPI.allowance.count >= EskomSePushAPI.allowance.limit) {
        fill = 'red'
      }
    }
    node.status({
      fill, shape, text: statusText
    })
  }

  function checkAllowance (node) {
    const options = {}
    const headers = { token: node.config.licensekey }
    axios.get('https://developer.sepush.co.za/business/2.0/api_allowance',
      { params: options, headers }).then(function (response) {
      EskomSePushAPI = response.data
      updateStatus(node)
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
      updateSheddingStatus(node)
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
      updateSheddingStatus(node)
    })
      .catch(error => {
        node.warn({ error: error.message })
      })
  }

  function updateSheddingStatus (node) {
    const now = new Date()

    if (EskomSePushAPI === null || (now.getTime() - lastStatusUpdate.getTime()) > 600000) {
      checkAllowance(node)
      lastStatusUpdate = now
    }

    if (Schedule && Schedule.info.area !== node.config.area) {
      Schedule = null
    }

    if (EskomSePushAPI && EskomSePushAPI.allowance.count >= EskomSePushAPI.allowance.limit) {
      updateStatus(node)
      return
    }

    if (Stage === null || (now.getTime() - lastStageUpdate.getTime()) > 3600000) {
      checkStage(node)
      lastStageUpdate = now
    }

    if (Schedule === null || (now.getTime() - lastScheduleUpdate.getTime()) > 3600000) {
      checkSchedule(node)
      lastScheduleUpdate = now
    }

    if (Stage && Schedule && EskomSePushAPI) {
      const stage = Stage.status[node.config.statusselect].stage
      const nowtime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
      LoadShedding = {
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
      node.warn(Schedule)
      node.warn(stage)
      node.warn(Stage)
      for (const schedule of Schedule.schedule.days[0].stages[stage - 1]) {
        if (nowtime >= schedule.split('-')[0] && nowtime <= schedule.split('-')[1]) {
          LoadShedding.schedule = {
            active: true
          }
          if (schedule.split('-')[0] < schedule.split('-')[1]) {
            LoadShedding.schedule.next = {
              start: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[0]),
              end: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[1])
            }
          } else {
            LoadShedding.schedule.next = {
              start: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[0]),
              end: Date.parse(Schedule.schedule.days[1].date + ' ' + schedule.split('-')[1])
            }
          }
        }
        if (nowtime < schedule.split('-')[0]) {
          if (schedule.split('-')[0] < schedule.split('-')[1]) {
            LoadShedding.schedule.next = {
              start: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[0]),
              end: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[1])
            }
          } else {
            LoadShedding.schedule.next = {
              start: Date.parse(Schedule.schedule.days[0].date + ' ' + schedule.split('-')[0]),
              end: Date.parse(Schedule.schedule.days[1].date + ' ' + schedule.split('-')[1])
            }
          }
        }
      }
      if (!LoadShedding.schedule.active && Object.keys(LoadShedding.schedule.next).length === 0) {
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
      if (now >= LoadShedding.event.next.start && now < LoadShedding.event.next.end) {
        LoadShedding.event.active = true
      }

      if (!LoadShedding.schedule | !LoadShedding.schedule.next ||
         !LoadShedding.event || !LoadShedding.event.next ||
         !LoadShedding.schedule.next.start || !LoadShedding.event.next.start) {
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

      LoadShedding.next.duration = (LoadShedding.next.end - LoadShedding.next.start) / 1000
      LoadShedding.next.islong = LoadShedding.next.duration >= (4 * 3600)

      LoadShedding.active = (LoadShedding.schedule.active || LoadShedding.event.active)
      if (LoadShedding.schedule.active) {
        LoadShedding.type = 'schedule'
        LoadShedding.start = LoadShedding.schedule.next.start
        LoadShedding.end = LoadShedding.schedule.next.end
      }
      if (LoadShedding.event.active) {
        LoadShedding.type = 'event'
        LoadShedding.start = LoadShedding.event.next.start
        LoadShedding.end = LoadShedding.event.next.end
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

    updateStatus(node)
  }

  function EskomSePush (config) {
    RED.nodes.createNode(this, config)

    const node = this
    node.config = config

    updateSheddingStatus(node)
    const intervalId = setInterval(function () {
      updateSheddingStatus(node)
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
  RED.httpNode.get('/eskomsepush/api', (req, res) => {
    if (!req.query.token) {
      res.setHeader('Content-Type', 'application/json')
      return res.send('invalid')
    }
    const headers = {
      token: req.query.token
    }
    const options = {}

    res.setHeader('Content-Type', 'application/json')
    axios.get('https://developer.sepush.co.za/business/2.0/api_allowance',
      { params: options, headers }).then(function (response) {
      return res.send(response.data)
    })
      .catch(error => {
        return res.send({ error: error.message })
      })
  })
}
