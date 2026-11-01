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
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import z from 'zod'

import { api } from '@/lib/api'

import { UserGuides } from '../index'
import type { UserGuide } from '../types'

const clients: QueryClient[] = []
const guides: UserGuide[] = [
  {
    id: 3,
    title: 'Video models',
    format: 'markdown',
    content: '## Submit a video task',
    sort_order: 1,
    enabled: true,
    created_time: 1,
    updated_time: 1,
  },
  {
    id: 5,
    title: 'Image models',
    format: 'markdown',
    content: '## Generate an image',
    sort_order: 2,
    enabled: true,
    created_time: 1,
    updated_time: 1,
  },
]

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/guide/') {
      // The list endpoint never carries guide bodies.
      return {
        data: {
          success: true,
          data: guides.map(({ content: _content, ...guide }) => guide),
        },
      }
    }
    const guide = guides.find((item) => url === `/api/guide/${item.id}`)
    return guide
      ? { data: { success: true, data: guide } }
      : { data: { success: false, message: 'Guide not found' } }
  })
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

async function setup(initialUrl = '/guides') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const page = createRoute({
    getParentRoute: () => authenticated,
    path: 'guides/',
    validateSearch: z.object({
      id: z.number().int().positive().optional().catch(undefined),
    }),
    component: UserGuides,
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([page])]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { user: userEvent.setup(), router }
}

it('opens the first guide and switches to the guide the reader picks', async () => {
  const { user, router } = await setup()
  await screen.findByRole('heading', { name: 'Submit a video task' })
  const nav = screen.getByRole('navigation', { name: 'Guides' })
  expect(
    within(nav).getByRole('button', { name: 'Video models' })
  ).toHaveAttribute('aria-current', 'page')

  await user.click(within(nav).getByRole('button', { name: 'Image models' }))
  await screen.findByRole('heading', { name: 'Generate an image' })
  expect(router.state.location.search).toEqual({ id: 5 })
  expect(
    within(nav).getByRole('button', { name: 'Image models' })
  ).toHaveAttribute('aria-current', 'page')
  expect(api.get).toHaveBeenCalledWith('/api/guide/5')
})

it('opens the guide named in the link', async () => {
  await setup('/guides?id=5')
  await screen.findByRole('heading', { name: 'Generate an image' })
  expect(api.get).not.toHaveBeenCalledWith('/api/guide/3')
})

it('falls back to the first guide when the linked guide is no longer published', async () => {
  await setup('/guides?id=99')
  await screen.findByRole('heading', { name: 'Submit a video task' })
  expect(api.get).not.toHaveBeenCalledWith('/api/guide/99')
})

it('shows an empty state when nothing is published', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } })
  await setup()
  await screen.findByText('No guides yet')
  expect(
    screen.queryByRole('navigation', { name: 'Guides' })
  ).not.toBeInTheDocument()
})

it('shows the server error when the list cannot be loaded', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { success: false, message: 'Database unavailable' },
  })
  await setup()
  await screen.findByText('Database unavailable')
  expect(screen.queryByText('No guides yet')).not.toBeInTheDocument()
})
