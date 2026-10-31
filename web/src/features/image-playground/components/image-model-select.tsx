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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import type { SelectOption } from '../types'

type ImageModelSelectProps = {
  disabled?: boolean
  imageModels: SelectOption[]
  isLoading?: boolean
  models: SelectOption[]
  onChange: (value: string) => void
  value: string
}

export function ImageModelSelect({
  disabled,
  imageModels,
  isLoading,
  models,
  onChange,
  value,
}: ImageModelSelectProps) {
  const { t } = useTranslation()
  // 关键词过滤可能漏判自定义模型名，允许切到手填
  const [manualInput, setManualInput] = useState(false)

  const options = useMemo(() => {
    const list = imageModels.length > 0 ? imageModels : models
    // 当前值不在候选里时补进去，避免 Select 显示为空
    if (value && !list.some((option) => option.value === value)) {
      return [{ label: value, value }, ...list]
    }
    return list
  }, [imageModels, models, value])

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <Label htmlFor='image-model'>{t('Model')}</Label>
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground text-xs'>
            {t('Custom name')}
          </span>
          <Switch
            checked={manualInput}
            disabled={disabled}
            onCheckedChange={setManualInput}
          />
        </div>
      </div>

      {manualInput ? (
        <Input
          className='font-mono'
          disabled={disabled}
          id='image-model'
          placeholder='gpt-image-2'
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Select
          items={options}
          value={value}
          onValueChange={(next) => next !== null && onChange(String(next))}
        >
          <SelectTrigger className='w-full' disabled={disabled || isLoading}>
            <SelectValue
              placeholder={
                isLoading ? t('Loading models...') : t('Select a model')
              }
            />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectLabel>
                {imageModels.length > 0
                  ? t('Image models')
                  : t('Available models')}
              </SelectLabel>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
