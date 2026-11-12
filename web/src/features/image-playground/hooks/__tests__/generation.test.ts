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
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import type { ImageHistoryEntry } from '../../history-types'
import {
  deleteImageHistoryEntries,
  readImageHistory,
  saveImageHistoryEntry,
} from '../../lib/history-storage'
import type { UploadedImage } from '../../types'
import { useImageGeneration } from '../use-image-generation'

vi.mock('../../lib/history-storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/history-storage')>()),
  readImageHistory: vi.fn(),
  saveImageHistoryEntry: vi.fn(),
  deleteImageHistoryEntries: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(readImageHistory).mockReset().mockResolvedValue([])
  vi.mocked(saveImageHistoryEntry).mockReset().mockResolvedValue(false)
  vi.mocked(deleteImageHistoryEntries).mockReset().mockResolvedValue(undefined)
})

const options = {
  apiKey: 'test-key',
  config: { ...DEFAULT_CONFIG, prompt: 'A paper lantern' },
  parameterEnabled: { ...DEFAULT_PARAMETER_ENABLED },
  uploadedImages: [] as UploadedImage[],
  mask: null as UploadedImage | null,
}

afterEach(() => vi.unstubAllGlobals())

describe('image generation lifecycle', () => {
  it('sends one request when generation is triggered twice before rendering', async () => {
    let resolve!: (value: Response) => void
    const response = new Promise<Response>((done) => {
      resolve = done
    })
    const fetchMock = vi.fn().mockReturnValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useImageGeneration(options))
    let first!: Promise<void>
    let duplicate!: Promise<void>

    act(() => {
      first = result.current.generate()
      duplicate = result.current.generate()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve(new Response(JSON.stringify({ data: [{ b64_json: 'first' }] })))
      await Promise.all([first, duplicate])
    })
    expect(result.current.images).toHaveLength(1)
    expect(result.current.isGenerating).toBe(false)
  })

  it('regenerates an edit with the original files, mask and parameters after uploads are cleared', async () => {
    const source = new File(['source'], 'source.png', { type: 'image/png' })
    const mask = new File(['mask'], 'mask.png', { type: 'image/png' })
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: 'edited' }] }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const originalOptions = {
      ...options,
      config: { ...options.config, mode: 'edit' as const },
      uploadedImages: [
        { id: 'source', file: source, objectUrl: 'blob:source' },
      ],
      mask: { id: 'mask', file: mask, objectUrl: 'blob:mask' },
    }
    const { result, rerender } = renderHook(useImageGeneration, {
      initialProps: originalOptions as Parameters<typeof useImageGeneration>[0],
    })
    await act(() => result.current.generate())
    const image = result.current.images[0]
    rerender({
      ...options,
      config: { ...options.config, model: 'changed-model', prompt: 'Changed' },
    })

    await act(() => result.current.regenerate(image))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('/v1/images/edits')
    const form = fetchMock.mock.calls[1][1].body as FormData
    expect(form.get('model')).toBe(originalOptions.config.model)
    expect(form.get('prompt')).toBe(originalOptions.config.prompt)
    expect(form.get('n')).toBe('1')
    expect(form.get('image')).toEqual(source)
    expect(form.get('mask')).toEqual(mask)
    expect((form.get('image') as File).name).toBe('source.png')
    expect((form.get('mask') as File).name).toBe('mask.png')
  })

  it('discards a stopped response without ending a newer request', async () => {
    let resolveFirst!: (value: Response) => void
    let resolveSecond!: (value: Response) => void
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveSecond = resolve
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useImageGeneration(options))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.generate()
    })
    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal
    act(() => {
      result.current.stop()
    })
    expect(firstSignal.aborted).toBe(true)
    act(() => {
      second = result.current.generate()
    })

    await act(async () => {
      resolveFirst(
        new Response(JSON.stringify({ data: [{ b64_json: 'stale' }] }))
      )
      await first
    })

    expect(result.current.images).toEqual([])
    expect(result.current.isGenerating).toBe(true)
    expect(result.current.error).toBeNull()
    await act(async () => {
      resolveSecond(
        new Response(JSON.stringify({ data: [{ b64_json: 'current' }] }))
      )
      await second
    })
    expect(result.current.images.map((image) => image.src)).toEqual([
      'data:image/png;base64,current',
    ])
    expect(result.current.isGenerating).toBe(false)
  })

  it('aborts on unmount and starts with no results when the page mounts again', async () => {
    let resolve!: (value: Response) => void
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const first = renderHook(() => useImageGeneration(options))
    let request!: Promise<void>
    act(() => {
      request = first.result.current.generate()
    })
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    first.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => {
      resolve(new Response(JSON.stringify({ data: [{ b64_json: 'late' }] })))
      await request
    })

    const second = renderHook(() => useImageGeneration(options))
    expect(second.result.current.images).toEqual([])
    expect(second.result.current.isGenerating).toBe(false)
  })

  it('reports an upstream error and allows the next generation attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'Model unavailable' } }),
          { status: 503 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ b64_json: 'recovered' }] }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useImageGeneration(options))
    await act(() => result.current.generate())
    expect(result.current.error).toBe('Model unavailable')
    expect(result.current.isGenerating).toBe(false)

    await act(() => result.current.generate())
    expect(result.current.error).toBeNull()
    expect(result.current.images).toHaveLength(1)
  })

  it('keeps results only in memory when no account is available', async () => {
    const localWrite = vi.spyOn(localStorage, 'setItem')
    const sessionWrite = vi.spyOn(sessionStorage, 'setItem')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ b64_json: 'temporary' }] }))
        )
    )
    const first = renderHook(() => useImageGeneration(options))
    await act(() => first.result.current.generate())
    expect(first.result.current.images).toHaveLength(1)
    first.unmount()

    const second = renderHook(() => useImageGeneration(options))
    expect(second.result.current.images).toEqual([])
    expect(localWrite).not.toHaveBeenCalled()
    expect(sessionWrite).not.toHaveBeenCalled()
  })

  it('exposes the start time while pending and the elapsed duration on completed images', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    let resolve!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>((done) => {
          resolve = done
        })
      )
    )
    const { result } = renderHook(() => useImageGeneration(options))
    let request!: Promise<void>
    act(() => {
      request = result.current.generate()
    })
    expect(result.current.startedAt).toBe(10_000)

    await act(async () => {
      now.mockReturnValue(13_450)
      resolve(new Response(JSON.stringify({ data: [{ b64_json: 'timed' }] })))
      await request
    })

    expect(result.current.startedAt).toBeNull()
    expect(result.current.images[0].durationMs).toBe(3450)
  })

  it('runs a selected batch as single-image requests and preserves partial successes', async () => {
    let resolveFirst!: (value: Response) => void
    let resolveSecond!: (value: Response) => void
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveSecond = resolve
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() =>
      useImageGeneration({
        ...options,
        config: { ...options.config, n: 2 },
      })
    )
    let request!: Promise<void>
    act(() => {
      request = result.current.generate()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).n)
    ).toEqual([1, 1])

    await act(async () => {
      resolveFirst(
        new Response(JSON.stringify({ data: [{ b64_json: 'first' }] }))
      )
    })
    await waitFor(() => expect(result.current.images).toHaveLength(1))
    expect(result.current.isGenerating).toBe(true)
    expect(result.current.tasks.map((task) => task.status)).toEqual([
      'success',
      'pending',
    ])
    await act(async () => {
      resolveSecond(
        new Response(
          JSON.stringify({ error: { message: 'Provider unavailable' } }),
          { status: 503 }
        )
      )
      await request
    })
    expect(result.current.isGenerating).toBe(false)
    expect(result.current.images).toHaveLength(1)
    expect(result.current.history[0]).toMatchObject({
      successCount: 1,
      failCount: 1,
      status: 'success',
    })
    expect(result.current.tasks[1]).toMatchObject({
      status: 'failed',
      error: 'Provider unavailable',
    })
  })

  it('bounds an oversized selected batch to ten single-image requests', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: 'bounded' }] }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() =>
      useImageGeneration({ ...options, config: { ...options.config, n: 100 } })
    )
    await act(() => result.current.generate())
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(
      fetchMock.mock.calls.every(
        ([, request]) => JSON.parse(request.body).n === 1
      )
    ).toBe(true)
    expect(result.current.history[0].imageCount).toBe(10)
  })

  it('preserves an omitted n parameter when retrying a single-image provider', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: 'one' }] }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() =>
      useImageGeneration({
        ...options,
        parameterEnabled: { ...options.parameterEnabled, n: false },
      })
    )
    await act(() => result.current.generate())
    await act(() => result.current.regenerate(result.current.images[0]))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(
      fetchMock.mock.calls.every(
        ([, request]) => !Object.hasOwn(JSON.parse(request.body), 'n')
      )
    ).toBe(true)
  })

  it('normalizes legacy GIF JSON retries without changing the model alias', async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            output_format: 'gif',
            data: [{ b64_json: 'R0lGODlh' }],
          })
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() =>
      useImageGeneration({
        ...options,
        config: {
          ...options.config,
          model: 'gpt-images-2.6',
          outputFormat: 'gif',
        },
      })
    )
    await act(() => result.current.generate())
    const image = result.current.images[0]
    await act(() =>
      result.current.regenerate({
        ...image,
        requestSnapshot: {
          model: 'gpt-images-2.6',
          prompt: 'An animated lantern',
          output_format: 'gif',
          frame_count: 99,
          frame_duration_ms: 235,
          output_compression: 70,
          background: 'transparent',
        },
      })
    )
    const payload = JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body)
    expect(payload).toMatchObject({
      model: 'gpt-images-2.6',
      frame_count: 16,
      frame_duration_ms: 240,
    })
    expect(payload).not.toHaveProperty('output_compression')
    expect(payload).not.toHaveProperty('background')
    expect(payload).not.toHaveProperty('response_format')
  })

  it('restores saved results and original edit files after a remount without storing the API key', async () => {
    const source = new File(['original'], 'reference.png', {
      type: 'image/png',
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ data: [{ b64_json: 'saved' }] }))
        )
    )
    const editOptions = {
      ...options,
      accountId: 17,
      config: { ...options.config, mode: 'edit' as const },
      uploadedImages: [
        { id: 'source', file: source, objectUrl: 'blob:source' },
      ],
    }
    const first = renderHook(() => useImageGeneration(editOptions))
    await act(() => first.result.current.generate())
    await waitFor(() =>
      expect(
        vi
          .mocked(saveImageHistoryEntry)
          .mock.calls.some(([, entry]) => entry.status === 'success')
      ).toBe(true)
    )
    const savedCalls = vi.mocked(saveImageHistoryEntry).mock.calls
    const saved = savedCalls.at(-1)?.[1]
    if (!saved) throw new Error('Expected completed history to be saved')
    expect(JSON.stringify(saved)).not.toContain('test-key')
    first.unmount()
    vi.mocked(readImageHistory).mockResolvedValue([saved])
    const second = renderHook(() =>
      useImageGeneration({ ...options, accountId: 17 })
    )
    await waitFor(() =>
      expect(second.result.current.historyLoading).toBe(false)
    )

    act(() =>
      second.result.current.selectHistory(second.result.current.history[0])
    )
    expect(second.result.current.images).toHaveLength(1)
    expect(second.result.current.history[0].editSnapshot?.images[0]).toBe(
      source
    )
    await act(() =>
      second.result.current.regenerate(second.result.current.images[0])
    )
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/v1/images/edits')
    expect(
      (fetchMock.mock.calls.at(-1)?.[1]?.body as FormData | undefined)?.get(
        'image'
      )
    ).toEqual(source)
  })

  it('keeps successful generation available when saving local history fails', async () => {
    vi.mocked(saveImageHistoryEntry).mockRejectedValue(
      new DOMException('Full', 'QuotaExceededError')
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ b64_json: 'available' }] }))
        )
    )
    const { result } = renderHook(() =>
      useImageGeneration({ ...options, accountId: 1 })
    )
    await act(() => result.current.generate())
    await waitFor(() =>
      expect(result.current.historyError).toContain(
        'Local history could not be saved'
      )
    )
    expect(result.current.images).toHaveLength(1)
    expect(result.current.error).toBeNull()
    expect(result.current.history[0].status).toBe('success')
  })

  it('does not expose or save a late completion into a different account', async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise<Response>((done) => {
          resolve = done
        })
      )
    )
    const { result, rerender } = renderHook(
      (accountId: number) => useImageGeneration({ ...options, accountId }),
      { initialProps: 1 }
    )
    let request!: Promise<void>
    act(() => {
      request = result.current.generate()
    })
    rerender(2)
    await act(async () => {
      resolve(new Response(JSON.stringify({ data: [{ b64_json: 'private' }] })))
      await request
    })
    expect(result.current.images).toEqual([])
    expect(result.current.history).toEqual([])
    expect(result.current.isGenerating).toBe(false)
    expect(
      vi
        .mocked(saveImageHistoryEntry)
        .mock.calls.every(
          ([accountId, entry]) => accountId === 1 && entry.status === 'pending'
        )
    ).toBe(true)
  })

  it('starts a blank session without deleting history and deletes the active session after confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ b64_json: 'history' }] }))
        )
    )
    const { result } = renderHook(() =>
      useImageGeneration({ ...options, accountId: 1 })
    )
    await act(() => result.current.generate())
    const saved = result.current.history[0]
    act(() => result.current.newSession())
    expect(result.current.images).toEqual([])
    expect(result.current.history).toHaveLength(1)
    expect(deleteImageHistoryEntries).not.toHaveBeenCalled()
    act(() => result.current.selectHistory(saved))
    expect(result.current.images).toHaveLength(1)
    await act(() => result.current.deleteHistory([saved.id]))
    expect(deleteImageHistoryEntries).toHaveBeenCalledWith(1, [saved.id])
    expect(result.current.activeHistoryId).toBeNull()
    expect(result.current.history).toEqual([])
    expect(result.current.images).toEqual([])
  })

  it('waits for an older save before deleting so a late write cannot resurrect history', async () => {
    let finishSave!: (remote: boolean) => void
    vi.mocked(saveImageHistoryEntry).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve
        })
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ b64_json: 'history' }] }))
        )
    )
    const { result } = renderHook(() =>
      useImageGeneration({ ...options, accountId: 1 })
    )
    await act(() => result.current.generate())
    const id = result.current.history[0].id
    let deletion!: Promise<boolean>
    act(() => {
      deletion = result.current.deleteHistory([id])
    })
    expect(deleteImageHistoryEntries).not.toHaveBeenCalled()
    await act(async () => {
      finishSave(false)
      await deletion
    })
    expect(deleteImageHistoryEntries).toHaveBeenCalledWith(1, [id])
    expect(result.current.history).toEqual([])
    expect(vi.mocked(saveImageHistoryEntry).mock.calls).toHaveLength(1)
  })

  it('persists removal of a result from both the session and its task', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ b64_json: 'removed' }] }))
        )
    )
    const { result } = renderHook(() =>
      useImageGeneration({ ...options, accountId: 1 })
    )
    await act(() => result.current.generate())
    act(() => result.current.removeImage(result.current.images[0].id))
    await waitFor(() =>
      expect(
        vi.mocked(saveImageHistoryEntry).mock.calls.at(-1)?.[1].images
      ).toEqual([])
    )
    expect(result.current.images).toEqual([])
    expect(result.current.tasks[0].images).toEqual([])
    expect(result.current.history[0].images).toEqual([])
  })

  it('releases duplicate hydrated previews while preserving a newer in-memory session', async () => {
    let load!: (entries: ImageHistoryEntry[]) => void
    vi.mocked(readImageHistory).mockReturnValue(
      new Promise((resolve) => {
        load = resolve
      })
    )
    const revoke = vi.fn()
    vi.stubGlobal(
      'URL',
      class extends URL {
        static revokeObjectURL = revoke
      }
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ b64_json: 'latest' }] }))
        )
    )
    const { result } = renderHook(() =>
      useImageGeneration({ ...options, accountId: 1 })
    )
    await act(() => result.current.generate())
    const current = result.current.history[0]
    await act(async () => {
      load([
        {
          ...current,
          images: [{ ...current.images[0], src: 'blob:discarded-preview' }],
        },
      ])
    })
    expect(revoke).toHaveBeenCalledWith('blob:discarded-preview')
    expect(result.current.history[0].images[0].src).toBe(
      'data:image/png;base64,latest'
    )
  })
})
