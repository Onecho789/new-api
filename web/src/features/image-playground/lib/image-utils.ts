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
import { t } from 'i18next'

import {
  DEFAULT_GIF_FRAME_COUNT,
  DEFAULT_GIF_FRAME_DURATION_MS,
  GIF_FRAME_DURATION_STEP,
  IMAGE_ASPECT_OPTIONS,
  IMAGE_DIMENSION_STEP,
  IMAGE_SIZE_PRESETS,
  MAX_GIF_FRAME_COUNT,
  MAX_GIF_FRAME_DURATION_MS,
  MAX_IMAGE_N,
  MAX_IMAGE_DIMENSION,
  MIN_GIF_FRAME_COUNT,
  MIN_GIF_FRAME_DURATION_MS,
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

  if (enabled.size && config.size && config.size !== 'auto') {
    if (IMAGE_ASPECT_OPTIONS.some((option) => option.value === config.size)) {
      let resolution = '1k'
      if (config.quality === 'high') resolution = '4k'
      if (config.quality === 'medium' || config.quality === 'hd') {
        resolution = '2k'
      }
      payload.size = imageSizeForPreset(resolution, config.size)
    } else {
      payload.size = config.size
    }
  }
  if (enabled.quality && config.quality && config.quality !== 'auto') {
    payload.quality = config.quality
  }
  // Match the reference workbench without restoring removed user controls.
  // GPT Image (including gateway aliases with that prefix) returns base64.
  if (!/gpt-image/.test(payload.model)) payload.response_format = 'b64_json'
  if (enabled.outputFormat && config.outputFormat) {
    payload.output_format = config.outputFormat
  }
  if (
    enabled.background &&
    config.background === 'transparent' &&
    (payload.output_format === 'png' || payload.output_format === 'webp')
  ) {
    payload.background = 'transparent'
  }
  if (payload.output_format === 'gif') {
    payload.frame_count = clampGifFrameCount(config.frameCount)
    payload.frame_duration_ms = clampGifFrameDuration(config.frameDurationMs)
  }
  // config.n is the workbench batch count; the hook issues separate requests.
  if (enabled.n) payload.n = 1

  return normalizeImageRequestSnapshot(payload)
}

export function clampGifFrameCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GIF_FRAME_COUNT
  return Math.min(
    MAX_GIF_FRAME_COUNT,
    Math.max(MIN_GIF_FRAME_COUNT, Math.floor(value))
  )
}

export function clampGifFrameDuration(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GIF_FRAME_DURATION_MS
  const rounded =
    Math.round(value / GIF_FRAME_DURATION_STEP) * GIF_FRAME_DURATION_STEP
  return Math.min(
    MAX_GIF_FRAME_DURATION_MS,
    Math.max(MIN_GIF_FRAME_DURATION_MS, rounded)
  )
}

/** Keep original request options on retries except combinations GIF cannot accept. */
export function normalizeImageRequestSnapshot(
  request: ImageGenerationRequest
): ImageGenerationRequest {
  const normalized = { ...request }
  if (request.output_format === 'gif') {
    normalized.frame_count = clampGifFrameCount(
      request.frame_count ?? DEFAULT_GIF_FRAME_COUNT
    )
    normalized.frame_duration_ms = clampGifFrameDuration(
      request.frame_duration_ms ?? DEFAULT_GIF_FRAME_DURATION_MS
    )
    delete normalized.output_compression
    if (normalized.background === 'transparent') delete normalized.background
    const dimensions = /^(\d+)x(\d+)$/i.exec(request.size ?? '')
    if (dimensions) {
      const width = Number(dimensions[1])
      const height = Number(dimensions[2])
      if (
        Number.isSafeInteger(width) &&
        Number.isSafeInteger(height) &&
        width > 0 &&
        height > 0
      ) {
        normalized.size = `${Math.ceil(width / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP}x${Math.ceil(height / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP}`
      }
    }
  } else {
    delete normalized.frame_count
    delete normalized.frame_duration_ms
  }
  return normalized
}

/**
 * 图生图请求体。单图用 image 字段，多图用 image[]，
 * 与后端 GetAndValidOpenAIImageRequest 的解析方式一致。
 * payload 已经只含启用的参数，这里只做序列化。
 */
export function buildEditFormData(
  payload: ImageGenerationRequest,
  images: Pick<UploadedImage, 'file'>[],
  mask: Pick<UploadedImage, 'file'> | null
): FormData {
  payload = normalizeImageRequestSnapshot(payload)
  if (payload.output_format === 'gif' && mask) {
    throw new Error(t('GIF output does not support masks'))
  }
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
  if (payload.frame_count !== undefined) {
    form.append('frame_count', String(payload.frame_count))
  }
  if (payload.frame_duration_ms !== undefined) {
    form.append('frame_duration_ms', String(payload.frame_duration_ms))
  }
  if (payload.n !== undefined) form.append('n', String(payload.n))

  return form
}

export function clampImageN(value: number): number {
  if (!Number.isFinite(value)) return MIN_IMAGE_N
  const rounded = Math.floor(value)
  if (rounded < MIN_IMAGE_N) return MIN_IMAGE_N
  if (rounded > MAX_IMAGE_N) return MAX_IMAGE_N
  return rounded
}

export function imageSizeForPreset(resolution: string, ratio: string): string {
  if (ratio === 'auto') return 'auto'
  if (resolution === 'auto') return ratio
  return IMAGE_SIZE_PRESETS[resolution]?.[ratio] ?? 'auto'
}

export function normalizeImageDimension(value: number, align: boolean): number {
  const whole = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1024
  const aligned = align
    ? Math.ceil(whole / IMAGE_DIMENSION_STEP) * IMAGE_DIMENSION_STEP
    : whole
  return Math.min(MAX_IMAGE_DIMENSION, aligned)
}

export function readImageSizeSettings(size: string): {
  resolution: string
  ratio: string
  width: number
  height: number
} {
  const pixels = /^(\d+)x(\d+)$/i.exec(size)
  if (!pixels) {
    const ratio =
      IMAGE_ASPECT_OPTIONS.find((option) => option.value === size)?.value ??
      'auto'
    const preset = IMAGE_SIZE_PRESETS['1k'][ratio] ?? '1024x1024'
    const [width, height] = preset.split('x').map(Number)
    return { resolution: 'auto', ratio, width, height }
  }
  const width = Number(pixels[1])
  const height = Number(pixels[2])
  let resolution = Object.keys(IMAGE_SIZE_PRESETS).find((key) =>
    Object.values(IMAGE_SIZE_PRESETS[key]).includes(size.toLowerCase())
  )
  if (!resolution) {
    resolution = '1k'
    if (Math.max(width, height) >= 1536) resolution = '2k'
    if (Math.max(width, height) >= 3072) resolution = '4k'
  }
  let ratio = '1:1'
  let distance = Number.POSITIVE_INFINITY
  for (const option of IMAGE_ASPECT_OPTIONS) {
    if (option.value === 'auto') continue
    const candidate = Math.abs(option.width / option.height - width / height)
    if (candidate < distance) {
      ratio = option.value
      distance = candidate
    }
  }
  return { resolution, ratio, width, height }
}

function detectImageFormat(
  item: { b64_json?: string; url?: string },
  outputFormat?: string
): string | undefined {
  if (item.b64_json) {
    try {
      // Read only the header, never decode the full multi-megabyte image.
      const header = atob(item.b64_json.slice(0, 32))
      if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
        return 'gif'
      }
      if (header.startsWith('\x89PNG\r\n\x1a\n')) return 'png'
      if (header.startsWith('\xff\xd8\xff')) return 'jpeg'
      if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
        return 'webp'
      }
    } catch {
      // Preserve existing handling of providers with non-standard base64.
    }
  }
  const normalized = outputFormat?.toLowerCase()
  if (normalized === 'jpg') return 'jpeg'
  if (normalized && ['png', 'jpeg', 'webp', 'gif'].includes(normalized)) {
    return normalized
  }
  const sourceFormat = item.url
    ?.match(/(?:^data:image\/|\.)(png|jpe?g|webp|gif)(?:[;?#]|$)/i)?.[1]
    ?.toLowerCase()
  if (sourceFormat === 'jpg') return 'jpeg'
  return sourceFormat
}

/**
 * b64_json 与 url 两种返回形态统一成可直接渲染的 src。
 * 优先使用内嵌图片，避免 HTTPS 页面加载上游 HTTP 地址时被浏览器拦截。
 * Inspect known signatures first so GIF responses keep their animation and MIME.
 */
export function resolveImageSrc(
  item: { b64_json?: string; url?: string },
  outputFormat?: string
): string | null {
  if (item.b64_json) {
    const mime = `image/${detectImageFormat(item, outputFormat) ?? 'png'}`
    return `data:${mime};base64,${item.b64_json}`
  }
  if (item.url) return item.url
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
    const outputFormat = detectImageFormat(item, response.output_format)
    const src = resolveImageSrc(item, outputFormat ?? request.output_format)
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
      actualOutputFormat: outputFormat,
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
 * Compare explicitly requested values with the upstream's reported result.
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
  const format =
    detectImageFormat({ url: image.src }, image.actualOutputFormat) ?? 'png'
  const ext = format === 'jpeg' ? 'jpg' : format
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
