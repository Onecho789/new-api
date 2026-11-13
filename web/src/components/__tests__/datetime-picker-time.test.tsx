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
import { afterEach, expect, test, vi } from 'vitest'

import { DateTimePicker } from '../datetime-picker'

afterEach(() => vi.unstubAllEnvs())

test('selects a Beijing calendar day without shifting it to the browser calendar day', async () => {
  vi.stubEnv('TZ', 'America/New_York')
  const onChange = vi.fn()
  render(
    <DateTimePicker
      timeZone='Asia/Shanghai'
      value={new Date('2026-03-08T00:30:45+08:00')}
      onChange={onChange}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: '2026-03-08' }))
  await userEvent.click(screen.getByRole('button', { name: /Monday, March 9/ }))
  expect(onChange.mock.calls[0][0].getTime()).toBe(
    Date.parse('2026-03-09T00:30:45+08:00')
  )
})

test.each(['America/New_York', 'Europe/Berlin', 'UTC'])(
  'edits Beijing wall time independently of browser timezone %s with a daylight-saving gap',
  (timeZone) => {
    vi.stubEnv('TZ', timeZone)
    const onChange = vi.fn()
    render(
      <DateTimePicker
        timeZone='Asia/Shanghai'
        value={new Date('2026-03-08T00:30:45+08:00')}
        onChange={onChange}
      />
    )
    expect(screen.getByRole('button', { name: '2026-03-08' })).toBeVisible()
    expect(screen.getByLabelText('Time')).toHaveValue('00:30:45')
    fireEvent.change(screen.getByLabelText('Time'), {
      target: { value: '02:30:15' },
    })
    expect(onChange.mock.calls[0][0].getTime()).toBe(
      Date.parse('2026-03-08T02:30:15+08:00')
    )
  }
)

test('shows the seconds of the selected time', () => {
  render(
    <DateTimePicker
      value={new Date(2026, 9, 11, 8, 30, 45)}
      onChange={() => undefined}
    />
  )
  expect(screen.getByLabelText('Time')).toHaveValue('08:30:45')
})

test('keeps the seconds typed into the time field', () => {
  const onChange = vi.fn()
  render(
    <DateTimePicker
      value={new Date(2026, 9, 11, 8, 0, 0)}
      onChange={onChange}
    />
  )
  fireEvent.change(screen.getByLabelText('Time'), {
    target: { value: '08:30:45' },
  })
  expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 9, 11, 8, 30, 45))
})

test('reads a time without seconds as zero seconds', () => {
  const onChange = vi.fn()
  render(
    <DateTimePicker
      value={new Date(2026, 9, 11, 8, 0, 30)}
      onChange={onChange}
    />
  )
  fireEvent.change(screen.getByLabelText('Time'), {
    target: { value: '09:15' },
  })
  expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 9, 11, 9, 15, 0))
})

test('keeps the current time when the time field is emptied', () => {
  const onChange = vi.fn()
  render(
    <DateTimePicker
      value={new Date(2026, 9, 11, 20, 30, 45)}
      onChange={onChange}
    />
  )
  const field = screen.getByLabelText('Time')
  fireEvent.change(field, { target: { value: '' } })
  expect(onChange).not.toHaveBeenCalled()
  expect(field).toHaveValue('20:30:45')
})
