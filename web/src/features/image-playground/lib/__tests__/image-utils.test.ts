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

import {
  DEFAULT_CONFIG,
  DEFAULT_PARAMETER_ENABLED,
  STORAGE_KEYS,
} from '../../constants'
import type {
  ImageParameterEnabled,
  ImagePlaygroundConfig,
  UploadedImage,
} from '../../types'
import {
  buildDownloadFileName,
  buildEditFormData,
  buildRequestPayload,
  clampGifFrameCount,
  clampGifFrameDuration,
  clampImageN,
  extractErrorMessage,
  extractGeneratedImages,
  getMaskSizeMismatch,
  getParameterMismatches,
  normalizeImageRequestSnapshot,
  resolveImageSrc,
} from '../image-utils'
import {
  getInitialConfig,
  getInitialParameterEnabled,
  saveConfig,
} from '../storage'

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
      makeEnabled({
        n: false,
        quality: false,
        size: false,
        outputFormat: false,
      })
    )

    expect(payload).toEqual({ model: 'gpt-image-2', prompt: 'a red apple' })
    expect(payload).not.toHaveProperty('size')
    expect(payload).not.toHaveProperty('quality')
    expect(payload).not.toHaveProperty('n')
  })

  it('includes visible controls and ignores legacy advanced flags while trimming text', () => {
    const payload = buildRequestPayload(
      makeConfig({
        model: '  gpt-image-2  ',
        prompt: '  a cat  ',
        quality: 'high',
        size: '2048x1152',
      }),
      Object.assign(
        makeEnabled({
          quality: true,
          size: true,
        }),
        { responseFormat: true, style: true, outputCompression: true }
      )
    )

    expect(payload).toEqual({
      model: 'gpt-image-2',
      n: 1,
      prompt: 'a cat',
      quality: 'high',
      size: '2048x1152',
      output_format: 'png',
    })
  })

  it('keeps automatic quality and size upstream controlled by omitting them', () => {
    const payload = buildRequestPayload(
      makeConfig({ size: 'auto' }),
      makeEnabled()
    )

    expect(payload).toEqual({
      model: 'gpt-image-2',
      n: 1,
      prompt: 'a red apple',
      output_format: 'png',
    })
  })

  it('sends one image per request even when the desired batch contains five images', () => {
    const payload = buildRequestPayload(makeConfig({ n: 5 }), makeEnabled())

    expect(payload.n).toBe(1)
  })

  it('maps automatic resolution with a selected ratio through quality into concrete size', () => {
    const payload = buildRequestPayload(
      makeConfig({ size: '16:9', quality: 'high' }),
      makeEnabled()
    )
    expect(payload.size).toBe('3840x2160')
    expect(payload).not.toHaveProperty('resolution')
    expect(payload).not.toHaveProperty('aspect_ratio')
  })

  it('forwards GIF animation fields without transparent background in JSON and multipart', () => {
    const payload = buildRequestPayload(
      makeConfig({ outputFormat: 'gif', background: 'transparent' }),
      makeEnabled({ background: true })
    )
    expect(payload.output_format).toBe('gif')
    expect(payload.background).toBeUndefined()
    expect(payload.frame_count).toBe(9)
    expect(payload.frame_duration_ms).toBe(200)
    const form = buildEditFormData(
      payload,
      [{ file: new File(['GIF89a'], 'reference.gif', { type: 'image/gif' }) }],
      null
    )
    expect(form.get('output_format')).toBe('gif')
    expect(form.get('background')).toBeNull()
    expect(form.get('frame_count')).toBe('9')
    expect(form.get('frame_duration_ms')).toBe('200')
  })

  it('includes output_format and background when enabled', () => {
    const payload = buildRequestPayload(
      makeConfig({ background: 'transparent', outputFormat: 'webp' }),
      makeEnabled({ background: true, outputFormat: true })
    )

    expect(payload.output_format).toBe('webp')
    expect(payload.background).toBe('transparent')
  })

  it('never sends removed advanced controls even if old stored values are enabled', () => {
    const payload = buildRequestPayload(
      Object.assign(makeConfig({ outputFormat: 'webp' }), {
        outputCompression: 60,
        style: 'vivid',
        responseFormat: 'url',
      }),
      Object.assign(makeEnabled(), {
        outputCompression: true,
        style: true,
        responseFormat: true,
      })
    )
    expect(payload).not.toHaveProperty('output_compression')
    expect(payload).not.toHaveProperty('style')
    expect(payload).not.toHaveProperty('response_format')
  })

  it('uses reference base64 negotiation for non-GPT models and preserves GPT aliases unchanged', () => {
    expect(
      buildRequestPayload(makeConfig({ model: 'dall-e-3' }), makeEnabled())
        .response_format
    ).toBe('b64_json')
    const alias = buildRequestPayload(
      makeConfig({ model: 'gpt-images-2.6' }),
      makeEnabled()
    )
    expect(alias.model).toBe('gpt-images-2.6')
    expect(alias).not.toHaveProperty('response_format')
  })

  it('omits animation-only fields from PNG and JPEG requests', () => {
    for (const outputFormat of ['png', 'jpeg']) {
      const payload = buildRequestPayload(
        makeConfig({ outputFormat, frameCount: 12, frameDurationMs: 600 }),
        makeEnabled()
      )
      expect(payload).not.toHaveProperty('frame_count')
      expect(payload).not.toHaveProperty('frame_duration_ms')
      const form = buildEditFormData(payload, [], null)
      expect(form.get('frame_count')).toBeNull()
      expect(form.get('frame_duration_ms')).toBeNull()
    }
  })

  it('clamps GIF controls to the documented ranges and rounds duration to ten milliseconds', () => {
    expect(clampGifFrameCount(1)).toBe(2)
    expect(clampGifFrameCount(99)).toBe(16)
    expect(clampGifFrameCount(Number.NaN)).toBe(9)
    expect(clampGifFrameDuration(1)).toBe(20)
    expect(clampGifFrameDuration(9999)).toBe(2000)
    expect(clampGifFrameDuration(235)).toBe(240)
    expect(clampGifFrameDuration(Number.NaN)).toBe(200)
    const payload = buildRequestPayload(
      makeConfig({ outputFormat: 'gif', frameCount: 99, frameDurationMs: 235 }),
      makeEnabled()
    )
    expect(payload).toMatchObject({ frame_count: 16, frame_duration_ms: 240 })
  })

  it('aligns only explicit GIF frame sizes to sixteen while preserving automatic sizing', () => {
    const payload = buildRequestPayload(
      makeConfig({ outputFormat: 'gif', size: '513x769' }),
      makeEnabled()
    )
    expect(payload.size).toBe('528x784')
    expect(
      buildRequestPayload(
        makeConfig({ outputFormat: 'gif', size: 'auto' }),
        makeEnabled()
      )
    ).not.toHaveProperty('size')
  })
})

describe('historical request snapshots', () => {
  it('preserves previously executed non-GIF protocol options while excluding GIF-only fields', () => {
    const request = {
      model: 'gpt-image-2',
      prompt: 'retry',
      output_format: 'webp',
      style: 'natural',
      response_format: 'url',
      output_compression: 60,
    }
    const normalized = normalizeImageRequestSnapshot({
      ...request,
      frame_count: 9,
      frame_duration_ms: 200,
    })
    expect(normalized).toEqual(request)
    const form = buildEditFormData(normalized, [], null)
    expect(form.get('style')).toBe('natural')
    expect(form.get('response_format')).toBe('url')
    expect(form.get('output_compression')).toBe('60')
  })

  it('rejects a historical GIF mask before sending an edit request', () => {
    expect(() =>
      buildEditFormData(
        {
          model: 'gpt-images-2.6',
          prompt: 'retry animation',
          output_format: 'gif',
        },
        [],
        { file: new File(['mask'], 'mask.png', { type: 'image/png' }) }
      )
    ).toThrow('GIF output does not support masks')
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
  it('bounds the desired batch count to whole numbers from one to ten', () => {
    expect(clampImageN(0)).toBe(1)
    expect(clampImageN(-5)).toBe(1)
    expect(clampImageN(99)).toBe(10)
    expect(clampImageN(Number.NaN)).toBe(1)
    expect(clampImageN(2.6)).toBe(2)
    expect(clampImageN(1)).toBe(1)
  })
})

describe('resolveImageSrc', () => {
  it('recognizes GIF bytes without output_format and preserves the animated data for downloads', () => {
    const base64 = btoa(`GIF89a${'\0'.repeat(30)}`)
    const [image] = extractGeneratedImages(
      { data: [{ b64_json: base64 }] },
      { model: 'gpt-images-2.6', prompt: 'animation' }
    )
    expect(image.src).toBe(`data:image/gif;base64,${base64}`)
    expect(image.actualOutputFormat).toBe('gif')
    expect(buildDownloadFileName(image)).toMatch(/\.gif$/)
  })

  it('uses known file signatures instead of an incorrect requested output format', () => {
    expect(
      resolveImageSrc({ b64_json: btoa(`GIF87a${'\0'.repeat(30)}`) }, 'png')
    ).toMatch(/^data:image\/gif;/)
    expect(resolveImageSrc({ b64_json: '/9j/AAAA' })).toMatch(
      /^data:image\/jpeg;/
    )
    expect(resolveImageSrc({ b64_json: btoa('RIFF0000WEBPxxxx') })).toMatch(
      /^data:image\/webp;/
    )
    expect(resolveImageSrc({ b64_json: 'AAAA' }, 'gif')).toBe(
      'data:image/gif;base64,AAAA'
    )
  })
  it('uses base64 when the response also includes an HTTP image URL', () => {
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEYoAAAAASUVORK5CYII='

    expect(
      resolveImageSrc({
        b64_json: base64,
        url: 'http://192.0.2.1:3002/images/generated.png',
      })
    ).toBe(`data:image/png;base64,${base64}`)
  })

  it('resolves responses containing only one image source', () => {
    expect(resolveImageSrc({ url: 'https://example.com/a.png' })).toBe(
      'https://example.com/a.png'
    )
    expect(resolveImageSrc({ b64_json: 'AAAA' })).toBe(
      'data:image/png;base64,AAAA'
    )
    expect(resolveImageSrc({})).toBeNull()
  })

  it('falls back to the URL when base64 is empty', () => {
    expect(
      resolveImageSrc({ b64_json: '', url: 'https://example.com/a.png' })
    ).toBe('https://example.com/a.png')
  })
})

describe('playground configuration migration', () => {
  it('migrates the old fixed defaults and disabled common controls to automatic settings', () => {
    localStorage.setItem(
      STORAGE_KEYS.CONFIG,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        quality: 'standard',
        size: '1024x1024',
        prompt: 'private old prompt',
      })
    )
    localStorage.setItem(
      STORAGE_KEYS.PARAMETER_ENABLED,
      JSON.stringify({
        ...DEFAULT_PARAMETER_ENABLED,
        size: false,
        quality: false,
        outputFormat: false,
      })
    )
    const config = getInitialConfig()
    expect(config).toMatchObject({ quality: 'auto', size: '1:1', prompt: '' })
    expect(getInitialParameterEnabled()).toMatchObject({
      size: true,
      quality: true,
      outputFormat: true,
    })
    localStorage.removeItem(STORAGE_KEYS.CONFIG)
    localStorage.removeItem(STORAGE_KEYS.PARAMETER_ENABLED)
  })

  it('preserves dimensions and animation settings but starts the next page session in PNG', () => {
    const config = makeConfig({
      size: '2336x3520',
      quality: 'high',
      outputFormat: 'gif',
      frameCount: 12,
      frameDurationMs: 400,
      n: 4,
    })
    saveConfig(config)
    expect(getInitialConfig()).toMatchObject({
      size: '2336x3520',
      quality: 'high',
      outputFormat: 'png',
      frameCount: 12,
      frameDurationMs: 400,
      n: 4,
      prompt: '',
    })
    expect(localStorage.getItem(STORAGE_KEYS.CONFIG)).not.toContain(
      'a red apple'
    )
    localStorage.removeItem(STORAGE_KEYS.CONFIG)
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
