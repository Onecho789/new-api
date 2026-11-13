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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import { TZDate } from 'react-day-picker'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import {
  getCurrencyDisplay,
  getCurrencyLabel,
  formatQuotaWithCurrency,
} from '@/lib/currency'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getUserGroupRatios, updateUserGroupRatios } from '../api'
import type {
  UserGroupRatio,
  UserGroupRatioInput,
  UserGroupRatiosData,
} from '../types'

export interface UserGroupRatiosHandle {
  saveChanges: () => Promise<boolean>
}

interface UserGroupRatioEditorHandle {
  readUpdate: (
    includeUnchanged: boolean
  ) => Promise<UserGroupRatioInput | null | false>
}

interface UserGroupRatiosSectionProps {
  ref?: Ref<UserGroupRatiosHandle>
  userId: number
  groups: string[]
  disabled: boolean
  onSavingChange: (saving: boolean) => void
}

export function UserGroupRatiosSection(props: UserGroupRatiosSectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const editors = useRef(new Map<string, UserGroupRatioEditorHandle>())
  const savingRef = useRef(false)
  const [selectedGroup, setSelectedGroup] = useState('')
  const [draftGroups, setDraftGroups] = useState<string[]>([])
  const [savingGroup, setSavingGroup] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const query = useQuery({
    queryKey: ['user-group-ratios', props.userId],
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const result = requireServerSuccess(
        await getUserGroupRatios(props.userId, signal)
      )
      if (!result.data) throw new Error('Failed to load group discounts')
      return result.data
    },
  })
  const displayedGroups = [
    ...new Set([
      ...(query.data?.rules.map((rule) => rule.group) ?? []),
      ...draftGroups,
    ]),
  ]
  const availableGroups = props.groups.filter(
    (group) => !displayedGroups.includes(group)
  )
  const groupToAdd = availableGroups.includes(selectedGroup)
    ? selectedGroup
    : (availableGroups[0] ?? '')
  const addingDisabled =
    props.disabled || savingGroup !== null || query.isFetching || !groupToAdd
  const mutation = useMutation({
    mutationFn: async (rules: UserGroupRatioInput[]) => {
      const result = requireServerSuccess(
        await updateUserGroupRatios(props.userId, rules)
      )
      if (!result.data) throw new Error('Failed to save group discount')
      return result.data
    },
    onSuccess: (data, submitted) => {
      // A response includes every group. Only adopt saved versions for submitted
      // groups, so another administrator cannot silently replace an unsaved draft.
      queryClient.setQueryData<UserGroupRatiosData>(
        ['user-group-ratios', props.userId],
        (current) => {
          const rules: UserGroupRatio[] = []
          for (const rule of data.rules) {
            const wasSubmitted = submitted.some(
              (update) => update.group === rule.group
            )
            const previous = current?.rules.find(
              (saved) => saved.group === rule.group
            )
            // A local new group must keep version zero if another administrator
            // creates it before this draft is submitted.
            if (
              !wasSubmitted &&
              !previous &&
              draftGroups.includes(rule.group)
            ) {
              continue
            }
            rules.push(wasSubmitted ? rule : (previous ?? rule))
          }
          // A remote deletion must not discard another group's unsaved edits.
          // Keep its old version so a later save receives a conflict.
          for (const previous of current?.rules ?? []) {
            if (
              !data.rules.some((rule) => rule.group === previous.group) &&
              !submitted.some((update) => update.group === previous.group)
            ) {
              rules.push(previous)
            }
          }
          return { ...data, rules }
        }
      )
      void queryClient.invalidateQueries({
        queryKey: ['admin-user-group-discounts'],
      })
      if (useAuthStore.getState().auth.user?.id === props.userId) {
        void queryClient.invalidateQueries({ queryKey: ['pricing'] })
        void queryClient.invalidateQueries({ queryKey: ['user-groups'] })
        void queryClient.invalidateQueries({ queryKey: ['playground-groups'] })
      }
      toast.success(t('Group discount saved'))
    },
    onError: (error) => {
      setSaveError(getServerErrorMessage(error))
      handleServerError(error, t('Failed to save group discount'))
    },
  })

  // Both the per-group button and the drawer footer use the same save path.
  async function saveChanges(group?: string): Promise<boolean> {
    if (
      savingRef.current ||
      !query.data ||
      !query.isFetchedAfterMount ||
      query.isFetching ||
      query.isError
    ) {
      return false
    }
    savingRef.current = true
    setSavingGroup(group ?? '')
    setSaveError(null)
    props.onSavingChange(true)
    try {
      const rules: UserGroupRatioInput[] = []
      // Validation rerenders forms and reattaches refs; keep a stable snapshot.
      const editorsToSave = [...editors.current]
      for (const [name, editor] of editorsToSave) {
        if (group !== undefined && name !== group) continue
        const update = await editor.readUpdate(group !== undefined)
        if (update === false) return false
        if (update) rules.push(update)
      }
      if (rules.length > 0) await mutation.mutateAsync(rules)
      return true
    } catch {
      // The mutation displays the server error and retains every unsaved draft.
      return false
    } finally {
      savingRef.current = false
      setSavingGroup(null)
      props.onSavingChange(false)
    }
  }

  useImperativeHandle(props.ref, () => ({ saveChanges: () => saveChanges() }))

  return (
    <SideDrawerSection>
      <SideDrawerSectionHeader
        title={t('Group discounts')}
        description={t(
          "Applies a final multiplier to this user's actual calling group. Group access is unchanged."
        )}
      />
      <p className='text-muted-foreground text-xs leading-5'>
        {t(
          'Add only the groups that need a discount. Save a group separately or use Save changes below to save all edits.'
        )}
      </p>
      {!query.isFetchedAfterMount && !query.isError && (
        <LoadingState className='min-h-20' size='sm' />
      )}
      {query.isError && (
        <ErrorState
          className='min-h-24'
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {saveError && (
        <div className='space-y-2'>
          <p role='alert' className='text-destructive text-sm'>
            {saveError}
          </p>
          <Button
            type='button'
            variant='outline'
            disabled={props.disabled || query.isFetching}
            onClick={async () => {
              if (savingRef.current) return
              savingRef.current = true
              props.onSavingChange(true)
              try {
                const result = await query.refetch()
                if (result.isSuccess) {
                  setReloadVersion((current) => current + 1)
                  setDraftGroups([])
                  setSaveError(null)
                }
              } finally {
                savingRef.current = false
                props.onSavingChange(false)
              }
            }}
          >
            {t('Reload saved discounts')}
          </Button>
          <p className='text-muted-foreground text-xs'>
            {t('Reloading discards unsaved discount edits.')}
          </p>
        </div>
      )}
      {query.data && query.isFetchedAfterMount && !query.isError && (
        <>
          {displayedGroups.length === 0 && (
            <EmptyState
              className='min-h-24 py-4'
              title={t('No group discounts configured')}
            />
          )}
          {displayedGroups.map((group) => {
            const rule = query.data.rules.find((item) => item.group === group)
            return (
              <Card key={group} size='sm' role='group' aria-label={group}>
                <CardHeader>
                  <h4 className='text-sm font-semibold break-all'>{group}</h4>
                </CardHeader>
                <CardContent>
                  <UserGroupRatioEditor
                    key={`${props.userId}:${group}:${rule?.version ?? 0}:${rule?.enabled ?? false}:${reloadVersion}`}
                    ref={(editor) => {
                      if (editor) editors.current.set(group, editor)
                      else editors.current.delete(group)
                    }}
                    group={group}
                    rule={rule}
                    data={query.data}
                    disabled={
                      props.disabled || savingGroup !== null || query.isFetching
                    }
                    saving={savingGroup === group}
                    onSave={() => saveChanges(group)}
                    onCancel={
                      rule
                        ? undefined
                        : () =>
                            setDraftGroups((current) =>
                              current.filter((name) => name !== group)
                            )
                    }
                  />
                </CardContent>
              </Card>
            )
          })}
          <div className='space-y-2'>
            <Label htmlFor={fieldId}>{t('Group to add')}</Label>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
              <Combobox
                id={fieldId}
                aria-label={t('Group to add')}
                className='min-w-0 flex-1'
                options={availableGroups.map((group) => ({
                  value: group,
                  label: group,
                }))}
                value={groupToAdd}
                placeholder={t('No groups available')}
                disabled={addingDisabled}
                onValueChange={(value) => setSelectedGroup(value ?? '')}
              />
              <Button
                type='button'
                variant='outline'
                disabled={addingDisabled}
                onClick={() => {
                  if (addingDisabled) return
                  setDraftGroups((current) => [
                    ...new Set([...current, groupToAdd]),
                  ])
                  setSelectedGroup('')
                }}
              >
                {t('Add group discount')}
              </Button>
            </div>
          </div>
        </>
      )}
    </SideDrawerSection>
  )
}

interface UserGroupRatioEditorProps {
  ref?: Ref<UserGroupRatioEditorHandle>
  group: string
  rule?: UserGroupRatio
  data: UserGroupRatiosData
  disabled: boolean
  saving: boolean
  onSave: () => Promise<boolean>
  onCancel?: () => void
}

function UserGroupRatioEditor(props: UserGroupRatioEditorProps) {
  const { t, i18n } = useTranslation()
  const currencyLabel = getCurrencyLabel()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const scheduleId = useId()
  const [clockTick, setClockTick] = useState(0)
  const startsAt = props.rule?.starts_at ?? 0
  const endsAt = props.rule?.ends_at ?? 0
  const enabled = props.rule?.enabled
  const savedDailyAssessment =
    props.rule?.daily_check_enabled ?? (props.rule?.min_daily_quota ?? 0) > 0
  const now = Date.now()
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const graceToday =
    savedDailyAssessment &&
    dayFormatter.format(now) ===
      dayFormatter.format(
        Math.max(props.rule?.enabled_at ?? 0, startsAt) * 1000
      )
  const midnight = new TZDate(now, 'Asia/Shanghai')
  midnight.setHours(24, 0, 0, 0)
  const boundaries = [
    startsAt * 1000,
    endsAt * 1000,
    graceToday ? midnight.getTime() : 0,
  ].filter((value) => value > now)
  const nextChange = Math.min(...boundaries)
  useEffect(() => {
    if (!enabled || !Number.isFinite(nextChange)) return
    const timer = window.setTimeout(
      () => setClockTick((tick) => tick + 1),
      Math.min(2147483647, Math.max(1, nextChange - Date.now()))
    )
    return () => window.clearTimeout(timer)
  }, [nextChange, enabled, clockTick])
  const schema = z
    .object({
      ratio: z
        .string()
        .trim()
        .min(1, t('Enter a multiplier from 0 to 1000'))
        .refine(
          (value) =>
            Number.isFinite(Number(value)) &&
            Number(value) >= 0 &&
            Number(value) <= 1000,
          t('Enter a multiplier from 0 to 1000')
        ),
      minimum: z.string().trim(),
      daily_check_enabled: z.boolean(),
      schedule: z.enum(['unlimited', 'duration', 'custom']),
      starts_at: z.number(),
      ends_at: z.number(),
      enabled: z.boolean(),
    })
    .superRefine((values, context) => {
      if (values.daily_check_enabled) {
        const amount = Number(values.minimum)
        const quota = parseQuotaFromDollars(amount)
        if (
          !(
            values.minimum.length > 0 &&
            Number.isFinite(amount) &&
            amount > 0 &&
            (!tokensOnly || Number.isSafeInteger(amount)) &&
            Number.isSafeInteger(quota) &&
            quota >= 1
          )
        ) {
          context.addIssue({
            code: 'custom',
            path: ['minimum'],
            message: t('Enter a positive daily minimum'),
          })
        }
      }
      if (values.schedule === 'duration' && !values.enabled) {
        context.addIssue({
          code: 'custom',
          path: ['schedule'],
          message: t('Enable the discount to start a 2-hour period.'),
        })
      }
      if (values.schedule !== 'custom') return
      if (
        ![values.starts_at, values.ends_at].every(
          (value) =>
            Number.isSafeInteger(value) && value >= 0 && value <= 253402300799
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['schedule'],
          message: t('Choose dates between 1970 and 9999'),
        })
      } else if (values.starts_at === 0 && values.ends_at === 0) {
        context.addIssue({
          code: 'custom',
          path: ['schedule'],
          message: t('Choose a start or end time for a custom schedule.'),
        })
      } else if (
        values.ends_at > 0 &&
        values.starts_at > 0 &&
        values.ends_at <= values.starts_at
      ) {
        context.addIssue({
          code: 'custom',
          path: ['schedule'],
          message: t('End time must be after start time'),
        })
      } else if (
        values.enabled &&
        values.ends_at > 0 &&
        values.ends_at * 1000 <= Date.now()
      ) {
        context.addIssue({
          code: 'custom',
          path: ['schedule'],
          message: t('End time must be in the future for an enabled discount.'),
        })
      }
    })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      ratio: String(props.rule?.ratio ?? 1),
      minimum: props.rule
        ? String(quotaUnitsToDollars(props.rule.min_daily_quota))
        : '',
      enabled: props.rule?.enabled ?? true,
      daily_check_enabled:
        props.rule?.daily_check_enabled ??
        (props.rule ? props.rule.min_daily_quota > 0 : false),
      schedule:
        props.rule?.starts_at || props.rule?.ends_at ? 'custom' : 'unlimited',
      starts_at: props.rule?.starts_at ?? 0,
      ends_at: props.rule?.ends_at ?? 0,
    },
  })
  const dirty = form.formState.isDirty || !props.rule
  useImperativeHandle(props.ref, () => ({
    readUpdate: async (includeUnchanged) => {
      if (!dirty && !includeUnchanged) return null
      let update: UserGroupRatioInput | false = false
      await form.handleSubmit((values) => {
        update = {
          group: props.group,
          ratio: Number(values.ratio),
          min_daily_quota: values.daily_check_enabled
            ? parseQuotaFromDollars(Number(values.minimum))
            : 0,
          daily_check_enabled: values.daily_check_enabled,
          enabled: values.enabled,
          version: props.rule?.version ?? 0,
          ...(values.schedule === 'duration'
            ? { duration_seconds: 7200 }
            : {
                starts_at: values.schedule === 'custom' ? values.starts_at : 0,
                ends_at: values.schedule === 'custom' ? values.ends_at : 0,
              }),
        }
      })()
      return update
    },
  }))
  const disabled = props.disabled
  const statuses = {
    active: t('Discount active'),
    grace_period: t('Activation day exempt'),
    pending_settlement: t('Waiting for settlement'),
    manually_disabled: t('Manually disabled'),
    auto_disabled: t('Disabled: daily minimum not met'),
    scheduled: t('Not started'),
    expired: t('Expired'),
  }
  const checkStatuses = {
    passed: t('Daily minimum met'),
    pending: t('Waiting for settlement'),
    disabled: t('Daily minimum not met'),
    grace: t('Activation day exempt'),
  }
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const checkTime = props.rule?.last_check_at
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: props.data.timezone,
      }).format(props.rule.last_check_at * 1000)
    : t('Not yet assessed')
  const quotaFormat = { digitsLarge: 6, digitsSmall: 6, abbreviate: false }
  const schedule = form.watch('schedule')
  const dailyCheckEnabled = form.watch('daily_check_enabled')
  let status = props.rule?.status
  if (enabled) {
    if (endsAt > 0 && endsAt * 1000 <= Date.now()) status = 'expired'
    else if (startsAt * 1000 > Date.now()) status = 'scheduled'
    else if (status === 'scheduled' || status === 'grace_period') {
      if (graceToday) status = 'grace_period'
      else if (
        savedDailyAssessment &&
        props.rule?.last_check_status === 'pending'
      ) {
        status = 'pending_settlement'
      } else status = 'active'
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <StatusBadge
          label={status ? statuses[status] : t('Not configured')}
          variant={
            enabled && status !== 'scheduled' && status !== 'expired'
              ? 'success'
              : 'neutral'
          }
          copyable={false}
        />
        {dirty && (
          <StatusBadge
            label={t('Unsaved changes')}
            variant='warning'
            copyable={false}
          />
        )}
        {(props.rule?.today_pending ?? 0) > 0 && (
          <span className='text-muted-foreground text-xs'>
            {t('Some charges are still pending settlement')}
          </span>
        )}
      </div>
      <dl className='grid grid-cols-2 gap-3 text-xs'>
        <div>
          <dt className='text-muted-foreground'>
            {t('Today’s net spend')} ({props.data.day})
          </dt>
          <dd className='mt-1 break-words'>
            {formatQuotaWithCurrency(props.rule?.today_quota ?? 0, quotaFormat)}
          </dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>
            {t('Last assessment (Beijing time)')}
          </dt>
          <dd className='mt-1 break-words'>{checkTime}</dd>
        </div>
        {props.rule?.last_check_status && (
          <div className='col-span-2 space-y-1'>
            <dt className='text-muted-foreground'>
              {t('Assessed day')}: {props.rule.last_check_day}
            </dt>
            <dd>
              {checkStatuses[props.rule.last_check_status]} ·{' '}
              {formatQuotaWithCurrency(
                props.rule.last_check_quota,
                quotaFormat
              )}
            </dd>
          </div>
        )}
      </dl>
      <Form {...form}>
        <form
          noValidate
          className='space-y-4'
          aria-label={t('Group discounts')}
          onSubmit={(event) => {
            event.preventDefault()
            if (!disabled) void props.onSave()
          }}
        >
          <div className='grid gap-4'>
            <FormField
              control={form.control}
              name='ratio'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Final group multiplier')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      min={0}
                      max={1000}
                      step='any'
                      disabled={disabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name='schedule'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Validity period (Beijing time)')}</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    disabled={disabled}
                    onValueChange={(value) => {
                      field.onChange(value)
                      if (value === 'duration') {
                        form.setValue('daily_check_enabled', false, {
                          shouldDirty: true,
                        })
                      }
                    }}
                    className='flex flex-wrap gap-x-5 gap-y-3'
                  >
                    <Label
                      htmlFor={`${scheduleId}-unlimited`}
                      className='flex items-center gap-2'
                    >
                      <RadioGroupItem
                        id={`${scheduleId}-unlimited`}
                        value='unlimited'
                      />
                      {t('No expiry')}
                    </Label>
                    <Label
                      htmlFor={`${scheduleId}-duration`}
                      className='flex items-center gap-2'
                    >
                      <RadioGroupItem
                        id={`${scheduleId}-duration`}
                        value='duration'
                        disabled={!form.watch('enabled')}
                      />
                      {props.rule
                        ? t('Restart for 2 hours on save')
                        : t('2 hours after saving')}
                    </Label>
                    <Label
                      htmlFor={`${scheduleId}-custom`}
                      className='flex items-center gap-2'
                    >
                      <RadioGroupItem
                        id={`${scheduleId}-custom`}
                        value='custom'
                      />
                      {t('Custom schedule')}
                    </Label>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {schedule === 'duration' && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'The 2-hour period starts when the server saves this discount.'
              )}
            </p>
          )}
          {schedule === 'custom' && (
            <fieldset disabled={disabled} className='grid min-w-0 gap-3'>
              <FormField
                control={form.control}
                name='starts_at'
                render={({ field }) => (
                  <FormItem
                    role='group'
                    aria-label={t('Start time (Beijing time)')}
                  >
                    <FormLabel>{t('Start time (Beijing time)')}</FormLabel>
                    <DateTimePicker
                      timeZone='Asia/Shanghai'
                      value={
                        field.value ? new Date(field.value * 1000) : undefined
                      }
                      onChange={(value) =>
                        field.onChange(
                          value ? Math.floor(value.getTime() / 1000) : 0
                        )
                      }
                      placeholder={t('Starts immediately')}
                    />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='ends_at'
                render={({ field }) => (
                  <FormItem
                    role='group'
                    aria-label={t('End time (Beijing time)')}
                  >
                    <FormLabel>{t('End time (Beijing time)')}</FormLabel>
                    <DateTimePicker
                      timeZone='Asia/Shanghai'
                      value={
                        field.value ? new Date(field.value * 1000) : undefined
                      }
                      onChange={(value) =>
                        field.onChange(
                          value ? Math.floor(value.getTime() / 1000) : 0
                        )
                      }
                      placeholder={t('No end time')}
                    />
                  </FormItem>
                )}
              />
            </fieldset>
          )}
          <p className='text-muted-foreground text-xs'>
            {t(
              'All times use Beijing time (UTC+8). On expiry, new requests use the applicable regular multiplier; existing requests keep their billing snapshot.'
            )}
          </p>
          <FormField
            control={form.control}
            name='daily_check_enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-3'>
                <FormLabel>{t('Daily spending assessment')}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={disabled}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          {dailyCheckEnabled && (
            <FormField
              control={form.control}
              name='minimum'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Daily minimum')} ({currencyLabel})
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      min={0}
                      step={tokensOnly ? 1 : 'any'}
                      disabled={disabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {dailyCheckEnabled && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'At 00:10 Beijing time, the previous calendar day is checked using final net charges. Below the minimum, only the discount is disabled.'
              )}{' '}
              {t(
                'Assessment begins after a full calendar day. Short discounts may expire before their first assessment.'
              )}
            </p>
          )}
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-3'>
                <FormLabel>{t('Enable group discount')}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={disabled}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <div className='flex flex-wrap gap-2'>
            <Button type='submit' disabled={disabled}>
              {props.saving ? t('Saving...') : t('Save group discount')}
            </Button>
            {props.onCancel && (
              <Button
                type='button'
                variant='ghost'
                disabled={disabled}
                onClick={props.onCancel}
              >
                {t('Cancel')}
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  )
}
