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
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  getInitialConfig,
  getInitialEditParameterEnabled,
  getInitialParameterEnabled,
  getStoredApiKey,
  saveApiKey,
  saveConfig,
  saveEditParameterEnabled,
  saveParameterEnabled,
} from '../lib'
import type {
  ImageMode,
  ImageParameterEnabled,
  ImagePlaygroundConfig,
} from '../types'

export function useImagePlaygroundState() {
  const [config, setConfig] = useState<ImagePlaygroundConfig>(getInitialConfig)

  // 两种模式的参数开关分开记忆：图生图下 size/quality 会被上游忽略，
  // 默认关闭，切回文生图时不应受影响。
  const [generateEnabled, setGenerateEnabled] = useState<ImageParameterEnabled>(
    getInitialParameterEnabled
  )
  const [editEnabled, setEditEnabled] = useState<ImageParameterEnabled>(
    getInitialEditParameterEnabled
  )

  // 有本地留存的 Key 说明用户上次选择了记住
  const [apiKey, setApiKey] = useState<string>(getStoredApiKey)
  const [rememberApiKey, setRememberApiKey] = useState<boolean>(
    () => getStoredApiKey() !== ''
  )

  useEffect(() => {
    saveConfig(config)
  }, [config])

  useEffect(() => {
    saveParameterEnabled(generateEnabled)
  }, [generateEnabled])

  useEffect(() => {
    saveEditParameterEnabled(editEnabled)
  }, [editEnabled])

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

  const parameterEnabled = useMemo(
    () => (config.mode === 'edit' ? editEnabled : generateEnabled),
    [config.mode, editEnabled, generateEnabled]
  )

  const updateParameterEnabled = useCallback(
    (key: keyof ImageParameterEnabled, value: boolean) => {
      const setter =
        config.mode === 'edit' ? setEditEnabled : setGenerateEnabled
      setter((prev) => ({ ...prev, [key]: value }))
    },
    [config.mode]
  )

  return {
    config,
    updateConfig,
    setMode,
    parameterEnabled,
    updateParameterEnabled,
    apiKey,
    setApiKey,
    rememberApiKey,
    setRememberApiKey,
  }
}
