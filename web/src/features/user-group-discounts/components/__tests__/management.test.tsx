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
import type { Row } from '@tanstack/react-table'
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
import { afterEach, expect, it, vi } from 'vitest'

import { DataTableRowActions } from '@/features/users/components/data-table-row-actions'
import { UsersProvider } from '@/features/users/components/users-provider'
import type { User } from '@/features/users/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { UserGroupDiscounts } from '../../index'
import type {
  AdminUserGroupDiscount,
  AdminUserGroupDiscountsParams,
} from '../../types'

const rule: AdminUserGroupDiscount = {
  id: 1,
  user_id: 2,
  username: 'customer',
  display_name: 'Customer',
  user_role: 1,
  group: 'vip',
  ratio: 0.005,
  min_daily_quota: 500000,
  enabled: true,
  version: 1,
  today_quota: 250000,
  today_pending: 0,
  status: 'active',
  enabled_at: 1794412800,
  disabled_at: 0,
  disable_reason: '',
  last_check_day: '2026-11-12',
  last_check_at: 1794499800,
  last_check_quota: 1000000,
  last_check_status: 'passed',
}
const clients: QueryClient[] = []

function renderPage(
  options: {
    userId?: number
    viewerId?: number
    fail?: boolean
    role?: number
    items?: AdminUserGroupDiscount[]
    page2?: AdminUserGroupDiscount[]
    total?: number
  } = {}
) {
  useAuthStore.getState().auth.setUser({
    id: options.viewerId ?? 1,
    username: 'operator',
    role: options.role ?? 100,
  })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === '/api/status') return { data: { success: true, data: {} } }
    if (url === '/api/group/') {
      return { data: { success: true, data: ['default', 'vip', 'svip'] } }
    }
    if (url === '/api/user/group-ratios') {
      if (options.fail) throw new Error('Discount list unavailable')
      const params = config?.params as AdminUserGroupDiscountsParams | undefined
      const items =
        params?.p === 2
          ? (options.page2 ?? [])
          : (options.items ?? [
              rule,
              {
                ...rule,
                id: 2,
                group: 'svip',
                status: 'manually_disabled',
                enabled: false,
              },
            ])
      return {
        data: {
          success: true,
          data: {
            items: items.map((item) => ({ ...item })),
            total: options.total ?? 21,
            p: params?.p ?? 1,
            page_size: 20,
            day: '2026-11-13',
            timezone: 'Asia/Shanghai',
          },
        },
      }
    }
    if (url === '/api/user/2/group-ratios') {
      return {
        data: {
          success: true,
          data: {
            user_id: 2,
            rules: [rule],
            day: '2026-11-13',
            timezone: 'Asia/Shanghai',
          },
        },
      }
    }
    if (url.startsWith('/api/user/search?')) {
      return {
        data: {
          success: true,
          data: {
            items: [
              {
                id: 2,
                username: 'customer',
                display_name: 'Customer',
                role: 1,
              },
              { id: 3, username: 'admin', display_name: 'Admin', role: 10 },
              { id: 4, username: 'root', display_name: 'Root', role: 100 },
            ],
            total: 3,
          },
        },
      }
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <UserGroupDiscounts userId={options.userId} />
    </QueryClientProvider>
  )
  return { get, client }
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.useRealTimers()
  useAuthStore.getState().auth.reset()
})

it('shows Beijing validity periods and distinguishes scheduled, expired and unassessed discounts', async () => {
  const start = Date.UTC(2030, 0, 1) / 1000
  renderPage({
    items: [
      {
        ...rule,
        starts_at: start,
        ends_at: start + 7200,
        daily_check_enabled: false,
        min_daily_quota: 0,
        status: 'scheduled',
      },
      {
        ...rule,
        id: 2,
        group: 'svip',
        starts_at: start - 7200,
        ends_at: start,
        status: 'expired',
      },
    ],
    total: 2,
  })
  expect(await screen.findByText('Not started')).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'Validity period (Beijing time)' })
  ).toBeVisible()
  expect(screen.getByText('Expired')).toBeVisible()
  expect(screen.getByText('Daily assessment off')).toBeVisible()
  const times = document.querySelectorAll('time')
  expect(
    [...times].some(
      (time) =>
        time.dateTime === '2030-01-01T00:00:00.000Z' &&
        /8:00/.test(time.textContent ?? '')
    )
  ).toBe(true)
})

it.each([
  ['Not started', 'scheduled'],
  ['Expired', 'expired'],
])('filters %s discounts using the server status', async (label, status) => {
  const { get } = renderPage()
  await screen.findByText('vip')
  await userEvent.click(screen.getByRole('button', { name: 'Status' }))
  await userEvent.click(screen.getByRole('option', { name: label }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/api/user/group-ratios',
      expect.objectContaining({ params: expect.objectContaining({ status }) })
    )
  )
})

it('refreshes at schedule boundaries before the regular polling interval', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
  const start = Math.floor(Date.now() / 1000) + 2
  const options = {
    items: [
      {
        ...rule,
        starts_at: start,
        ends_at: start + 2,
        status: 'scheduled' as const,
      } as AdminUserGroupDiscount,
    ],
    total: 1,
  }
  let get!: ReturnType<typeof renderPage>['get']
  await act(async () => {
    get = renderPage(options).get
    await vi.advanceTimersByTimeAsync(0)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.getByText('Not started')).toBeVisible()
  options.items[0] = { ...options.items[0], status: 'grace_period' }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2001)
  })
  expect(screen.getByText('Activation day exempt')).toBeVisible()
  options.items[0] = { ...options.items[0], status: 'expired' }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2001)
  })
  expect(screen.getByText('Expired')).toBeVisible()
  expect(
    get.mock.calls.filter(([url]) => url === '/api/user/group-ratios')
  ).toHaveLength(3)
})

it('refreshes an activation-day exemption at Beijing midnight', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2030-01-01T15:59:58Z'))
  const options = {
    items: [
      {
        ...rule,
        starts_at: Date.UTC(2029, 11, 31) / 1000,
        enabled_at: Date.UTC(2030, 0, 1) / 1000,
        status: 'grace_period' as const,
      } as AdminUserGroupDiscount,
    ],
    total: 1,
  }
  await act(async () => {
    renderPage(options)
    await vi.advanceTimersByTimeAsync(0)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.getByText('Activation day exempt')).toBeVisible()
  options.items[0] = { ...options.items[0], status: 'active' }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2001)
  })
  expect(screen.getByText('Discount active')).toBeVisible()
})

it('confirms the exact user and group, permits cancellation and deletes only once while pending', async () => {
  const options = {
    items: [rule, { ...rule, id: 2, group: 'svip' }],
    total: 2,
    viewerId: 2,
  }
  let resolveDelete!: () => void
  const pending = new Promise<void>((resolve) => {
    resolveDelete = resolve
  })
  const del = vi.spyOn(api, 'delete').mockImplementation(async () => {
    await pending
    options.items = options.items.filter((item) => item.group !== 'vip')
    options.total = 1
    return {
      data: {
        success: true,
        data: {
          user_id: 2,
          rules: options.items,
          day: '2026-11-13',
          timezone: 'Asia/Shanghai',
        },
      },
    }
  })
  const { get, client } = renderPage(options)
  for (const key of [
    ['user-group-ratios', 2],
    ['pricing'],
    ['user-groups'],
    ['playground-groups'],
  ]) {
    client.setQueryData(key, { saved: true })
  }
  await screen.findByText('svip')
  await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
  const first = within(
    await screen.findByRole('alertdialog', { name: 'Delete group discount' })
  )
  expect(first.getByText(/customer.*ID: 2.*vip/)).toBeVisible()
  expect(
    first.getByText(
      'New requests will use the applicable regular multiplier. Historical spending and in-flight requests are preserved.'
    )
  ).toBeVisible()
  await userEvent.click(first.getByRole('button', { name: 'Cancel' }))
  expect(del).not.toHaveBeenCalled()
  await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
  const dialog = within(
    await screen.findByRole('alertdialog', { name: 'Delete group discount' })
  )
  const confirm = dialog.getByRole('button', { name: 'Delete' })
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  await waitFor(() => expect(del).toHaveBeenCalledTimes(1))
  expect(del).toHaveBeenCalledWith('/api/user/2/group-ratios', {
    data: { group: 'vip', version: 1 },
  })
  expect(dialog.getByRole('button', { name: 'Deleting...' })).toBeDisabled()
  expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog')).toBeVisible()
  await act(async () => resolveDelete())
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(screen.queryByText('vip')).not.toBeInTheDocument()
  expect(screen.getByText('svip')).toBeVisible()
  expect(
    get.mock.calls.filter(([url]) => url === '/api/user/group-ratios').length
  ).toBeGreaterThan(1)
  for (const key of [
    ['user-group-ratios', 2],
    ['pricing'],
    ['user-groups'],
    ['playground-groups'],
  ]) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
  }
})

it('retains the delete confirmation and original server error after failure, then allows a deliberate retry', async () => {
  const options = { items: [rule], total: 1 }
  const del = vi
    .spyOn(api, 'delete')
    .mockRejectedValueOnce(new Error('Discount deletion unavailable'))
    .mockImplementationOnce(async () => {
      options.items = []
      options.total = 0
      return {
        data: {
          success: true,
          data: {
            user_id: 2,
            rules: [],
            day: '2026-11-13',
            timezone: 'Asia/Shanghai',
          },
        },
      }
    })
  renderPage(options)
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  const dialog = within(await screen.findByRole('alertdialog'))
  await userEvent.click(dialog.getByRole('button', { name: 'Delete' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(
    'Discount deletion unavailable'
  )
  expect(dialog.getByRole('button', { name: 'Delete' })).toBeEnabled()
  await userEvent.click(dialog.getByRole('button', { name: 'Delete' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(del).toHaveBeenCalledTimes(2)
  expect(screen.getByText('No group discounts configured')).toBeVisible()
})

it('locks a conflicted deletion to the originally confirmed version instead of deleting the refreshed rule', async () => {
  const options = { items: [rule], total: 1 }
  const message = 'Group discount changed. Reload it before saving again.'
  const del = vi.spyOn(api, 'delete').mockImplementation(async () => {
    options.items = [{ ...rule, version: 2, ratio: 0.5 }]
    throw { response: { status: 409, data: { success: false, message } } }
  })
  renderPage(options)
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  const dialog = within(await screen.findByRole('alertdialog'))
  await userEvent.click(dialog.getByRole('button', { name: 'Delete' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(message)
  expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled()
  expect(
    dialog.getByText(
      'This discount changed. Close this dialog and review the refreshed rule before deleting it.'
    )
  ).toBeVisible()
  await userEvent.click(dialog.getByRole('button', { name: 'Delete' }))
  expect(del).toHaveBeenCalledTimes(1)
  expect(del).toHaveBeenLastCalledWith('/api/user/2/group-ratios', {
    data: { group: 'vip', version: 1 },
  })
  await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(await screen.findByText('0.5')).toBeVisible()
})

it('returns to the previous page after deleting the only rule on the last page', async () => {
  const options = {
    items: [rule],
    page2: [{ ...rule, id: 2, group: 'svip' }],
    total: 21,
  }
  vi.spyOn(api, 'delete').mockImplementation(async () => {
    options.page2 = []
    options.total = 20
    return {
      data: {
        success: true,
        data: {
          user_id: 2,
          rules: [rule],
          day: '2026-11-13',
          timezone: 'Asia/Shanghai',
        },
      },
    }
  })
  const { get } = renderPage(options)
  await screen.findByText('vip')
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  await screen.findByText('svip')
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await userEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(await screen.findByText('vip')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Go to previous page' })
  ).toBeDisabled()
  expect(get).toHaveBeenLastCalledWith(
    '/api/user/group-ratios',
    expect.objectContaining({ params: expect.objectContaining({ p: 1 }) })
  )
})

it('lists each user and group separately, preserves small multiplier precision and distinguishes assessment from today spend', async () => {
  renderPage()
  const rows = await screen.findAllByRole('row')
  await screen.findByText('svip')
  expect(rows.length).toBeGreaterThan(0)
  expect(screen.getAllByText('customer')).toHaveLength(2)
  expect(screen.getAllByText('0.005')).toHaveLength(2)
  expect(screen.getAllByText('Daily minimum met · $2')).toHaveLength(2)
  expect(screen.getAllByText('$0.5')).toHaveLength(2)
  expect(screen.getByText('Manually disabled')).toBeVisible()
  await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
  expect(
    await screen.findByRole('dialog', { name: 'Group discounts' })
  ).toHaveTextContent('#2 · customer · Customer')
  expect(
    await screen.findByRole('spinbutton', { name: 'Final group multiplier' })
  ).toHaveValue(0.005)
})

it('uses exact user filtering for links and clears it explicitly before listing all users', async () => {
  const { get } = renderPage({ userId: 2 })
  await screen.findByText('vip')
  expect(get).toHaveBeenCalledWith(
    '/api/user/group-ratios',
    expect.objectContaining({
      params: expect.objectContaining({ user_id: 2, keyword: '' }),
    })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(
      '/api/user/group-ratios',
      expect.objectContaining({
        params: expect.objectContaining({ user_id: undefined }),
      })
    )
  )
})

it('requests server pagination and resets the page when filtering by status', async () => {
  const { get } = renderPage()
  await screen.findByText('vip')
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/api/user/group-ratios',
      expect.objectContaining({ params: expect.objectContaining({ p: 2 }) })
    )
  )
  await userEvent.click(screen.getByRole('button', { name: 'Status' }))
  await userEvent.click(
    screen.getByRole('option', { name: 'Manually disabled' })
  )
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/api/user/group-ratios',
      expect.objectContaining({
        params: expect.objectContaining({ p: 1, status: 'manually_disabled' }),
      })
    )
  )
})

it('shows list errors with retry and never presents a failed request as an empty list', async () => {
  const options = { fail: true }
  renderPage(options)
  expect(await screen.findByText('Discount list unavailable')).toBeVisible()
  expect(
    screen.queryByText('No group discounts configured')
  ).not.toBeInTheDocument()
  options.fail = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('vip')).toBeVisible()
})

it('requires selecting a manageable user before adding discounts and excludes peers from the picker', async () => {
  renderPage({ role: 10 })
  await screen.findByText('vip')
  await userEvent.click(
    screen.getByRole('button', { name: 'Add group discount' })
  )
  const dialog = within(
    await screen.findByRole('dialog', { name: 'Group discounts' })
  )
  expect(dialog.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await waitFor(() =>
    expect(dialog.getByRole('combobox', { name: 'Select user' })).toBeEnabled()
  )
  await userEvent.click(dialog.getByRole('combobox', { name: 'Select user' }))
  expect(
    screen.getByRole('option', { name: '#2 · customer · Customer' })
  ).toBeVisible()
  expect(
    screen.queryByRole('option', { name: '#3 · admin · Admin' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('option', { name: '#4 · root · Root' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('option', { name: '#2 · customer · Customer' })
  )
  expect(await dialog.findByRole('group', { name: 'vip' })).toBeVisible()
  expect(
    dialog.queryByRole('group', { name: 'default' })
  ).not.toBeInTheDocument()
})

it.each([
  [10, 1, false, true],
  [10, 10, false, false],
  [100, 100, false, true],
  [100, 1, true, false],
])(
  'shows a direct discount link only for a manageable account (operator %s, target %s, deleted %s)',
  async (viewerRole, targetRole, deleted, allowed) => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'operator', role: viewerRole })
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [] },
    })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const target: User = {
      id: 2,
      username: 'customer',
      display_name: 'Customer',
      role: targetRole,
      status: 1,
      quota: 0,
      used_quota: 0,
      request_count: 0,
      group: 'default',
      DeletedAt: deleted ? '2026-11-13T00:00:00Z' : undefined,
    }
    const root = createRootRoute()
    const users = createRoute({
      getParentRoute: () => root,
      path: 'users',
      component: () => (
        <UsersProvider>
          <DataTableRowActions row={{ original: target } as Row<User>} />
        </UsersProvider>
      ),
    })
    const discounts = createRoute({
      getParentRoute: () => root,
      path: 'user-group-discounts',
      validateSearch: (search) => ({ user_id: Number(search.user_id) }),
      component: () => null,
    })
    const router = createRouter({
      routeTree: root.addChildren([users, discounts]),
      history: createMemoryHistory({ initialEntries: ['/users'] }),
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    await router.load()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    if (deleted) {
      expect(
        screen.queryByRole('button', { name: 'Open menu' })
      ).not.toBeInTheDocument()
      return
    }
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open menu' })
    )
    const link = screen.queryByRole('menuitem', { name: 'View discounts' })
    if (!allowed) {
      expect(link).not.toBeInTheDocument()
      return
    }
    expect(link).toHaveAttribute('href', '/user-group-discounts?user_id=2')
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'View discounts' })
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/user-group-discounts')
    )
    expect(router.state.location.search).toMatchObject({ user_id: 2 })
  }
)
