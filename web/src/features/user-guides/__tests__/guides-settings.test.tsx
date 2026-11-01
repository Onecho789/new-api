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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster, toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { GuidesSettingsSection } from '../components/guides-settings-section'
import type { UserGuide } from '../types'

const clients: QueryClient[] = []
let guides: UserGuide[]

beforeEach(() => {
  guides = [
    {
      id: 3,
      title: 'Video models',
      format: 'html',
      content: '<p>Submit a video task</p>',
      sort_order: 4,
      enabled: false,
      created_time: 1,
      updated_time: 1,
    },
  ]
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/guide/admin/') {
      return {
        data: {
          success: true,
          data: guides.map(({ content: _content, ...guide }) => guide),
        },
      }
    }
    const guide = guides.find((item) => url === `/api/guide/admin/${item.id}`)
    return { data: { success: true, data: guide } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
    const created = { ...(body as UserGuide), id: 8 }
    guides = [...guides, created]
    return { data: { success: true, data: created } }
  })
  vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
    guides = guides.map((item) =>
      url === `/api/guide/admin/${item.id}`
        ? { ...(body as UserGuide), id: item.id }
        : item
    )
    return { data: { success: true, data: guides[0] } }
  })
  vi.spyOn(api, 'delete').mockImplementation(async () => {
    guides = []
    return { data: { success: true } }
  })
})

afterEach(() => {
  cleanup()
  toast.dismiss()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

async function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <GuidesSettingsSection />
      <Toaster />
    </QueryClientProvider>
  )
  await screen.findByRole('row', { name: /Video models/ })
  return userEvent.setup()
}

it('lists drafts with their format, order and publish state', async () => {
  await setup()
  const row = screen.getByRole('row', { name: /Video models/ })
  expect(within(row).getByText('HTML')).toBeInTheDocument()
  expect(within(row).getByText('4')).toBeInTheDocument()
  expect(within(row).getByText('Unpublished')).toBeInTheDocument()
})

it('creates a published Markdown guide placed after the existing ones', async () => {
  const user = await setup()
  await user.click(screen.getByRole('button', { name: 'Create guide' }))
  const dialog = screen.getByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Guide title' }),
    '  Image models  '
  )
  fireEvent.change(
    within(dialog).getByRole('textbox', { name: 'Guide content' }),
    {
      target: { value: '## Generate an image' },
    }
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  await screen.findByRole('row', { name: /Image models/ })
  expect(api.post).toHaveBeenCalledWith('/api/guide/admin/', {
    title: 'Image models',
    format: 'markdown',
    content: '## Generate an image',
    sort_order: 5,
    enabled: true,
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps an empty guide local and shows both field errors', async () => {
  const user = await setup()
  await user.click(screen.getByRole('button', { name: 'Create guide' }))
  const dialog = screen.getByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Guide title' }),
    '   '
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await within(dialog).findByText('Guide title is required')
  expect(
    within(dialog).getByText('Guide content is required')
  ).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('loads the full body before editing and saves it to the same guide', async () => {
  const user = await setup()
  const row = screen.getByRole('row', { name: /Video models/ })
  await user.click(within(row).getByRole('button', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog')
  const content = within(dialog).getByRole('textbox', { name: 'Guide content' })
  expect(content).toHaveValue('<p>Submit a video task</p>')
  expect(api.get).toHaveBeenCalledWith('/api/guide/admin/3')

  fireEvent.change(content, { target: { value: '<p>Poll the task</p>' } })
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await screen.findByText('Guide saved successfully')
  expect(api.put).toHaveBeenCalledWith('/api/guide/admin/3', {
    title: 'Video models',
    format: 'html',
    content: '<p>Poll the task</p>',
    sort_order: 4,
    enabled: false,
  })
  expect(api.post).not.toHaveBeenCalled()
})

it('deletes a guide only after confirmation', async () => {
  const user = await setup()
  const row = screen.getByRole('row', { name: /Video models/ })
  await user.click(within(row).getByRole('button', { name: 'Open menu' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(
    within(dialog).getByText(
      'Delete “Video models”? This action cannot be undone.'
    )
  ).toBeInTheDocument()
  expect(api.delete).not.toHaveBeenCalled()

  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await screen.findByText('No guides yet. Click "Create guide" to add one.')
  expect(api.delete).toHaveBeenCalledWith('/api/guide/admin/3')
})
