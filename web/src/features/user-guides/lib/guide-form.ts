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
import type { TFunction } from 'i18next'
import { z } from 'zod'

// Mirrors the server limits in model/user_guide.go.
export const GUIDE_TITLE_MAX = 128
export const GUIDE_CONTENT_MAX = 200000

export function getGuideFormSchema(t: TFunction) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('Guide title is required'))
      .refine(
        (title) => [...title].length <= GUIDE_TITLE_MAX,
        t('Guide title must be at most 128 characters')
      ),
    format: z.enum(['markdown', 'html']),
    content: z
      .string()
      .refine(
        (content) => content.trim().length > 0,
        t('Guide content is required')
      )
      .refine(
        (content) => [...content].length <= GUIDE_CONTENT_MAX,
        t('Guide content must be at most 200000 characters')
      ),
    sort_order: z.number().int(),
    enabled: z.boolean(),
  })
}

export type GuideFormValues = z.infer<ReturnType<typeof getGuideFormSchema>>
