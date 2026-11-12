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
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import { buildRequestPayload } from '../../lib/image-utils'
import { ImageParameterForm } from '../image-parameter-form'

function ParameterWorkbench(props: { disabled?: boolean }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [enabled, setEnabled] = useState(DEFAULT_PARAMETER_ENABLED)
  return (
    <>
      <ImageParameterForm
        config={config}
        disabled={props.disabled}
        parameterEnabled={enabled}
        onConfigChange={(key, value) =>
          setConfig((previous) => ({ ...previous, [key]: value }))
        }
        onParameterEnabledChange={(key, value) =>
          setEnabled((previous) => ({ ...previous, [key]: value }))
        }
      />
      <output aria-label='Request preview'>
        {JSON.stringify(buildRequestPayload(config, enabled))}
      </output>
      <output aria-label='Batch size'>{config.n}</output>
    </>
  )
}

function requestPreview() {
  return JSON.parse(
    screen.getByLabelText('Request preview').textContent ?? '{}'
  ) as Record<string, unknown>
}

describe('image workbench parameter controls', () => {
  it('offers reference quality, resolution and ratio presets that produce pixel sizes', async () => {
    const user = userEvent.setup()
    render(<ParameterWorkbench />)
    const quality = within(screen.getByRole('group', { name: 'Quality' }))
    expect(quality.getAllByRole('button')).toHaveLength(4)
    expect(quality.getByRole('button', { name: 'Auto' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('spinbutton', { name: 'Width' })).toBeEnabled()
    quality.getByRole('button', { name: 'High' }).focus()
    await user.keyboard(' ')
    await user.click(
      within(screen.getByRole('group', { name: 'Aspect ratio' })).getByRole(
        'button',
        { name: '16:9' }
      )
    )
    expect(requestPreview()).toMatchObject({
      quality: 'high',
      size: '3840x2160',
    })
    await user.click(
      within(screen.getByRole('group', { name: 'Resolution' })).getByRole(
        'button',
        { name: '2k' }
      )
    )
    expect(requestPreview()).toMatchObject({
      quality: 'high',
      size: '2048x1152',
    })
    expect(screen.getByRole('spinbutton', { name: 'Width' })).toHaveValue(2048)
    expect(screen.getByRole('spinbutton', { name: 'Height' })).toHaveValue(1152)
    expect(requestPreview()).not.toHaveProperty('resolution')
    expect(requestPreview()).not.toHaveProperty('aspect_ratio')
  })

  it('rounds custom dimensions up to sixteen pixels only while alignment is on', async () => {
    const user = userEvent.setup()
    render(<ParameterWorkbench />)
    await user.click(
      within(screen.getByRole('group', { name: 'Resolution' })).getByRole(
        'button',
        { name: '1k' }
      )
    )
    let width = screen.getByRole('spinbutton', { name: 'Width' })
    await user.clear(width)
    await user.type(width, '1025')
    await user.tab()
    expect(requestPreview().size).toBe('1040x1024')
    await user.click(screen.getByRole('switch', { name: 'Align to 16 pixels' }))
    width = screen.getByRole('spinbutton', { name: 'Width' })
    await user.clear(width)
    await user.type(width, '1025')
    await user.tab()
    expect(requestPreview().size).toBe('1025x1024')
  })

  it('defaults to PNG and shows bounded GIF controls without extra advanced parameters', async () => {
    const user = userEvent.setup()
    render(<ParameterWorkbench />)
    const formats = within(screen.getByRole('group', { name: 'Output format' }))
    expect(formats.getAllByRole('button')).toHaveLength(2)
    expect(formats.getByRole('button', { name: 'png' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.queryByRole('spinbutton', { name: 'Frame count' })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('switch', { name: 'Transparent background' })
    )
    expect(requestPreview().background).toBe('transparent')
    await user.click(formats.getByRole('button', { name: 'gif' }))
    expect(requestPreview()).toMatchObject({
      output_format: 'gif',
      frame_count: 9,
      frame_duration_ms: 200,
    })
    expect(requestPreview()).not.toHaveProperty('background')
    expect(
      screen.getByRole('switch', { name: 'Transparent background' })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'Transparent background' })
    ).not.toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Align to 16 pixels' })
    ).toHaveAttribute('aria-disabled', 'true')
    const frames = screen.getByRole('spinbutton', { name: 'Frame count' })
    await user.clear(frames)
    await user.type(frames, '99')
    await user.tab()
    const duration = screen.getByRole('spinbutton', {
      name: 'Frame duration (ms)',
    })
    await user.clear(duration)
    await user.type(duration, '237')
    await user.tab()
    expect(requestPreview()).toMatchObject({
      frame_count: 16,
      frame_duration_ms: 240,
    })
    expect(screen.queryByText('Advanced parameters')).not.toBeInTheDocument()
    expect(screen.queryByText('Art style')).not.toBeInTheDocument()
    expect(screen.queryByText('Response format')).not.toBeInTheDocument()
    expect(screen.queryByText('Compression')).not.toBeInTheDocument()
    await user.click(formats.getByRole('button', { name: 'png' }))
    expect(requestPreview()).not.toHaveProperty('frame_count')
    expect(requestPreview()).not.toHaveProperty('frame_duration_ms')
    expect(
      screen.queryByRole('spinbutton', { name: 'Frame count' })
    ).not.toBeInTheDocument()
  })
  it('bounds an oversized custom dimension before it reaches the request', async () => {
    const user = userEvent.setup()
    render(<ParameterWorkbench />)
    await user.click(
      within(screen.getByRole('group', { name: 'Resolution' })).getByRole(
        'button',
        { name: '1k' }
      )
    )
    const width = screen.getByRole('spinbutton', { name: 'Width' })
    await user.clear(width)
    await user.type(width, '999999')
    await user.tab()
    expect(requestPreview().size).toBe('3840x1024')
  })

  it('allows a bounded custom batch count while each request still asks for one image', async () => {
    const user = userEvent.setup()
    render(<ParameterWorkbench />)
    const count = screen.getByRole('spinbutton', { name: 'Custom image count' })
    await user.clear(count)
    await user.type(count, '6')
    await user.tab()
    expect(screen.getByLabelText('Batch size')).toHaveTextContent('6')
    expect(requestPreview().n).toBe(1)
    await user.clear(
      screen.getByRole('spinbutton', { name: 'Custom image count' })
    )
    await user.type(
      screen.getByRole('spinbutton', { name: 'Custom image count' }),
      '99'
    )
    await user.tab()
    expect(screen.getByLabelText('Batch size')).toHaveTextContent('10')
  })

  it('keeps settings disabled during a running generation', () => {
    render(<ParameterWorkbench disabled />)
    expect(
      screen.getByRole('spinbutton', { name: 'Custom image count' })
    ).toBeDisabled()
    expect(
      screen.getByRole('switch', { name: 'Transparent background' })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(screen.getByRole('group', { name: 'Quality' })).getByRole(
        'button',
        { name: 'High' }
      )
    ).toBeDisabled()
  })
})
