import axios from 'axios'
import type { AllowanceInfo, AreaInfo, AreasSearchResult, StatusInfo } from './types'

const API_BASE = 'https://developer.sepush.co.za/business/3.0'

/** Detects a v2-style area ID (e.g. eskde-10-fourways) and returns the v3 equivalent (eskde-10). */
export function migrateAreaId(areaId: string): { id: string; migrated: boolean } {
  const parts = areaId.split('-')
  if (parts.length > 2) {
    return { id: parts.slice(0, 2).join('-'), migrated: true }
  }
  return { id: areaId, migrated: false }
}

export async function fetchAllowance(token: string): Promise<AllowanceInfo> {
  const { data } = await axios.get<AllowanceInfo>(`${API_BASE}/api_allowance`, {
    headers: { token }
  })
  return data
}

export async function fetchStatus(token: string): Promise<StatusInfo> {
  const { data } = await axios.get<StatusInfo>(`${API_BASE}/status`, {
    headers: { token }
  })
  return data
}

export async function fetchArea(token: string, areaId: string, testMode = false): Promise<AreaInfo> {
  const params: Record<string, string> = { id: areaId }
  if (testMode) params.test = 'current'
  const { data } = await axios.get<AreaInfo>(`${API_BASE}/area`, {
    headers: { token },
    params
  })
  return data
}

export async function searchAreas(token: string, query: string): Promise<AreasSearchResult> {
  const { data } = await axios.get<AreasSearchResult>(`${API_BASE}/areas_search`, {
    headers: { token },
    params: { text: query }
  })
  return data
}
