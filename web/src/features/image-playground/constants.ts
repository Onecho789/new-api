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

export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

/** 单张上传图片大小上限，超过时上游通常直接拒绝 */
export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024

export const MAX_UPLOAD_IMAGES = 10

export const QUALITY_OPTIONS: SelectOption[] = [
  { label: 'auto', value: 'auto', descriptionKey: 'Auto' },
  { label: 'high', value: 'high', descriptionKey: 'High' },
  { label: 'medium', value: 'medium', descriptionKey: 'Medium' },
  { label: 'low', value: 'low', descriptionKey: 'Low' },
]

export const IMAGE_RESOLUTION_OPTIONS = ['1k', '2k', '4k', 'auto'] as const
export const IMAGE_ASPECT_OPTIONS = [
  { value: '1:1', width: 1, height: 1 },
  { value: '2:3', width: 2, height: 3 },
  { value: '3:2', width: 3, height: 2 },
  { value: '4:3', width: 4, height: 3 },
  { value: '3:4', width: 3, height: 4 },
  { value: '16:9', width: 16, height: 9 },
  { value: '9:16', width: 9, height: 16 },
  { value: '21:9', width: 21, height: 9 },
  { value: '9:21', width: 9, height: 21 },
  { value: 'auto', width: 0, height: 0 },
] as const

/** Presets match the reference workbench; provider support is model specific. */
export const IMAGE_SIZE_PRESETS: Record<string, Record<string, string>> = {
  '1k': {
    '1:1': '1024x1024',
    '2:3': '1024x1536',
    '3:2': '1536x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '16:9': '1536x864',
    '9:16': '864x1536',
    '21:9': '2016x864',
    '9:21': '864x2016',
  },
  '2k': {
    '1:1': '2048x2048',
    '2:3': '1360x2048',
    '3:2': '2048x1360',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '21:9': '2688x1152',
    '9:21': '1152x2688',
  },
  '4k': {
    '1:1': '2880x2880',
    '2:3': '2336x3520',
    '3:2': '3520x2336',
    '4:3': '3312x2480',
    '3:4': '2480x3312',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '21:9': '3840x1648',
    '9:21': '1648x3840',
  },
}

export const IMAGE_DIMENSION_STEP = 16
export const MAX_IMAGE_DIMENSION = 3840

/** Output options are passed through; support depends on the selected model. */
export const OUTPUT_FORMAT_OPTIONS: SelectOption[] = [
  { label: 'png', value: 'png', descriptionKey: 'Lossless, largest' },
  { label: 'gif', value: 'gif', descriptionKey: 'GIF image' },
]

/** Official animated GIF controls; the duration follows the guide's UI range. */
export const MIN_GIF_FRAME_COUNT = 2
export const MAX_GIF_FRAME_COUNT = 16
export const DEFAULT_GIF_FRAME_COUNT = 9
export const MIN_GIF_FRAME_DURATION_MS = 20
export const MAX_GIF_FRAME_DURATION_MS = 2000
export const GIF_FRAME_DURATION_STEP = 10
export const DEFAULT_GIF_FRAME_DURATION_MS = 200

export const MIN_IMAGE_N = 1

/** Desired workbench batch size, each HTTP request asks for one image. */
export const MAX_IMAGE_N = 10

export const DEFAULT_CONFIG: ImagePlaygroundConfig = {
  mode: 'generate',
  model: 'gpt-image-2',
  prompt: '',
  size: '1:1',
  quality: 'auto',
  n: 1,
  outputFormat: 'png',
  background: '',
  frameCount: DEFAULT_GIF_FRAME_COUNT,
  frameDurationMs: DEFAULT_GIF_FRAME_DURATION_MS,
}

/** Visible controls apply immediately; transparent background is opt-in. */
export const DEFAULT_PARAMETER_ENABLED: ImageParameterEnabled = {
  size: true,
  quality: true,
  n: true,
  outputFormat: true,
  background: false,
}

export const EDIT_MODE_PARAMETER_ENABLED: ImageParameterEnabled = {
  ...DEFAULT_PARAMETER_ENABLED,
}

export const STORAGE_KEYS = {
  CONFIG: 'image_playground_config',
  PARAMETER_ENABLED: 'image_playground_parameter_enabled',
  EDIT_PARAMETER_ENABLED: 'image_playground_edit_parameter_enabled',
  API_KEY: 'image_playground_api_key',
} as const
