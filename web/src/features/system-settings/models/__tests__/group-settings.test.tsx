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
import { zodResolver } from '@hookform/resolvers/zod'
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { positiveIntegerSchema } from '../../utils/numeric-field'
import { GroupOverrideSchedule } from '../group-override-schedule'
import { GroupRatioForm } from '../group-ratio-form'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const defaults = {
  GroupRatio: '{"default":1,"vip":0.8}',
  TopupGroupRatio: '{"vip":1.2}',
  UserUsableGroups: '{"default":"Standard access","vip":"Premium access"}',
  GroupGroupRatio: '{}',
  AutoGroups: '["default","vip"]',
  MaxTokenAutoGroups: 5,
  DefaultUseAutoGroup: false,
  GroupSpecialUsableGroup: '{}',
}

const schema = z.object({
  GroupRatio: z.string(),
  TopupGroupRatio: z.string(),
  UserUsableGroups: z.string(),
  GroupGroupRatio: z.string(),
  AutoGroups: z.string(),
  MaxTokenAutoGroups: positiveIntegerSchema('Enter a positive integer'),
  DefaultUseAutoGroup: z.boolean(),
  GroupSpecialUsableGroup: z.string(),
})

function Fixture(props: {
  onSave?: (values: typeof defaults) => Promise<void>
  initial?: Partial<typeof defaults>
  isSaving?: boolean
}) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const form = useForm({
    defaultValues: { ...defaults, ...props.initial },
    resolver: zodResolver(schema),
  })
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div ref={setActions} />
      <GroupRatioForm
        form={form}
        onSave={props.onSave ?? (async () => {})}
        isSaving={props.isSaving ?? false}
      />
    </SettingsPageProvider>
  )
}

describe('group settings workspace', () => {
  it('reads legacy and scheduled special ratios, preserves small values and shows each schedule status', async () => {
    const now = Date.parse('2026-11-13T12:00:00+08:00') / 1000
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000)
    const rules = {
      vip: {
        default: 0.00005,
        vip: { ratio: 0.005, enabled: true, starts_at: now, ends_at: now + 60 },
        future: { ratio: 0.2, enabled: true, starts_at: now + 60, ends_at: 0 },
        expired: { ratio: 0.3, enabled: true, starts_at: 0, ends_at: now },
        disabled: {
          ratio: 0.4,
          enabled: false,
          starts_at: now + 60,
          ends_at: 0,
        },
      },
    }
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(
      <Fixture
        onSave={onSave}
        initial={{ GroupGroupRatio: JSON.stringify(rules) }}
      />
    )
    await userEvent.click(
      screen.getByRole('tab', { name: 'Special ratio rules' })
    )
    expect(screen.getByText('0.00005')).toBeVisible()
    expect(screen.getByText('0.005')).toBeVisible()
    expect(screen.getAllByText('In effect')).toHaveLength(2)
    expect(screen.getByText('Not started')).toBeVisible()
    expect(screen.getByText('Expired')).toBeVisible()
    expect(screen.getByText('Manually disabled')).toBeVisible()
    expect(screen.getAllByText(/12:00:00/).length).toBeGreaterThan(0)
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to JSON' })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to Visual' })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].GroupGroupRatio)).toEqual(rules)
  })

  it('edits a scheduled rule, validates its end time and keeps unrelated rules unchanged', async () => {
    const start = Date.parse('2026-11-13T12:00:00+08:00') / 1000
    const original = {
      vip: {
        default: {
          ratio: 0.005,
          enabled: true,
          starts_at: start,
          ends_at: start + 3600,
        },
        vip: 0.8,
      },
      untouched: {
        default: { ratio: 0.02, enabled: false, starts_at: 0, ends_at: 0 },
      },
    }
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(
      <Fixture
        onSave={onSave}
        initial={{ GroupGroupRatio: JSON.stringify(original) }}
      />
    )
    await userEvent.click(
      screen.getByRole('tab', { name: 'Special ratio rules' })
    )
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Edit ratio override' })
    )
    expect(dialog.getByRole('textbox', { name: 'Ratio' })).toHaveValue('0.005')
    const end = within(
      dialog.getByRole('group', { name: 'End time (Beijing time)' })
    ).getByLabelText('Time')
    fireEvent.change(end, { target: { value: '11:59:59' } })
    await userEvent.click(dialog.getByRole('button', { name: 'Update' }))
    expect(dialog.getByRole('alert')).toHaveTextContent(
      'End time must be after start time'
    )
    fireEvent.change(end, { target: { value: '13:00:01' } })
    await userEvent.click(
      dialog.getByRole('switch', { name: 'Enable special ratio' })
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Update' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].GroupGroupRatio)).toEqual({
      ...original,
      vip: {
        ...original.vip,
        default: {
          ...original.vip.default,
          enabled: false,
          ends_at: start + 3601,
        },
      },
    })
  })

  it('changes scheduled status exactly at the inclusive start and exclusive end without a page refresh', () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-11-13T12:00:00+08:00')
    vi.setSystemTime(now)
    render(
      <GroupOverrideSchedule
        rule={{
          ratio: 0.5,
          enabled: true,
          starts_at: now / 1000 + 1,
          ends_at: now / 1000 + 2,
        }}
      />
    )
    expect(screen.getByText('Not started')).toBeVisible()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('In effect')).toBeVisible()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Expired')).toBeVisible()
  })

  it('shows incoming and outgoing scheduled rules in group details without treating objects as multipliers', async () => {
    const now = Math.floor(Date.now() / 1000)
    render(
      <Fixture
        initial={{
          GroupGroupRatio: JSON.stringify({
            vip: {
              default: {
                ratio: 0.005,
                enabled: false,
                starts_at: 0,
                ends_at: 0,
              },
            },
            default: {
              vip: {
                ratio: 0.000005,
                enabled: true,
                starts_at: now + 3600,
                ends_at: 0,
              },
            },
          }),
        }}
      />
    )
    await userEvent.click(screen.getAllByRole('button', { name: 'Details' })[0])
    const detail = within(
      await screen.findByRole('dialog', { name: 'Group details: default' })
    )
    expect(detail.getByText('0.005')).toBeVisible()
    expect(detail.getByText('0.000005')).toBeVisible()
    expect(detail.getByText('Manually disabled')).toBeVisible()
    expect(detail.getByText('Not started')).toBeVisible()
    expect(detail.getAllByText(/No end time/)).toHaveLength(2)
  })

  it('allows clearing both schedule boundaries and keeps manual disablement in the saved object', async () => {
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    const timestamp = Date.parse('2026-11-13T12:00:00+08:00') / 1000
    render(
      <Fixture
        onSave={onSave}
        initial={{
          GroupGroupRatio: JSON.stringify({
            vip: {
              default: {
                ratio: 0.000005,
                enabled: false,
                starts_at: timestamp,
                ends_at: timestamp + 3600,
              },
            },
          }),
        }}
      />
    )
    await userEvent.click(
      screen.getByRole('tab', { name: 'Special ratio rules' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Edit ratio override' })
    )
    for (const label of [
      'Start time (Beijing time)',
      'End time (Beijing time)',
    ]) {
      await userEvent.click(
        within(dialog.getByRole('group', { name: label })).getByRole('button', {
          name: 'Clear',
        })
      )
    }
    expect(
      dialog.getByRole('switch', { name: 'Enable special ratio' })
    ).not.toBeChecked()
    await userEvent.click(dialog.getByRole('button', { name: 'Update' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].GroupGroupRatio)).toEqual({
      vip: {
        default: { ratio: 0.000005, enabled: false, starts_at: 0, ends_at: 0 },
      },
    })
  })

  it.each(['-1', 'Infinity', '9007199254740992', ''])(
    'rejects invalid special multiplier %s without saving the rule',
    async (value) => {
      render(
        <Fixture
          initial={{ GroupGroupRatio: '{"vip":{"default":0.000005}}' }}
        />
      )
      await userEvent.click(
        screen.getByRole('tab', { name: 'Special ratio rules' })
      )
      await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
      const dialog = within(
        await screen.findByRole('dialog', { name: 'Edit ratio override' })
      )
      fireEvent.change(dialog.getByRole('textbox', { name: 'Ratio' }), {
        target: { value },
      })
      await userEvent.click(dialog.getByRole('button', { name: 'Update' }))
      expect(dialog.getByRole('alert')).toHaveTextContent(
        'Enter a valid non-negative multiplier'
      )
    }
  )
  it('filters by description and clears search without discarding edits', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    const search = screen.getByRole('textbox', {
      name: 'Search groups by name or description',
    })
    await user.type(search, 'PREMIUM')
    expect(screen.getAllByRole('textbox', { name: 'Group name' })).toHaveLength(
      1
    )
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveValue(
      'vip'
    )
    await user.clear(screen.getByRole('spinbutton', { name: 'Ratio' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Ratio' }), '0.6')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('textbox', { name: 'Group name' })).toHaveLength(
      2
    )
    expect(screen.getAllByRole('spinbutton', { name: 'Ratio' })[1]).toHaveValue(
      0.6
    )
    await user.type(search, 'missing')
    expect(screen.getByText('No results found')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(search).toHaveValue('')
    expect(
      screen
        .getAllByRole<HTMLInputElement>('textbox', { name: 'Group name' })
        .map((input) => input.value)
    ).toEqual(['group_1', 'default', 'vip'])
    expect(screen.getAllByRole('spinbutton', { name: 'Ratio' })[2]).toHaveValue(
      0.6
    )
  })

  it('prepends consecutive new groups and saves them without changing existing settings', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: 'Add group' }))
    await user.click(screen.getByRole('button', { name: 'Add group' }))
    expect(
      screen
        .getAllByRole<HTMLInputElement>('textbox', { name: 'Group name' })
        .map((input) => input.value)
    ).toEqual(['group_2', 'group_1', 'default', 'vip'])

    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const saved = onSave.mock.calls[0][0]
    expect(JSON.parse(saved.GroupRatio)).toEqual({
      group_2: 1,
      group_1: 1,
      default: 1,
      vip: 0.8,
    })
    expect(JSON.parse(saved.UserUsableGroups)).toEqual({
      group_2: '',
      group_1: '',
      default: 'Standard access',
      vip: 'Premium access',
    })
    expect(JSON.parse(saved.TopupGroupRatio)).toEqual({ vip: 1.2 })
    expect(saved.AutoGroups).toBe(defaults.AutoGroups)
  })

  it('keeps unfinished visibility rules while switching sections and supports keyboard tabs', async () => {
    const user = userEvent.setup()
    render(
      <Fixture
        initial={{
          GroupSpecialUsableGroup: '{"vip":{"+:default":"Standard"}}',
        }}
      />
    )
    const pricing = screen.getByRole('tab', { name: 'Pricing groups' })
    pricing.focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(
      screen.getByRole('tab', { name: 'Special ratio rules' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.queryByRole('table', { name: 'Pricing groups' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Group visibility' }))
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(
      screen.getAllByRole('combobox', { name: 'Group name' })
    ).toHaveLength(2)
    await user.click(pricing)
    await user.click(screen.getByRole('tab', { name: 'Group visibility' }))
    expect(
      screen.getAllByRole('combobox', { name: 'Group name' })
    ).toHaveLength(2)
    const toggle = screen.getByRole('button', { name: 'Rules for vip' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('reorders and removes auto groups with named controls and saves across sections', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const list = screen.getByRole('list', { name: 'Auto group order' })
    expect(
      screen.getByRole('button', { name: 'Move default up' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move vip down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move vip up' }))
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('vip')
    await user.click(
      screen.getByRole('switch', { name: 'Default to auto groups' })
    )
    await user.click(screen.getByRole('button', { name: 'Remove default' }))
    expect(screen.getByRole('button', { name: 'Move vip up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move vip down' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        AutoGroups: '[\n  "vip"\n]',
        DefaultUseAutoGroup: true,
      })
    )
  })

  it('reorders from the drag handle with arrow keys, preserves unknown groups and saves the new order', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(
      <Fixture
        onSave={onSave}
        initial={{
          AutoGroups: '["default","vip","retired"]',
          MaxTokenAutoGroups: 1,
        }}
      />
    )
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const list = screen.getByRole('list', { name: 'Auto group order' })
    const handle = screen.getByRole('button', {
      name: 'Drag default to reorder',
    })
    handle.focus()
    await user.keyboard('{ArrowUp}')
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'default'
    )
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent(
      'default'
    )
    expect(handle).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent(
      'default'
    )
    expect(screen.getByText('Not in pricing table')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(JSON.parse(onSave.mock.calls[0][0].AutoGroups)).toEqual([
      'vip',
      'default',
      'retired',
    ])
  })

  it('keeps a single auto group unchanged when using its drag handle keyboard controls', async () => {
    const user = userEvent.setup()
    render(<Fixture initial={{ AutoGroups: '["default"]' }} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    const handle = screen.getByRole('button', {
      name: 'Drag default to reorder',
    })
    handle.focus()
    await user.keyboard('{ArrowUp}{ArrowDown}')
    const list = screen.getByRole('list', { name: 'Auto group order' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByRole('listitem')).toHaveTextContent('default')
    expect(handle).toHaveFocus()
    expect(
      screen.getByRole('button', { name: 'Move default up' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move default down' })
    ).toBeDisabled()
  })

  it('opens the auto section and focuses its invalid limit when saving from another section', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn(async (_values: typeof defaults) => {})
    render(<Fixture onSave={onSave} />)
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Maximum custom groups per token',
      }),
      { target: { value: '0' } }
    )
    await user.click(screen.getByRole('tab', { name: 'Pricing groups' }))
    await user.click(
      screen.getByRole('button', { name: 'Save group settings' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Auto group order' })
      ).toHaveAttribute('aria-selected', 'true')
    )
    const input = screen.getByRole('spinbutton', {
      name: 'Maximum custom groups per token',
    })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByText('Enter a positive integer')).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows empty state guidance and disables save during a pending request', async () => {
    const user = userEvent.setup()
    render(
      <Fixture
        isSaving
        initial={{
          GroupRatio: '{}',
          TopupGroupRatio: '{}',
          UserUsableGroups: '{}',
          AutoGroups: '[]',
        }}
      />
    )
    expect(
      screen.getByText('No groups yet. Add a group to get started.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: 'Special ratio rules' }))
    expect(
      screen.getByText('Base group ratios apply until you add an override.')
    ).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Auto group order' }))
    expect(screen.getByText('No auto groups configured')).toBeVisible()
  })

  it('preserves pricing edits when switching between visual and JSON editors', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    await user.clear(
      screen.getAllByRole('textbox', { name: 'Group description' })[1]
    )
    await user.type(
      screen.getAllByRole('textbox', { name: 'Group description' })[1],
      'Updated description'
    )
    await user.click(screen.getByRole('button', { name: 'Switch to JSON' }))
    await user.click(screen.getByRole('button', { name: 'Switch to Visual' }))
    expect(
      screen.getAllByRole('textbox', { name: 'Group description' })[1]
    ).toHaveValue('Updated description')
  })
})
