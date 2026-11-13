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
import type { User, UserGroupRatio } from '@/features/users/types'

export type DiscountUser = Pick<
  User,
  'id' | 'username' | 'display_name' | 'role'
>

export interface AdminUserGroupDiscount extends UserGroupRatio {
  id: number
  user_id: number
  username: string
  display_name: string
  user_role: number
}

export interface AdminUserGroupDiscountsData {
  items: AdminUserGroupDiscount[]
  total: number
  p: number
  page_size: number
  day: string
  timezone: 'Asia/Shanghai'
}

export interface AdminUserGroupDiscountsParams {
  p: number
  page_size: number
  keyword?: string
  user_id?: number
  group?: string
  status?: string
}
