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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerErrorMessage,
  getServerErrorStatus,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { deleteUserGroupDiscount } from '../api'
import type { AdminUserGroupDiscount } from '../types'

interface DeleteGroupDiscountDialogProps {
  rule: AdminUserGroupDiscount
  onClose: () => void
}

export function DeleteGroupDiscountDialog(
  props: DeleteGroupDiscountDialogProps
) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const deletingRef = useRef(false)
  const mutation = useMutation({
    mutationFn: async () =>
      requireServerSuccess(
        await deleteUserGroupDiscount(
          props.rule.user_id,
          props.rule.group,
          props.rule.version
        )
      ),
    onSuccess: async () => {
      const refresh = [
        queryClient.invalidateQueries({
          queryKey: ['admin-user-group-discounts'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['user-group-ratios', props.rule.user_id],
        }),
      ]
      if (useAuthStore.getState().auth.user?.id === props.rule.user_id) {
        for (const key of ['pricing', 'user-groups', 'playground-groups']) {
          refresh.push(queryClient.invalidateQueries({ queryKey: [key] }))
        }
      }
      await Promise.all(refresh)
      toast.success(t('Group discount deleted'))
      props.onClose()
    },
    onError: (error) => {
      handleServerError(error, t('Failed to delete group discount'))
      if (getServerErrorStatus(error) === 409) {
        void queryClient.invalidateQueries({
          queryKey: ['admin-user-group-discounts'],
        })
      }
    },
  })
  const conflict = getServerErrorStatus(mutation.error) === 409

  return (
    <ConfirmDialog
      open
      destructive
      title={t('Delete group discount')}
      desc={
        <div className='space-y-2 break-words'>
          <p>
            {t(
              'Delete the discount for {{username}} (ID: {{userId}}), group {{group}}?',
              {
                username: props.rule.username,
                userId: props.rule.user_id,
                group: props.rule.group,
              }
            )}
          </p>
          <p>
            {t(
              'New requests will use the applicable regular multiplier. Historical spending and in-flight requests are preserved.'
            )}
          </p>
        </div>
      }
      confirmText={mutation.isPending ? t('Deleting...') : t('Delete')}
      isLoading={mutation.isPending}
      disabled={conflict}
      onOpenChange={(open) => {
        if (!open && !deletingRef.current) props.onClose()
      }}
      handleConfirm={async () => {
        if (deletingRef.current || conflict) return
        deletingRef.current = true
        try {
          await mutation.mutateAsync()
        } catch {
          /* The dialog retains the server error for a deliberate retry. */
        } finally {
          deletingRef.current = false
        }
      }}
    >
      {mutation.error && (
        <p role='alert' className='text-destructive text-sm'>
          {getServerErrorMessage(mutation.error)}
        </p>
      )}
      {conflict && (
        <p className='text-muted-foreground text-sm'>
          {t(
            'This discount changed. Close this dialog and review the refreshed rule before deleting it.'
          )}
        </p>
      )}
    </ConfirmDialog>
  )
}
