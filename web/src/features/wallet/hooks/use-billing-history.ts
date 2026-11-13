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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'

import { useIsAdmin } from '@/hooks/use-admin'
import { useDebounce } from '@/hooks/use-debounce'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  getUserBillingHistory,
  getAllBillingHistory,
  completeOrder,
  isApiSuccess,
} from '../api'

// ============================================================================
// Billing History Hook
// ============================================================================

interface UseBillingHistoryOptions {
  /** Initial page number */
  initialPage?: number
  /** Initial page size */
  initialPageSize?: number
}

export function useBillingHistory(options: UseBillingHistoryOptions = {}) {
  const { initialPage = 1, initialPageSize = 10 } = options
  const isAdmin = useIsAdmin()
  const viewerId = useAuthStore((state) => state.auth.user?.id)
  const queryClient = useQueryClient()

  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [keyword, setKeyword] = useState('')
  const [userId, setUserId] = useState('')
  const debouncedKeyword = useDebounce(keyword)
  const normalizedUserId = isAdmin ? userId.trim() : ''
  const debouncedUserId = useDebounce(normalizedUserId)
  const invalidUserId =
    normalizedUserId !== '' &&
    (!/^\d+$/.test(normalizedUserId) ||
      !Number.isSafeInteger(Number(normalizedUserId)) ||
      Number(normalizedUserId) <= 0)
  const filtersPending =
    keyword !== debouncedKeyword ||
    (isAdmin && normalizedUserId !== debouncedUserId)
  const requestReady = !invalidUserId && !filtersPending
  const effectiveUserId =
    isAdmin && debouncedUserId !== '' ? Number(debouncedUserId) : undefined
  const [completing, setCompleting] = useState(false)

  /**
   * Fetch billing history
   */
  const query = useQuery({
    queryKey: [
      'billing-history',
      viewerId,
      isAdmin ? 'all' : 'self',
      page,
      pageSize,
      debouncedKeyword,
      effectiveUserId,
    ],
    enabled: requestReady,
    retry: false,
    refetchOnWindowFocus: false,
    meta: { errorToast: false },
    queryFn: async ({ signal }) => {
      const response = isAdmin
        ? await getAllBillingHistory(
            page,
            pageSize,
            debouncedKeyword,
            effectiveUserId,
            signal
          )
        : await getUserBillingHistory(page, pageSize, debouncedKeyword, signal)
      if (!isApiSuccess(response) || !response.data) {
        throw createServerError(response, 'Failed to load billing history')
      }
      return response.data
    },
  })
  const records =
    requestReady && !query.isError ? (query.data?.items ?? []) : []
  const total = requestReady && !query.isError ? (query.data?.total ?? 0) : 0
  const loading =
    !invalidUserId && (filtersPending || query.isPending || query.isFetching)

  /**
   * Complete a pending order (admin only)
   */
  const handleCompleteOrder = useCallback(
    async (tradeNo: string) => {
      if (!isAdmin) {
        toast.error(i18next.t('Admin access required'))
        return false
      }

      setCompleting(true)
      try {
        const response = await completeOrder({ trade_no: tradeNo })
        if (isApiSuccess(response)) {
          toast.success(i18next.t('Order completed successfully'))
          // Refresh the list
          await queryClient.invalidateQueries({
            queryKey: ['billing-history', viewerId],
          })
          return true
        } else {
          handleServerError(response, i18next.t('Failed to complete order'))
          return false
        }
      } catch (error) {
        handleServerError(error, i18next.t('Failed to complete order'))
        return false
      } finally {
        setCompleting(false)
      }
    },
    [isAdmin, queryClient, viewerId]
  )

  /**
   * Change page
   */
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  /**
   * Change page size
   */
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1) // Reset to first page when changing page size
  }, [])

  /**
   * Search by keyword
   */
  const handleSearch = useCallback((newKeyword: string) => {
    setKeyword(newKeyword)
    setPage(1) // Reset to first page when searching
  }, [])

  const handleUserIdSearch = useCallback((value: string) => {
    setUserId(value)
    setPage(1)
  }, [])

  return {
    records,
    total,
    page,
    pageSize,
    keyword,
    userId,
    invalidUserId,
    error: requestReady ? query.error : null,
    loading,
    completing,
    isAdmin,
    handlePageChange,
    handlePageSizeChange,
    handleSearch,
    handleUserIdSearch,
    handleCompleteOrder,
    refresh: query.refetch,
  }
}
