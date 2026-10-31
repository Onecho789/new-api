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
  COMPRESSION_ONLY_FORMATS,
  MAX_COMPRESSION,
  MAX_IMAGE_N,
  MIN_COMPRESSION,
  MIN_IMAGE_N,
} from '../constants'
import type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageMode,
  ImageParameterEnabled,
  ImagePlaygroundConfig,
  UploadedImage,
} from '../types'

/** 仅把启用的参数放进请求体，未启用的一律不传 */
export function buildRequestPayload(
  config: ImagePlaygroundConfig,
  enabled: ImageParameterEnabled
): ImageGenerationRequest {
  const payload: ImageGenerationRequest = {
    model: config.model.trim(),
    prompt: config.prompt.trim(),
  }

  if (enabled.size && config.size) payload.size = config.size
  if (enabled.quality && config.quality) payload.quality = config.quality
  if (enabled.style && config.style) payload.style = config.style
  if (enabled.responseFormat && config.responseFormat) {
    payload.response_format = config.responseFormat
  }
  if (enabled.outputFormat && config.outputFormat) {
    payload.output_format = config.outputFormat
  }
  if (enabled.background && config.background) {
    payload.background = config.background
  }
  // 压缩率仅对 jpeg/webp 有效，png 传 <100 会被上游拒绝
  if (
    enabled.outputCompression &&
    enabled.outputFormat &&
    supportsCompression(config.outputFormat)
  ) {
    payload.output_compression = clampCompression(config.outputCompression)
  }
  if (enabled.n) payload.n = clampImageN(config.n)

  return payload
}

export function supportsCompression(outputFormat: string): boolean {
  return COMPRESSION_ONLY_FORMATS.has(outputFormat)
}

export function clampCompression(value: number): number {
  if (!Number.isFinite(value)) return MAX_COMPRESSION
  const rounded = Math.round(value)
  if (rounded < MIN_COMPRESSION) return MIN_COMPRESSION
  if (rounded > MAX_COMPRESSION) return MAX_COMPRESSION
  return rounded
}

/**
 * 图生图请求体。单图用 image 字段，多图用 image[]，
 * 与后端 GetAndValidOpenAIImageRequest 的解析方式一致。
 * payload 已经只含启用的参数，这里只做序列化。
 */
export function buildEditFormData(
  payload: ImageGenerationRequest,
  images: UploadedImage[],
  mask: UploadedImage | null
): FormData {
  const form = new FormData()

  const field = images.length > 1 ? 'image[]' : 'image'
  for (const image of images) {
    form.append(field, image.file, image.file.name)
  }

  if (mask) {
    form.append('mask', mask.file, mask.file.name)
  }

  form.append('model', payload.model)
  form.append('prompt', payload.prompt)
  if (payload.size) form.append('size', payload.size)
  if (payload.quality) form.append('quality', payload.quality)
  if (payload.style) form.append('style', payload.style)
  if (payload.response_format) {
    form.append('response_format', payload.response_format)
  }
  if (payload.output_format) {
    form.append('output_format', payload.output_format)
  }
  if (payload.background) form.append('background', payload.background)
  if (payload.output_compression !== undefined) {
    form.append('output_compression', String(payload.output_compression))
  }
  if (payload.n !== undefined) form.append('n', String(payload.n))

  return form
}

export function clampImageN(value: number): number {
  if (!Number.isFinite(value)) return MIN_IMAGE_N
  const rounded = Math.round(value)
  if (rounded < MIN_IMAGE_N) return MIN_IMAGE_N
  if (rounded > MAX_IMAGE_N) return MAX_IMAGE_N
  return rounded
}

/**
 * b64_json 与 url 两种返回形态统一成可直接渲染的 src。
 * MIME 跟随上游返回的 output_format，否则 webp/jpeg 会被标成 png。
 */
export function resolveImageSrc(
  item: { b64_json?: string; url?: string },
  outputFormat?: string
): string | null {
  if (item.url) return item.url
  if (item.b64_json) {
    const mime =
      outputFormat === 'webp' || outputFormat === 'jpeg'
        ? `image/${outputFormat}`
        : 'image/png'
    return `data:${mime};base64,${item.b64_json}`
  }
  return null
}

export function extractGeneratedImages(
  response: ImageGenerationResponse,
  request: ImageGenerationRequest,
  mode: ImageMode = 'generate'
): GeneratedImage[] {
  const items = response.data ?? []
  const createdAt = (response.created ?? Math.floor(Date.now() / 1000)) * 1000

  return items.reduce<GeneratedImage[]>((acc, item, index) => {
    const src = resolveImageSrc(item, response.output_format)
    if (!src) return acc

    acc.push({
      id: `${createdAt}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      src,
      revisedPrompt: item.revised_prompt,
      prompt: request.prompt,
      model: request.model,
      createdAt,
      mode,
      requestedSize: request.size,
      actualSize: response.size,
      actualQuality: response.quality,
      actualModel: response.model,
      actualOutputFormat: response.output_format,
      actualBackground: response.background,
      usage: response.usage,
      requestSnapshot: request,
    })
    return acc
  }, [])
}

/**
 * 蒙版必须与原图同尺寸，否则上游会拒绝或产生错位。
 * 尺寸未知（解码失败）时不报错，只在两边都已知且不同时提示。
 */
export function getMaskSizeMismatch(
  images: UploadedImage[],
  mask: UploadedImage | null
): { imageSize: string; maskSize: string } | null {
  const first = images[0]
  if (!mask?.width || !mask.height || !first?.width || !first.height) {
    return null
  }
  if (mask.width === first.width && mask.height === first.height) return null

  return {
    imageSize: `${first.width}x${first.height}`,
    maskSize: `${mask.width}x${mask.height}`,
  }
}

/**
 * 上游可能忽略请求参数并回传实际生效值（例如 gpt-image-2 会把 size
 * 改成自选尺寸），据此提示用户以免误判计费。
 */
export function getParameterMismatches(
  image: GeneratedImage
): { label: string; requested: string; actual: string }[] {
  const mismatches: { label: string; requested: string; actual: string }[] = []

  if (
    image.requestedSize &&
    image.actualSize &&
    image.requestedSize !== image.actualSize
  ) {
    mismatches.push({
      label: 'size',
      requested: image.requestedSize,
      actual: image.actualSize,
    })
  }

  if (image.actualModel && image.actualModel !== image.model) {
    mismatches.push({
      label: 'model',
      requested: image.model,
      actual: image.actualModel,
    })
  }

  return mismatches
}

export function buildDownloadFileName(image: GeneratedImage): string {
  const stamp = new Date(image.createdAt)
    .toISOString()
    .replaceAll(/[:.]/g, '-')
    .slice(0, 19)
  // 扩展名跟随上游实际返回的格式，避免 webp 存成 .png
  const ext =
    image.actualOutputFormat === 'jpeg'
      ? 'jpg'
      : (image.actualOutputFormat ?? 'png')
  return `${image.model}-${stamp}.${ext}`
}

/** 从 new-api 或上游的错误响应里取出可读信息 */
export function extractErrorMessage(
  payload: unknown,
  fallback: string
): string {
  if (!payload || typeof payload !== 'object') return fallback

  const error = (payload as { error?: unknown }).error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }

  const message = (payload as { message?: unknown }).message
  if (typeof message === 'string' && message.trim()) return message

  return fallback
}
