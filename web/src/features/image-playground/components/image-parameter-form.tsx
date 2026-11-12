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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  IMAGE_ASPECT_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  GIF_FRAME_DURATION_STEP,
  MAX_GIF_FRAME_COUNT,
  MAX_GIF_FRAME_DURATION_MS,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_N,
  MIN_IMAGE_N,
  MIN_GIF_FRAME_COUNT,
  MIN_GIF_FRAME_DURATION_MS,
  OUTPUT_FORMAT_OPTIONS,
  QUALITY_OPTIONS,
} from '../constants'
import {
  clampImageN,
  clampGifFrameCount,
  clampGifFrameDuration,
  imageSizeForPreset,
  normalizeImageDimension,
  readImageSizeSettings,
} from '../lib/image-utils'
import type { ImageParameterEnabled, ImagePlaygroundConfig } from '../types'

type ImageParameterFormProps = {
  compact?: boolean
  config: ImagePlaygroundConfig
  disabled?: boolean
  onConfigChange: <K extends keyof ImagePlaygroundConfig>(
    key: K,
    value: ImagePlaygroundConfig[K]
  ) => void
  onParameterEnabledChange: (
    key: keyof ImageParameterEnabled,
    value: boolean
  ) => void
  parameterEnabled: ImageParameterEnabled
}

function DimensionField(props: {
  axis: 'width' | 'height'
  value: number
  align: boolean
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  return (
    <InputGroup className='h-9 rounded-xl'>
      <InputGroupAddon aria-hidden='true'>
        {props.axis === 'width' ? 'W' : 'H'}
      </InputGroupAddon>
      <InputGroupInput
        aria-label={props.axis === 'width' ? t('Width') : t('Height')}
        defaultValue={props.value}
        disabled={props.disabled}
        key={props.value}
        max={MAX_IMAGE_DIMENSION}
        min={1}
        type='number'
        onBlur={(event) => {
          const value =
            event.currentTarget.value === ''
              ? props.value
              : Number(event.currentTarget.value)
          const normalized = normalizeImageDimension(value, props.align)
          event.currentTarget.value = String(normalized)
          props.onChange(normalized)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />
    </InputGroup>
  )
}

export function ImageParameterForm(props: ImageParameterFormProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [alignDimensions, setAlignDimensions] = useState(true)
  const alignToGrid = alignDimensions || props.config.outputFormat === 'gif'
  const dimensions = readImageSizeSettings(props.config.size)
  const fieldId = useId()
  const canUseTransparency = ['png', 'webp'].includes(props.config.outputFormat)
  const formatOptions = OUTPUT_FORMAT_OPTIONS.some(
    (option) => option.value === props.config.outputFormat
  )
    ? OUTPUT_FORMAT_OPTIONS
    : [
        ...OUTPUT_FORMAT_OPTIONS,
        { value: props.config.outputFormat, label: props.config.outputFormat },
      ]

  const applySize = (size: string) => {
    props.onConfigChange('size', size)
    props.onParameterEnabledChange('size', true)
  }

  return (
    <FieldGroup className='gap-5'>
      <p className='text-muted-foreground text-xs leading-5'>
        {t('Parameter support depends on the selected model.')}
      </p>
      <Field>
        <FieldLabel id={`${fieldId}-quality-label`}>{t('Quality')}</FieldLabel>
        <ToggleGroup
          aria-labelledby={`${fieldId}-quality-label`}
          className='grid w-full grid-cols-4 gap-2'
          disabled={props.disabled}
          spacing={2}
          value={[props.config.quality]}
          variant='outline'
          onValueChange={(values) => {
            if (!values[0]) return
            props.onConfigChange('quality', String(values[0]))
            props.onParameterEnabledChange('quality', true)
          }}
        >
          {QUALITY_OPTIONS.map((option) => (
            <ToggleGroupItem
              className='aria-pressed:border-foreground h-9 min-w-0 rounded-full px-1'
              key={option.value}
              value={option.value}
            >
              {t(option.descriptionKey ?? option.label)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <FieldLabel>{t('Image size')}</FieldLabel>
          <div className='flex items-center gap-2'>
            <Label
              className='text-muted-foreground text-xs'
              htmlFor={`${fieldId}-align-dimensions`}
            >
              {t('Align to 16 pixels')}
            </Label>
            <Switch
              id={`${fieldId}-align-dimensions`}
              checked={alignToGrid}
              disabled={props.disabled || props.config.outputFormat === 'gif'}
              onCheckedChange={setAlignDimensions}
            />
          </div>
        </div>
        <div className='grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2'>
          <DimensionField
            axis='width'
            value={dimensions.width}
            align={alignToGrid}
            disabled={props.disabled || dimensions.ratio === 'auto'}
            onChange={(width) =>
              applySize(
                `${width}x${normalizeImageDimension(dimensions.height, alignToGrid)}`
              )
            }
          />
          <span aria-hidden='true' className='text-muted-foreground'>
            ↔
          </span>
          <DimensionField
            axis='height'
            value={dimensions.height}
            align={alignToGrid}
            disabled={props.disabled || dimensions.ratio === 'auto'}
            onChange={(height) =>
              applySize(
                `${normalizeImageDimension(dimensions.width, alignToGrid)}x${height}`
              )
            }
          />
        </div>
      </Field>

      <Field>
        <FieldLabel id={`${fieldId}-resolution-label`}>
          {t('Resolution')}
        </FieldLabel>
        <ToggleGroup
          aria-labelledby={`${fieldId}-resolution-label`}
          className='grid w-full grid-cols-4 gap-2'
          disabled={props.disabled}
          spacing={2}
          value={[dimensions.resolution]}
          variant='outline'
          onValueChange={(values) => {
            if (values[0]) {
              applySize(
                imageSizeForPreset(
                  String(values[0]),
                  dimensions.ratio === 'auto' ? '1:1' : dimensions.ratio
                )
              )
            }
          }}
        >
          {IMAGE_RESOLUTION_OPTIONS.map((value) => (
            <ToggleGroupItem
              className='aria-pressed:border-foreground h-9 min-w-0 rounded-full px-1'
              key={value}
              value={value}
            >
              {value === 'auto' ? t('Auto') : value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field>
        <FieldLabel id={`${fieldId}-aspect-label`}>
          {t('Aspect ratio')}
        </FieldLabel>
        <ToggleGroup
          aria-labelledby={`${fieldId}-aspect-label`}
          className='grid w-full grid-cols-4 gap-2'
          disabled={props.disabled}
          spacing={2}
          value={[dimensions.ratio]}
          variant='outline'
          onValueChange={(values) => {
            if (values[0]) {
              applySize(
                imageSizeForPreset(dimensions.resolution, String(values[0]))
              )
            }
          }}
        >
          {IMAGE_ASPECT_OPTIONS.map((option) => (
            <ToggleGroupItem
              className='aria-pressed:border-foreground h-[72px] min-w-0 flex-col gap-1.5 rounded-xl px-1'
              key={option.value}
              value={option.value}
            >
              <span
                aria-hidden='true'
                className='grid h-7 w-9 place-items-center'
              >
                {option.width && option.height ? (
                  <span
                    className='border-2 border-current'
                    style={{
                      width: Math.max(
                        10,
                        24 * Math.min(1, option.width / option.height)
                      ),
                      height: Math.max(
                        10,
                        24 * Math.min(1, option.height / option.width)
                      ),
                    }}
                  />
                ) : null}
              </span>
              {option.value === 'auto' ? t('Auto') : option.value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field orientation='horizontal'>
        <FieldLabel className='flex-1' htmlFor={`${fieldId}-transparent`}>
          {t('Transparent background')}
        </FieldLabel>
        <Switch
          id={`${fieldId}-transparent`}
          checked={
            canUseTransparency &&
            props.parameterEnabled.background &&
            props.config.background === 'transparent'
          }
          disabled={props.disabled || !canUseTransparency}
          onCheckedChange={(checked) => {
            props.onConfigChange('background', checked ? 'transparent' : 'auto')
            props.onParameterEnabledChange('background', checked)
          }}
        />
      </Field>

      <Field>
        <FieldLabel id={`${fieldId}-format-label`}>
          {t('Output format')}
        </FieldLabel>
        <ToggleGroup
          aria-labelledby={`${fieldId}-format-label`}
          className='grid w-full grid-cols-2 gap-2'
          disabled={props.disabled}
          spacing={2}
          value={[props.config.outputFormat]}
          variant='outline'
          onValueChange={(values) => {
            if (!values[0]) return
            props.onConfigChange('outputFormat', String(values[0]))
            props.onParameterEnabledChange('outputFormat', true)
            if (values[0] === 'gif' && /^\d+x\d+$/.test(props.config.size)) {
              applySize(
                `${normalizeImageDimension(dimensions.width, true)}x${normalizeImageDimension(dimensions.height, true)}`
              )
            }
            if (!['png', 'webp'].includes(String(values[0]))) {
              props.onConfigChange('background', 'auto')
              props.onParameterEnabledChange('background', false)
            }
          }}
        >
          {formatOptions.map((option) => (
            <ToggleGroupItem
              className='aria-pressed:border-foreground h-9 min-w-0 rounded-full px-1 uppercase'
              key={option.value}
              value={option.value}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      {props.config.outputFormat === 'gif' ? (
        <div className='grid grid-cols-2 gap-3'>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-frame-count`}>
              {t('Frame count')}
            </FieldLabel>
            <Input
              id={`${fieldId}-frame-count`}
              className='h-9 rounded-full'
              defaultValue={props.config.frameCount}
              disabled={props.disabled}
              key={props.config.frameCount}
              min={MIN_GIF_FRAME_COUNT}
              max={MAX_GIF_FRAME_COUNT}
              type='number'
              onBlur={(event) => {
                const value = clampGifFrameCount(
                  Number(event.currentTarget.value)
                )
                event.currentTarget.value = String(value)
                props.onConfigChange('frameCount', value)
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-frame-duration`}>
              {t('Frame duration (ms)')}
            </FieldLabel>
            <Input
              id={`${fieldId}-frame-duration`}
              className='h-9 rounded-full'
              defaultValue={props.config.frameDurationMs}
              disabled={props.disabled}
              key={props.config.frameDurationMs}
              min={MIN_GIF_FRAME_DURATION_MS}
              max={MAX_GIF_FRAME_DURATION_MS}
              step={GIF_FRAME_DURATION_STEP}
              type='number'
              onBlur={(event) => {
                const value = clampGifFrameDuration(
                  Number(event.currentTarget.value)
                )
                event.currentTarget.value = String(value)
                props.onConfigChange('frameDurationMs', value)
              }}
            />
          </Field>
        </div>
      ) : null}

      <Field>
        <FieldLabel id={`${fieldId}-count-label`}>
          {t('Image count')}
        </FieldLabel>
        <ToggleGroup
          aria-labelledby={`${fieldId}-count-label`}
          className='grid w-full grid-cols-4 gap-2'
          disabled={props.disabled}
          spacing={2}
          value={[String(props.config.n)]}
          variant='outline'
          onValueChange={(values) => {
            if (!values[0]) return
            props.onConfigChange('n', clampImageN(Number(values[0])))
            props.onParameterEnabledChange('n', true)
          }}
        >
          {Array.from({ length: MAX_IMAGE_N }, (_, index) => index + 1).map(
            (value) => (
              <ToggleGroupItem
                className='aria-pressed:border-foreground h-9 min-w-0 rounded-full px-1'
                key={value}
                value={String(value)}
              >
                {formatNumber(value, locale)}
              </ToggleGroupItem>
            )
          )}
          <Input
            aria-label={t('Custom image count')}
            className='col-span-2 h-9 rounded-full text-center'
            defaultValue={props.config.n}
            disabled={props.disabled}
            key={props.config.n}
            max={MAX_IMAGE_N}
            min={MIN_IMAGE_N}
            type='number'
            onBlur={(event) => {
              const value = clampImageN(Number(event.currentTarget.value))
              event.currentTarget.value = String(value)
              props.onConfigChange('n', value)
              props.onParameterEnabledChange('n', true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </ToggleGroup>
        <p className='text-muted-foreground text-xs leading-4'>
          {t('Each image is billed separately.')}
        </p>
      </Field>
    </FieldGroup>
  )
}
