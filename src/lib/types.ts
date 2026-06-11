export interface AllowanceInfo {
  allowance: {
    count: number
    limit: number
    type: string
  }
}

export interface StatusEntry {
  name: string
  next_stages: Array<{ stage: string; stage_start_timestamp: string }>
  stage: string
  stage_updated: string
}

export interface StatusInfo {
  status: Record<string, StatusEntry>
}

export interface AreaEvent {
  end: string
  note: string
  start: string
}

export interface ScheduleDay {
  date: string
  name: string
  stages: string[][]
}

export interface AreaInfo {
  events: AreaEvent[]
  info: {
    name: string
    region: string
  }
  schedule: {
    days: ScheduleDay[]
    source: string
  }
}

export interface AreasSearchResult {
  areas: Array<{
    id: string
    name: string
    region: string
  }>
}

export interface NextPeriod {
  type: 'schedule' | 'event'
  start: number
  end: number
  duration: number
  islong: boolean
  stage: string | number
  isHigherStage?: boolean
}

export interface CalcResult {
  sleeptime: number
  stage: string | number
  active: boolean
  type?: 'schedule' | 'event'
  start?: number
  end?: number
  duration?: number
  islong?: boolean
  secondstostatechange?: number
  next?: NextPeriod
}

export interface NodeConfig {
  name?: string
  licensekey: string
  area: string
  statusselect: string
  test?: boolean
  verbose?: boolean
  api_allowance_buffer: number
}

export interface NodeRedNode {
  config: NodeConfig
  status(opts: { fill?: string; shape?: string; text?: string }): void
  warn(msg: unknown): void
  send(msgs: (object | null)[]): void
  on(event: 'close' | 'input', listener: (...args: unknown[]) => void): void
}

export interface NodeRed {
  nodes: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createNode(node: any, config: NodeConfig): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerType(type: string, constructor: any): void
  }
  httpNode: {
    get(
      path: string,
      handler: (
        req: { query: Record<string, string> },
        res: { setHeader(name: string, value: string): void; send(data: unknown): unknown }
      ) => void
    ): void
  }
}
