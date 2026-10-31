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
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ApiKeyFieldProps = {
  apiKey: string
  disabled?: boolean
  onApiKeyChange: (value: string) => void
  onRememberChange: (value: boolean) => void
  remember: boolean
}

export function ApiKeyField({
  apiKey,
  disabled,
  onApiKeyChange,
  onRememberChange,
  remember,
}: ApiKeyFieldProps) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)

  return (
    <div className='space-y-1.5'>
      <Label htmlFor='image-api-key'>{t('API Key')}</Label>
      <div className='flex gap-2'>
        <Input
          autoComplete='off'
          className='font-mono'
          disabled={disabled}
          id='image-api-key'
          placeholder='sk-...'
          type={revealed ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
        />
        <Button
          aria-label={revealed ? t('Hide API key') : t('Show API key')}
          disabled={disabled}
          size='icon'
          type='button'
          variant='outline'
          onClick={() => setRevealed((prev) => !prev)}
        >
          {revealed ? (
            <EyeOffIcon className='size-4' />
          ) : (
            <EyeIcon className='size-4' />
          )}
        </Button>
      </div>
      <div className='flex items-center gap-2'>
        <Checkbox
          checked={remember}
          disabled={disabled}
          id='image-api-key-remember'
          onCheckedChange={(value) => onRememberChange(value === true)}
        />
        <Label
          className='text-muted-foreground text-xs font-normal'
          htmlFor='image-api-key-remember'
        >
          {t('Remember in this browser')}
        </Label>
      </div>
      <p className='text-muted-foreground text-xs leading-4'>
        {t(
          'Stored in plain text in your browser. Avoid enabling this on a shared device.'
        )}
      </p>
    </div>
  )
}
