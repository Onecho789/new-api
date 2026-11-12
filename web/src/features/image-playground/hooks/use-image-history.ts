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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ImageHistoryEntry } from '../history-types'
import {
  deleteImageHistoryEntries,
  readImageHistory,
  releaseImageHistory,
  saveImageHistoryEntry,
  type ImageHistoryMediaCache,
} from '../lib/history-storage'

export function useImageHistory(accountId: number | null) {
  const { t } = useTranslation()
  const [state, setState] = useState<{
    accountId: number | null
    entries: ImageHistoryEntry[]
    loading: boolean
    error: 'load' | 'save' | 'remote' | 'delete' | null
  }>({ accountId, entries: [], loading: accountId !== null, error: null })
  const entriesRef = useRef<ImageHistoryEntry[]>([])
  const scopeRef = useRef({ accountId, token: Symbol() })
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const deletedRef = useRef(new Set<string>())
  const mediaCacheRef = useRef<ImageHistoryMediaCache>(new WeakMap())

  useEffect(() => {
    const scope = { accountId, token: Symbol() }
    scopeRef.current = scope
    entriesRef.current = []
    deletedRef.current = new Set()
    mediaCacheRef.current = new WeakMap()
    setState({
      accountId,
      entries: [],
      loading: accountId !== null,
      error: null,
    })
    if (accountId !== null) {
      void readImageHistory(accountId, mediaCacheRef.current)
        .then((loaded) => {
          if (scopeRef.current !== scope) {
            releaseImageHistory(loaded)
            return
          }
          const currentIds = new Set(
            entriesRef.current.map((entry) => entry.id)
          )
          const discarded = loaded.filter(
            (entry) =>
              currentIds.has(entry.id) || deletedRef.current.has(entry.id)
          )
          releaseImageHistory(discarded)
          const entries = [
            ...entriesRef.current,
            ...loaded.filter(
              (entry) =>
                !currentIds.has(entry.id) && !deletedRef.current.has(entry.id)
            ),
          ].sort((a, b) => b.createdAt - a.createdAt)
          entriesRef.current = entries
          setState((previous) => ({ ...previous, entries, loading: false }))
        })
        .catch(() => {
          if (scopeRef.current !== scope) return
          setState((previous) => ({
            ...previous,
            loading: false,
            error: 'load',
          }))
        })
    }
    return () => {
      if (scopeRef.current === scope) {
        scopeRef.current = { accountId: null, token: Symbol() }
        releaseImageHistory(entriesRef.current)
        entriesRef.current = []
      }
    }
  }, [accountId])

  const upsertHistory = useCallback(
    (entry: ImageHistoryEntry) => {
      const scope = scopeRef.current
      if (scope.accountId !== accountId || deletedRef.current.has(entry.id)) {
        return
      }
      const previousEntry = entriesRef.current.find(
        (item) => item.id === entry.id
      )
      if (previousEntry) {
        const retained = new Set(entry.images.map((image) => image.src))
        releaseImageHistory([
          {
            ...previousEntry,
            images: previousEntry.images.filter(
              (image) => !retained.has(image.src)
            ),
          },
        ])
      }
      const entries = [
        entry,
        ...entriesRef.current.filter((item) => item.id !== entry.id),
      ].sort((a, b) => b.createdAt - a.createdAt)
      entriesRef.current = entries
      setState((previous) => ({ ...previous, entries }))
      if (accountId === null) return
      // Serialize writes, including deletion, so a slow Blob download cannot
      // restore a deleted session or replace its newer completion status.
      const deleted = deletedRef.current
      const mediaCache = mediaCacheRef.current
      queueRef.current = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (deleted.has(entry.id)) return
          const remoteOnly = await saveImageHistoryEntry(
            accountId,
            entry,
            mediaCache
          )
          if (scopeRef.current !== scope) return
          if (remoteOnly) {
            setState((previous) => ({ ...previous, error: 'remote' }))
          }
        })
        .catch(() => {
          if (scopeRef.current !== scope) return
          setState((previous) => ({ ...previous, error: 'save' }))
        })
    },
    [accountId]
  )

  const deleteHistory = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const scope = scopeRef.current
      if (scope.accountId !== accountId) return false
      const uniqueIds = [...new Set(ids)]
      for (const id of uniqueIds) deletedRef.current.add(id)
      const deletion = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (accountId !== null) {
            await deleteImageHistoryEntries(accountId, uniqueIds)
          }
        })
      queueRef.current = deletion
      try {
        await deletion
        if (scopeRef.current !== scope) return false
        const removed = entriesRef.current.filter((entry) =>
          uniqueIds.includes(entry.id)
        )
        const entries = entriesRef.current.filter(
          (entry) => !uniqueIds.includes(entry.id)
        )
        releaseImageHistory(removed)
        entriesRef.current = entries
        setState((previous) => ({ ...previous, entries, error: null }))
        return true
      } catch {
        if (scopeRef.current !== scope) return false
        for (const id of uniqueIds) deletedRef.current.delete(id)
        setState((previous) => ({ ...previous, error: 'delete' }))
        return false
      }
    },
    [accountId]
  )

  let historyError: string | null = null
  if (state.accountId === accountId) {
    if (state.error === 'load') {
      historyError = t(
        'Local image history could not be loaded. You can still generate images.'
      )
    }
    if (state.error === 'save') {
      historyError = t(
        'Local history could not be saved. Your generated images are still available; download them before leaving.'
      )
    }
    if (state.error === 'remote') {
      historyError = t(
        'Some images could only be saved as links and may expire. Download them to keep a copy.'
      )
    }
    if (state.error === 'delete') {
      historyError = t('Local history could not be deleted. Please try again.')
    }
  }

  return {
    history: state.accountId === accountId ? state.entries : [],
    historyLoading:
      state.accountId === accountId ? state.loading : accountId !== null,
    historyError,
    upsertHistory,
    deleteHistory,
  }
}
