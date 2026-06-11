import axios from 'axios'
import { fetchAllowance, fetchArea, fetchStatus, migrateAreaId, searchAreas } from '../lib/api'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

const V3_BASE = 'https://developer.sepush.co.za/business/3.0'
const TOKEN = 'TEST-TOKEN-1234'

beforeEach(() => jest.clearAllMocks())

describe('migrateAreaId', () => {
  it('strips the location suffix from a v2-style ID', () => {
    expect(migrateAreaId('eskde-10-fourways')).toEqual({ id: 'eskde-10', migrated: true })
  })

  it('leaves a v3-style ID unchanged', () => {
    expect(migrateAreaId('eskde-10')).toEqual({ id: 'eskde-10', migrated: false })
  })

  it('handles long location suffixes', () => {
    expect(migrateAreaId('eskmo-15-ballitokwadukuzakwazulunatal')).toEqual({
      id: 'eskmo-15',
      migrated: true
    })
  })
})

describe('fetchAllowance', () => {
  it('calls the v3 api_allowance endpoint', async () => {
    const payload = { allowance: { count: 10, limit: 50, type: 'free' } }
    mockedAxios.get.mockResolvedValueOnce({ data: payload })

    const result = await fetchAllowance(TOKEN)

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${V3_BASE}/api_allowance`,
      expect.objectContaining({ headers: { token: TOKEN } })
    )
    expect(result).toEqual(payload)
  })
})

describe('fetchStatus', () => {
  it('calls the v3 status endpoint', async () => {
    const payload = { status: { eskom: { stage: '2', name: 'National', next_stages: [], stage_updated: '' } } }
    mockedAxios.get.mockResolvedValueOnce({ data: payload })

    const result = await fetchStatus(TOKEN)

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${V3_BASE}/status`,
      expect.objectContaining({ headers: { token: TOKEN } })
    )
    expect(result).toEqual(payload)
  })
})

describe('fetchArea', () => {
  it('calls the v3 area endpoint with the given area ID', async () => {
    const payload = { events: [], info: { name: 'Test', region: 'Test' }, schedule: { days: [], source: '' } }
    mockedAxios.get.mockResolvedValueOnce({ data: payload })

    await fetchArea(TOKEN, 'eskde-10')

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${V3_BASE}/area`,
      expect.objectContaining({
        headers: { token: TOKEN },
        params: { id: 'eskde-10' }
      })
    )
  })

  it('appends test=current when testMode is true', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: {} })

    await fetchArea(TOKEN, 'eskde-10', true)

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${V3_BASE}/area`,
      expect.objectContaining({ params: { id: 'eskde-10', test: 'current' } })
    )
  })
})

describe('searchAreas', () => {
  it('calls the v3 areas_search endpoint with text param', async () => {
    const payload = { areas: [{ id: 'eskde-10', name: 'Fourways 2', region: 'Eskom Direct' }] }
    mockedAxios.get.mockResolvedValueOnce({ data: payload })

    const result = await searchAreas(TOKEN, 'fourways')

    expect(mockedAxios.get).toHaveBeenCalledWith(
      `${V3_BASE}/areas_search`,
      expect.objectContaining({
        headers: { token: TOKEN },
        params: { text: 'fourways' }
      })
    )
    expect(result).toEqual(payload)
  })
})
