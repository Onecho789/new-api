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
import type {
  ImageParameterEnabled,
  ImagePlaygroundConfig,
  SelectOption,
} from './types'

/** 生图端点走 /v1 而非 /pg，需自带 API Key 鉴权 */
export const IMAGE_GENERATION_ENDPOINT = '/v1/images/generations'

/** 图生图端点，走 multipart/form-data */
export const IMAGE_EDIT_ENDPOINT = '/v1/images/edits'

export const USER_MODELS_ENDPOINT = '/api/user/models'

export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp'

/** 单张上传图片大小上限，超过时上游通常直接拒绝 */
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024

export const MAX_UPLOAD_IMAGES = 10

/**
 * 枚举选项的 descriptionKey 用于在下拉里补一句中文说明，
 * label 保留原始参数值以便与 API 文档对照。
 */
export const SIZE_OPTIONS: SelectOption[] = [
  { label: '1024x1024', value: '1024x1024', descriptionKey: 'Square' },
  { label: '1024x1536', value: '1024x1536', descriptionKey: 'Portrait' },
  { label: '1536x1024', value: '1536x1024', descriptionKey: 'Landscape' },
  { label: '1024x1792', value: '1024x1792', descriptionKey: 'Tall portrait' },
  { label: '1792x1024', value: '1792x1024', descriptionKey: 'Wide landscape' },
  { label: '512x512', value: '512x512', descriptionKey: 'Small square' },
  { label: '256x256', value: '256x256', descriptionKey: 'Tiny square' },
  { label: 'auto', value: 'auto', descriptionKey: 'Chosen by upstream' },
]

export const QUALITY_OPTIONS: SelectOption[] = [
  { label: 'standard', value: 'standard', descriptionKey: 'Standard' },
  { label: 'hd', value: 'hd', descriptionKey: 'High definition' },
  { label: 'low', value: 'low', descriptionKey: 'Low, cheapest' },
  { label: 'medium', value: 'medium', descriptionKey: 'Medium' },
  { label: 'high', value: 'high', descriptionKey: 'High, most expensive' },
  { label: 'auto', value: 'auto', descriptionKey: 'Chosen by upstream' },
]

export const STYLE_OPTIONS: SelectOption[] = [
  { label: 'vivid', value: 'vivid', descriptionKey: 'Vivid, dramatic' },
  { label: 'natural', value: 'natural', descriptionKey: 'Natural, realistic' },
]

export const RESPONSE_FORMAT_OPTIONS: SelectOption[] = [
  { label: 'url', value: 'url', descriptionKey: 'Temporary link' },
  { label: 'b64_json', value: 'b64_json', descriptionKey: 'Inline base64' },
]

/** 实测有效：返回体的 output_format 会跟着变，jpeg/webp 体积远小于 png */
export const OUTPUT_FORMAT_OPTIONS: SelectOption[] = [
  { label: 'png', value: 'png', descriptionKey: 'Lossless, largest' },
  { label: 'jpeg', value: 'jpeg', descriptionKey: 'Compressed, smallest' },
  { label: 'webp', value: 'webp', descriptionKey: 'Compressed, good quality' },
]

/** 实测有效：opaque 会回显。transparent 被该模型拒绝，故不提供 */
export const BACKGROUND_OPTIONS: SelectOption[] = [
  { label: 'auto', value: 'auto', descriptionKey: 'Chosen by upstream' },
  { label: 'opaque', value: 'opaque', descriptionKey: 'Solid background' },
]

/** 压缩率仅对 jpeg/webp 有效，png 传 <100 会被上游拒绝 */
export const COMPRESSION_ONLY_FORMATS = new Set(['jpeg', 'webp'])

export const MIN_COMPRESSION = 1
export const MAX_COMPRESSION = 100

export const MIN_IMAGE_N = 1

/**
 * 实测 gpt-image-2 只接受 n=1，n=2/3 均报
 * "Unknown parameter: 'tools[0].n'"，故上限收到 1。
 */
export const MAX_IMAGE_N = 1

export const DEFAULT_CONFIG: ImagePlaygroundConfig = {
  mode: 'generate',
  model: 'gpt-image-2',
  prompt: '',
  size: '1024x1024',
  quality: 'standard',
  style: 'vivid',
  n: 1,
  responseFormat: 'url',
  outputFormat: 'png',
  background: 'auto',
  outputCompression: 80,
}

/**
 * style 与 response_format 默认关闭：gpt-image 系列不支持这两个参数，
 * style 传了直接报 Unknown parameter，仅 dall-e-3 需要时再手动开启。
 * size/quality 也默认关闭：实测 gpt-image-2 文生图同样会忽略它们
 * （四组组合均返回 1254x1254 / auto / 229 token），开着会让人误判可控性。
 * outputFormat/background 实测有效但默认保持上游默认值，需要时再开。
 */
export const DEFAULT_PARAMETER_ENABLED: ImageParameterEnabled = {
  size: false,
  quality: false,
  style: false,
  n: true,
  responseFormat: false,
  outputFormat: false,
  background: false,
  outputCompression: false,
}

/** 图生图同上，且上游还会按输入图自行决定输出尺寸 */
export const EDIT_MODE_PARAMETER_ENABLED: ImageParameterEnabled = {
  size: false,
  quality: false,
  style: false,
  n: true,
  responseFormat: false,
  outputFormat: false,
  background: false,
  outputCompression: false,
}

export const STORAGE_KEYS = {
  CONFIG: 'image_playground_config',
  PARAMETER_ENABLED: 'image_playground_parameter_enabled',
  EDIT_PARAMETER_ENABLED: 'image_playground_edit_parameter_enabled',
  API_KEY: 'image_playground_api_key',
} as const
