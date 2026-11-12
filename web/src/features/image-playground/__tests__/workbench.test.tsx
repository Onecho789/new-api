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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ImagePlayground } from '..'
import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import type {
  GeneratedImage,
  ImagePlaygroundConfig,
  UploadedImage,
} from '../types'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  stop: vi.fn(),
  setMode: vi.fn(),
  restoreConfig: vi.fn(),
  resetSession: vi.fn(),
  mobile: false,
  updateConfig: vi.fn(),
  addImages: vi.fn(),
  replaceImages: vi.fn(),
  clearMask: vi.fn(),
  setError: vi.fn(),
  imageSrcToFile: vi.fn(),
  isGenerating: false,
  apiKey: 'test-key',
  images: [] as GeneratedImage[],
  uploadedImages: [] as UploadedImage[],
  generationConfig: null as ImagePlaygroundConfig | null,
}))

vi.mock('@/hooks/use-media-query', () => ({
  useMediaQuery: () => mocks.mobile,
}))

vi.mock('../hooks', () => ({
  useImagePlaygroundState: () => ({
    config: { ...DEFAULT_CONFIG, prompt: 'A paper lantern' },
    parameterEnabled: DEFAULT_PARAMETER_ENABLED,
    updateConfig: mocks.updateConfig,
    setMode: mocks.setMode,
    restoreConfig: mocks.restoreConfig,
    resetSession: mocks.resetSession,
    updateParameterEnabled: vi.fn(),
    apiKey: mocks.apiKey,
    setApiKey: vi.fn(),
    rememberApiKey: false,
    setRememberApiKey: vi.fn(),
  }),
  useImageModels: () => ({ models: [], imageModels: [], isLoading: false }),
  useImageUploads: () => ({
    images: mocks.uploadedImages,
    mask: null,
    uploadError: null,
    addImages: mocks.addImages,
    replaceImages: mocks.replaceImages,
    removeImage: vi.fn(),
    moveImage: vi.fn(),
    clearImages: vi.fn(),
    setMaskFile: vi.fn(),
    clearMask: mocks.clearMask,
  }),
  useImageGeneration: (options: { config: ImagePlaygroundConfig }) => {
    mocks.generationConfig = options.config
    return {
      images: mocks.images,
      tasks: [],
      retryTask: vi.fn(),
      history: [],
      historyLoading: false,
      historyError: null,
      activeHistoryId: null,
      selectHistory: vi.fn(),
      newSession: vi.fn(),
      deleteHistory: vi.fn(),
      isGenerating: mocks.isGenerating,
      startedAt: null,
      error: null,
      generate: mocks.generate,
      regenerate: vi.fn(),
      setError: mocks.setError,
      stop: mocks.stop,
      clearImages: vi.fn(),
      removeImage: vi.fn(),
    }
  },
}))

vi.mock('../lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib')>()),
  imageSrcToFile: mocks.imageSrcToFile,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isGenerating = false
  mocks.mobile = false
  mocks.apiKey = 'test-key'
  mocks.images = []
  mocks.uploadedImages = []
  mocks.imageSrcToFile.mockResolvedValue(
    new File(['image'], 'result.png', { type: 'image/png' })
  )
})

describe('image workbench composition', () => {
  it('keeps credentials in the header dialog and opens it when generating without a key', async () => {
    mocks.apiKey = ''
    const view = render(<ImagePlayground />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText('API Key', { selector: 'input' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(
      screen.getByRole('dialog', { name: 'Request settings' })
    ).toBeVisible()
    expect(mocks.generate).not.toHaveBeenCalled()
    mocks.apiKey = 'local-test-only'
    view.rerender(<ImagePlayground />)
    expect(
      screen.getByRole('dialog', { name: 'Request settings' })
    ).toBeVisible()
  })
  it('clears the previous mask when continuing with a generated image', async () => {
    mocks.images = [
      {
        id: 'result',
        src: 'data:image/png;base64,aQ==',
        prompt: 'A paper lantern',
        model: 'gpt-image-2',
        mode: 'generate',
        createdAt: 1,
      },
    ]
    render(<ImagePlayground />)
    fireEvent.load(screen.getByAltText('A paper lantern'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue editing' })
    )
    await waitFor(() => expect(mocks.replaceImages).toHaveBeenCalled())
    expect(mocks.clearMask).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveFocus()
    )
  })

  it('locks input actions while loading a result for editing and restores focus afterward', async () => {
    let resolveFile!: (file: File) => void
    mocks.imageSrcToFile.mockImplementation(
      () =>
        new Promise<File>((resolve) => {
          resolveFile = resolve
        })
    )
    mocks.images = [
      {
        id: 'result',
        src: '/generated.png',
        prompt: 'A paper lantern',
        model: 'gpt-image-2',
        mode: 'generate',
        createdAt: 1,
      },
    ]
    render(<ImagePlayground />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue editing' })
    )
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reuse prompt' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    resolveFile(new File(['image'], 'result.png', { type: 'image/png' }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveFocus()
    )
    expect(
      screen.getByRole('button', { name: 'Continue editing' })
    ).toBeEnabled()
  })

  it('submits with Ctrl+Enter but leaves ordinary Enter and IME composition alone', () => {
    render(<ImagePlayground />)
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    fireEvent.keyDown(prompt, { key: 'Enter' })
    fireEvent.keyDown(prompt, {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    })
    expect(mocks.generate).not.toHaveBeenCalled()
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true })
    expect(mocks.generate).toHaveBeenCalledOnce()
  })

  it('adds pasted reference images without sending a request', () => {
    render(<ImagePlayground />)
    const file = new File(['reference'], 'reference.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox', { name: 'Prompt' }), {
      clipboardData: { files: [file] },
    })
    expect(mocks.addImages).toHaveBeenCalledWith([file])
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('chooses the edit endpoint automatically when accepted reference images exist', () => {
    mocks.uploadedImages = [
      {
        id: 'reference',
        file: new File(['gif'], 'reference.gif', { type: 'image/gif' }),
        objectUrl: 'blob:reference',
      },
    ]
    const { unmount } = render(<ImagePlayground />)
    expect(mocks.generationConfig?.mode).toBe('edit')
    unmount()
    mocks.uploadedImages = []
    render(<ImagePlayground />)
    expect(mocks.generationConfig?.mode).toBe('generate')
  })

  it('shows one model picker with no custom-name or advanced controls', () => {
    render(<ImagePlayground />)
    expect(screen.getAllByRole('combobox', { name: 'Model' })).toHaveLength(1)
    expect(screen.queryByText('Custom name')).not.toBeInTheDocument()
    expect(screen.queryByText('Advanced parameters')).not.toBeInTheDocument()
    expect(screen.queryByText('Mask (optional)')).not.toBeInTheDocument()
  })

  it('opens mobile parameters in a bottom drawer without duplicate controls', async () => {
    mocks.mobile = true
    render(<ImagePlayground />)
    expect(
      screen.queryByRole('combobox', { name: 'Model' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('group', { name: 'Quality' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Adjust' }))
    expect(screen.getByRole('dialog', { name: 'Parameters' })).toBeVisible()
    expect(screen.getAllByRole('combobox', { name: 'Model' })).toHaveLength(1)
    expect(screen.getAllByRole('group', { name: 'Quality' })).toHaveLength(1)
  })

  it('resets the output defaults when starting a new session', async () => {
    render(<ImagePlayground />)
    await userEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(mocks.resetSession).toHaveBeenCalledOnce()
    expect(mocks.clearMask).toHaveBeenCalledOnce()
  })
  it('offers Stop and blocks submit and reference uploads while a request is pending', () => {
    mocks.isGenerating = true
    render(<ImagePlayground />)
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt' }), {
      key: 'Enter',
      metaKey: true,
    })
    expect(mocks.generate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(mocks.stop).toHaveBeenCalledOnce()
  })

  it('uses the reference history and compose widths with separate wide-screen scroll regions', () => {
    render(<ImagePlayground />)
    const input = screen.getByRole('region', { name: 'Image workbench' })
    const results = screen.getByRole('region', { name: 'Results' })
    expect(input).toHaveClass('@6xl/content:overflow-y-auto')
    expect(results).toHaveClass('@6xl/content:overflow-y-auto')
    expect(input.parentElement).toHaveClass(
      '@6xl/content:grid-cols-[420px_minmax(0,1fr)]'
    )
    expect(input.parentElement?.parentElement).toHaveClass(
      '@4xl/content:grid-cols-[300px_minmax(0,1fr)]'
    )
  })
})
