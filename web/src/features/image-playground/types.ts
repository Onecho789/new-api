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
/** 生成模式：文生图走 JSON，图生图走 multipart */
export type ImageMode = 'generate' | 'edit'

/** 图像生成请求体，对应 /v1/images/generations */
export interface ImageGenerationRequest {
  model: string
  prompt: string
  n?: number
  size?: string
  quality?: string
  style?: string
  response_format?: string
  output_format?: string
  background?: string
  output_compression?: number
  frame_count?: number
  frame_duration_ms?: number
}

/** 待上传的图片，objectUrl 用于预览，卸载时需 revoke */
export interface UploadedImage {
  id: string
  file: File
  objectUrl: string
  /** 实际像素宽高，解码完成后才可用，用于校验蒙版是否与原图同尺寸 */
  width?: number
  height?: number
}

/** 上游返回的单张图像；部分服务会同时返回 b64_json 与 url */
export interface ImageGenerationResultItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
}

export interface ImageGenerationUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: {
    text_tokens?: number
    image_tokens?: number
  }
  output_tokens_details?: {
    text_tokens?: number
    image_tokens?: number
  }
}

export interface ImageGenerationResponse {
  created?: number
  data?: ImageGenerationResultItem[]
  usage?: ImageGenerationUsage
  /** 上游可能回传实际生效的参数，与请求值不一定相同 */
  model?: string
  quality?: string
  size?: string
  output_format?: string
  background?: string
}

/** 表单配置，持久化到 localStorage（apiKey 除外） */
export interface ImagePlaygroundConfig {
  mode: ImageMode
  model: string
  prompt: string
  size: string
  quality: string
  /** Desired workbench batch size; each upstream request generates one image. */
  n: number
  outputFormat: string
  background: string
  frameCount: number
  frameDurationMs: number
}

/** 仅在启用时随请求发送，避免上游因不支持的参数报错 */
export interface ImageParameterEnabled {
  size: boolean
  quality: boolean
  n: boolean
  outputFormat: boolean
  background: boolean
}

/** 原始文件快照，用于本地历史恢复和重试，不依赖预览 URL */
export interface ImageEditSnapshot {
  images: File[]
  mask: File | null
}

/** 一次生成结果，含请求快照便于对照上游实际生效值 */
export interface GeneratedImage {
  id: string
  src: string
  revisedPrompt?: string
  prompt: string
  model: string
  createdAt: number
  mode: ImageMode
  requestedSize?: string
  actualSize?: string
  actualQuality?: string
  actualModel?: string
  actualOutputFormat?: string
  actualBackground?: string
  usage?: ImageGenerationUsage
  /** 完整请求快照，用于「重新生成」原样复跑 */
  requestSnapshot?: ImageGenerationRequest
  editSnapshot?: ImageEditSnapshot
  durationMs?: number
}

export interface SelectOption {
  label: string
  value: string
  /** i18n key，用于在选项后补一句本地化说明 */
  descriptionKey?: string
}
