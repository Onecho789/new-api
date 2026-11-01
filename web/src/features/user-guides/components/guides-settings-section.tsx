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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { ErrorState } from '@/components/error-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import {
  deleteUserGuide,
  userGuideQueryOptions,
  userGuidesQueryOptions,
} from '../api'
import type { UserGuide } from '../types'
import { GuideFormDialog } from './guide-form-dialog'

export function GuidesSettingsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const guides = useQuery(userGuidesQueryOptions(true))
  const [editing, setEditing] = useState<UserGuide | 'create' | null>(null)
  const [deleting, setDeleting] = useState<UserGuide | null>(null)
  const list = guides.data ?? []
  const nextSortOrder =
    list.reduce((max, guide) => Math.max(max, guide.sort_order), 0) + 1

  const onChanged = () => {
    void queryClient.invalidateQueries({ queryKey: ['user-guides'] })
    setEditing(null)
    setDeleting(null)
  }

  // The list omits bodies, so editing fetches the full guide first.
  const openEditor = useMutation({
    mutationFn: (id: number) =>
      queryClient.fetchQuery({
        ...userGuideQueryOptions(id, true),
        staleTime: 0,
      }),
    onSuccess: (guide) => setEditing(guide),
    onError: (error) => handleServerError(error),
  })

  const remove = useMutation({
    mutationFn: async (id: number) =>
      requireServerSuccess(await deleteUserGuide(id)),
    onSuccess: () => {
      toast.success(t('Guide deleted successfully'))
      onChanged()
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <SettingsSection title={t('Guides')}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-sm'>
          {t('Guides appear under General → Guides for signed-in users.')}
        </p>
        <Button size='sm' onClick={() => setEditing('create')}>
          <Plus aria-hidden='true' />
          {t('Create guide')}
        </Button>
      </div>
      {guides.isError ? (
        <ErrorState
          description={getServerErrorMessage(guides.error)}
          onRetry={() => void guides.refetch()}
        />
      ) : (
        <StaticDataTable
          data={list}
          getRowKey={(guide) => guide.id}
          emptyContent={
            guides.isLoading
              ? t('Loading...')
              : t('No guides yet. Click "Create guide" to add one.')
          }
          columns={[
            {
              id: 'title',
              header: t('Guide title'),
              cellClassName: 'max-w-sm font-medium break-all whitespace-normal',
              cell: (guide) => guide.title,
            },
            {
              id: 'format',
              header: t('Content format'),
              cell: (guide) => (guide.format === 'html' ? 'HTML' : 'Markdown'),
            },
            {
              id: 'sort_order',
              header: t('Sort order'),
              cell: (guide) => guide.sort_order,
            },
            {
              id: 'enabled',
              header: t('Status'),
              cell: (guide) => (
                <StatusBadge
                  label={guide.enabled ? t('Published') : t('Unpublished')}
                  variant={guide.enabled ? 'success' : 'neutral'}
                  copyable={false}
                />
              ),
            },
            {
              id: 'actions',
              header: t('Actions'),
              cell: (guide) => (
                <StaticRowActions
                  editLabel={t('Edit')}
                  deleteLabel={t('Delete')}
                  menuLabel={t('Open menu')}
                  onEdit={() => openEditor.mutate(guide.id)}
                  onDelete={() => setDeleting(guide)}
                />
              ),
            },
          ]}
        />
      )}
      {editing !== null && (
        <GuideFormDialog
          guide={editing === 'create' ? undefined : editing}
          nextSortOrder={nextSortOrder}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null)
        }}
        title={t('Delete guide')}
        desc={t('Delete “{{name}}”? This action cannot be undone.', {
          name: deleting?.title ?? '',
        })}
        confirmText={t('Delete')}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </SettingsSection>
  )
}
