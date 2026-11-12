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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import type { ImageHistoryEntry } from '../../history-types'
import { prepareImageHistoryEntry } from '../history-storage'

function imageSession(src: string): ImageHistoryEntry {
  const image = {
    id: 'image-1',
    src,
    model: 'gpt-image-2',
    prompt: 'A tree',
    mode: 'generate' as const,
    createdAt: 1000,
  }
  return {
    id: 'session-1',
    createdAt: 1000,
    status: 'success',
    config: { ...DEFAULT_CONFIG, prompt: 'A tree' },
    parameterEnabled: { ...DEFAULT_PARAMETER_ENABLED },
    requestSnapshot: { model: 'gpt-image-2', prompt: 'A tree', n: 1 },
    images: [image],
    tasks: [{ id: 'task-1', index: 0, status: 'success', images: [image] }],
    imageCount: 1,
    successCount: 1,
    failCount: 0,
    durationMs: 1500,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('image history serialization', () => {
  it('stores inline images as binary Blobs and retains reference Files without a network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['reference'], 'source.png', { type: 'image/png' })
    const entry = imageSession('data:image/webp;base64,YWJj')
    entry.editSnapshot = { images: [file], mask: null }
    entry.images[0].editSnapshot = entry.editSnapshot

    const stored = await prepareImageHistoryEntry(8, entry)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(stored.accountId).toBe(8)
    expect(stored.images[0].blob).toBeInstanceOf(Blob)
    expect(stored.images[0].blob).toMatchObject({ type: 'image/webp', size: 3 })
    const blob = stored.images[0].blob
    if (!blob) throw new Error('Expected the image to be stored as a Blob')
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener('load', () => resolve(String(reader.result)))
      reader.addEventListener('error', () => reject(reader.error))
      reader.readAsDataURL(blob)
    })
    expect(content).toBe('data:image/webp;base64,YWJj')
    expect(stored.images[0]).not.toHaveProperty('src')
    expect(stored.images[0]).not.toHaveProperty('editSnapshot')
    expect(stored.tasks[0]).toMatchObject({ imageIds: ['image-1'] })
    expect(stored.tasks[0]).not.toHaveProperty('images')
    expect(stored.editSnapshot?.images[0]).toBe(file)
  })

  it('fetches each completed image once across repeated batch snapshots', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new Blob(['abc'], { type: 'image/png' })))
    vi.stubGlobal('fetch', fetchMock)
    const entry = imageSession('https://images.example.test/result.png')
    const mediaCache = new WeakMap()
    const first = await prepareImageHistoryEntry(8, entry, mediaCache)
    const second = await prepareImageHistoryEntry(
      8,
      { ...entry, durationMs: 2000 },
      mediaCache
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      entry.images[0].src,
      expect.objectContaining({ credentials: 'omit' })
    )
    expect(second.images[0].blob).toBe(first.images[0].blob)
  })

  it('retains a remote link when browser CORS prevents downloading image bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    )
    const src = 'https://images.example.test/result.png'
    const stored = await prepareImageHistoryEntry(8, imageSession(src))
    expect(stored.images[0].remoteUrl).toBe(src)
    expect(stored.images[0].blob).toBeUndefined()
    expect(stored.status).toBe('success')
  })
})
