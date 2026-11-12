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
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
  const modelId = useId()

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
      <Label htmlFor={modelId}>{t('Model')}</Label>
      <Select
        items={options}
        value={value}
        onValueChange={(next) => next !== null && onChange(String(next))}
      >
        <SelectTrigger
          id={modelId}
          className='w-full rounded-full'
          disabled={disabled || isLoading}
        >
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
    </div>
  )
}
