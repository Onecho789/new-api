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
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { BillingHistoryDialog } from '../components/dialogs/billing-history-dialog'
import { useBillingHistory } from '../hooks/use-billing-history'

const clients: QueryClient[] = []

function historyResponse(tradeNo: string, total = 25, status = 'success') {
  return {
    data: {
      success: true,
      data: {
        total,
        items: [
          {
            id: 1,
            user_id: 23,
            amount: 10,
            money: 10,
            trade_no: tradeNo,
            status,
            payment_method: 'stripe',
            create_time: 1,
          },
        ],
      },
    },
  }
}

function renderHistory(role = 10) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const params = new URL(url, 'http://localhost').searchParams
    return historyResponse(
      `order-${params.get('user_id') ?? 'all'}-${params.get('keyword') ?? 'none'}-p${params.get('p')}`
    )
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const view = render(
    <QueryClientProvider client={client}>
      <BillingHistoryDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>
  )
  return { get, client, view }
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.useRealTimers()
  useAuthStore.getState().auth.reset()
})

it('combines exact user and order filters, retains both when paging and clears each independently', async () => {
  const { get } = renderHistory()
  await screen.findByText('order-all-none-p1')
  const userId = screen.getByRole('textbox', { name: 'User ID' })
  const order = screen.getByRole('textbox', {
    name: 'Search by order number...',
  })
  fireEvent.change(userId, { target: { value: '23' } })
  fireEvent.change(order, { target: { value: 'invoice-42' } })
  expect(screen.queryByText('order-all-none-p1')).not.toBeInTheDocument()
  expect(await screen.findByText('order-23-invoice-42-p1')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(await screen.findByText('order-23-invoice-42-p2')).toBeVisible()
  await userEvent.click(screen.getByRole('combobox'))
  await userEvent.click(screen.getByRole('option', { name: '20 / page' }))
  expect(await screen.findByText('order-23-invoice-42-p1')).toBeVisible()
  expect(
    new URL(
      get.mock.calls.at(-1)?.[0] ?? '',
      'http://localhost'
    ).searchParams.get('page_size')
  ).toBe('20')
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(await screen.findByText('order-23-invoice-42-p2')).toBeVisible()
  fireEvent.change(userId, { target: { value: '24' } })
  expect(await screen.findByText('order-24-invoice-42-p1')).toBeVisible()
  fireEvent.change(userId, { target: { value: '' } })
  expect(await screen.findByText('order-all-invoice-42-p1')).toBeVisible()
  fireEvent.change(order, { target: { value: '' } })
  expect(await screen.findByText('order-all-none-p1')).toBeVisible()
  const latest = new URL(get.mock.calls.at(-1)?.[0] ?? '', 'http://localhost')
  expect(latest.searchParams.has('user_id')).toBe(false)
  expect(latest.searchParams.has('keyword')).toBe(false)
  expect(screen.getByRole('group', { name: 'Filters' })).toHaveClass(
    'flex-col',
    'sm:flex-row'
  )
  expect(userId).toHaveAttribute('inputmode', 'numeric')
})

it.each(['0', '-1', '1.5', '1e3', '9007199254740992'])(
  'rejects invalid user ID %s without querying or showing all users',
  async (invalid) => {
    const { get } = renderHistory()
    await screen.findByText('order-all-none-p1')
    vi.useFakeTimers()
    const userId = screen.getByRole('textbox', { name: 'User ID' })
    fireEvent.change(userId, { target: { value: invalid } })
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid user ID')
    expect(userId).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('order-all-none-p1')).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(501)
    })
    expect(get).toHaveBeenCalledTimes(1)
  }
)

it.each(['success', 'failure'])(
  'ignores a late %s from the previous user filter even if cancellation is ignored',
  async (outcome) => {
    const { get } = renderHistory()
    await screen.findByText('order-all-none-p1')
    let resolveOld!: (value: ReturnType<typeof historyResponse>) => void
    let rejectOld!: (error: Error) => void
    const pending = new Promise<ReturnType<typeof historyResponse>>(
      (resolve, reject) => {
        resolveOld = resolve
        rejectOld = reject
      }
    )
    get.mockImplementation(async (url) => {
      if (
        new URL(url, 'http://localhost').searchParams.get('user_id') === '7'
      ) {
        return pending
      }
      return historyResponse('current-user-8')
    })
    const userId = screen.getByRole('textbox', { name: 'User ID' })
    fireEvent.change(userId, { target: { value: '7' } })
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    fireEvent.change(userId, { target: { value: '8' } })
    expect(await screen.findByText('current-user-8')).toBeVisible()
    await act(async () => {
      if (outcome === 'success') resolveOld(historyResponse('stale-user-7'))
      else rejectOld(new Error('Old filter failed'))
    })
    expect(screen.getByText('current-user-8')).toBeVisible()
    expect(screen.queryByText('stale-user-7')).not.toBeInTheDocument()
    expect(screen.queryByText('Old filter failed')).not.toBeInTheDocument()
  }
)

it('keeps failed filtered responses visible as errors and retries the same user and order', async () => {
  const { get } = renderHistory()
  await screen.findByText('order-all-none-p1')
  get.mockRejectedValueOnce(new Error('Billing service unavailable'))
  fireEvent.change(screen.getByRole('textbox', { name: 'User ID' }), {
    target: { value: '23' },
  })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Search by order number...' }),
    { target: { value: 'invoice' } }
  )
  expect(await screen.findByText('Billing service unavailable')).toBeVisible()
  expect(screen.queryByText('order-all-none-p1')).not.toBeInTheDocument()
  expect(screen.queryByText('No billing records found')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('order-23-invoice-p1')).toBeVisible()
})

it('hides the user filter for ordinary users and isolates cached results across accounts', async () => {
  const { get } = renderHistory()
  await screen.findByText('order-all-none-p1')
  fireEvent.change(screen.getByRole('textbox', { name: 'User ID' }), {
    target: { value: '23' },
  })
  await screen.findByText('order-23-none-p1')
  get.mockImplementation(async () =>
    historyResponse(`self-${useAuthStore.getState().auth.user?.id}`)
  )
  act(() =>
    useAuthStore.getState().auth.setUser({ id: 99, username: 'first', role: 1 })
  )
  expect(
    screen.queryByRole('textbox', { name: 'User ID' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('order-23-none-p1')).not.toBeInTheDocument()
  expect(await screen.findByText('self-99')).toBeVisible()
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Search by order number...' }),
    { target: { value: 'mine' } }
  )
  await waitFor(() =>
    expect(get.mock.calls.at(-1)?.[0] ?? '').toContain('keyword=mine')
  )
  expect(get.mock.calls.at(-1)?.[0] ?? '').toContain('/api/user/topup/self?')
  expect(get.mock.calls.at(-1)?.[0] ?? '').not.toContain('user_id')
  act(() =>
    useAuthStore
      .getState()
      .auth.setUser({ id: 100, username: 'second', role: 1 })
  )
  expect(screen.queryByText('self-99')).not.toBeInTheDocument()
  expect(await screen.findByText('self-100')).toBeVisible()
})

it('refreshes the active user and order filters after completing an order', async () => {
  const { get } = renderHistory()
  await screen.findByText('order-all-none-p1')
  let completed = false
  get.mockImplementation(async () =>
    historyResponse('pending-order', 1, completed ? 'success' : 'pending')
  )
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    completed = true
    return { data: { success: true } }
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'User ID' }), {
    target: { value: '23' },
  })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Search by order number...' }),
    { target: { value: 'invoice' } }
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Complete Order' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(await screen.findByText('Success')).toBeVisible()
  expect(post).toHaveBeenCalledWith('/api/user/topup/complete', {
    trade_no: 'pending-order',
  })
  const params = new URL(get.mock.calls.at(-1)?.[0] ?? '', 'http://localhost')
    .searchParams
  expect(params.get('user_id')).toBe('23')
  expect(params.get('keyword')).toBe('invoice')
})

it('refreshes the latest filters when an earlier order completion finishes after the filter changes', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role: 10 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const get = vi.spyOn(api, 'get').mockResolvedValue(historyResponse('initial'))
  const { result } = renderHook(() => useBillingHistory(), {
    wrapper: (props) => (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    ),
  })
  await waitFor(() =>
    expect(result.current.records[0]?.trade_no).toBe('initial')
  )
  let completed = false
  let resolveComplete!: () => void
  const pending = new Promise<void>((resolve) => {
    resolveComplete = resolve
  })
  get.mockImplementation(async (url) => {
    const id = new URL(url, 'http://localhost').searchParams.get('user_id')
    if (id === '23') return historyResponse('old-pending-order', 1, 'pending')
    return historyResponse(completed ? 'new-filter-refreshed' : 'new-filter', 1)
  })
  vi.spyOn(api, 'post').mockImplementation(async () => {
    await pending
    completed = true
    return { data: { success: true } }
  })
  act(() => result.current.handleUserIdSearch('23'))
  await waitFor(() =>
    expect(result.current.records[0]?.trade_no).toBe('old-pending-order')
  )
  let completion!: Promise<boolean>
  act(() => {
    completion = result.current.handleCompleteOrder('old-pending-order')
  })
  expect(result.current.completing).toBe(true)
  act(() => {
    result.current.handleUserIdSearch('24')
    result.current.handleSearch('new-order')
  })
  await waitFor(() =>
    expect(result.current.records[0]?.trade_no).toBe('new-filter')
  )
  await act(async () => {
    resolveComplete()
    expect(await completion).toBe(true)
  })
  await waitFor(() =>
    expect(result.current.records[0]?.trade_no).toBe('new-filter-refreshed')
  )
  const params = new URL(get.mock.calls.at(-1)?.[0] ?? '', 'http://localhost')
    .searchParams
  expect(params.get('user_id')).toBe('24')
  expect(params.get('keyword')).toBe('new-order')
})

it('keeps a late response hidden after the user filter becomes invalid', async () => {
  const { get } = renderHistory()
  await screen.findByText('order-all-none-p1')
  let resolveOld!: (value: ReturnType<typeof historyResponse>) => void
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      })
  )
  const userId = screen.getByRole('textbox', { name: 'User ID' })
  fireEvent.change(userId, { target: { value: '23' } })
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  fireEvent.change(userId, { target: { value: '23x' } })
  await act(async () => resolveOld(historyResponse('late-user-23')))
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid user ID')
  expect(screen.queryByText('late-user-23')).not.toBeInTheDocument()
  expect(screen.queryByText('order-all-none-p1')).not.toBeInTheDocument()
  expect(get).toHaveBeenCalledTimes(2)
})
