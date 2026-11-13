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
import { useQuery } from '@tanstack/react-query'
import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
} from '@tanstack/react-table'
import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TZDate } from 'react-day-picker'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { GroupOverrideSchedule } from '@/features/system-settings/models/group-override-schedule'
import { getGroups } from '@/features/users/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { getAdminUserGroupDiscounts } from './api'
import { DeleteGroupDiscountDialog } from './components/delete-group-discount-dialog'
import { UserGroupDiscountsDialog } from './components/user-group-discounts-dialog'
import type { AdminUserGroupDiscount, DiscountUser } from './types'

interface UserGroupDiscountsProps {
  userId?: number
}

export function UserGroupDiscounts(props: UserGroupDiscountsProps) {
  const { t, i18n } = useTranslation()
  const [dialog, setDialog] = useState<{ user?: DiscountUser } | null>(null)
  const [deleteRule, setDeleteRule] = useState<AdminUserGroupDiscount | null>(
    null
  )
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const [userId, setUserId] = useState(props.userId)
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const group =
    (
      columnFilters.find((item) => item.id === 'group')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''
  const status =
    (
      columnFilters.find((item) => item.id === 'status')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''
  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
    staleTime: 5 * 60 * 1000,
  })
  const query = useQuery({
    queryKey: [
      'admin-user-group-discounts',
      pagination,
      globalFilter,
      userId,
      group,
      status,
    ],
    queryFn: async ({ signal }) => {
      const result = requireServerSuccess(
        await getAdminUserGroupDiscounts(
          {
            p: pagination.pageIndex + 1,
            page_size: pagination.pageSize,
            keyword: globalFilter.trim(),
            user_id: userId,
            group,
            status,
          },
          signal
        )
      )
      if (!result.data) throw new Error('Failed to load group discounts')
      return result.data
    },
    refetchInterval: dialog || deleteRule ? false : 30000,
    refetchOnWindowFocus: !dialog && !deleteRule,
  })
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const rules = query.data?.items
  const refetch = query.refetch
  useEffect(() => {
    if (dialog || deleteRule || !rules) return
    const now = Date.now()
    let nextChange = Infinity
    for (const rule of rules) {
      if (!rule.enabled) continue
      if (rule.status === 'grace_period') {
        const midnight = new TZDate(now, 'Asia/Shanghai')
        midnight.setHours(24, 0, 0, 0)
        nextChange = Math.min(nextChange, midnight.getTime())
      }
      for (const boundary of [rule.starts_at, rule.ends_at]) {
        if (boundary && boundary * 1000 > now) {
          nextChange = Math.min(nextChange, boundary * 1000)
        }
      }
    }
    if (!Number.isFinite(nextChange)) return
    const timer = window.setTimeout(
      () => void refetch(),
      Math.min(2147483647, nextChange - now)
    )
    return () => window.clearTimeout(timer)
  }, [rules, query.dataUpdatedAt, refetch, dialog, deleteRule])
  const statusLabels = useMemo(
    () => ({
      active: t('Discount active'),
      grace_period: t('Activation day exempt'),
      pending_settlement: t('Waiting for settlement'),
      manually_disabled: t('Manually disabled'),
      auto_disabled: t('Disabled: daily minimum not met'),
      scheduled: t('Not started'),
      expired: t('Expired'),
    }),
    [t]
  )
  const columns = useMemo<ColumnDef<AdminUserGroupDiscount>[]>(() => {
    const money = (quota: number) =>
      formatQuotaWithCurrency(quota, {
        digitsLarge: 6,
        digitsSmall: 6,
        abbreviate: false,
      })
    const checkLabels = {
      passed: t('Daily minimum met'),
      pending: t('Waiting for settlement'),
      disabled: t('Daily minimum not met'),
      grace: t('Activation day exempt'),
    }
    return [
      {
        id: 'user',
        header: t('User'),
        cell: ({ row }) => (
          <div className='min-w-0'>
            <p className='font-medium break-all'>{row.original.username}</p>
            <p className='text-muted-foreground text-xs break-all'>
              #{row.original.user_id} · {row.original.display_name}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'group',
        header: t('Group'),
        cell: ({ row }) => (
          <span className='break-all'>{row.original.group}</span>
        ),
      },
      // formatNumber intentionally rounds to two decimals; multipliers need their configured precision.
      {
        accessorKey: 'ratio',
        header: t('Final group multiplier'),
        cell: ({ row }) =>
          new Intl.NumberFormat(locale, {
            maximumSignificantDigits: 15,
          }).format(row.original.ratio),
      },
      {
        accessorKey: 'min_daily_quota',
        header: t('Daily minimum'),
        cell: ({ row }) =>
          (row.original.daily_check_enabled ?? row.original.min_daily_quota > 0)
            ? money(row.original.min_daily_quota)
            : t('Daily assessment off'),
      },
      {
        id: 'validity',
        header: t('Validity period (Beijing time)'),
        cell: ({ row }) => (
          <GroupOverrideSchedule
            showStatus={false}
            rule={{
              ratio: row.original.ratio,
              enabled: row.original.enabled,
              starts_at: row.original.starts_at ?? 0,
              ends_at: row.original.ends_at ?? 0,
            }}
          />
        ),
      },
      {
        accessorKey: 'today_quota',
        header: t('Today’s net spend'),
        cell: ({ row }) => (
          <div>
            <p>{money(row.original.today_quota)}</p>
            <p className='text-muted-foreground text-xs'>{query.data?.day}</p>
            {row.original.today_pending > 0 && (
              <p className='text-muted-foreground text-xs'>
                {t('Some charges are still pending settlement')}
              </p>
            )}
          </div>
        ),
      },
      {
        id: 'assessment',
        header: t('Last assessment (Beijing time)'),
        cell: ({ row }) => {
          const rule = row.original
          if (!rule.last_check_at || !rule.last_check_status) {
            return t('Not yet assessed')
          }
          return (
            <div className='space-y-1 text-xs'>
              <p>
                {checkLabels[rule.last_check_status]} ·{' '}
                {money(rule.last_check_quota)}
              </p>
              <p>
                {t('Assessed day')}: {rule.last_check_day}
              </p>
              <p className='text-muted-foreground'>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'Asia/Shanghai',
                }).format(rule.last_check_at * 1000)}
              </p>
            </div>
          )
        },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) => (
          <StatusBadge
            label={statusLabels[row.original.status]}
            variant={
              row.original.enabled &&
              row.original.status !== 'scheduled' &&
              row.original.status !== 'expired'
                ? 'success'
                : 'neutral'
            }
            copyable={false}
          />
        ),
      },
      {
        id: 'actions',
        header: t('Actions'),
        enableHiding: false,
        cell: ({ row }) => (
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() =>
                setDialog({
                  user: {
                    id: row.original.user_id,
                    username: row.original.username,
                    display_name: row.original.display_name,
                    role: row.original.user_role,
                  },
                })
              }
            >
              {t('Edit')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='text-destructive'
              onClick={() => setDeleteRule(row.original)}
            >
              {t('Delete')}
            </Button>
          </div>
        ),
      },
    ]
  }, [t, locale, query.data?.day, statusLabels])
  const ensurePageInRange = useCallback(
    (pageCount: number) => {
      if (query.isPending || query.isFetching || query.isError) return
      setPagination((current) => {
        const pageIndex = Math.max(0, pageCount - 1)
        return current.pageIndex > pageIndex
          ? { ...current, pageIndex }
          : current
      })
    },
    [query.isPending, query.isFetching, query.isError]
  )
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    pagination,
    onPaginationChange: setPagination,
    globalFilter,
    onGlobalFilterChange: (updater) => {
      setGlobalFilter(updater)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    columnFilters,
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater)
      setPagination((current) => ({ ...current, pageIndex: 0 }))
    },
    enableRowSelection: false,
    enableSorting: false,
    manualPagination: true,
    manualFiltering: true,
    totalCount: query.data?.total ?? 0,
    ensurePageInRange,
    getRowId: (row) => String(row.id),
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Group discounts')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className='size-4' />
            {t('Refresh')}
          </Button>
          <Button onClick={() => setDialog({})}>
            <Plus className='size-4' />
            {t('Add group discount')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          {query.isError ? (
            <ErrorState
              description={getServerErrorMessage(query.error)}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <DataTablePage
              table={table}
              columns={columns}
              isLoading={query.isPending}
              isFetching={query.isFetching}
              emptyTitle={t('No group discounts configured')}
              skeletonKeyPrefix='user-group-discounts'
              toolbarProps={{
                searchPlaceholder: t(
                  'Search by user ID, username or display name'
                ),
                searchDebounceMs: 300,
                hasAdditionalFilters: !!userId,
                onReset: () => {
                  setUserId(undefined)
                  setPagination((current) => ({ ...current, pageIndex: 0 }))
                },
                additionalSearch: userId ? (
                  <span className='text-muted-foreground text-sm'>
                    {t('User')} #{userId}
                  </span>
                ) : undefined,
                filters: [
                  {
                    columnId: 'group',
                    title: t('Group'),
                    singleSelect: true,
                    options: (groupsQuery.data?.data ?? []).map((value) => ({
                      value,
                      label: value,
                    })),
                  },
                  {
                    columnId: 'status',
                    title: t('Status'),
                    singleSelect: true,
                    options: Object.entries(statusLabels).map(
                      ([value, label]) => ({ value, label })
                    ),
                  },
                ],
              }}
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {dialog && (
        <UserGroupDiscountsDialog
          key={dialog.user?.id ?? 'new'}
          open
          user={dialog.user}
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null)
              void query.refetch()
            }
          }}
        />
      )}
      {deleteRule && (
        <DeleteGroupDiscountDialog
          key={`${deleteRule.id}:${deleteRule.version}`}
          rule={deleteRule}
          onClose={() => setDeleteRule(null)}
        />
      )}
    </>
  )
}
