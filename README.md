### EskomSePush API

![EskomsePush API](img/eskomsepush-flow.png)

A node for retrieving info from the [EskomSePush API](https://eskomsepush.gumroad.com/l/api).

The EskomSePush-API node gives the tools to make working with the load shedding in South Africa as easy as possible.

First you need to configure the node by entering the license key and entering the correct area.

Once deployed, the node will fetch the data from EskomSePush every hour. As every fetch from the API takes 2 calls, the 50 free queries per day on a free account should suffice. Every ten minutes the API status is checked to see how many queries you have left.

Internally the node checks every minute if a schedule is currently active or not. It will also output a message on the first deployment.

![EskomsePush Victron MinSOC](img/eskomsepush-victron-minsoc.png)

The node has been made to work well together with the [@victronenergy/node-red-contrib-victron](https://flows.nodered.org/node/@victronenergy/node-red-contrib-victron) nodes. One of the main ones being the
ESS control node for setting the MinSoc, based on the currently active stage. You can find the
example flow for this via importing the [victron-minsoc-stage-based.json](examples/victron-minsoc-stage-based.json) file.

### Configuration

First you will need a _licence key_. You can get one from [here](https://eskomsepush.gumroad.com/l/api), by subsribing to the Free model. Note that this is for personal use only.

![EskomsePush configuration](img/eskomsepush-configuration.png)

Next you need to insert the correct area. Once you entered 5 characters (and a valid license is used), the API will be used for searching the correct area. Do note that this will cost some of the daily queries. If you don't want that and you already know the id of the area, fill out the area first and then the license key.

Then you need to fill out which status to follow. This can be either _National_ (eskom) or _Capetown_.

If the _test_ checkbox has been selected, test data for the area will be fetched instead of the actual schedule. This is useful when debugging.

### Outputs

The first output of the node outputs a boolean value. When load shedding is active, the `msg.payload` will be _true_, otherwise it will be _false_. It also outputs some extra values:  
```
{
  "payload":false,
  "LoadShedding":{
    "schedule":{
       "next":{
         "start":1683561600000,
         "end":1683570600000,
         "type":"schedule"
       },
       "active":false
    },
    "event":{
      "next":{
        "start":1683561600000,
        "end":1683570600000
      },
      "active":false
    },
    "checked":"13:35",
    "next":{
      "start":1683561600000,
      "end":1683570600000,
      "type":"schedule"
    },
    "active":false
  },
  "stage":"5",
  "statusselect":"capetown",
  "api":{
    "count":12,
    "limit":50,
    "lastStatusUpdate":"Mon May 08 2023 13:34:30 GMT+0200 (Central European Summer Time)",
    "lastScheduleUpdate":"Mon May 08 2023 13:34:30 GMT+0200 (Central European Summer Time)"
  },
  "\_msgid":"6e77b593b7f9eda4"
}
```

The start and end objects contain the time as unix timestamp in the Javascript format (milliseconds after the epoch).

The second output shows `msg.stage` and `msg.schedule`, containing the latest information as retrieved from the API. This output is mainly useful when writing your own functions and logic.

### Status

The status will show the situation regarding the API calls and when the next
shedding wil start or end.  It also shows the count of API calls that have been
done and how many are left. This updates every 10 minutes.


### Documentation

Documentation for the API can be found [here](https://documenter.getpostman.com/view/1296288/UzQuNk3E)

When quota has been exceeded:
```
{"error":"Quota Exceeded - Reminder: you can use the 'test' query param for development. Check the docs! \ud83d\ude05"}
```
