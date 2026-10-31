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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { editImages, generateImages } from '../api'
import {
  buildEditFormData,
  buildRequestPayload,
  extractGeneratedImages,
} from '../lib'
import type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageParameterEnabled,
  ImagePlaygroundConfig,
  UploadedImage,
} from '../types'

type UseImageGenerationOptions = {
  config: ImagePlaygroundConfig
  parameterEnabled: ImageParameterEnabled
  apiKey: string
  /** 图生图的输入图，文生图模式下为空数组 */
  uploadedImages: UploadedImage[]
  mask: UploadedImage | null
}

export function useImageGeneration({
  config,
  parameterEnabled,
  apiKey,
  uploadedImages,
  mask,
}: UseImageGenerationOptions) {
  const { t } = useTranslation()
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 卸载时中断在途请求，避免对已销毁组件 setState
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  /**
   * 共用发送逻辑。payload 既是请求体也是结果卡的快照，
   * 「重新生成」直接把历史快照传回来即可原样复跑。
   */
  const run = useCallback(
    async (payload: ImageGenerationRequest, isEdit: boolean) => {
      if (!apiKey.trim()) {
        setError(t('Please enter an API key'))
        return
      }
      if (!payload.prompt) {
        setError(t('Please enter a prompt'))
        return
      }
      if (!payload.model) {
        setError(t('Please select a model'))
        return
      }
      if (isEdit && uploadedImages.length === 0) {
        setError(t('Please upload at least one source image'))
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      setIsGenerating(true)
      setError(null)

      try {
        const response = isEdit
          ? await editImages(
              buildEditFormData(payload, uploadedImages, mask),
              apiKey.trim(),
              controller.signal
            )
          : await generateImages(payload, apiKey.trim(), controller.signal)

        const generated = extractGeneratedImages(
          response,
          payload,
          isEdit ? 'edit' : 'generate'
        )

        if (generated.length === 0) {
          setError(t('The response contained no images'))
          return
        }

        // 最新结果置顶
        setImages((prev) => [...generated, ...prev])
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : t('Request failed'))
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        setIsGenerating(false)
      }
    },
    [apiKey, mask, t, uploadedImages]
  )

  const generate = useCallback(async () => {
    await run(
      buildRequestPayload(config, parameterEnabled),
      config.mode === 'edit'
    )
  }, [config, parameterEnabled, run])

  /** 用结果卡上的原始快照复跑，参数完全一致 */
  const regenerate = useCallback(
    async (image: GeneratedImage) => {
      const payload = image.requestSnapshot ?? {
        model: image.model,
        prompt: image.prompt,
      }
      await run(payload, image.mode === 'edit')
    },
    [run]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsGenerating(false)
  }, [])

  const clearImages = useCallback(() => {
    setImages([])
    setError(null)
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((image) => image.id !== id))
  }, [])

  return {
    images,
    isGenerating,
    error,
    generate,
    regenerate,
    setError,
    stop,
    clearImages,
    removeImage,
  }
}
