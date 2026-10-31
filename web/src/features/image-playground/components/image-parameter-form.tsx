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
import { TriangleAlertIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import {
  BACKGROUND_OPTIONS,
  MAX_COMPRESSION,
  MAX_IMAGE_N,
  MIN_COMPRESSION,
  MIN_IMAGE_N,
  OUTPUT_FORMAT_OPTIONS,
  QUALITY_OPTIONS,
  RESPONSE_FORMAT_OPTIONS,
  SIZE_OPTIONS,
  STYLE_OPTIONS,
} from '../constants'
import { clampCompression, clampImageN, supportsCompression } from '../lib'
import type {
  ImageParameterEnabled,
  ImagePlaygroundConfig,
  SelectOption,
} from '../types'

type ImageParameterFormProps = {
  config: ImagePlaygroundConfig
  disabled?: boolean
  /** 图生图下 size/quality 实测会被上游忽略，需要额外提示 */
  showIgnoredNotes?: boolean
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

type EnumFieldProps = {
  description?: string
  disabled?: boolean
  enabled: boolean
  /** 面向用户的本地化标签 */
  label: string
  /** 上游会忽略该参数时的提示，与 description 并列展示 */
  ignoredNote?: string
  /** 原始参数名，与 API 文档一致，便于对照排查 */
  paramName: string
  onEnabledChange: (value: boolean) => void
  onValueChange: (value: string) => void
  options: SelectOption[]
  value: string
}

/** 带开关的枚举字段：关闭时该参数不进请求体 */
function EnumField({
  description,
  disabled,
  enabled,
  label,
  ignoredNote,
  paramName,
  onEnabledChange,
  onValueChange,
  options,
  value,
}: EnumFieldProps) {
  const { t } = useTranslation()

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex items-baseline gap-1.5'>
          <Label>{label}</Label>
          <span className='text-muted-foreground font-mono text-xs'>
            {paramName}
          </span>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
      <Select
        items={options}
        value={value}
        onValueChange={(next) => next !== null && onValueChange(String(next))}
      >
        <SelectTrigger className='w-full' disabled={disabled || !enabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className='font-mono'>{option.label}</span>
                {option.descriptionKey ? (
                  <span className='text-muted-foreground ml-2 text-xs'>
                    {t(option.descriptionKey)}
                  </span>
                ) : null}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description ? (
        <p className='text-muted-foreground text-xs leading-4'>{description}</p>
      ) : null}
      {ignoredNote ? (
        <p className='flex gap-1.5 text-xs leading-4 text-amber-600 dark:text-amber-500'>
          <TriangleAlertIcon className='mt-0.5 size-3.5 shrink-0' />
          <span>{ignoredNote}</span>
        </p>
      ) : null}
    </div>
  )
}

export function ImageParameterForm({
  config,
  disabled,
  showIgnoredNotes,
  onConfigChange,
  onParameterEnabledChange,
  parameterEnabled,
}: ImageParameterFormProps) {
  const { t } = useTranslation()
  // 实测 gpt-image-2 两种模式都会忽略 size/quality，各给一句对应说明
  const sizeIgnoredNote = showIgnoredNotes
    ? t('Tested: gpt-image-2 picks the output size itself and ignores this.')
    : undefined
  const qualityIgnoredNote = showIgnoredNotes
    ? t('Tested: gpt-image-2 always reports quality auto and ignores this.')
    : undefined
  const canCompress =
    parameterEnabled.outputFormat && supportsCompression(config.outputFormat)

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <div className='text-sm font-medium'>{t('Parameters')}</div>
        <p className='text-muted-foreground text-xs leading-4'>
          {t('Only enabled parameters are sent with the request.')}
        </p>
      </div>

      <EnumField
        description={t('Output image dimensions')}
        disabled={disabled}
        enabled={parameterEnabled.size}
        ignoredNote={sizeIgnoredNote}
        label={t('Image size')}
        paramName='size'
        onEnabledChange={(value) => onParameterEnabledChange('size', value)}
        onValueChange={(value) => onConfigChange('size', value)}
        options={SIZE_OPTIONS}
        value={config.size}
      />

      <EnumField
        description={t('Generation quality preset')}
        disabled={disabled}
        enabled={parameterEnabled.quality}
        ignoredNote={qualityIgnoredNote}
        label={t('Quality')}
        paramName='quality'
        onEnabledChange={(value) => onParameterEnabledChange('quality', value)}
        onValueChange={(value) => onConfigChange('quality', value)}
        options={QUALITY_OPTIONS}
        value={config.quality}
      />

      <EnumField
        description={t('Only supported by dall-e-3')}
        disabled={disabled}
        enabled={parameterEnabled.style}
        ignoredNote={t(
          'Tested: gpt-image-2 rejects this outright with Unknown parameter.'
        )}
        label={t('Art style')}
        paramName='style'
        onEnabledChange={(value) => onParameterEnabledChange('style', value)}
        onValueChange={(value) => onConfigChange('style', value)}
        options={STYLE_OPTIONS}
        value={config.style}
      />

      <EnumField
        description={t('File format of the returned image')}
        disabled={disabled}
        enabled={parameterEnabled.outputFormat}
        label={t('Output format')}
        paramName='output_format'
        onEnabledChange={(value) =>
          onParameterEnabledChange('outputFormat', value)
        }
        onValueChange={(value) => onConfigChange('outputFormat', value)}
        options={OUTPUT_FORMAT_OPTIONS}
        value={config.outputFormat}
      />

      {/* 压缩率仅在 output_format 选了 jpeg/webp 时才有意义 */}
      <div className='space-y-1.5'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-baseline gap-1.5'>
            <Label htmlFor='image-compression'>{t('Compression')}</Label>
            <span className='text-muted-foreground font-mono text-xs'>
              output_compression
            </span>
          </div>
          <Switch
            checked={parameterEnabled.outputCompression}
            disabled={disabled || !canCompress}
            onCheckedChange={(value) =>
              onParameterEnabledChange('outputCompression', value)
            }
          />
        </div>
        <Input
          disabled={
            disabled || !canCompress || !parameterEnabled.outputCompression
          }
          id='image-compression'
          max={MAX_COMPRESSION}
          min={MIN_COMPRESSION}
          type='number'
          value={config.outputCompression}
          onChange={(e) =>
            onConfigChange(
              'outputCompression',
              clampCompression(Number(e.target.value))
            )
          }
        />
        <p className='text-muted-foreground text-xs leading-4'>
          {canCompress
            ? t(
                'Compression quality ({{min}} - {{max}}), lower means smaller',
                {
                  max: MAX_COMPRESSION,
                  min: MIN_COMPRESSION,
                }
              )
            : t('Enable output_format and pick jpeg or webp to use this.')}
        </p>
      </div>

      <EnumField
        description={t('Background of the generated image')}
        disabled={disabled}
        enabled={parameterEnabled.background}
        label={t('Background')}
        paramName='background'
        onEnabledChange={(value) =>
          onParameterEnabledChange('background', value)
        }
        onValueChange={(value) => onConfigChange('background', value)}
        options={BACKGROUND_OPTIONS}
        value={config.background}
      />

      <EnumField
        description={t('How image results are returned')}
        disabled={disabled}
        enabled={parameterEnabled.responseFormat}
        label={t('Response format')}
        paramName='response_format'
        onEnabledChange={(value) =>
          onParameterEnabledChange('responseFormat', value)
        }
        onValueChange={(value) => onConfigChange('responseFormat', value)}
        options={RESPONSE_FORMAT_OPTIONS}
        value={config.responseFormat}
      />

      <div className='space-y-1.5'>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-baseline gap-1.5'>
            <Label htmlFor='image-n'>{t('Image count')}</Label>
            <span className='text-muted-foreground font-mono text-xs'>n</span>
          </div>
          <Switch
            checked={parameterEnabled.n}
            disabled={disabled}
            onCheckedChange={(value) => onParameterEnabledChange('n', value)}
          />
        </div>
        <Input
          disabled={disabled || !parameterEnabled.n}
          id='image-n'
          max={MAX_IMAGE_N}
          min={MIN_IMAGE_N}
          type='number'
          value={config.n}
          onChange={(e) =>
            onConfigChange('n', clampImageN(Number(e.target.value)))
          }
        />
        <p className='flex gap-1.5 text-xs leading-4 text-red-600 dark:text-red-500'>
          <TriangleAlertIcon className='mt-0.5 size-3.5 shrink-0' />
          <span>
            {t(
              'Tested: gpt-image-2 only accepts n=1. Anything larger fails with Unknown parameter.'
            )}
          </span>
        </p>
      </div>
    </div>
  )
}
