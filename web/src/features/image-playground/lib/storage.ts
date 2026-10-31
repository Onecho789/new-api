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
  DEFAULT_CONFIG,
  DEFAULT_PARAMETER_ENABLED,
  EDIT_MODE_PARAMETER_ENABLED,
  STORAGE_KEYS,
} from '../constants'
import type { ImageParameterEnabled, ImagePlaygroundConfig } from '../types'
import { clampImageN } from './image-utils'

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<T>
    // 与默认值合并，避免旧版本缓存缺字段导致 undefined
    return { ...fallback, ...parsed }
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式或配额用尽时静默降级，不阻断生成流程
  }
}

export function getInitialConfig(): ImagePlaygroundConfig {
  // prompt 不做持久化，避免上次的提示词意外复用
  const stored = readJSON<ImagePlaygroundConfig>(
    STORAGE_KEYS.CONFIG,
    DEFAULT_CONFIG
  )
  // 旧缓存里可能存着超出新上限的 n（曾经允许到 10），读取时收敛
  return { ...stored, n: clampImageN(stored.n), prompt: '' }
}

export function saveConfig(config: ImagePlaygroundConfig): void {
  const { prompt: _prompt, ...rest } = config
  writeJSON(STORAGE_KEYS.CONFIG, rest)
}

export function getInitialParameterEnabled(): ImageParameterEnabled {
  return readJSON<ImageParameterEnabled>(
    STORAGE_KEYS.PARAMETER_ENABLED,
    DEFAULT_PARAMETER_ENABLED
  )
}

export function saveParameterEnabled(value: ImageParameterEnabled): void {
  writeJSON(STORAGE_KEYS.PARAMETER_ENABLED, value)
}

export function getInitialEditParameterEnabled(): ImageParameterEnabled {
  return readJSON<ImageParameterEnabled>(
    STORAGE_KEYS.EDIT_PARAMETER_ENABLED,
    EDIT_MODE_PARAMETER_ENABLED
  )
}

export function saveEditParameterEnabled(value: ImageParameterEnabled): void {
  writeJSON(STORAGE_KEYS.EDIT_PARAMETER_ENABLED, value)
}

/**
 * API Key 保存在 localStorage 便于免重复输入。这是明文存储，
 * 任何能执行同源脚本的代码都可读取，因此默认不保存，由用户显式勾选。
 */
export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.API_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key) {
      localStorage.setItem(STORAGE_KEYS.API_KEY, key)
    } else {
      localStorage.removeItem(STORAGE_KEYS.API_KEY)
    }
  } catch {
    // 忽略存储失败
  }
}
