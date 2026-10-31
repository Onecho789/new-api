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

import { MAX_UPLOAD_IMAGES, MAX_UPLOAD_SIZE_BYTES } from '../constants'
import {
  acceptUploadFiles,
  createUploadedImage,
  formatFileSize,
  readImageSize,
  revokeUploadedImage,
  revokeUploadedImages,
  type UploadRejectReason,
} from '../lib'
import type { UploadedImage } from '../types'

export function useImageUploads() {
  const { t } = useTranslation()
  const [images, setImages] = useState<UploadedImage[]>([])
  const [mask, setMask] = useState<UploadedImage | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // 卸载时释放所有 objectUrl，用 ref 读取最新值避免闭包捕获旧数组
  const imagesRef = useRef<UploadedImage[]>(images)
  const maskRef = useRef<UploadedImage | null>(mask)
  imagesRef.current = images
  maskRef.current = mask

  useEffect(() => {
    return () => {
      revokeUploadedImages(imagesRef.current)
      revokeUploadedImage(maskRef.current)
    }
  }, [])

  const describeRejection = useCallback(
    (reason: UploadRejectReason): string => {
      switch (reason.kind) {
        case 'type':
          return t('{{name}} is not a supported image type', {
            name: reason.fileName,
          })
        case 'size':
          return t('{{name}} exceeds the {{limit}} size limit', {
            limit: formatFileSize(MAX_UPLOAD_SIZE_BYTES),
            name: reason.fileName,
          })
        default:
          return t('At most {{limit}} images can be uploaded', {
            limit: reason.limit,
          })
      }
    },
    [t]
  )

  /** 解码完成后补写像素尺寸，用于蒙版尺寸校验 */
  const resolveSizes = useCallback((targets: UploadedImage[]) => {
    for (const target of targets) {
      void readImageSize(target.objectUrl).then((size) => {
        if (!size) return
        setImages((prev) =>
          prev.map((image) =>
            image.id === target.id ? { ...image, ...size } : image
          )
        )
      })
    }
  }, [])

  const addImages = useCallback(
    (files: File[]) => {
      if (files.length === 0) return

      setUploadError(null)
      setImages((prev) => {
        const { accepted, rejected } = acceptUploadFiles(
          files,
          prev.length,
          MAX_UPLOAD_IMAGES
        )
        if (rejected.length > 0) {
          setUploadError(describeRejection(rejected[0]))
        }
        if (accepted.length === 0) return prev
        resolveSizes(accepted)
        return [...prev, ...accepted]
      })
    },
    [describeRejection, resolveSizes]
  )

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((image) => image.id === id)
      revokeUploadedImage(target ?? null)
      return prev.filter((image) => image.id !== id)
    })
  }, [])

  const clearImages = useCallback(() => {
    setImages((prev) => {
      revokeUploadedImages(prev)
      return []
    })
    setUploadError(null)
  }, [])

  const setMaskFile = useCallback(
    (files: File[]) => {
      const file = files[0]
      if (!file) return

      setUploadError(null)
      const { accepted, rejected } = acceptUploadFiles([file], 0, 1)
      if (rejected.length > 0) {
        setUploadError(describeRejection(rejected[0]))
        return
      }

      const next = accepted[0] ?? createUploadedImage(file)
      setMask((prev) => {
        revokeUploadedImage(prev)
        return next
      })

      void readImageSize(next.objectUrl).then((size) => {
        if (!size) return
        setMask((prev) => (prev?.id === next.id ? { ...prev, ...size } : prev))
      })
    },
    [describeRejection]
  )

  const clearMask = useCallback(() => {
    setMask((prev) => {
      revokeUploadedImage(prev)
      return null
    })
  }, [])

  /** 用单张图替换整个上传列表，供「以此图继续编辑」使用 */
  const replaceImages = useCallback(
    (files: File[]) => {
      setUploadError(null)
      const { accepted, rejected } = acceptUploadFiles(files, 0)
      if (rejected.length > 0) {
        setUploadError(describeRejection(rejected[0]))
      }
      if (accepted.length === 0) return

      setImages((prev) => {
        revokeUploadedImages(prev)
        return accepted
      })
      resolveSizes(accepted)
    },
    [describeRejection, resolveSizes]
  )

  return {
    images,
    mask,
    uploadError,
    addImages,
    replaceImages,
    removeImage,
    clearImages,
    setMaskFile,
    clearMask,
  }
}
