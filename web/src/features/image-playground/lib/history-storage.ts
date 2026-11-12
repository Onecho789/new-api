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
import type { ImageHistoryEntry } from '../history-types'
import type { GeneratedImage } from '../types'

interface StoredImage extends Omit<GeneratedImage, 'src' | 'editSnapshot'> {
  blob?: Blob
  remoteUrl?: string
}

export type ImageHistoryMediaCache = WeakMap<
  GeneratedImage,
  Promise<StoredImage>
>

interface StoredHistoryEntry extends Omit<
  ImageHistoryEntry,
  'images' | 'tasks'
> {
  accountId: number
  images: StoredImage[]
  tasks: (Omit<ImageHistoryEntry['tasks'][number], 'images'> & {
    imageIds: string[]
  })[]
}

const DATABASE_NAME = 'new-api-image-workbench'
const STORE_NAME = 'entries'

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    let blocked = false
    request.addEventListener('upgradeneeded', () => {
      const store = request.result.createObjectStore(STORE_NAME, {
        keyPath: ['accountId', 'id'],
      })
      store.createIndex('accountId', 'accountId')
    })
    request.addEventListener('success', () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    })
    request.addEventListener('error', () => reject(request.error))
    request.addEventListener('blocked', () => {
      blocked = true
      reject(new Error('Image history database is blocked'))
    })
  })
}

/** Store binary image data, never data URLs or credentials, in IndexedDB. */
export async function prepareImageHistoryEntry(
  accountId: number,
  entry: ImageHistoryEntry,
  mediaCache: ImageHistoryMediaCache = new WeakMap()
): Promise<StoredHistoryEntry> {
  const images = await Promise.all(
    entry.images.map((image): Promise<StoredImage> => {
      const cached = mediaCache.get(image)
      if (cached) return cached
      const pending = (async (): Promise<StoredImage> => {
        const { src, editSnapshot: _editSnapshot, ...metadata } = image
        const inline = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(src)
        if (inline) {
          const bytes = Uint8Array.from(atob(inline[2]), (character) =>
            character.charCodeAt(0)
          )
          return { ...metadata, blob: new Blob([bytes], { type: inline[1] }) }
        }
        try {
          const response = await fetch(src, {
            credentials: 'omit',
            signal: AbortSignal.timeout(15_000),
          })
          if (!response.ok) throw new Error('Image download failed')
          const blob = await response.blob()
          if (!blob.type.startsWith('image/')) {
            throw new Error('Invalid image data')
          }
          return { ...metadata, blob }
        } catch (error) {
          // Cross-origin image links can display without permitting fetch/CORS.
          if (/^https?:\/\//i.test(src)) return { ...metadata, remoteUrl: src }
          throw error
        }
      })().catch((error) => {
        mediaCache.delete(image)
        throw error
      })
      mediaCache.set(image, pending)
      return pending
    })
  )
  return {
    ...entry,
    accountId,
    images,
    tasks: entry.tasks.map(({ images: taskImages, ...task }) => ({
      ...task,
      imageIds: taskImages.map((image) => image.id),
    })),
  }
}

export async function saveImageHistoryEntry(
  accountId: number,
  entry: ImageHistoryEntry,
  mediaCache?: ImageHistoryMediaCache
): Promise<boolean> {
  const record = await prepareImageHistoryEntry(accountId, entry, mediaCache)
  const db = await openHistoryDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('error', () => reject(transaction.error))
      transaction.addEventListener('abort', () => reject(transaction.error))
      transaction.objectStore(STORE_NAME).put(record)
    })
  } finally {
    db.close()
  }
  return record.images.some((image) => image.remoteUrl)
}

export async function readImageHistory(
  accountId: number,
  mediaCache?: ImageHistoryMediaCache
): Promise<ImageHistoryEntry[]> {
  const db = await openHistoryDatabase()
  let records: StoredHistoryEntry[]
  try {
    records = await new Promise<StoredHistoryEntry[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const request = transaction
        .objectStore(STORE_NAME)
        .index('accountId')
        .getAll(accountId)
      transaction.addEventListener('complete', () =>
        resolve(request.result as StoredHistoryEntry[])
      )
      transaction.addEventListener('error', () => reject(transaction.error))
      transaction.addEventListener('abort', () => reject(transaction.error))
    })
  } finally {
    db.close()
  }
  return records
    .map((record) => {
      const images = record.images.map(
        ({ blob, remoteUrl, ...metadata }): GeneratedImage => {
          const image: GeneratedImage = {
            ...metadata,
            src: blob ? URL.createObjectURL(blob) : (remoteUrl ?? ''),
            editSnapshot: record.editSnapshot,
          }
          // Keep the original Blob available to queued writes even after
          // navigation releases its preview URL.
          mediaCache?.set(
            image,
            Promise.resolve({ ...metadata, blob, remoteUrl })
          )
          return image
        }
      )
      const { accountId: _accountId, tasks, ...entry } = record
      return {
        ...entry,
        status:
          entry.status === 'pending' ? ('interrupted' as const) : entry.status,
        images,
        tasks: tasks.map(({ imageIds, ...task }) => ({
          ...task,
          status:
            task.status === 'pending' ? ('interrupted' as const) : task.status,
          images: images.filter((image) => imageIds.includes(image.id)),
        })),
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteImageHistoryEntries(
  accountId: number,
  ids: string[]
): Promise<void> {
  const db = await openHistoryDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('error', () => reject(transaction.error))
      transaction.addEventListener('abort', () => reject(transaction.error))
      for (const id of ids) store.delete([accountId, id])
    })
  } finally {
    db.close()
  }
}

export function releaseImageHistory(entries: ImageHistoryEntry[]): void {
  for (const entry of entries) {
    for (const image of entry.images) {
      if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src)
    }
  }
}
