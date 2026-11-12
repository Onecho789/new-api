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
  CheckSquareIcon,
  HistoryIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { ImageHistoryEntry } from '../history-types'

interface ImageHistoryPanelProps {
  entries: ImageHistoryEntry[]
  activeId?: string | null
  loading?: boolean
  disabled?: boolean
  error?: string | null
  onSelect: (entry: ImageHistoryEntry) => void
  onNewSession: () => void
  onDelete: (ids: string[]) => Promise<boolean>
}

export function ImageHistoryPanel(props: ImageHistoryPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const selected = selectedIds.filter((id) =>
    props.entries.some((entry) => entry.id === id)
  )
  const allSelected =
    props.entries.length > 0 && selected.length === props.entries.length
  const disabled = props.disabled || deleting

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='shrink-0 space-y-3 border-b p-4'>
        <div className='flex items-center justify-between gap-2'>
          <h2 className='text-sm font-semibold'>{t('Generation history')}</h2>
          <Badge variant='secondary'>
            {formatNumber(props.entries.length, locale)}
          </Badge>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={disabled}
            onClick={props.onNewSession}
          >
            <PlusIcon aria-hidden='true' />
            {t('New session')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={disabled || !props.entries.length}
            aria-pressed={allSelected}
            onClick={() =>
              setSelectedIds(
                allSelected ? [] : props.entries.map((entry) => entry.id)
              )
            }
          >
            <CheckSquareIcon aria-hidden='true' />
            {allSelected ? t('Deselect all') : t('Select all')}
          </Button>
          <Button
            size='sm'
            variant='destructive'
            disabled={disabled || !selected.length}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2Icon aria-hidden='true' />
            {t('Delete')}
          </Button>
        </div>
        <p className='text-muted-foreground text-xs'>
          {t('Saved in this browser only.')}
        </p>
        {props.error ? (
          <Alert>
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-3'>
        {props.loading ? (
          <LoadingState message={t('Loading history...')} />
        ) : null}
        {!props.loading && props.entries.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title={t('No image history yet')}
            description={t('Your image sessions will appear here.')}
          />
        ) : null}
        {props.entries.map((entry) => (
          <div
            key={entry.id}
            className={cn(
              'flex gap-2 rounded-xl border p-2',
              props.activeId === entry.id && 'border-primary bg-primary/5'
            )}
          >
            <Checkbox
              className='mt-1'
              checked={selected.includes(entry.id)}
              disabled={disabled}
              aria-label={t('Select history entry {{name}}', {
                name: entry.config.prompt,
              })}
              onCheckedChange={(checked) =>
                setSelectedIds((previous) =>
                  checked
                    ? [...previous, entry.id]
                    : previous.filter((id) => id !== entry.id)
                )
              }
            />
            <Button
              variant='ghost'
              className='h-auto min-w-0 flex-1 flex-col items-stretch gap-2 p-0 text-left whitespace-normal hover:bg-transparent'
              disabled={disabled}
              aria-pressed={props.activeId === entry.id}
              onClick={() => props.onSelect(entry)}
            >
              <span className='line-clamp-2 text-sm font-medium wrap-anywhere'>
                {entry.config.prompt}
              </span>
              {entry.images.length > 0 ? (
                <span className='flex gap-1 overflow-hidden'>
                  {entry.images.slice(0, 4).map((image) => (
                    <img
                      key={image.id}
                      src={image.src}
                      alt=''
                      loading='lazy'
                      className='size-10 rounded-md object-cover'
                    />
                  ))}
                </span>
              ) : null}
              <span className='flex flex-wrap gap-1'>
                {entry.status === 'pending' ? (
                  <Badge variant='secondary'>{t('Generating...')}</Badge>
                ) : null}
                {entry.status === 'interrupted' ? (
                  <Badge variant='outline'>{t('Interrupted')}</Badge>
                ) : null}
                <Badge variant='secondary'>
                  {t('{{value}} succeeded', {
                    value: formatNumber(entry.successCount, locale),
                  })}
                </Badge>
                {entry.failCount > 0 ? (
                  <Badge variant='destructive'>
                    {t('{{value}} failed', {
                      value: formatNumber(entry.failCount, locale),
                    })}
                  </Badge>
                ) : null}
              </span>
              <span className='text-muted-foreground flex flex-wrap justify-between gap-1 text-xs'>
                <span>
                  {t('{{value}} images', {
                    value: formatNumber(entry.imageCount, locale),
                  })}
                </span>
                <span>
                  {t('{{value}}s', {
                    value: formatNumber(entry.durationMs / 1000, locale),
                  })}
                </span>
              </span>
              <time
                className='text-muted-foreground text-xs'
                dateTime={new Date(entry.createdAt).toISOString()}
              >
                {new Date(entry.createdAt).toLocaleString(locale, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </Button>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!deleting) setConfirmOpen(open)
        }}
        title={t('Delete selected image history?')}
        desc={t(
          'This deletes {{value}} sessions and their saved images from this browser.',
          { value: formatNumber(selected.length, locale) }
        )}
        confirmText={t('Delete')}
        destructive
        disabled={props.disabled || selected.length === 0}
        isLoading={deleting}
        handleConfirm={() => {
          setDeleting(true)
          void props
            .onDelete(selected)
            .then((removed) => {
              if (removed) {
                setSelectedIds([])
                setConfirmOpen(false)
              }
            })
            .finally(() => setDeleting(false))
        }}
      />
    </div>
  )
}
