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
import { api } from '@/lib/api'

import {
  IMAGE_EDIT_ENDPOINT,
  IMAGE_GENERATION_ENDPOINT,
  USER_MODELS_ENDPOINT,
} from './constants'
import { extractErrorMessage } from './lib'
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
  SelectOption,
} from './types'

/** 统一解析响应：new-api 可能以 200 返回业务错误体 */
async function parseImageResponse(
  res: Response
): Promise<ImageGenerationResponse> {
  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // 非 JSON 响应（如网关 HTML 错误页）走下面的兜底分支
    }
  }

  if (!res.ok) {
    const fallback = `${res.status} ${res.statusText}`.trim()
    throw new Error(extractErrorMessage(parsed, fallback || 'Request failed'))
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Unexpected response format')
  }

  if ((parsed as { error?: unknown }).error) {
    throw new Error(extractErrorMessage(parsed, 'Request failed'))
  }

  return parsed as ImageGenerationResponse
}

/**
 * 调用生图端点。该端点走 API Key 鉴权而非控制台会话，
 * 因此不复用带会话拦截器的 api 实例，直接用 fetch 并显式带 Bearer。
 */
export async function generateImages(
  payload: ImageGenerationRequest,
  apiKey: string,
  signal?: AbortSignal
): Promise<ImageGenerationResponse> {
  const res = await fetch(IMAGE_GENERATION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  })

  return parseImageResponse(res)
}

/**
 * 图生图。不设置 Content-Type，由浏览器自动带上
 * multipart/form-data 及 boundary。
 */
export async function editImages(
  form: FormData,
  apiKey: string,
  signal?: AbortSignal
): Promise<ImageGenerationResponse> {
  const res = await fetch(IMAGE_EDIT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal,
  })

  return parseImageResponse(res)
}

/** 拉取当前用户可用模型，用于模型下拉 */
export async function getAvailableModels(): Promise<SelectOption[]> {
  const res = await api.get(USER_MODELS_ENDPOINT)
  const { data } = res

  if (!data?.success || !Array.isArray(data.data)) {
    return []
  }

  return (data.data as string[]).map((model) => ({
    label: model,
    value: model,
  }))
}
