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
import { useCallback, useEffect, useState } from 'react'

import { DEFAULT_CONFIG } from '../constants'
import {
  getInitialConfig,
  getInitialParameterEnabled,
  getStoredApiKey,
  saveApiKey,
  saveConfig,
  saveParameterEnabled,
} from '../lib'
import {
  normalizeImageParameterEnabled,
  normalizeImagePlaygroundConfig,
} from '../lib/storage'
import type {
  ImageMode,
  ImageParameterEnabled,
  ImagePlaygroundConfig,
} from '../types'

export function useImagePlaygroundState() {
  const [config, setConfig] = useState<ImagePlaygroundConfig>(getInitialConfig)

  const [parameterEnabled, setParameterEnabled] =
    useState<ImageParameterEnabled>(getInitialParameterEnabled)

  // 有本地留存的 Key 说明用户上次选择了记住
  const [apiKey, setApiKey] = useState<string>(getStoredApiKey)
  const [rememberApiKey, setRememberApiKey] = useState<boolean>(
    () => getStoredApiKey() !== ''
  )

  useEffect(() => {
    saveConfig(config)
  }, [config])

  useEffect(() => {
    saveParameterEnabled(parameterEnabled)
  }, [parameterEnabled])

  useEffect(() => {
    saveApiKey(rememberApiKey ? apiKey : '')
  }, [apiKey, rememberApiKey])

  const updateConfig = useCallback(
    <K extends keyof ImagePlaygroundConfig>(
      key: K,
      value: ImagePlaygroundConfig[K]
    ) => {
      setConfig((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const setMode = useCallback((mode: ImageMode) => {
    setConfig((prev) => (prev.mode === mode ? prev : { ...prev, mode }))
  }, [])

  const updateParameterEnabled = useCallback(
    (key: keyof ImageParameterEnabled, value: boolean) => {
      setParameterEnabled((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const restoreConfig = useCallback(
    (nextConfig: ImagePlaygroundConfig, enabled?: ImageParameterEnabled) => {
      setConfig(normalizeImagePlaygroundConfig(nextConfig))
      setParameterEnabled((previous) =>
        normalizeImageParameterEnabled(enabled ?? previous)
      )
    },
    []
  )

  const resetSession = useCallback(() => {
    setConfig((previous) => ({
      ...previous,
      mode: 'generate',
      prompt: '',
      outputFormat: DEFAULT_CONFIG.outputFormat,
      frameCount: DEFAULT_CONFIG.frameCount,
      frameDurationMs: DEFAULT_CONFIG.frameDurationMs,
    }))
  }, [])

  return {
    config,
    updateConfig,
    restoreConfig,
    resetSession,
    setMode,
    parameterEnabled,
    updateParameterEnabled,
    apiKey,
    setApiKey,
    rememberApiKey,
    setRememberApiKey,
  }
}
