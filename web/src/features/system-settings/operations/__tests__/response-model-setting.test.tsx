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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { OperationsSettings } from '..'

let client: QueryClient
let enabled: boolean | undefined
const previousConfig = useSystemConfigStore.getState().config

beforeEach(() => {
  enabled = undefined
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useSystemConfigStore
    .getState()
    .setConfig({ responseModelMismatchEnabled: true })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/option/') {
      return {
        data: {
          success: true,
          data:
            enabled === undefined
              ? []
              : [
                  {
                    key: 'ResponseModelMismatchEnabled',
                    value: String(enabled),
                  },
                ],
        },
      }
    }
    if (url === '/api/status') {
      return {
        data: {
          success: true,
          data: { response_model_mismatch_enabled: enabled ?? true },
        },
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.spyOn(api, 'put').mockImplementation(async (_url, request) => {
    enabled = (request as { value: boolean }).value
    return { data: { success: true } }
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useSystemConfigStore.getState().setConfig(previousConfig)
})

async function renderSettings() {
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const route = createRoute({
    getParentRoute: () => authenticated,
    path: '/system-settings/operations/$section',
    component: OperationsSettings,
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([route])]),
    history: createMemoryHistory({
      initialEntries: ['/system-settings/operations/behavior'],
    }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await act(() => router.load())
  return screen.findByRole('switch', { name: 'Response model mismatch' })
}

test('saves only the changed diagnostic switch, refreshes logs, and restores it after re-enabling', async () => {
  const user = userEvent.setup()
  client.setQueryData(['logs', 'common', 'root'], { items: [] })
  const toggle = await renderSettings()
  expect(toggle).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(api.put).not.toHaveBeenCalled()

  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledExactlyOnceWith('/api/option/', {
      key: 'ResponseModelMismatchEnabled',
      value: false,
    })
  )
  await waitFor(() =>
    expect(
      useSystemConfigStore.getState().config.responseModelMismatchEnabled
    ).toBe(false)
  )
  expect(client.getQueryState(['logs', 'common', 'root'])?.isInvalidated).toBe(
    true
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  )

  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenLastCalledWith('/api/option/', {
      key: 'ResponseModelMismatchEnabled',
      value: true,
    })
  )
  await waitFor(() =>
    expect(
      useSystemConfigStore.getState().config.responseModelMismatchEnabled
    ).toBe(true)
  )
})

test('a rejected save keeps the active diagnostic setting and allows retry', async () => {
  const user = userEvent.setup()
  vi.mocked(api.put).mockResolvedValueOnce({
    data: { success: false, message: 'Setting save failed' },
  })
  const toggle = await renderSettings()
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  )
  expect(
    useSystemConfigStore.getState().config.responseModelMismatchEnabled
  ).toBe(true)
  expect(toggle).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(
      useSystemConfigStore.getState().config.responseModelMismatchEnabled
    ).toBe(false)
  )
})
