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
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ImageGenerationTask } from '../../history-types'
import type { GeneratedImage } from '../../types'
import { ImageResultGallery } from '../image-result-gallery'

const firstImage: GeneratedImage = {
  id: 'first',
  src: 'data:image/png;base64,first',
  prompt: 'A mountain lake',
  model: 'gpt-image-1',
  createdAt: 1,
  mode: 'generate',
}
const secondImage: GeneratedImage = {
  ...firstImage,
  id: 'second',
  src: 'data:image/png;base64,second',
  prompt: 'A forest trail',
}

function galleryProps() {
  return {
    images: [firstImage],
    isGenerating: false,
    otherModeCount: 0,
    onContinueEditing: vi.fn(),
    onRegenerate: vi.fn(),
    onRemove: vi.fn(),
    onReusePrompt: vi.fn(),
  }
}

describe('image result workbench', () => {
  it('shows the empty state after every successful batch result is removed', () => {
    render(
      <ImageResultGallery
        {...galleryProps()}
        images={[]}
        tasks={[{ id: 'removed', index: 0, status: 'success', images: [] }]}
      />
    )
    expect(screen.getByText('No images yet')).toBeVisible()
    expect(
      screen.queryByRole('group', { name: 'Image 1' })
    ).not.toBeInTheDocument()
  })

  it('keeps successful, failed and pending batch slots visible together', () => {
    const tasks: ImageGenerationTask[] = [
      { id: 'done', index: 0, status: 'success', images: [firstImage] },
      {
        id: 'failed',
        index: 1,
        status: 'failed',
        images: [],
        error: 'Model unavailable',
      },
      { id: 'pending', index: 2, status: 'pending', images: [] },
    ]
    render(
      <ImageResultGallery
        {...galleryProps()}
        tasks={tasks}
        onRetryTask={vi.fn()}
        isGenerating
      />
    )

    expect(
      within(screen.getByRole('group', { name: 'Image 1' })).getByRole('img')
    ).toHaveAttribute('src', firstImage.src)
    const failure = within(screen.getByRole('group', { name: 'Image 2' }))
    expect(failure.getByText('Model unavailable')).toBeVisible()
    expect(failure.getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(
      within(screen.getByRole('group', { name: 'Image 3' })).getByText(
        'Generating...'
      )
    ).toBeVisible()
    expect(screen.queryByText('No images yet')).not.toBeInTheDocument()
  })

  it('retries only the selected failed task from a partially successful batch', async () => {
    const user = userEvent.setup()
    const props = galleryProps()
    const failedTask: ImageGenerationTask = {
      id: 'failed',
      index: 1,
      status: 'failed',
      images: [],
      error: 'Model unavailable',
    }
    const onRetryTask = vi.fn()
    render(
      <ImageResultGallery
        {...props}
        tasks={[
          { id: 'done', index: 0, status: 'success', images: [firstImage] },
          failedTask,
        ]}
        onRetryTask={onRetryTask}
      />
    )

    await user.click(
      within(screen.getByRole('group', { name: 'Image 2' })).getByRole(
        'button',
        { name: 'Retry' }
      )
    )
    expect(onRetryTask).toHaveBeenCalledExactlyOnceWith(failedTask)
    expect(props.onRegenerate).not.toHaveBeenCalled()
  })

  it('shows an interrupted task instead of the empty state and blocks its retry during reference loading', () => {
    render(
      <ImageResultGallery
        {...galleryProps()}
        images={[]}
        tasks={[{ id: 'stopped', index: 0, status: 'interrupted', images: [] }]}
        onRetryTask={vi.fn()}
        actionsDisabled
      />
    )

    expect(screen.getByText('Image generation interrupted')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(screen.queryByText('No images yet')).not.toBeInTheDocument()
  })

  it.each([
    { isGenerating: true, actionsDisabled: false, reason: 'generating' },
    {
      isGenerating: false,
      actionsDisabled: true,
      reason: 'loading a reference',
    },
  ])(
    'disables result mutations while $reason',
    ({ isGenerating, actionsDisabled }) => {
      render(
        <ImageResultGallery
          {...galleryProps()}
          isGenerating={isGenerating}
          actionsDisabled={actionsDisabled}
        />
      )

      for (const name of [
        'Continue editing',
        'Regenerate',
        'Reuse prompt',
        'Remove',
      ]) {
        expect(screen.getByRole('button', { name })).toBeDisabled()
      }
      expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
      if (!isGenerating) {
        expect(screen.queryByText('Generating...')).not.toBeInTheDocument()
      }
    }
  )

  it('selects thumbnails by keyboard and runs actions on the selected result', async () => {
    const user = userEvent.setup()
    const props = galleryProps()
    render(<ImageResultGallery {...props} images={[firstImage, secondImage]} />)
    const next = screen.getByRole('button', { name: 'Select image 2' })
    next.focus()

    await user.keyboard('{Enter}')
    expect(next).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: 'Select image 1' })
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      within(screen.getByRole('button', { name: 'View full image' })).getByRole(
        'img'
      )
    ).toHaveAttribute('src', secondImage.src)
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(props.onRegenerate).toHaveBeenCalledWith(secondImage)
  })

  it('selects a new result when it arrives and falls back when a selected result is removed', async () => {
    const user = userEvent.setup()
    const props = galleryProps()
    const { rerender } = render(
      <ImageResultGallery {...props} images={[firstImage, secondImage]} />
    )
    await user.click(screen.getByRole('button', { name: 'Select image 2' }))
    const newest = {
      ...firstImage,
      id: 'newest',
      src: 'data:image/png;base64,newest',
    }

    rerender(
      <ImageResultGallery
        {...props}
        images={[newest, firstImage, secondImage]}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Select image 1' })
    ).toHaveAttribute('aria-pressed', 'true')
    rerender(
      <ImageResultGallery {...props} images={[firstImage, secondImage]} />
    )
    expect(
      within(screen.getByRole('button', { name: 'View full image' })).getByRole(
        'img'
      )
    ).toHaveAttribute('src', firstImage.src)
  })

  it('offers image reload after a preview error without generating another image', async () => {
    const user = userEvent.setup()
    const props = galleryProps()
    render(<ImageResultGallery {...props} />)
    const original = within(
      screen.getByRole('button', { name: 'View full image' })
    ).getByRole('img')
    fireEvent.error(original)

    expect(
      screen.getByText('Image generated, but preview failed to load')
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Reload image' }))
    const reloaded = within(
      screen.getByRole('button', { name: 'View full image' })
    ).getByRole('img')
    expect(reloaded).not.toBe(original)
    expect(reloaded).toHaveAttribute('src', firstImage.src)
    expect(props.onRegenerate).not.toHaveBeenCalled()
    fireEvent.load(reloaded)
    expect(screen.queryByText('Loading image...')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Image generated, but preview failed to load')
    ).not.toBeInTheDocument()
  })

  it('shows the empty state and other-mode hint when the selected mode has no results', () => {
    render(
      <ImageResultGallery {...galleryProps()} images={[]} otherModeCount={2} />
    )
    expect(screen.getByText('No images yet')).toBeVisible()
    expect(
      screen.getByText('2 more results belong to the other mode.')
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Regenerate' })
    ).not.toBeInTheDocument()
  })

  it('updates elapsed time while generating and shows the completed request duration', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-12T00:00:00Z'))
      const props = galleryProps()
      const { rerender } = render(
        <ImageResultGallery
          {...props}
          images={[]}
          isGenerating
          startedAt={Date.now() - 1000}
        />
      )
      expect(screen.getByText('Generating... 1s')).toBeVisible()
      act(() => vi.advanceTimersByTime(1000))
      expect(screen.getByText('Generating... 2s')).toBeVisible()

      rerender(
        <ImageResultGallery
          {...props}
          images={[{ ...firstImage, durationMs: 2200 }]}
        />
      )
      expect(screen.getByText('Completed in 2s')).toBeVisible()
      expect(screen.queryByText('Generating... 2s')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('contains the image and scrolls thumbnails and long prompt text without stretching the workbench', () => {
    const longPrompt =
      'A detailed landscape with mountains, sky, forest and a lake. '.repeat(40)
    render(
      <ImageResultGallery
        {...galleryProps()}
        images={[{ ...firstImage, prompt: longPrompt }, secondImage]}
      />
    )
    const preview = within(
      screen.getByRole('button', { name: 'View full image' })
    ).getByRole('img')
    expect(preview).toHaveClass('object-contain')
    expect(screen.getByRole('group', { name: 'Results' })).toHaveClass(
      'overflow-x-auto'
    )
    expect(screen.getByText(longPrompt.trim())).toHaveClass(
      'overflow-y-auto',
      'break-words'
    )
  })
})
