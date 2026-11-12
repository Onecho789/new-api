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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import type { ImageHistoryEntry } from '../../history-types'
import { ImageHistoryPanel } from '../image-history-panel'

const entries: ImageHistoryEntry[] = ['A tree', 'A lake'].map(
  (prompt, index) => ({
    id: `entry-${index}`,
    createdAt: 1000 + index,
    status: 'success',
    config: { ...DEFAULT_CONFIG, prompt },
    parameterEnabled: { ...DEFAULT_PARAMETER_ENABLED },
    requestSnapshot: { model: 'gpt-image-2', prompt, n: 1 },
    images: [],
    tasks: [],
    imageCount: 1,
    successCount: 1,
    failCount: 0,
    durationMs: 1200,
  })
)

describe('image history panel', () => {
  it('selects all sessions and deletes them only after confirming', async () => {
    const user = userEvent.setup()
    const remove = vi.fn().mockResolvedValue(true)
    render(
      <ImageHistoryPanel
        entries={entries}
        onSelect={vi.fn()}
        onNewSession={vi.fn()}
        onDelete={remove}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Select all' }))
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeChecked()
    }
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(remove).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog).getByText(
        'This deletes 2 sessions and their saved images from this browser.'
      )
    ).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(remove).toHaveBeenCalledWith(['entry-0', 'entry-1'])
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('restores the selected session and creates a blank session through distinct actions', async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    const create = vi.fn()
    render(
      <ImageHistoryPanel
        entries={entries}
        activeId='entry-0'
        onSelect={select}
        onNewSession={create}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /A tree/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.click(screen.getByRole('button', { name: /A lake/ }))
    expect(select).toHaveBeenCalledWith(entries[1])
    await user.click(screen.getByRole('button', { name: 'New session' }))
    expect(create).toHaveBeenCalledOnce()
  })

  it('disables session changes and deletion during generation', () => {
    render(
      <ImageHistoryPanel
        entries={entries}
        disabled
        onSelect={vi.fn()}
        onNewSession={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    }
  })
})
