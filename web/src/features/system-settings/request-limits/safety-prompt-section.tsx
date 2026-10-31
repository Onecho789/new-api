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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

// 与后端 system_setting.MaxSafetyPromptRunes 保持一致。
const MAX_SAFETY_PROMPT_LENGTH = 20000

const safetyPromptSchema = z.object({
  safety_prompt: z.object({
    enabled: z.boolean(),
    prompt: z.string().max(MAX_SAFETY_PROMPT_LENGTH),
  }),
})

type SafetyPromptFormValues = z.output<typeof safetyPromptSchema>
type SafetyPromptFormInput = z.input<typeof safetyPromptSchema>

type NormalizedSafetyPromptValues = {
  'safety_prompt.enabled': boolean
  'safety_prompt.prompt': string
}

type SafetyPromptSectionProps = {
  defaultValues: NormalizedSafetyPromptValues
}

const buildFormDefaults = (
  defaults: NormalizedSafetyPromptValues
): SafetyPromptFormInput => ({
  safety_prompt: {
    enabled: defaults['safety_prompt.enabled'],
    prompt: defaults['safety_prompt.prompt'],
  },
})

const normalizeFormValues = (
  values: SafetyPromptFormValues
): NormalizedSafetyPromptValues => ({
  'safety_prompt.enabled': values.safety_prompt.enabled,
  'safety_prompt.prompt': values.safety_prompt.prompt,
})

export function SafetyPromptSection({
  defaultValues,
}: SafetyPromptSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<SafetyPromptFormInput, unknown, SafetyPromptFormValues>({
    resolver: zodResolver(safetyPromptSchema),
    mode: 'onChange',
    defaultValues: buildFormDefaults(defaultValues),
  })

  useEffect(() => {
    form.reset(buildFormDefaults(defaultValues))
  }, [defaultValues, form])

  const onSubmit = async (values: SafetyPromptFormValues) => {
    const normalized = normalizeFormValues(values)
    const keys = [
      'safety_prompt.prompt',
      'safety_prompt.enabled',
    ] as const satisfies readonly (keyof NormalizedSafetyPromptValues)[]

    // 先写提示词再写开关，避免开关先生效时短暂注入旧内容。
    for (const key of keys) {
      if (normalized[key] !== defaultValues[key]) {
        await updateOption.mutateAsync({ key, value: normalized[key] })
      }
    }
  }

  return (
    <SettingsSection title={t('Safety Prompt')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save safety prompt'
          />
          <FormField
            control={form.control}
            name='safety_prompt.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable safety prompt injection')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Prepends the safety instructions below to the system prompt of every relayed request, before any channel-level system prompt.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='safety_prompt.prompt'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Safety instructions')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={14}
                    placeholder={t('Enter the safety instructions to inject')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Sent as a system instruction to every provider, so it also consumes input tokens on each request. Keep it short and specific.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
