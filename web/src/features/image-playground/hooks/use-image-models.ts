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
import { useEffect, useMemo, useState } from 'react'

import { getAvailableModels } from '../api'
import type { SelectOption } from '../types'

/** 与后端 common.ImageGenerationModels 对应的生图模型名特征 */
const IMAGE_MODEL_KEYWORDS = [
  'gpt-image-',
  'dall-e',
  'imagen-',
  'flux',
  'image',
] as const

function isImageModel(model: string): boolean {
  const lower = model.toLowerCase()
  return IMAGE_MODEL_KEYWORDS.some((keyword) => lower.includes(keyword))
}

export function useImageModels() {
  const [models, setModels] = useState<SelectOption[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void getAvailableModels()
      .then((list) => {
        if (!cancelled) setModels(list)
      })
      .catch(() => {
        if (!cancelled) setModels([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // 生图模型优先展示，但保留全部选项以防关键词漏判
  const imageModels = useMemo(
    () => models.filter((option) => isImageModel(option.value)),
    [models]
  )

  return { models, imageModels, isLoading }
}
