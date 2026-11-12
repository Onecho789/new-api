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
import type { ImageGenerationTask, ImageHistoryEntry } from '../history-types'
import {
  buildEditFormData,
  buildRequestPayload,
  clampImageN,
  extractGeneratedImages,
  normalizeImageRequestSnapshot,
} from '../lib'
import type {
  GeneratedImage,
  ImageEditSnapshot,
  ImageGenerationRequest,
  ImageParameterEnabled,
  ImagePlaygroundConfig,
  UploadedImage,
} from '../types'
import { useImageHistory } from './use-image-history'

type UseImageGenerationOptions = {
  config: ImagePlaygroundConfig
  parameterEnabled: ImageParameterEnabled
  apiKey: string
  /** 图生图的输入图，文生图模式下为空数组 */
  uploadedImages: UploadedImage[]
  mask: UploadedImage | null
  accountId?: number | null
}

export function useImageGeneration({
  config,
  parameterEnabled,
  apiKey,
  uploadedImages,
  mask,
  accountId = null,
}: UseImageGenerationOptions) {
  const { t } = useTranslation()
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<ImageGenerationTask[]>([])
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const activeEntryRef = useRef<ImageHistoryEntry | null>(null)
  const {
    history,
    historyLoading,
    historyError,
    upsertHistory,
    deleteHistory: deleteStoredHistory,
  } = useImageHistory(accountId)

  // Account changes also invalidate every in-flight response.
  useEffect(() => {
    setImages([])
    setTasks([])
    setStartedAt(null)
    setActiveHistoryId(null)
    setError(null)
    activeEntryRef.current = null
    return () => {
      const controller = abortRef.current
      abortRef.current = null
      controller?.abort()
    }
  }, [accountId])

  /**
   * 共用发送逻辑。payload 既是请求体也是结果卡的快照，
   * 「重新生成」同时传入原始文件快照，不受当前上传区内容影响。
   */
  const run = useCallback(
    async (
      payload: ImageGenerationRequest,
      snapshotConfig: ImagePlaygroundConfig,
      snapshotParameters: ImageParameterEnabled,
      editSnapshot: ImageEditSnapshot | undefined,
      count = 1
    ) => {
      // Ref 立即生效，防止同一次渲染内连续点击发送多个付费请求。
      if (abortRef.current) return
      // A legacy/manual snapshot may still contain the batch count in n.
      payload = normalizeImageRequestSnapshot(payload)
      if (payload.n !== undefined) payload.n = 1
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
      const isEdit = snapshotConfig.mode === 'edit'
      if (isEdit && !editSnapshot?.images.length) {
        setError(t('Please upload at least one source image'))
        return
      }

      const controller = new AbortController()
      const requestStartedAt = Date.now()
      const id = crypto.randomUUID()
      const imageCount = clampImageN(count)
      const initialTasks: ImageGenerationTask[] = Array.from(
        { length: imageCount },
        (_, index) => ({
          id: `${id}-${index}`,
          index,
          status: 'pending',
          images: [],
        })
      )
      let entry: ImageHistoryEntry = {
        id,
        createdAt: requestStartedAt,
        status: 'pending',
        config: { ...snapshotConfig, n: imageCount },
        parameterEnabled: { ...snapshotParameters },
        requestSnapshot: { ...payload },
        editSnapshot,
        images: [],
        tasks: initialTasks,
        imageCount,
        successCount: 0,
        failCount: 0,
        durationMs: 0,
      }
      abortRef.current = controller
      activeEntryRef.current = entry
      setStartedAt(requestStartedAt)
      setActiveHistoryId(id)
      setImages([])
      setTasks(initialTasks)
      setError(null)
      upsertHistory(entry)

      try {
        const inputMask = editSnapshot?.mask
          ? { file: editSnapshot.mask }
          : null
        // The selected count is a bounded batch; each upstream request asks
        // for one image, matching the reference workbench's provider contract.
        await Promise.allSettled(
          initialTasks.map(async (task) => {
            let completed: ImageGenerationTask
            try {
              const response =
                isEdit && editSnapshot
                  ? await editImages(
                      buildEditFormData(
                        payload,
                        editSnapshot.images.map((file) => ({ file })),
                        inputMask
                      ),
                      apiKey.trim(),
                      controller.signal
                    )
                  : await generateImages(
                      payload,
                      apiKey.trim(),
                      controller.signal
                    )
              const generated = extractGeneratedImages(
                response,
                payload,
                snapshotConfig.mode
              )
              if (generated.length === 0) {
                throw new Error(t('The response contained no images'))
              }
              const durationMs = Math.max(0, Date.now() - requestStartedAt)
              completed = {
                ...task,
                status: 'success',
                durationMs,
                images: generated.map((image) => ({
                  ...image,
                  durationMs,
                  editSnapshot,
                })),
              }
            } catch (err) {
              const message =
                err instanceof Error ? err.message : t('Request failed')
              completed = {
                ...task,
                status: 'failed',
                durationMs: Math.max(0, Date.now() - requestStartedAt),
                error: message.replaceAll(apiKey.trim(), '[redacted]'),
              }
            }
            if (controller.signal.aborted || abortRef.current !== controller) {
              return
            }
            const nextTasks = entry.tasks.map((item) =>
              item.id === task.id ? completed : item
            )
            const successCount = nextTasks.filter(
              (item) => item.status === 'success'
            ).length
            const failCount = nextTasks.filter(
              (item) => item.status === 'failed'
            ).length
            let status: ImageHistoryEntry['status'] = 'pending'
            if (successCount + failCount === imageCount) {
              status = successCount > 0 ? 'success' : 'failed'
            }
            entry = {
              ...entry,
              tasks: nextTasks,
              images: nextTasks.flatMap((item) => item.images),
              successCount,
              failCount,
              status,
              durationMs: Math.max(0, Date.now() - requestStartedAt),
              error: nextTasks.find((item) => item.error)?.error,
            }
            activeEntryRef.current = entry
            setImages(entry.images)
            setTasks(entry.tasks)
            setError(entry.error ?? null)
            upsertHistory(entry)
          })
        )
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setStartedAt(null)
        }
      }
    },
    [apiKey, t, upsertHistory]
  )

  const generate = useCallback(async () => {
    await run(
      buildRequestPayload(config, parameterEnabled),
      config,
      parameterEnabled,
      config.mode === 'edit'
        ? {
            images: uploadedImages.map((image) => image.file),
            mask: mask?.file ?? null,
          }
        : undefined,
      parameterEnabled.n ? config.n : 1
    )
  }, [config, mask, parameterEnabled, run, uploadedImages])

  /** 用结果卡上的原始快照复跑，参数完全一致 */
  const regenerate = useCallback(
    async (image: GeneratedImage) => {
      const payload = image.requestSnapshot ?? {
        model: image.model,
        prompt: image.prompt,
      }
      const original = history.find((entry) =>
        entry.images.some((item) => item.id === image.id)
      )
      await run(
        payload,
        {
          ...(original?.config ?? config),
          mode: image.mode,
          prompt: image.prompt,
          model: image.model,
        },
        original?.parameterEnabled ?? parameterEnabled,
        image.editSnapshot
      )
    },
    [config, history, parameterEnabled, run]
  )

  const retryTask = useCallback(
    async (_task: ImageGenerationTask) => {
      const entry = activeEntryRef.current
      if (!entry || !entry.tasks.some((task) => task.id === _task.id)) return
      await run(
        entry.requestSnapshot,
        entry.config,
        entry.parameterEnabled,
        entry.editSnapshot
      )
    },
    [run]
  )

  const stop = useCallback(() => {
    const controller = abortRef.current
    abortRef.current = null
    controller?.abort()
    const active = activeEntryRef.current
    if (controller && active) {
      const entry: ImageHistoryEntry = {
        ...active,
        status: 'interrupted',
        durationMs: Math.max(0, Date.now() - active.createdAt),
        tasks: active.tasks.map((task) =>
          task.status === 'pending' ? { ...task, status: 'interrupted' } : task
        ),
      }
      activeEntryRef.current = entry
      setTasks(entry.tasks)
      upsertHistory(entry)
    }
    setStartedAt(null)
  }, [upsertHistory])

  const newSession = useCallback(() => {
    if (abortRef.current) return
    activeEntryRef.current = null
    setActiveHistoryId(null)
    setImages([])
    setTasks([])
    setError(null)
  }, [])

  const selectHistory = useCallback(
    (entry: ImageHistoryEntry) => {
      if (abortRef.current || !history.some((item) => item.id === entry.id)) {
        return
      }
      activeEntryRef.current = entry
      setActiveHistoryId(entry.id)
      setImages(entry.images)
      setTasks(entry.tasks)
      setError(entry.error ?? null)
    },
    [history]
  )

  const deleteHistory = useCallback(
    async (ids: string[]): Promise<boolean> => {
      if (abortRef.current) return false
      const removed = await deleteStoredHistory(ids)
      if (
        removed &&
        activeEntryRef.current &&
        ids.includes(activeEntryRef.current.id)
      ) {
        newSession()
      }
      return removed
    },
    [deleteStoredHistory, newSession]
  )

  const removeImage = useCallback(
    (id: string) => {
      if (abortRef.current) return
      const active = activeEntryRef.current
      if (!active) return
      const entry = {
        ...active,
        images: active.images.filter((image) => image.id !== id),
        tasks: active.tasks.map((task) => ({
          ...task,
          images: task.images.filter((image) => image.id !== id),
        })),
      }
      activeEntryRef.current = entry
      setImages(entry.images)
      setTasks(entry.tasks)
      upsertHistory(entry)
    },
    [upsertHistory]
  )

  return {
    images,
    tasks,
    history,
    historyLoading,
    historyError,
    activeHistoryId,
    isGenerating: startedAt !== null,
    startedAt,
    error,
    generate,
    regenerate,
    retryTask,
    setError,
    stop,
    clearImages: newSession,
    newSession,
    selectHistory,
    deleteHistory,
    removeImage,
  }
}
