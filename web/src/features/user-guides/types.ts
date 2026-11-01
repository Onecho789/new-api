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
export type UserGuideFormat = 'markdown' | 'html'

export interface UserGuide {
  id: number
  title: string
  format: UserGuideFormat
  // List responses omit content; detail responses always include it.
  content?: string
  sort_order: number
  enabled: boolean
  created_time: number
  updated_time: number
}

export type UserGuideInput = Pick<
  UserGuide,
  'title' | 'format' | 'sort_order' | 'enabled'
> & { content: string }

export interface UserGuideResponse<T = UserGuide> {
  success: boolean
  message?: string
  data?: T
}
