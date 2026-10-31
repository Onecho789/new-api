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
import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import type {
  ImageParameterEnabled,
  ImagePlaygroundConfig,
  UploadedImage,
} from '../../types'
import {
  buildDownloadFileName,
  buildEditFormData,
  buildRequestPayload,
  clampCompression,
  clampImageN,
  extractErrorMessage,
  extractGeneratedImages,
  getMaskSizeMismatch,
  getParameterMismatches,
  resolveImageSrc,
  supportsCompression,
} from '../image-utils'

function makeConfig(
  overrides: Partial<ImagePlaygroundConfig> = {}
): ImagePlaygroundConfig {
  return { ...DEFAULT_CONFIG, prompt: 'a red apple', ...overrides }
}

function makeEnabled(
  overrides: Partial<ImageParameterEnabled> = {}
): ImageParameterEnabled {
  return { ...DEFAULT_PARAMETER_ENABLED, ...overrides }
}

describe('buildRequestPayload', () => {
  it('omits parameters that are disabled', () => {
    const payload = buildRequestPayload(
      makeConfig(),
      makeEnabled({ n: false, quality: false, size: false })
    )

    expect(payload).toEqual({ model: 'gpt-image-2', prompt: 'a red apple' })
    expect(payload).not.toHaveProperty('size')
    expect(payload).not.toHaveProperty('quality')
    expect(payload).not.toHaveProperty('n')
  })

  it('includes enabled parameters and trims text fields', () => {
    const payload = buildRequestPayload(
      makeConfig({ model: '  gpt-image-2  ', prompt: '  a cat  ' }),
      makeEnabled({
        quality: true,
        responseFormat: true,
        size: true,
        style: true,
      })
    )

    expect(payload).toEqual({
      model: 'gpt-image-2',
      n: 1,
      prompt: 'a cat',
      quality: 'standard',
      response_format: 'url',
      size: '1024x1024',
      style: 'vivid',
    })
  })

  it('only sends model, prompt and n by default', () => {
    // 实测 gpt-image-2 会忽略 size/quality，且不支持 style/response_format
    const payload = buildRequestPayload(makeConfig(), makeEnabled())

    expect(payload).toEqual({
      model: 'gpt-image-2',
      n: 1,
      prompt: 'a red apple',
    })
  })

  it('clamps n to 1 because the model rejects anything larger', () => {
    const payload = buildRequestPayload(makeConfig({ n: 5 }), makeEnabled())

    expect(payload.n).toBe(1)
  })

  it('includes output_format and background when enabled', () => {
    const payload = buildRequestPayload(
      makeConfig({ background: 'opaque', outputFormat: 'webp' }),
      makeEnabled({ background: true, outputFormat: true })
    )

    expect(payload.output_format).toBe('webp')
    expect(payload.background).toBe('opaque')
  })

  it('sends output_compression only for jpeg and webp', () => {
    const webp = buildRequestPayload(
      makeConfig({ outputCompression: 60, outputFormat: 'webp' }),
      makeEnabled({ outputCompression: true, outputFormat: true })
    )
    const png = buildRequestPayload(
      makeConfig({ outputCompression: 60, outputFormat: 'png' }),
      makeEnabled({ outputCompression: true, outputFormat: true })
    )
    // png 传 <100 会被上游拒绝，必须省略
    expect(webp.output_compression).toBe(60)
    expect(png.output_compression).toBeUndefined()
  })

  it('omits output_compression when output_format is disabled', () => {
    const payload = buildRequestPayload(
      makeConfig({ outputCompression: 60, outputFormat: 'webp' }),
      makeEnabled({ outputCompression: true, outputFormat: false })
    )

    expect(payload.output_compression).toBeUndefined()
  })
})

describe('clampCompression', () => {
  it('keeps values inside 1-100', () => {
    expect(clampCompression(0)).toBe(1)
    expect(clampCompression(60)).toBe(60)
    expect(clampCompression(120)).toBe(100)
    expect(clampCompression(Number.NaN)).toBe(100)
  })
})

describe('supportsCompression', () => {
  it('is true only for jpeg and webp', () => {
    expect(supportsCompression('jpeg')).toBe(true)
    expect(supportsCompression('webp')).toBe(true)
    expect(supportsCompression('png')).toBe(false)
  })
})

describe('buildDownloadFileName', () => {
  it('uses the extension of the format upstream actually returned', () => {
    const base = {
      createdAt: 0,
      id: '1',
      mode: 'generate' as const,
      model: 'gpt-image-2',
      prompt: 'x',
      src: 'data:image/png;base64,AAAA',
    }

    expect(buildDownloadFileName(base)).toMatch(/\.png$/)
    expect(
      buildDownloadFileName({ ...base, actualOutputFormat: 'webp' })
    ).toMatch(/\.webp$/)
    // jpeg 用惯例的 .jpg
    expect(
      buildDownloadFileName({ ...base, actualOutputFormat: 'jpeg' })
    ).toMatch(/\.jpg$/)
  })
})

describe('clampImageN', () => {
  it('clamps everything to 1 since the model only accepts n=1', () => {
    expect(clampImageN(0)).toBe(1)
    expect(clampImageN(-5)).toBe(1)
    expect(clampImageN(99)).toBe(1)
    expect(clampImageN(Number.NaN)).toBe(1)
    expect(clampImageN(2.6)).toBe(1)
    expect(clampImageN(1)).toBe(1)
  })
})

describe('resolveImageSrc', () => {
  it('prefers url and falls back to base64', () => {
    expect(resolveImageSrc({ url: 'https://example.com/a.png' })).toBe(
      'https://example.com/a.png'
    )
    expect(resolveImageSrc({ b64_json: 'AAAA' })).toBe(
      'data:image/png;base64,AAAA'
    )
    expect(resolveImageSrc({})).toBeNull()
  })
})

describe('extractGeneratedImages', () => {
  it('maps response items and keeps the request snapshot', () => {
    const request = {
      model: 'gpt-image-2',
      prompt: 'a red apple',
      size: '1024x1024',
    }
    const images = extractGeneratedImages(
      {
        created: 1_787_483_424,
        data: [{ b64_json: 'AAAA', revised_prompt: 'a shiny red apple' }],
        model: 'gpt-image-2-codex',
        quality: 'auto',
        size: '1024x1536',
        usage: { input_tokens: 68, output_tokens: 343 },
      },
      request
    )

    expect(images).toHaveLength(1)
    expect(images[0]).toMatchObject({
      actualModel: 'gpt-image-2-codex',
      actualQuality: 'auto',
      actualSize: '1024x1536',
      model: 'gpt-image-2',
      prompt: 'a red apple',
      requestedSize: '1024x1024',
      revisedPrompt: 'a shiny red apple',
      src: 'data:image/png;base64,AAAA',
    })
    expect(images[0].usage).toEqual({ input_tokens: 68, output_tokens: 343 })
  })

  it('skips items without any renderable source', () => {
    const images = extractGeneratedImages(
      { data: [{}, { url: 'https://example.com/b.png' }] },
      { model: 'dall-e-3', prompt: 'x' }
    )

    expect(images).toHaveLength(1)
    expect(images[0].src).toBe('https://example.com/b.png')
  })

  it('returns an empty list when the response has no data', () => {
    expect(
      extractGeneratedImages({}, { model: 'gpt-image-2', prompt: 'x' })
    ).toEqual([])
  })
})

describe('buildEditFormData', () => {
  function makeUpload(name: string): UploadedImage {
    return {
      file: new File(['x'], name, { type: 'image/png' }),
      id: name,
      objectUrl: `blob:${name}`,
    }
  }

  const payload = { model: 'gpt-image-2', prompt: 'a red apple' }

  it('uses the image field for a single source image', () => {
    const form = buildEditFormData(payload, [makeUpload('a.png')], null)

    expect(form.getAll('image')).toHaveLength(1)
    expect(form.getAll('image[]')).toEqual([])
    expect(form.get('prompt')).toBe('a red apple')
    expect(form.get('model')).toBe('gpt-image-2')
    // payload 里没有的参数不写进表单，上游会忽略 size/quality
    expect(form.get('size')).toBeNull()
    expect(form.get('quality')).toBeNull()
  })

  it('uses the image[] field for multiple source images', () => {
    const form = buildEditFormData(
      payload,
      [makeUpload('a.png'), makeUpload('b.png')],
      null
    )

    expect(form.getAll('image[]')).toHaveLength(2)
    expect(form.getAll('image')).toEqual([])
  })

  it('appends the mask only when provided', () => {
    const withoutMask = buildEditFormData(payload, [makeUpload('a.png')], null)
    const withMask = buildEditFormData(
      payload,
      [makeUpload('a.png')],
      makeUpload('mask.png')
    )

    expect(withoutMask.get('mask')).toBeNull()
    expect(withMask.get('mask')).toBeInstanceOf(File)
  })

  it('serialises the enabled parameters present on the payload', () => {
    const form = buildEditFormData(
      { ...payload, n: 2, quality: 'high', size: '1024x1024' },
      [makeUpload('a.png')],
      null
    )

    expect(form.get('size')).toBe('1024x1024')
    expect(form.get('quality')).toBe('high')
    expect(form.get('n')).toBe('2')
  })
})

describe('getMaskSizeMismatch', () => {
  const sized = (id: string, width: number, height: number): UploadedImage => ({
    file: new File(['x'], `${id}.png`, { type: 'image/png' }),
    height,
    id,
    objectUrl: `blob:${id}`,
    width,
  })

  it('reports a mismatch when the mask differs from the source image', () => {
    expect(
      getMaskSizeMismatch([sized('a', 512, 512)], sized('m', 256, 256))
    ).toEqual({ imageSize: '512x512', maskSize: '256x256' })
  })

  it('returns null when sizes match or are unknown', () => {
    expect(
      getMaskSizeMismatch([sized('a', 512, 512)], sized('m', 512, 512))
    ).toBeNull()
    expect(getMaskSizeMismatch([sized('a', 512, 512)], null)).toBeNull()
    // 解码失败时尺寸未知，不应误报
    expect(
      getMaskSizeMismatch(
        [{ file: new File([], 'a.png'), id: 'a', objectUrl: 'blob:a' }],
        sized('m', 256, 256)
      )
    ).toBeNull()
  })
})

describe('getParameterMismatches', () => {
  it('reports size and model differences returned by upstream', () => {
    const mismatches = getParameterMismatches({
      actualModel: 'gpt-image-2-codex',
      actualSize: '1024x1536',
      createdAt: 0,
      id: '1',
      mode: 'generate',
      model: 'gpt-image-2',
      prompt: 'x',
      requestedSize: '1024x1024',
      src: 'data:image/png;base64,AAAA',
    })

    expect(mismatches).toEqual([
      { actual: '1024x1536', label: 'size', requested: '1024x1024' },
      { actual: 'gpt-image-2-codex', label: 'model', requested: 'gpt-image-2' },
    ])
  })

  it('reports nothing when upstream honoured the request', () => {
    expect(
      getParameterMismatches({
        actualModel: 'gpt-image-2',
        actualSize: '1024x1024',
        createdAt: 0,
        id: '1',
        mode: 'generate',
        model: 'gpt-image-2',
        prompt: 'x',
        requestedSize: '1024x1024',
        src: 'data:image/png;base64,AAAA',
      })
    ).toEqual([])
  })
})

describe('extractErrorMessage', () => {
  it('reads nested and top-level error messages', () => {
    expect(
      extractErrorMessage(
        {
          error: { message: 'Image generation is not enabled for this group' },
        },
        'fallback'
      )
    ).toBe('Image generation is not enabled for this group')
    expect(extractErrorMessage({ message: 'boom' }, 'fallback')).toBe('boom')
  })

  it('falls back for unusable payloads', () => {
    expect(extractErrorMessage(null, 'fallback')).toBe('fallback')
    expect(extractErrorMessage('nope', 'fallback')).toBe('fallback')
    expect(extractErrorMessage({ error: { message: '   ' } }, 'fb')).toBe('fb')
  })
})
