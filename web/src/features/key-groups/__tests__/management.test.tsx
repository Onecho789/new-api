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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster, toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { KeyGroups } from '../index'
import type { TokenCategory } from '../types'

const clients: QueryClient[] = []
const category: TokenCategory = {
  id: 7,
  name: 'Production',
  created_time: 1,
  token_count: 3,
}
let categories: TokenCategory[]

beforeEach(() => {
  categories = [{ ...category }]
  localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: { success: true, data: [...categories] },
  }))
  vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
    const created = {
      id: 8,
      name: (body as { name: string }).name,
      created_time: 2,
      token_count: 0,
    }
    categories = [...categories, created]
    return { data: { success: true, data: created } }
  })
  vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
    categories = categories.map((item) =>
      url.endsWith(`/${item.id}`)
        ? { ...item, name: (body as { name: string }).name }
        : item
    )
    return { data: { success: true, data: categories[0] } }
  })
  vi.spyOn(api, 'delete').mockImplementation(async () => {
    categories = []
    return { data: { success: true } }
  })
})

afterEach(() => {
  cleanup()
  toast.dismiss()
  clients.splice(0).forEach((client) => client.clear())
  localStorage.clear()
})

async function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['keys', 1], { items: [], total: 0 })
  clients.push(client)
  const root = createRootRoute()
  const categoriesRoute = createRoute({
    getParentRoute: () => root,
    path: '/key-groups',
    component: KeyGroups,
  })
  const keysRoute = createRoute({
    getParentRoute: () => root,
    path: '/keys',
    component: () => <h1>Keys destination</h1>,
    validateSearch: (search) => ({ category_id: Number(search.category_id) }),
  })
  const router = createRouter({
    routeTree: root.addChildren([categoriesRoute, keysRoute]),
    history: createMemoryHistory({ initialEntries: ['/key-groups'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  )
  await screen.findByRole('heading', { name: 'Key Groups' })
  return { user: userEvent.setup(), client, router }
}

it('shows the category name and key count, then opens the filtered key list', async () => {
  const { user, router } = await setup()
  const row = await screen.findByRole('row', { name: /Production/ })
  expect(within(row).getByRole('cell', { name: '3' })).toBeInTheDocument()
  const link = within(row).getByRole('link', { name: 'View API keys' })
  expect(link).toHaveAttribute('href', '/keys?category_id=7')
  await user.click(link)
  await screen.findByRole('heading', { name: 'Keys destination' })
  expect(router.state.location.search).toEqual({ category_id: 7 })
})

it('creates a trimmed category using keyboard submission and refreshes the list', async () => {
  const { user, client } = await setup()
  await user.click(screen.getByRole('button', { name: 'Create key category' }))
  const input = screen.getByRole('textbox', { name: 'Category name' })
  await user.type(input, '  Staging  ')
  await user.keyboard('{Enter}')
  await screen.findByRole('row', { name: /Staging/ })
  expect(api.post).toHaveBeenCalledWith('/api/token/categories', {
    name: 'Staging',
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(client.getQueryState(['keys', 1])?.isInvalidated).toBe(true)
})

it.each([
  ['   ', 'Category name is required'],
  ['名'.repeat(65), 'Category name must be at most 64 characters'],
])(
  'keeps invalid category name %s local and exposes the field error',
  async (name, message) => {
    const { user } = await setup()
    await user.click(
      screen.getByRole('button', { name: 'Create key category' })
    )
    const input = screen.getByRole('textbox', { name: 'Category name' })
    fireEvent.change(input, { target: { value: name } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(message)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(api.post).not.toHaveBeenCalled()
  }
)

it('accepts a 64-code-point category name and keeps long names available in the list', async () => {
  const { user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Create key category' }))
  const name = '🔑'.repeat(64)
  fireEvent.change(screen.getByRole('textbox', { name: 'Category name' }), {
    target: { value: name },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(name)).toHaveClass(
    'break-all',
    'whitespace-normal'
  )
  expect(api.post).toHaveBeenCalledWith('/api/token/categories', { name })
})

it('prefills the current name and renames only the selected category', async () => {
  categories.push({ ...category, id: 9, name: 'Staging', token_count: 1 })
  const { user } = await setup()
  const row = await screen.findByRole('row', { name: /Production/ })
  await user.click(within(row).getByRole('button', { name: 'Rename' }))
  const input = screen.getByRole('textbox', { name: 'Category name' })
  expect(input).toHaveValue('Production')
  await user.clear(input)
  await user.type(input, 'Live')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('row', { name: /Live/ })
  expect(screen.getByRole('row', { name: /Staging/ })).toBeInTheDocument()
  expect(api.put).toHaveBeenCalledWith('/api/token/categories/7', {
    name: 'Live',
  })
  expect(api.post).not.toHaveBeenCalled()
})

it('keeps duplicate-name server failures visible without closing the editor', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { success: false, message: 'Category already exists' },
  })
  const { user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Create key category' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Category name' }),
    'Production'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Category already exists')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Category name' })).toHaveValue(
    'Production'
  )
})

it('disables saving and dismissal until the pending request completes', async () => {
  let resolve: ((response: { data: { success: boolean } }) => void) | undefined
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const { user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Create key category' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Category name' }),
    'Staging'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByRole('button', { name: 'Saving...' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await act(async () => resolve?.({ data: { success: true } }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it('keeps keys untouched when deletion is cancelled, then confirms uncategorization before deletion', async () => {
  const { user, client } = await setup()
  const row = await screen.findByRole('row', { name: /Production/ })
  await user.click(within(row).getByRole('button', { name: 'Delete' }))
  let dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent(
    'Its API keys will become uncategorized and will not be deleted.'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(api.delete).not.toHaveBeenCalled()
  await user.click(within(row).getByRole('button', { name: 'Delete' }))
  dialog = screen.getByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await screen.findByText('No key categories')
  expect(api.delete).toHaveBeenCalledExactlyOnceWith('/api/token/categories/7')
  expect(api.post).not.toHaveBeenCalled()
  expect(client.getQueryState(['keys', 1])?.isInvalidated).toBe(true)
})

it('retains the category and confirmation when deleting fails', async () => {
  vi.mocked(api.delete).mockRejectedValue(new Error('Deletion failed'))
  const { user } = await setup()
  const row = await screen.findByRole('row', { name: /Production/ })
  await user.click(within(row).getByRole('button', { name: 'Delete' }))
  const dialog = screen.getByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await screen.findByText('Deletion failed')
  expect(dialog).toBeInTheDocument()
  expect(row).toHaveTextContent('Production')
})

it('shows a retryable error for a failed list response instead of an empty list', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({
    data: { success: false, message: 'Load failed' },
  })
  const { user } = await setup()
  await screen.findByText('Load failed')
  expect(screen.queryByText('No key categories')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('row', { name: /Production/ })
})

it('avoids displaying an empty list until loading completes', async () => {
  let resolve:
    | ((response: {
        data: { success: boolean; data: TokenCategory[] }
      }) => void)
    | undefined
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  await setup()
  expect(screen.queryByText('No key categories')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Rename' })
  ).not.toBeInTheDocument()
  await act(async () => resolve?.({ data: { success: true, data: [] } }))
  await screen.findByText('No key categories')
  expect(
    screen.getByRole('button', { name: 'Create key category' })
  ).toBeEnabled()
})

it('shows the category actions and key count in the mobile list', async () => {
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query.includes('max-width') || original(query).matches,
  }))
  await setup()
  await screen.findByText('Production')
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View API keys' })).toHaveAttribute(
    'href',
    '/keys?category_id=7'
  )
  expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
})
