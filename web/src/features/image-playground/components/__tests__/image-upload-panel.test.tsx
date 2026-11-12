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
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useImageUploads } from '../../hooks/use-image-uploads'
import { ImageUploadPanel } from '../image-upload-panel'

function UploadWorkbench(props: { disabled?: boolean }) {
  const uploads = useImageUploads()
  return (
    <ImageUploadPanel
      compact
      disabled={props.disabled}
      images={uploads.images}
      mask={uploads.mask}
      onAddImages={uploads.addImages}
      onClearImages={uploads.clearImages}
      onClearMask={uploads.clearMask}
      onMoveImage={uploads.moveImage}
      onRemoveImage={uploads.removeImage}
      onSetMask={uploads.setMaskFile}
    />
  )
}

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
    revokeObjectURL: vi.fn(),
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('image reference inputs', () => {
  it('pastes image files into references while leaving ordinary text paste untouched', () => {
    render(<UploadWorkbench />)
    const zone = screen.getByRole('group', {
      name: 'Click, drop or paste reference images',
    })
    const file = new File(['image'], 'reference.png', { type: 'image/png' })

    expect(fireEvent.paste(zone, { clipboardData: { files: [file] } })).toBe(
      false
    )
    expect(screen.getByRole('img', { name: 'reference.png' })).toBeVisible()
    expect(fireEvent.paste(zone, { clipboardData: { files: [] } })).toBe(true)
  })

  it('moves references using the keyboard and disables moves beyond either edge', async () => {
    const user = userEvent.setup()
    render(<UploadWorkbench />)
    const zone = screen.getByRole('group', {
      name: 'Click, drop or paste reference images',
    })
    fireEvent.drop(zone, {
      dataTransfer: {
        files: ['first.png', 'second.png'].map(
          (name) => new File(['image'], name, { type: 'image/png' })
        ),
      },
    })

    expect(
      screen.getByRole('button', { name: 'Move first.png earlier' })
    ).toBeDisabled()
    const moveLater = screen.getByRole('button', {
      name: 'Move first.png later',
    })
    moveLater.focus()
    await user.keyboard('{Enter}')

    expect(
      screen.getAllByRole('img').map((image) => image.getAttribute('alt'))
    ).toEqual(['second.png', 'first.png'])
    expect(
      screen.getByRole('button', { name: 'Move first.png later' })
    ).toBeDisabled()
  })

  it('keeps references in one compact strip without extra mask or clear controls', () => {
    render(<UploadWorkbench />)
    const zone = screen.getByRole('group', {
      name: 'Click, drop or paste reference images',
    })
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [new File(['image'], 'reference.png', { type: 'image/png' })],
      },
    })
    expect(zone).toHaveClass('min-h-24', 'overflow-x-auto')
    const image = screen.getByRole('img', { name: 'reference.png' })
    expect(image).toHaveClass('object-cover')
    expect(image.parentElement?.parentElement).toHaveClass('size-20')
    expect(screen.getByText('Image 1')).toBeVisible()
    expect(screen.queryByText('Mask (optional)')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Clear all' })
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByLabelText('Upload reference images', { selector: 'input' })
    ).toHaveLength(1)
  })
  it('rejects paste and drop while generation disables reference changes', () => {
    render(<UploadWorkbench disabled />)
    const zone = screen.getByRole('group', {
      name: 'Click, drop or paste reference images',
    })
    const file = new File(['image'], 'ignored.png', { type: 'image/png' })
    fireEvent.paste(zone, { clipboardData: { files: [file] } })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })

    expect(zone).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('disables reordering and removing uploaded references during generation', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<UploadWorkbench />)
    await user.upload(
      screen.getByLabelText('Upload reference images', {
        selector: 'input',
      }),
      ['first.png', 'second.png'].map(
        (name) => new File(['image'], name, { type: 'image/png' })
      )
    )

    rerender(<UploadWorkbench disabled />)
    expect(screen.getAllByRole('img')).toHaveLength(2)
    for (const button of screen.getAllByRole('button', {
      name: /^(Move|Remove|Clear all)/,
    })) {
      expect(button).toBeDisabled()
    }
  })

  it('uploads GIF references with their original file type', async () => {
    const user = userEvent.setup()
    render(<UploadWorkbench />)
    await user.upload(
      screen.getByLabelText('Upload reference images', { selector: 'input' }),
      new File(['GIF89a'], 'animated.gif', { type: 'image/gif' })
    )
    expect(screen.getByRole('img', { name: 'animated.gif' })).toBeVisible()
  })

  it('reads a reference from the clipboard button and reports permission failure without changing references', async () => {
    const user = userEvent.setup()
    const read = vi.fn().mockResolvedValue([
      {
        types: ['image/png'],
        getType: async () => new Blob(['reference'], { type: 'image/png' }),
      },
    ])
    Object.defineProperty(navigator.clipboard, 'read', {
      configurable: true,
      value: read,
    })
    render(<UploadWorkbench />)
    await user.click(screen.getByRole('button', { name: 'Clipboard' }))
    expect(
      await screen.findByRole('img', { name: 'reference-1.png' })
    ).toBeVisible()
    read.mockRejectedValue(new Error('Permission denied'))
    await user.click(screen.getByRole('button', { name: 'Clipboard' }))
    expect(
      await screen.findByText(
        'Unable to read the clipboard. Paste an image here instead.'
      )
    ).toBeVisible()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })
})
