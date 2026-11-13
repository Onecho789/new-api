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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getGroups, searchUsers } from '@/features/users/api'
import {
  UserGroupRatiosSection,
  type UserGroupRatiosHandle,
} from '@/features/users/components/user-group-ratios-section'
import { useDebounce } from '@/hooks/use-debounce'
import { ROLE } from '@/lib/roles'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import type { DiscountUser } from '../types'

interface UserGroupDiscountsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user?: DiscountUser
}

export function UserGroupDiscountsDialog(props: UserGroupDiscountsDialogProps) {
  const { t } = useTranslation()
  const viewer = useAuthStore((state) => state.auth.user)
  const [selectedUser, setSelectedUser] = useState<DiscountUser | undefined>(
    props.user
  )
  const [search, setSearch] = useState('')
  const keyword = useDebounce(search, 300)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const discountsRef = useRef<UserGroupRatiosHandle>(null)
  const canManage =
    !!viewer &&
    viewer.role >= ROLE.ADMIN &&
    (!selectedUser ||
      viewer.role === ROLE.SUPER_ADMIN ||
      viewer.role > selectedUser.role)
  const usersQuery = useQuery({
    queryKey: ['discount-user-options', keyword, viewer?.role],
    enabled: props.open && canManage && !selectedUser,
    queryFn: async () =>
      requireServerSuccess(
        await searchUsers({
          keyword,
          p: 1,
          page_size: 100,
          role: viewer?.role === ROLE.SUPER_ADMIN ? '' : String(ROLE.USER),
        })
      ),
  })
  const groupsQuery = useQuery({
    queryKey: ['groups'],
    enabled: props.open && canManage,
    queryFn: async () => requireServerSuccess(await getGroups()),
    staleTime: 5 * 60 * 1000,
  })
  const users = (usersQuery.data?.data?.items ?? []).filter(
    (user) =>
      !user.DeletedAt &&
      !!viewer &&
      (viewer.role === ROLE.SUPER_ADMIN || viewer.role > user.role)
  )

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!savingRef.current && !saving) props.onOpenChange(open)
      }}
      title={t('Group discounts')}
      description={
        selectedUser
          ? `#${selectedUser.id} · ${selectedUser.username} · ${selectedUser.display_name}`
          : t('Choose a user to configure group discounts.')
      }
      contentClassName='sm:max-w-[600px]'
      contentHeight='min(65vh, 720px)'
      showCloseButton={!saving}
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            disabled={saving}
            onClick={() => props.onOpenChange(false)}
          >
            {t('Close')}
          </Button>
          <Button
            type='button'
            disabled={
              !selectedUser ||
              !canManage ||
              saving ||
              groupsQuery.isPending ||
              groupsQuery.isError
            }
            onClick={async () => {
              if (savingRef.current || !discountsRef.current) return
              savingRef.current = true
              setSaving(true)
              try {
                if (await discountsRef.current.saveChanges()) {
                  props.onOpenChange(false)
                }
              } finally {
                savingRef.current = false
                setSaving(false)
              }
            }}
          >
            {saving && savingRef.current ? t('Saving...') : t('Save changes')}
          </Button>
        </>
      }
    >
      {!canManage && (
        <ErrorState
          description={t(
            'No permission to access users of same or higher level'
          )}
        />
      )}
      {canManage && !selectedUser && (
        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='discount-user-search'>{t('Search users')}</Label>
            <Input
              id='discount-user-search'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('Search by user ID, username or display name')}
            />
          </div>
          {usersQuery.isError ? (
            <ErrorState
              description={getServerErrorMessage(usersQuery.error)}
              onRetry={() => void usersQuery.refetch()}
            />
          ) : (
            <Combobox
              aria-label={t('Select user')}
              options={users.map((user) => ({
                value: String(user.id),
                label: `#${user.id} · ${user.username} · ${user.display_name}`,
              }))}
              value=''
              disabled={usersQuery.isFetching}
              placeholder={
                usersQuery.isFetching ? t('Loading...') : t('Select user')
              }
              onValueChange={(value) =>
                setSelectedUser(users.find((user) => String(user.id) === value))
              }
            />
          )}
        </div>
      )}
      {canManage &&
        selectedUser &&
        (groupsQuery.isError ? (
          <ErrorState
            description={getServerErrorMessage(groupsQuery.error)}
            onRetry={() => void groupsQuery.refetch()}
          />
        ) : (
          <UserGroupRatiosSection
            key={selectedUser.id}
            ref={discountsRef}
            userId={selectedUser.id}
            groups={groupsQuery.data?.data ?? []}
            disabled={false}
            onSavingChange={setSaving}
          />
        ))}
    </Dialog>
  )
}
