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
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_CONFIG,
  DEFAULT_PARAMETER_ENABLED,
  STORAGE_KEYS,
} from '../../constants'
import { buildRequestPayload } from '../../lib/image-utils'
import { useImagePlaygroundState } from '../use-image-playground-state'

afterEach(() => {
  localStorage.removeItem(STORAGE_KEYS.CONFIG)
  localStorage.removeItem(STORAGE_KEYS.PARAMETER_ENABLED)
})

describe('workbench settings restoration', () => {
  it('restores visible GIF, quality and dimensions as active controls even when old flags were disabled', () => {
    const { result } = renderHook(useImagePlaygroundState)
    act(() =>
      result.current.restoreConfig(
        {
          ...DEFAULT_CONFIG,
          prompt: 'animate the scene',
          outputFormat: 'gif',
          quality: 'high',
          size: '3840x2160',
          n: 4,
          frameCount: 12,
          frameDurationMs: 300,
        },
        {
          ...DEFAULT_PARAMETER_ENABLED,
          size: false,
          quality: false,
          outputFormat: false,
          n: false,
        }
      )
    )

    expect(
      buildRequestPayload(
        result.current.config,
        result.current.parameterEnabled
      )
    ).toMatchObject({
      output_format: 'gif',
      quality: 'high',
      size: '3840x2160',
      n: 1,
      prompt: 'animate the scene',
      frame_count: 12,
      frame_duration_ms: 300,
    })
    expect(result.current.config.n).toBe(4)
    expect(localStorage.getItem(STORAGE_KEYS.CONFIG)).not.toContain(
      'animate the scene'
    )
  })

  it('starts in PNG despite an old GIF preference, preserves explicit GIF selection, and resets new sessions to PNG', () => {
    localStorage.setItem(
      STORAGE_KEYS.CONFIG,
      JSON.stringify({ ...DEFAULT_CONFIG, outputFormat: 'gif' })
    )
    const { result } = renderHook(useImagePlaygroundState)
    expect(result.current.config.outputFormat).toBe('png')
    act(() => result.current.updateConfig('outputFormat', 'gif'))
    act(() => result.current.updateConfig('quality', 'high'))
    expect(result.current.config.outputFormat).toBe('gif')
    act(() => result.current.resetSession())
    expect(result.current.config).toMatchObject({
      outputFormat: 'png',
      prompt: '',
      mode: 'generate',
      quality: 'high',
    })
  })

  it('discards obsolete hidden settings from local storage and restored history', () => {
    const legacy = {
      ...DEFAULT_CONFIG,
      style: 'vivid',
      responseFormat: 'url',
      outputCompression: 70,
    }
    const enabled = {
      ...DEFAULT_PARAMETER_ENABLED,
      style: true,
      responseFormat: true,
      outputCompression: true,
    }
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(legacy))
    localStorage.setItem(
      STORAGE_KEYS.PARAMETER_ENABLED,
      JSON.stringify(enabled)
    )
    const { result } = renderHook(useImagePlaygroundState)
    expect(result.current.config).not.toHaveProperty('style')
    expect(result.current.parameterEnabled).not.toHaveProperty('responseFormat')
    act(() =>
      result.current.restoreConfig({ ...legacy, outputFormat: 'webp' }, enabled)
    )
    expect(result.current.config.outputFormat).toBe('webp')
    expect(result.current.config).not.toHaveProperty('outputCompression')
    const payload = buildRequestPayload(
      result.current.config,
      result.current.parameterEnabled
    )
    expect(payload).not.toHaveProperty('style')
    expect(payload).not.toHaveProperty('output_compression')
    expect(payload).not.toHaveProperty('response_format')
  })
})
