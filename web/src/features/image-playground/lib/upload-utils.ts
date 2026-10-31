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
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_IMAGES,
  MAX_UPLOAD_SIZE_BYTES,
} from '../constants'
import type { UploadedImage } from '../types'

export type UploadRejectReason =
  | { kind: 'type'; fileName: string }
  | { kind: 'size'; fileName: string }
  | { kind: 'count'; limit: number }

export type UploadAcceptResult = {
  accepted: UploadedImage[]
  rejected: UploadRejectReason[]
}

const ALLOWED_TYPES = new Set(ACCEPTED_IMAGE_TYPES.split(','))

function isAllowedType(file: File): boolean {
  return ALLOWED_TYPES.has(file.type)
}

/**
 * 校验并转换待上传文件。超限的文件不静默丢弃，
 * 而是回传原因供界面提示。
 */
export function acceptUploadFiles(
  files: File[],
  existingCount = 0,
  maxImages = MAX_UPLOAD_IMAGES
): UploadAcceptResult {
  const accepted: UploadedImage[] = []
  const rejected: UploadRejectReason[] = []
  let remaining = maxImages - existingCount

  for (const file of files) {
    if (remaining <= 0) {
      rejected.push({ kind: 'count', limit: maxImages })
      break
    }
    if (!isAllowedType(file)) {
      rejected.push({ fileName: file.name, kind: 'type' })
      continue
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      rejected.push({ fileName: file.name, kind: 'size' })
      continue
    }

    accepted.push(createUploadedImage(file))
    remaining -= 1
  }

  return { accepted, rejected }
}

export function createUploadedImage(file: File): UploadedImage {
  return {
    file,
    id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`,
    objectUrl: URL.createObjectURL(file),
  }
}

/**
 * 读取图片实际像素尺寸。蒙版必须与原图同尺寸，
 * 上传时解码一次即可拿到，失败时返回 null 而不阻断上传。
 */
export function readImageSize(
  objectUrl: string
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.addEventListener('load', () => {
      resolve({ height: image.naturalHeight, width: image.naturalWidth })
    })
    image.addEventListener('error', () => resolve(null))
    image.src = objectUrl
  })
}

/** objectUrl 必须显式释放，否则会一直占用内存 */
export function revokeUploadedImage(image: UploadedImage | null): void {
  if (image) URL.revokeObjectURL(image.objectUrl)
}

export function revokeUploadedImages(images: UploadedImage[]): void {
  for (const image of images) URL.revokeObjectURL(image.objectUrl)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer | null
): File[] {
  if (!dataTransfer) return []
  return [...dataTransfer.files]
}
