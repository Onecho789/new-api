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
import type { ApiResponse, UserGroupRatiosData } from '@/features/users/types'
import { api } from '@/lib/api'

import type {
  AdminUserGroupDiscountsData,
  AdminUserGroupDiscountsParams,
} from './types'

export async function getAdminUserGroupDiscounts(
  params: AdminUserGroupDiscountsParams,
  signal?: AbortSignal
): Promise<ApiResponse<AdminUserGroupDiscountsData>> {
  const result = await api.get('/api/user/group-ratios', { params, signal })
  return result.data
}

export async function deleteUserGroupDiscount(
  userId: number,
  group: string,
  version: number
): Promise<ApiResponse<UserGroupRatiosData>> {
  const result = await api.delete(`/api/user/${userId}/group-ratios`, {
    data: { group, version },
  })
  return result.data
}
