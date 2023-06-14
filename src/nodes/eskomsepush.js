module.exports = function (RED) {
  'use strict'

  const axios = require('axios')
  const EskomSePushInfo = {
    api: {
      lastUpdate: null,
      info: {}
    },
    status: {
      lastUpdate: null,
      info: {}
    },
    area: {
      lastUpdate: null,
      info: {}
    },
    calc: {}
  }

  function getMinutesLeftInDay () {
    const currentDate = new Date()
    const tomorrow = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1)
    const timeDiff = tomorrow.getTime() - currentDate.getTime()
    const minutesLeft = Math.floor(timeDiff / (1000 * 60))

    return minutesLeft
  }

  function checkAllowance (node) {
    const options = {}
    const headers = { token: node.config.licensekey }

    if (node.config.verbose === true) {
      node.warn('Running function checkAllowance')
    }
    axios.get('https://developer.sepush.co.za/business/2.0/api_allowance',
      { params: options, headers }).then(function (response) {
      EskomSePushInfo.api.info = response.data
      if (EskomSePushInfo.api.lastUpdate === null) {
        EskomSePushInfo.api.lastUpdate = new Date()
        updateSheddingStatus(node)
      }
      EskomSePushInfo.api.lastUpdate = new Date()
    })
      .catch(error => {
        node.warn({ error: error.message })
      })
  }

  function checkStage (node) {
    const options = {}
    const headers = { token: node.config.licensekey }

    if (node.config.verbose === true) {
      let warnstring = 'Running function checkStage'
      if (EskomSePushInfo.status.lastUpdate === null) {
        warnstring += ' - initial run'
      } else {
        warnstring += ' after ' + ((new Date() - EskomSePushInfo.status.lastUpdate)/60000).toFixed(0) + ' minutes'
      }
      node.warn(warnstring)
    }
    axios.get('https://developer.sepush.co.za/business/2.0/status',
      { params: options, headers }).then(function (response) {
      EskomSePushInfo.status.info = response.data
      EskomSePushInfo.status.lastUpdate = new Date()
      // Call updateSheddingStatus again now we have new data
      updateSheddingStatus(node)
    })
      .catch(error => {
        node.warn({ error: error.message })
      })
  }

  function checkArea (node) {
    const options = { id: node.config.area }
    const headers = { token: node.config.licensekey }
    const url = 'https://developer.sepush.co.za/business/2.0/area'

    if (node.config.verbose === true) {
      let warnstring = 'Running function checkArea'
      if (EskomSePushInfo.area.lastUpdate === null) {
        warnstring += ' - initial run'
      } else {
        warnstring += ' after ' + ((new Date() - EskomSePushInfo.area.lastUpdate)/60000).toFixed(0) + ' minutes'
      }
      node.warn(warnstring)
    }
    if (node.config.test) {
      options.test = 'current'
    }
    axios.get(url,
      { params: options, headers }).then(function (response) {
      EskomSePushInfo.area.info = response.data
      EskomSePushInfo.area.lastUpdate = new Date()
      // Call updateSheddingStatus again now we have new data
      updateSheddingStatus(node)
    })
      .catch(error => {
        node.warn({ error: error.message })
      })
  }

  function updateSheddingStatus (node) {
    const now = new Date()

    // Check allowance every ten minutes
    if (EskomSePushInfo.api.lastUpdate === null || (now.getTime() - EskomSePushInfo.api.lastUpdate.getTime()) > 600000) {
      checkAllowance(node)
    }

    // If we don't have API info, we just return
    if (Object.entries(EskomSePushInfo.api.info).length === 0) {
      node.warn('No API info (yet), refusing to continue')
      return
    }

    // The same is true if we have no API calls left
    if (EskomSePushInfo.api.info.allowance.count >= EskomSePushInfo.api.info.allowance.limit) {
      node.warn('No API calls left, not checking status/schedule')
      return
    }

    // Fetching actual information takes 2 calls, so calculate how long the day lasts and see how we
    // can divide the available calls over the day
    if ((EskomSePushInfo.api.info.allowance.limit - EskomSePushInfo.api.info.allowance.count) > 0) {
      EskomSePushInfo.calc.sleeptime = (getMinutesLeftInDay() / ((EskomSePushInfo.api.info.allowance.limit - EskomSePushInfo.api.info.allowance.count) / 2)).toFixed(0)
    } else {
      EskomSePushInfo.calc.sleeptime = 30
    }

    if (EskomSePushInfo.status.lastUpdate === null || (now.getTime() - EskomSePushInfo.status.lastUpdate) > (EskomSePushInfo.calc.sleeptime * 60000)) {
      checkStage(node)
    }

    if (EskomSePushInfo.area.lastUpdate === null || (now.getTime() - EskomSePushInfo.area.lastUpdate) > (EskomSePushInfo.calc.sleeptime * 60000)) {
      checkArea(node)
    }

    // Now we have all info to continue. Just making sure that all update values are non null.
    if (EskomSePushInfo.api.lastUpdate === null ||
        EskomSePushInfo.status.lastUpdate === null ||
        EskomSePushInfo.area.lastUpdate === null) {
      (node.config.verbose === true) && node.warn('Not enough info to continue.')
      return
    }

    // Determine the current stage
    EskomSePushInfo.calc.stage = EskomSePushInfo.status.info.status[node.config.statusselect].stage

    if (node.config.verbose === true) {
      node.warn('API call status: ' + EskomSePushInfo.api.info.allowance.count + '/' + EskomSePushInfo.api.info.allowance.limit)
      node.warn(EskomSePushInfo)
    }

    // Default to false, overrule of loadshedding is active
    EskomSePushInfo.calc.active = false

    // Are there any events going on?
    if (Object.entries(EskomSePushInfo.area.info.events).length > 0) {
      EskomSePushInfo.calc.type = 'event'
      const EventStart = Date.parse(EskomSePushInfo.area.info.events[0].start)
      const EventEnd = Date.parse(EskomSePushInfo.area.info.events[0].end)
      if (now >= EventStart && now < EventEnd) {
        EskomSePushInfo.calc.active = true
        if (EskomSePushInfo.area.info.events[0].note.match(/Stage (\d+)/i)) {
          EskomSePushInfo.calc.stage = EskomSePushInfo.area.info.events[0].note.match(/Stage (\d+)/i)[1]
        }
      } else {
        EskomSePushInfo.calc.next = {
          type: 'event',
          start: EventStart,
          end: EventEnd,
          stage: EskomSePushInfo.area.info.events[0].note.match(/Stage (\d+)/i)[1]
        }
      }
    }

    // Scheduled downtime has the thing that the time is in locatime
    // So not just like events, where they are in UTC with an offset
    let BreakLoop = false
    for (const dates of EskomSePushInfo.area.info.schedule.days) {
      for (const schedule of dates.stages[EskomSePushInfo.calc.stage]) {
        const ScheduleStart = Date.parse(dates.date + ' ' + schedule.split('-')[0])
        const ScheduleEnd = Date.parse(dates.date + ' ' + schedule.split('-')[1])
        if (now < ScheduleEnd) {
          BreakLoop = true
          // This schedule is either active or will be next
          if (now >= ScheduleStart) {
            EskomSePushInfo.calc.active = true
            EskomSePushInfo.calc.type = 'schedule'
            EskomSePushInfo.calc.start = ScheduleStart
            EskomSePushInfo.calc.end = ScheduleEnd
          } else {
            EskomSePushInfo.calc.next = {
              type: 'schedule',
              start: ScheduleStart,
              end: ScheduleEnd
            }
          }
        }
        if (BreakLoop) { break }
      }
      if (BreakLoop) { break }
    }

    if (EskomSePushInfo.calc.next) {
      EskomSePushInfo.calc.next.duration = (EskomSePushInfo.calc.next.end - EskomSePushInfo.calc.next.start) / 1000
      EskomSePushInfo.calc.next.islong = EskomSePushInfo.calc.next.duration >= (4 * 3600)
      EskomSePushInfo.calc.secondstostatechange = parseInt((EskomSePushInfo.calc.next.start - now)/1000)
    }

    if (EskomSePushInfo.calc.active) {
      EskomSePushInfo.calc.duration = (EskomSePushInfo.calc.end - EskomSePushInfo.calc.start) / 1000
      EskomSePushInfo.calc.islong = EskomSePushInfo.calc.duration >= (4 * 3600)
      EskomSePushInfo.calc.secondstostatechange = parseInt((EskomSePushInfo.calc.end - now)/1000)
    }

    if (node.config.verbose === true) {
      node.warn(EskomSePushInfo.calc)
    }

    // Send output
    node.send([{
      payload: EskomSePushInfo.calc.active,
      stage: EskomSePushInfo.calc.stage,
      statusselect: node.config.statusselect,
      api: {
        count: EskomSePushInfo.api.info.allowance.count,
        limit: EskomSePushInfo.api.info.allowance.limit
      },
      calc: EskomSePushInfo.calc
    }, {
      stage: EskomSePushInfo.status,
      schedule: EskomSePushInfo.area
    }])

    // And update the status
    let fill = 'green'
    let shape = 'ring'
    let statusText = 'Stage ' + EskomSePushInfo.calc.stage

    if (EskomSePushInfo.calc.active) {
      fill = 'yellow'
      if (EskomSePushInfo.calc.type === 'event') {
        shape = 'dot'
      }
      statusText += ' - ' + new Date(EskomSePushInfo.calc.start).toLocaleTimeString()
      statusText += ' - ' + new Date(EskomSePushInfo.calc.end).toLocaleTimeString()
    } else {
      statusText += ' - ' + new Date(EskomSePushInfo.calc.next.start).toLocaleTimeString()
      statusText += ' - ' + new Date(EskomSePushInfo.calc.next.end).toLocaleTimeString()
    }

    statusText += ' (API: ' + EskomSePushInfo.api.info.allowance.count + '/' + EskomSePushInfo.api.info.allowance.limit + ')'
    node.status({
      fill, shape, text: statusText
    })
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
