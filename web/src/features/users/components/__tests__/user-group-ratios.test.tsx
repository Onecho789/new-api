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
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { UserGroupDiscountsDialog } from '@/features/user-group-discounts/components/user-group-discounts-dialog'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { User, UserGroupRatio, UserGroupRatiosData } from '../../types'

const target: User = {
  id: 2,
  username: 'customer',
  display_name: 'Customer',
  role: 1,
  status: 1,
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
}
const rule: UserGroupRatio = {
  group: 'vip',
  ratio: 0.75,
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
  last_check_at: Date.UTC(2026, 10, 12, 16, 10) / 1000,
  last_check_quota: 1000000,
  last_check_status: 'passed',
}
const clients: QueryClient[] = []
let snapshot: UserGroupRatiosData
let loadFailure = false

function renderDrawer(viewerRole = 100, targetRole = 1, viewerId = 1) {
  useAuthStore
    .getState()
    .auth.setUser({ id: viewerId, username: 'operator', role: viewerRole })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/status') {
      return { data: { success: true, data: {} } }
    }
    if (url === '/api/pricing') {
      return {
        data: { success: true, group_ratio: { vip: snapshot.rules[0]?.ratio } },
      }
    }
    if (url === '/api/authz/catalog') {
      return { data: { success: true, data: { resources: [], roles: [] } } }
    }
    if (url === '/api/group/') {
      return { data: { success: true, data: ['default', 'vip'] } }
    }
    if (url === '/api/user/2/group-ratios') {
      if (loadFailure) throw new Error('Discount settings unavailable')
      return { data: { success: true, data: snapshot } }
    }
    if (url === '/api/user/2') {
      return { data: { success: true, data: { ...target, role: targetRole } } }
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const onOpenChange = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <UserGroupDiscountsDialog
        open
        onOpenChange={onOpenChange}
        user={{ ...target, role: targetRole }}
      />
    </QueryClientProvider>
  )
  return { get, onOpenChange, client, view }
}

function PricingPreview() {
  const { groupRatio } = usePricingData()
  return <span>Preview multiplier: {groupRatio.vip}</span>
}

beforeEach(() => {
  loadFailure = false
  snapshot = {
    user_id: 2,
    timezone: 'Asia/Shanghai',
    day: '2026-11-13',
    rules: [{ ...rule }],
  }
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

afterEach(() => {
  cleanup()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.useRealTimers()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

it('creates a long-term discount without requiring daily spending by default', async () => {
  snapshot.rules = []
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: snapshot } })
  renderDrawer()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add group discount' })
  )
  expect(screen.getByRole('radio', { name: 'No expiry' })).toBeChecked()
  expect(
    screen.getByRole('switch', { name: 'Daily spending assessment' })
  ).not.toBeChecked()
  expect(
    screen.queryByRole('spinbutton', { name: /Daily minimum/ })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'default',
          ratio: 1,
          min_daily_quota: 0,
          daily_check_enabled: false,
          enabled: true,
          version: 0,
          starts_at: 0,
          ends_at: 0,
        },
      ],
    })
  )
})

it('starts two hours on server save, disables daily assessment and preserves the saved expiry on later edits', async () => {
  const startsAt = Date.UTC(2030, 0, 1) / 1000
  const put = vi.spyOn(api, 'put').mockImplementation(async () => {
    snapshot = {
      ...snapshot,
      rules: [
        {
          ...rule,
          starts_at: startsAt,
          ends_at: startsAt + 7200,
          daily_check_enabled: false,
          min_daily_quota: 0,
          version: 2,
        },
      ],
    }
    return { data: { success: true, data: snapshot } }
  })
  renderDrawer()
  await userEvent.click(
    await screen.findByRole('radio', { name: 'Restart for 2 hours on save' })
  )
  expect(
    screen.getByRole('switch', { name: 'Daily spending assessment' })
  ).not.toBeChecked()
  expect(
    screen.getByText(
      'The 2-hour period starts when the server saves this discount.'
    )
  ).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'vip',
          ratio: 0.75,
          min_daily_quota: 0,
          daily_check_enabled: false,
          enabled: true,
          version: 1,
          duration_seconds: 7200,
        },
      ],
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Custom schedule' })).toBeChecked()
  )
  const ratio = screen.getByRole('spinbutton', {
    name: 'Final group multiplier',
  })
  await userEvent.clear(ratio)
  await userEvent.type(ratio, '0.5')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'vip',
          ratio: 0.5,
          min_daily_quota: 0,
          daily_check_enabled: false,
          enabled: true,
          version: 2,
          starts_at: startsAt,
          ends_at: startsAt + 7200,
        },
      ],
    })
  )
})

it('allows daily assessment to be explicitly re-enabled after selecting two hours and validates its minimum', async () => {
  snapshot.rules = []
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: snapshot } })
  renderDrawer()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add group discount' })
  )
  await userEvent.click(
    screen.getByRole('radio', { name: '2 hours after saving' })
  )
  await userEvent.click(
    screen.getByRole('switch', { name: 'Daily spending assessment' })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  expect(
    await screen.findByText('Enter a positive daily minimum')
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  await userEvent.type(
    screen.getByRole('spinbutton', { name: /Daily minimum/ }),
    '2'
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'default',
          ratio: 1,
          min_daily_quota: 1000000,
          daily_check_enabled: true,
          enabled: true,
          version: 0,
          duration_seconds: 7200,
        },
      ],
    })
  )
})

it('rejects an end before the start and preserves Beijing dates while editing a saved schedule', async () => {
  Object.assign(snapshot.rules[0], {
    starts_at: Date.UTC(2030, 0, 1) / 1000,
    ends_at: Date.UTC(2029, 11, 31) / 1000,
  })
  const put = vi.spyOn(api, 'put')
  renderDrawer()
  const start = within(
    await screen.findByRole('group', { name: 'Start time (Beijing time)' })
  )
  expect(start.getByRole('button', { name: '2030-01-01' })).toBeVisible()
  expect(start.getByDisplayValue('08:00:00')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  expect(
    await screen.findByText('End time must be after start time')
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
})

it('saves an edited Beijing end time as an absolute instant without restarting the discount', async () => {
  const startsAt = Date.UTC(2030, 0, 1) / 1000
  Object.assign(snapshot.rules[0], {
    starts_at: startsAt,
    ends_at: startsAt + 7200,
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: snapshot } })
  renderDrawer()
  const end = within(
    await screen.findByRole('group', { name: 'End time (Beijing time)' })
  )
  fireEvent.change(end.getByDisplayValue('10:00:00'), {
    target: { value: '11:30:00' },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'vip',
          ratio: 0.75,
          min_daily_quota: 500000,
          daily_check_enabled: true,
          enabled: true,
          version: 1,
          starts_at: startsAt,
          ends_at: startsAt + 12600,
        },
      ],
    })
  )
})

it.each([
  [true, 'Activation day exempt'],
  [false, 'Discount active'],
] as const)(
  'uses the saved assessment setting %s when a schedule starts, preserving unsaved edits',
  async (dailyAssessment, expectedStatus) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const startsAt = Math.floor(Date.now() / 1000) + 2
    Object.assign(snapshot.rules[0], {
      starts_at: startsAt,
      ends_at: startsAt + 2,
      status: 'scheduled',
      daily_check_enabled: dailyAssessment,
      min_daily_quota: dailyAssessment ? 500000 : 0,
    })
    await act(async () => {
      renderDrawer()
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByText('Not started')).toBeVisible()
    const ratio = screen.getByRole('spinbutton', {
      name: 'Final group multiplier',
    })
    fireEvent.change(ratio, { target: { value: '0.5' } })
    fireEvent.click(
      screen.getByRole('switch', { name: 'Daily spending assessment' })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001)
    })
    expect(screen.getByText(expectedStatus)).toBeVisible()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001)
    })
    expect(screen.getByText('Expired')).toBeVisible()
    expect(ratio).toHaveValue(0.5)
    expect(screen.getByText('Unsaved changes')).toBeVisible()
  }
)

it('ends the saved activation-day exemption at Beijing midnight while retaining the draft', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2030-01-01T15:59:58Z'))
  Object.assign(snapshot.rules[0], {
    starts_at: Date.UTC(2029, 11, 31) / 1000,
    enabled_at: Date.UTC(2030, 0, 1) / 1000,
    ends_at: 0,
    status: 'grace_period',
  })
  await act(async () => {
    renderDrawer()
    await vi.advanceTimersByTimeAsync(0)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(screen.getByText('Activation day exempt')).toBeVisible()
  const ratio = screen.getByRole('spinbutton', {
    name: 'Final group multiplier',
  })
  fireEvent.change(ratio, { target: { value: '0.5' } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2001)
  })
  expect(screen.getByText('Discount active')).toBeVisible()
  expect(ratio).toHaveValue(0.5)
})

it('requires an enabled discount for two hours and allows disabling an expired schedule without renewing it', async () => {
  const endsAt = Date.UTC(2020, 0, 1) / 1000
  Object.assign(snapshot.rules[0], {
    starts_at: endsAt - 7200,
    ends_at: endsAt,
    status: 'expired',
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: snapshot } })
  renderDrawer()
  expect(await screen.findByText('Expired')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  expect(
    await screen.findByText(
      'End time must be in the future for an enabled discount.'
    )
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('switch', { name: 'Enable group discount' })
  )
  expect(
    screen.getByRole('radio', { name: 'Restart for 2 hours on save' })
  ).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'vip',
          ratio: 0.75,
          min_daily_quota: 500000,
          daily_check_enabled: true,
          enabled: false,
          version: 1,
          starts_at: endsAt - 7200,
          ends_at: endsAt,
        },
      ],
    })
  )
})

it('shows final net spend, automatic disablement and the assessment in Beijing time', async () => {
  snapshot.rules[0] = {
    ...rule,
    enabled: false,
    status: 'auto_disabled',
    disable_reason: 'below_daily_minimum',
    last_check_status: 'disabled',
  }
  renderDrawer()
  expect(
    await screen.findByText('Disabled: daily minimum not met')
  ).toBeInTheDocument()
  expect(screen.getByText(/^Daily minimum not met ·/)).toBeInTheDocument()
  expect(screen.getByText('$0.5')).toBeInTheDocument()
  expect(screen.queryByText('0')).not.toBeInTheDocument()
  expect(screen.getByText(/11\/13\/26, 12:10 AM/)).toBeInTheDocument()
  expect(
    screen.getByRole('switch', { name: 'Enable group discount' })
  ).not.toBeChecked()
  expect(screen.getByText('Assessed day: 2026-11-12')).toBeInTheDocument()
})

it.each([
  ['USD', 1, '2', 1000000],
  ['CNY', 7, '14', 1000000],
  ['TOKENS', 1, '23', 23],
] as const)(
  'saves a zero multiplier and converts the daily minimum from %s without changing other groups',
  async (currency, rate, input, expectedQuota) => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: currency,
        usdExchangeRate: rate,
      },
    })
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: {
        success: true,
        data: {
          ...snapshot,
          rules: [
            { ...rule, ratio: 0, min_daily_quota: expectedQuota, version: 2 },
          ],
        },
      },
    })
    renderDrawer()
    const ratio = await screen.findByRole('spinbutton', {
      name: 'Final group multiplier',
    })
    const minimum = screen.getByRole('spinbutton', { name: /Daily minimum/ })
    await userEvent.clear(ratio)
    await userEvent.type(ratio, '0')
    await userEvent.clear(minimum)
    await userEvent.type(minimum, input)
    await userEvent.click(
      screen.getByRole('button', { name: 'Save group discount' })
    )
    await waitFor(() =>
      expect(put).toHaveBeenCalledExactlyOnceWith('/api/user/2/group-ratios', {
        rules: [
          {
            group: 'vip',
            ratio: 0,
            min_daily_quota: expectedQuota,
            daily_check_enabled: true,
            starts_at: 0,
            ends_at: 0,
            enabled: true,
            version: 1,
          },
        ],
      })
    )
  }
)

it('saves discounts independently without writing user account details', async () => {
  const put = vi.spyOn(api, 'put').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url === '/api/user/2/group-ratios' ? snapshot : target,
    },
  }))
  const { onOpenChange } = renderDrawer()
  const discountForm = await screen.findByRole('form', {
    name: 'Group discounts',
  })
  await userEvent.click(
    within(discountForm).getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  expect(put.mock.calls[0][0]).toBe('/api/user/2/group-ratios')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(put).toHaveBeenCalledTimes(1)
})

it('refreshes displayed pricing after root changes their own group discount', async () => {
  const { client } = renderDrawer(100, 100, 2)
  render(
    <QueryClientProvider client={client}>
      <PricingPreview />
    </QueryClientProvider>
  )
  expect(
    await screen.findByText('Preview multiplier: 0.75')
  ).toBeInTheDocument()
  vi.spyOn(api, 'put').mockImplementation(async () => {
    snapshot = { ...snapshot, rules: [{ ...rule, ratio: 0.5, version: 2 }] }
    return { data: { success: true, data: snapshot } }
  })
  const ratio = await screen.findByRole('spinbutton', {
    name: 'Final group multiplier',
  })
  await userEvent.clear(ratio)
  await userEvent.type(ratio, '0.5')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  expect(await screen.findByText('Preview multiplier: 0.5')).toBeInTheDocument()
})

it('rejects an empty multiplier and a daily minimum smaller than one quota unit', async () => {
  const put = vi.spyOn(api, 'put')
  renderDrawer()
  const ratio = await screen.findByRole('spinbutton', {
    name: 'Final group multiplier',
  })
  await userEvent.clear(ratio)
  const minimum = screen.getByRole('spinbutton', { name: /Daily minimum/ })
  await userEvent.clear(minimum)
  await userEvent.type(minimum, '0.00000001')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  expect(
    await screen.findByText('Enter a multiplier from 0 to 1000')
  ).toBeInTheDocument()
  expect(screen.getByText('Enter a positive daily minimum')).toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
})

it('retains a rejected discount draft and allows a successful retry', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Group no longer exists' },
    })
    .mockResolvedValueOnce({ data: { success: true, data: snapshot } })
  renderDrawer()
  const ratio = await screen.findByRole('spinbutton', {
    name: 'Final group multiplier',
  })
  await userEvent.clear(ratio)
  await userEvent.type(ratio, '0.5')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Group no longer exists'
  )
  expect(ratio).toHaveValue(0.5)
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
})

it('retains a stale discount draft until explicitly reloading the current saved version', async () => {
  const message = 'Group discount changed. Reload it before saving again.'
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: false, message } })
  const { get } = renderDrawer()
  const ratio = await screen.findByRole('spinbutton', {
    name: 'Final group multiplier',
  })
  await userEvent.clear(ratio)
  await userEvent.type(ratio, '0.6')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(ratio).toHaveValue(0.6)
  expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
    rules: [
      {
        group: 'vip',
        ratio: 0.6,
        min_daily_quota: 500000,
        daily_check_enabled: true,
        starts_at: 0,
        ends_at: 0,
        enabled: true,
        version: 1,
      },
    ],
  })
  snapshot = { ...snapshot, rules: [{ ...rule, ratio: 0.4, version: 2 }] }
  let resolveReload!: () => void
  const pendingReload = new Promise<void>((resolve) => {
    resolveReload = resolve
  })
  get.mockImplementationOnce(async () => {
    await pendingReload
    return { data: { success: true, data: snapshot } }
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Reload saved discounts' })
  )
  expect(ratio).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Save group discount' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Add group discount' })
  ).toBeDisabled()
  fireEvent.submit(screen.getByRole('form', { name: 'Group discounts' }))
  expect(put).toHaveBeenCalledTimes(1)
  await act(async () => resolveReload())
  await waitFor(() =>
    expect(
      screen.getByRole('spinbutton', { name: 'Final group multiplier' })
    ).toHaveValue(0.4)
  )
  expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  put.mockResolvedValue({ data: { success: true, data: snapshot } })
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'vip',
          ratio: 0.4,
          min_daily_quota: 500000,
          daily_check_enabled: true,
          starts_at: 0,
          ends_at: 0,
          enabled: true,
          version: 2,
        },
      ],
    })
  )
})

it.each([
  ['USD', '1001', '1', 'Enter a multiplier from 0 to 1000'],
  ['USD', '0.5', '20000000000', 'Enter a positive daily minimum'],
  ['TOKENS', '0.5', '1.5', 'Enter a positive daily minimum'],
] as const)(
  'rejects out-of-range discount settings in %s with multiplier %s and minimum %s',
  async (currency, ratioValue, minimumValue, message) => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: currency },
    })
    const put = vi.spyOn(api, 'put')
    renderDrawer()
    const ratio = await screen.findByRole('spinbutton', {
      name: 'Final group multiplier',
    })
    const minimum = screen.getByRole('spinbutton', { name: /Daily minimum/ })
    await userEvent.clear(ratio)
    await userEvent.type(ratio, ratioValue)
    await userEvent.clear(minimum)
    await userEvent.type(minimum, minimumValue)
    await userEvent.click(
      screen.getByRole('button', { name: 'Save group discount' })
    )
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
    expect(minimum).toHaveValue(Number(minimumValue))
  }
)

it('blocks repeated saves, adding groups and drawer actions while saving', async () => {
  snapshot.rules.push({ ...rule, group: 'default', ratio: 0.5 })
  let resolveSave!: (value: {
    data: { success: boolean; data: UserGroupRatiosData }
  }) => void
  const put = vi.spyOn(api, 'put').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve
      })
  )
  const { onOpenChange } = renderDrawer()
  const vip = within(await screen.findByRole('group', { name: 'vip' }))
  const form = vip.getByRole('form', { name: 'Group discounts' })
  fireEvent.submit(form)
  fireEvent.submit(form)
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('combobox', { name: 'Group to add' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Add group discount' })
  ).toBeDisabled()
  const otherRatio = within(
    screen.getByRole('group', { name: 'default' })
  ).getByRole('spinbutton', { name: 'Final group multiplier' })
  expect(otherRatio).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  expect(
    screen
      .getAllByRole('button', { name: 'Close' })
      .some((button) => button.hasAttribute('disabled'))
  ).toBe(true)
  expect(onOpenChange).not.toHaveBeenCalled()
  await act(async () =>
    resolveSave({ data: { success: true, data: snapshot } })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  )
  expect(otherRatio).toBeEnabled()
})

it('disables only the selected group discount while retaining its ratio and minimum', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        rules: [{ ...rule, enabled: false, status: 'manually_disabled' }],
      },
    },
  })
  renderDrawer()
  await userEvent.click(
    await screen.findByRole('switch', { name: 'Enable group discount' })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'vip',
          ratio: 0.75,
          min_daily_quota: 500000,
          daily_check_enabled: true,
          starts_at: 0,
          ends_at: 0,
          enabled: false,
          version: 1,
        },
      ],
    })
  )
  expect(await screen.findByText('Manually disabled')).toBeInTheDocument()
})

it('saves all changed group discounts with the drawer save button without resubmitting unchanged groups', async () => {
  snapshot.rules.push(
    { ...rule, group: 'default', ratio: 1 },
    { ...rule, group: 'svip', ratio: 0.5 }
  )
  const saved = {
    ...snapshot,
    rules: [
      { ...rule, enabled: false, status: 'manually_disabled', version: 2 },
      snapshot.rules[1],
      {
        ...snapshot.rules[2],
        ratio: 0.4,
        min_daily_quota: 2000000,
        version: 2,
      },
    ],
  }
  const put = vi.spyOn(api, 'put').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('group-ratios') ? saved : target,
    },
  }))
  const { onOpenChange } = renderDrawer()
  const vip = within(await screen.findByRole('group', { name: 'vip' }))
  await userEvent.click(
    vip.getByRole('switch', { name: 'Enable group discount' })
  )
  expect(vip.getByText('Unsaved changes')).toBeVisible()
  const svip = within(screen.getByRole('group', { name: 'svip' }))
  const ratio = svip.getByRole('spinbutton', { name: 'Final group multiplier' })
  await userEvent.clear(ratio)
  await userEvent.type(ratio, '0.4')
  const minimum = svip.getByRole('spinbutton', { name: /Daily minimum/ })
  await userEvent.clear(minimum)
  await userEvent.type(minimum, '4')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
    rules: [
      {
        group: 'vip',
        ratio: 0.75,
        min_daily_quota: 500000,
        daily_check_enabled: true,
        starts_at: 0,
        ends_at: 0,
        enabled: false,
        version: 1,
      },
      {
        group: 'svip',
        ratio: 0.4,
        min_daily_quota: 2000000,
        daily_check_enabled: true,
        starts_at: 0,
        ends_at: 0,
        enabled: true,
        version: 1,
      },
    ],
  })
  expect(
    vip.getByRole('switch', { name: 'Enable group discount' })
  ).not.toBeChecked()
  expect(vip.getByText('Manually disabled')).toBeVisible()
  expect(vip.queryByText('Unsaved changes')).not.toBeInTheDocument()
})

it('locks the drawer and all group editors during a footer save and submits only once', async () => {
  snapshot.rules.push({ ...rule, group: 'default' })
  let resolveSave!: (value: {
    data: { success: boolean; data: UserGroupRatiosData }
  }) => void
  const put = vi.spyOn(api, 'put').mockImplementation(async (url) => {
    if (url.endsWith('group-ratios')) {
      return new Promise((resolve) => {
        resolveSave = resolve
      })
    }
    return { data: { success: true, data: target } }
  })
  const { onOpenChange } = renderDrawer()
  const vip = within(await screen.findByRole('group', { name: 'vip' }))
  await userEvent.click(
    vip.getByRole('switch', { name: 'Enable group discount' })
  )
  await userEvent.dblClick(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
  expect(
    screen
      .getAllByRole('button', { name: 'Close' })
      .some((button) => button.hasAttribute('disabled'))
  ).toBe(true)
  for (const control of within(
    screen.getByRole('group', { name: 'default' })
  ).getAllByRole('switch')) {
    expect(control).toHaveAttribute('aria-disabled', 'true')
  }
  expect(
    screen.getByRole('button', { name: 'Add group discount' })
  ).toBeDisabled()
  expect(onOpenChange).not.toHaveBeenCalled()
  await act(async () =>
    resolveSave({ data: { success: true, data: snapshot } })
  )
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(put).toHaveBeenCalledTimes(1)
})

it('keeps the drawer and discount draft open when the footer save fails and allows retry', async () => {
  const put = vi.spyOn(api, 'put').mockResolvedValueOnce({
    data: { success: false, message: 'Discount update failed' },
  })
  const { onOpenChange } = renderDrawer()
  await userEvent.click(
    await screen.findByRole('switch', { name: 'Enable group discount' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Discount update failed'
  )
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(
    screen.getByRole('switch', { name: 'Enable group discount' })
  ).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  put.mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        rules: [
          { ...rule, enabled: false, version: 2, status: 'manually_disabled' },
        ],
      },
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(
    put.mock.calls.filter(([url]) => url.endsWith('group-ratios'))
  ).toHaveLength(2)
})

it('validates every discount before the footer writes any changes and saves added groups only on request', async () => {
  const put = vi.spyOn(api, 'put')
  const { onOpenChange } = renderDrawer()
  await userEvent.click(
    await screen.findByRole('switch', { name: 'Enable group discount' })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Add group discount' })
  )
  expect(put).not.toHaveBeenCalled()
  await userEvent.click(
    within(screen.getByRole('group', { name: 'default' })).getByRole('switch', {
      name: 'Daily spending assessment',
    })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(
    await screen.findByText('Enter a positive daily minimum')
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  expect(onOpenChange).not.toHaveBeenCalled()
  const draft = within(screen.getByRole('group', { name: 'default' }))
  await userEvent.type(
    draft.getByRole('spinbutton', { name: /Daily minimum/ }),
    '3'
  )
  put.mockResolvedValue({ data: { success: true, data: snapshot } })
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'vip',
          ratio: 0.75,
          min_daily_quota: 500000,
          daily_check_enabled: true,
          starts_at: 0,
          ends_at: 0,
          enabled: false,
          version: 1,
        },
        {
          group: 'default',
          ratio: 1,
          min_daily_quota: 1500000,
          daily_check_enabled: true,
          starts_at: 0,
          ends_at: 0,
          enabled: true,
          version: 0,
        },
      ],
    })
  )
})

it('retries a failed load and explains unsettled charges without exposing an editable empty state', async () => {
  loadFailure = true
  snapshot.rules[0] = {
    ...rule,
    status: 'pending_settlement',
    today_pending: 2,
  }
  renderDrawer()
  expect(
    await screen.findByText('Discount settings unavailable')
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('spinbutton', { name: 'Final group multiplier' })
  ).not.toBeInTheDocument()
  loadFailure = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Waiting for settlement')).toBeInTheDocument()
  expect(
    screen.getByText('Some charges are still pending settlement')
  ).toBeInTheDocument()
})

it('adds an unconfigured group without carrying over another group’s amount or hiding its editor', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: snapshot } })
  const { onOpenChange } = renderDrawer()
  await userEvent.click(
    await screen.findByRole('combobox', { name: 'Group to add' })
  )
  expect(screen.getByRole('option', { name: 'default' })).toBeVisible()
  await userEvent.click(screen.getByRole('option', { name: 'default' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Add group discount' })
  )
  const draft = within(screen.getByRole('group', { name: 'default' }))
  expect(screen.getByRole('group', { name: 'vip' })).toBeVisible()
  expect(draft.getByText('Not configured')).toBeInTheDocument()
  expect(
    draft.getByRole('spinbutton', { name: 'Final group multiplier' })
  ).toHaveValue(1)
  await userEvent.click(
    draft.getByRole('switch', { name: 'Daily spending assessment' })
  )
  const minimum = draft.getByRole('spinbutton', { name: /Daily minimum/ })
  expect(minimum).toHaveValue(null)
  await userEvent.type(minimum, '3')
  await userEvent.click(
    draft.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'default',
          ratio: 1,
          min_daily_quota: 1500000,
          daily_check_enabled: true,
          starts_at: 0,
          ends_at: 0,
          enabled: true,
          version: 0,
        },
      ],
    })
  )
  expect(onOpenChange).not.toHaveBeenCalled()
})

it('adds and cancels a new group from an empty list without writing settings or duplicating groups', async () => {
  snapshot.rules = []
  const put = vi.spyOn(api, 'put')
  renderDrawer()
  expect(await screen.findByText('No group discounts configured')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Add group discount' })
  )
  const draft = within(screen.getByRole('group', { name: 'default' }))
  expect(
    screen.queryByText('No group discounts configured')
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('combobox', { name: 'Group to add' }))
  expect(
    screen.queryByRole('option', { name: 'default' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'vip' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(draft.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('No group discounts configured')).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Group to add' })).toHaveValue(
    'default'
  )
  expect(put).not.toHaveBeenCalled()
})

it.each(['changed', 'deleted'])(
  'keeps another group’s unsaved draft and version when saving one group after the other was %s remotely',
  async (remoteChange) => {
    snapshot.rules.push({
      ...rule,
      group: 'default',
      ratio: 0.5,
      min_daily_quota: 1000000,
    })
    const put = vi
      .spyOn(api, 'put')
      .mockImplementationOnce(async () => {
        snapshot = {
          ...snapshot,
          rules: snapshot.rules.map((item) =>
            item.group === 'vip'
              ? { ...item, ratio: 0.6, version: 2 }
              : { ...item, min_daily_quota: 3000000, version: 2 }
          ),
        }
        if (remoteChange === 'deleted') {
          snapshot = {
            ...snapshot,
            rules: snapshot.rules.filter((item) => item.group !== 'default'),
          }
        }
        return { data: { success: true, data: snapshot } }
      })
      .mockRejectedValueOnce(
        new Error('Group discount changed. Reload it before saving again.')
      )
    const { onOpenChange } = renderDrawer()
    const vip = within(await screen.findByRole('group', { name: 'vip' }))
    const other = within(screen.getByRole('group', { name: 'default' }))
    expect(
      vip.getByRole('spinbutton', { name: 'Final group multiplier' })
    ).toHaveValue(0.75)
    expect(
      other.getByRole('spinbutton', { name: 'Final group multiplier' })
    ).toHaveValue(0.5)
    const otherMinimum = other.getByRole('spinbutton', {
      name: /Daily minimum/,
    })
    await userEvent.clear(otherMinimum)
    await userEvent.type(otherMinimum, '4')
    const vipRatio = vip.getByRole('spinbutton', {
      name: 'Final group multiplier',
    })
    await userEvent.clear(vipRatio)
    await userEvent.type(vipRatio, '0.6')
    await userEvent.click(
      vip.getByRole('button', { name: 'Save group discount' })
    )
    await waitFor(() =>
      expect(
        vip.getByRole('spinbutton', { name: 'Final group multiplier' })
      ).toHaveValue(0.6)
    )
    expect(screen.getByRole('group', { name: 'default' })).toBeVisible()
    expect(
      other.getByRole('spinbutton', { name: /Daily minimum/ })
    ).toHaveValue(4)
    await userEvent.click(
      other.getByRole('button', { name: 'Save group discount' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Group discount changed. Reload it before saving again.'
    )
    expect(put).toHaveBeenLastCalledWith('/api/user/2/group-ratios', {
      rules: [
        {
          group: 'default',
          ratio: 0.5,
          min_daily_quota: 2000000,
          daily_check_enabled: true,
          starts_at: 0,
          ends_at: 0,
          enabled: true,
          version: 1,
        },
      ],
    })
    expect(
      other.getByRole('spinbutton', { name: /Daily minimum/ })
    ).toHaveValue(4)
    expect(onOpenChange).not.toHaveBeenCalled()
  }
)

it('keeps a new group draft at version zero when saving another group returns a concurrently created rule', async () => {
  const message =
    'A group discount already exists for this user and group. Edit or delete the existing discount first.'
  const put = vi
    .spyOn(api, 'put')
    .mockImplementationOnce(async () => ({
      data: {
        success: true,
        data: {
          ...snapshot,
          rules: [
            { ...rule, version: 2 },
            { ...rule, group: 'default', ratio: 0.2, min_daily_quota: 3000000 },
          ],
        },
      },
    }))
    .mockRejectedValueOnce(new Error(message))
  renderDrawer()
  const vip = within(await screen.findByRole('group', { name: 'vip' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'Add group discount' })
  )
  const draft = within(screen.getByRole('group', { name: 'default' }))
  await userEvent.click(
    draft.getByRole('switch', { name: 'Daily spending assessment' })
  )
  await userEvent.type(
    draft.getByRole('spinbutton', { name: /Daily minimum/ }),
    '4'
  )
  await userEvent.click(
    vip.getByRole('button', { name: 'Save group discount' })
  )
  await waitFor(() =>
    expect(
      vip.getByRole('button', { name: 'Save group discount' })
    ).toBeEnabled()
  )
  expect(draft.getByRole('spinbutton', { name: /Daily minimum/ })).toHaveValue(
    4
  )
  expect(
    draft.getByRole('spinbutton', { name: 'Final group multiplier' })
  ).toHaveValue(1)
  expect(draft.getByText('Not configured')).toBeVisible()
  await userEvent.click(
    draft.getByRole('button', { name: 'Save group discount' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(put).toHaveBeenLastCalledWith('/api/user/2/group-ratios', {
    rules: [
      {
        group: 'default',
        ratio: 1,
        min_daily_quota: 2000000,
        daily_check_enabled: true,
        starts_at: 0,
        ends_at: 0,
        enabled: true,
        version: 0,
      },
    ],
  })
  expect(draft.getByRole('spinbutton', { name: /Daily minimum/ })).toHaveValue(
    4
  )
})

it('preserves unsaved discount edits when the window gains focus or the network reconnects', async () => {
  const { get } = renderDrawer()
  const ratio = await screen.findByRole('spinbutton', {
    name: 'Final group multiplier',
  })
  await userEvent.clear(ratio)
  await userEvent.type(ratio, '0.6')
  snapshot = { ...snapshot, rules: [{ ...rule, ratio: 0.3, version: 2 }] }
  await act(async () => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
  })
  expect(
    get.mock.calls.filter(([url]) => url === '/api/user/2/group-ratios')
  ).toHaveLength(1)
  expect(
    screen.getByRole('spinbutton', { name: 'Final group multiplier' })
  ).toHaveValue(0.6)
})

it('waits for the current saved version before allowing edits when reopening a cached discount', async () => {
  const { get, client, view } = renderDrawer()
  await screen.findByRole('spinbutton', { name: 'Final group multiplier' })
  view.unmount()
  let resolveLoad!: () => void
  const pending = new Promise<void>((resolve) => {
    resolveLoad = resolve
  })
  get.mockImplementation(async (url) => {
    if (url === '/api/user/2/group-ratios') {
      await pending
      return {
        data: {
          success: true,
          data: { ...snapshot, rules: [{ ...rule, ratio: 0.3, version: 2 }] },
        },
      }
    }
    if (url === '/api/group/') {
      return { data: { success: true, data: ['default', 'vip'] } }
    }
    if (url === '/api/status') return { data: { success: true, data: {} } }
    throw new Error(`Unexpected URL ${url}`)
  })
  render(
    <QueryClientProvider client={client}>
      <UserGroupDiscountsDialog open onOpenChange={vi.fn()} user={target} />
    </QueryClientProvider>
  )
  expect(
    screen.queryByRole('spinbutton', { name: 'Final group multiplier' })
  ).not.toBeInTheDocument()
  await act(async () => resolveLoad())
  expect(
    await screen.findByRole('spinbutton', { name: 'Final group multiplier' })
  ).toHaveValue(0.3)
})

it.each([
  [10, 10],
  [10, 100],
  [1, 1],
])(
  'does not fetch group discounts for an operator role %s managing role %s',
  async (operator, role) => {
    const { get } = renderDrawer(operator, role)
    await screen.findByText(
      'No permission to access users of same or higher level'
    )
    expect(
      screen.queryByRole('form', { name: 'Group discounts' })
    ).not.toBeInTheDocument()
    expect(
      get.mock.calls.some(([url]) => url === '/api/user/2/group-ratios')
    ).toBe(false)
  }
)
