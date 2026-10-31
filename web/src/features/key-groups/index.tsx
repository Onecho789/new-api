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
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { deleteTokenCategory, tokenCategoriesQueryOptions } from './api'
import { CategoryFormDialog } from './components/category-form-dialog'
import type { TokenCategory } from './types'

export function KeyGroups() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const categories = useQuery(tokenCategoriesQueryOptions)
  const [editing, setEditing] = useState<TokenCategory | 'create' | null>(null)
  const [deleting, setDeleting] = useState<TokenCategory | null>(null)

  const onChanged = () => {
    void queryClient.invalidateQueries({ queryKey: ['token-categories'] })
    void queryClient.invalidateQueries({ queryKey: ['keys'] })
    setEditing(null)
    setDeleting(null)
  }

  const remove = useMutation({
    mutationFn: async (id: number) =>
      requireServerSuccess(await deleteTokenCategory(id)),
    onSuccess: () => {
      toast.success(t('Key category deleted successfully'))
      onChanged()
    },
    onError: (error) => handleServerError(error),
  })

  const columns: ColumnDef<TokenCategory>[] = [
    {
      accessorKey: 'name',
      header: t('Category name'),
      cell: ({ row }) => (
        <span className='block max-w-sm font-medium break-all whitespace-normal'>
          {row.original.name}
        </span>
      ),
      meta: { mobileTitle: true },
    },
    {
      accessorKey: 'token_count',
      header: t('API key count'),
      cell: ({ row }) => formatNumber(row.original.token_count, locale),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => (
        <div className='flex flex-wrap items-center gap-1'>
          <Button
            role='link'
            variant='ghost'
            size='sm'
            render={
              <Link to='/keys' search={{ category_id: row.original.id }} />
            }
          >
            {t('View API keys')}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setEditing(row.original)}
          >
            {t('Rename')}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='text-destructive'
            onClick={() => setDeleting(row.original)}
          >
            {t('Delete')}
          </Button>
        </div>
      ),
    },
  ]
  const { table } = useDataTable({
    data: categories.data ?? [],
    columns,
    enableRowSelection: false,
    getRowId: (row) => String(row.id),
    initialPagination: { pageIndex: 0, pageSize: 20 },
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Key Groups')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button onClick={() => setEditing('create')}>
            <Plus aria-hidden='true' />
            {t('Create key category')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          {categories.isError ? (
            <ErrorState
              description={getServerErrorMessage(categories.error)}
              onRetry={() => void categories.refetch()}
            />
          ) : (
            <DataTablePage
              table={table}
              columns={columns}
              isLoading={categories.isLoading}
              isFetching={categories.isFetching}
              toolbarProps={null}
              emptyTitle={t('No key categories')}
              emptyDescription={t(
                'Create a category to organize your API keys.'
              )}
              mobileProps={{ enableRowSelection: false }}
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {editing !== null && (
        <CategoryFormDialog
          category={editing === 'create' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null)
        }}
        title={t('Delete key category')}
        desc={t(
          'Delete “{{name}}”? Its API keys will become uncategorized and will not be deleted.',
          {
            name: deleting?.name ?? '',
          }
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </>
  )
}
