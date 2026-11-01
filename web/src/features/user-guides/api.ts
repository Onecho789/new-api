/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { queryOptions } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { UserGuide, UserGuideInput, UserGuideResponse } from './types'

// Readers only see enabled guides; the admin endpoints return drafts too.
function guideBasePath(admin: boolean): string {
  return admin ? '/api/guide/admin' : '/api/guide'
}

export function userGuidesQueryOptions(admin = false) {
  return queryOptions({
    queryKey: ['user-guides', admin ? 'admin' : 'reader'],
    queryFn: async (): Promise<UserGuide[]> => {
      const response = await api.get<UserGuideResponse<UserGuide[]>>(
        `${guideBasePath(admin)}/`
      )
      return requireServerSuccess(response.data).data ?? []
    },
  })
}

export function userGuideQueryOptions(id: number, admin = false) {
  return queryOptions({
    queryKey: ['user-guides', admin ? 'admin' : 'reader', id],
    queryFn: async (): Promise<UserGuide> => {
      const response = await api.get<UserGuideResponse>(
        `${guideBasePath(admin)}/${id}`
      )
      const guide = requireServerSuccess(response.data).data
      if (!guide) throw new Error('Guide not found')
      return guide
    },
  })
}

export async function saveUserGuide(
  data: UserGuideInput,
  id?: number
): Promise<UserGuideResponse> {
  const response =
    id === undefined
      ? await api.post('/api/guide/admin/', data)
      : await api.put(`/api/guide/admin/${id}`, data)
  return response.data
}

export async function deleteUserGuide(
  id: number
): Promise<UserGuideResponse<never>> {
  const response = await api.delete(`/api/guide/admin/${id}`)
  return response.data
}
