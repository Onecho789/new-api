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
import { useMutation } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { saveUserGuide } from '../api'
import { getGuideFormSchema, type GuideFormValues } from '../lib/guide-form'
import type { UserGuide } from '../types'

const GUIDE_FORM_ID = 'user-guide-form'

interface GuideFormDialogProps {
  // Editing loads the full guide first, so content is present here.
  guide?: UserGuide
  nextSortOrder: number
  onClose: () => void
  onSaved: () => void
}

export function GuideFormDialog(props: GuideFormDialogProps) {
  const { t } = useTranslation()
  const form = useForm<GuideFormValues>({
    resolver: zodResolver(getGuideFormSchema(t)),
    defaultValues: {
      title: props.guide?.title ?? '',
      format: props.guide?.format ?? 'markdown',
      content: props.guide?.content ?? '',
      sort_order: props.guide?.sort_order ?? props.nextSortOrder,
      enabled: props.guide?.enabled ?? true,
    },
  })
  const format = useWatch({ control: form.control, name: 'format' })
  const content = useWatch({ control: form.control, name: 'content' })
  const save = useMutation({
    mutationFn: async (values: GuideFormValues) =>
      requireServerSuccess(await saveUserGuide(values, props.guide?.id)),
    onSuccess: () => {
      toast.success(t('Guide saved successfully'))
      props.onSaved()
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onClose()
      }}
      title={t(props.guide ? 'Edit guide' : 'Create guide')}
      contentClassName='sm:max-w-4xl'
      bodyClassName='space-y-4'
      showCloseButton={!save.isPending}
      footer={
        <>
          <Button
            variant='outline'
            disabled={save.isPending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={GUIDE_FORM_ID} disabled={save.isPending}>
            {save.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={GUIDE_FORM_ID}
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Guide title')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete='off'
                    placeholder={t('How to call video models')}
                    disabled={save.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className='grid gap-4 sm:grid-cols-3'>
            <FormField
              control={form.control}
              name='format'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Content format')}</FormLabel>
                  <FormControl>
                    <NativeSelect
                      className='w-full'
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.value)}
                      disabled={save.isPending}
                    >
                      <NativeSelectOption value='markdown'>
                        Markdown
                      </NativeSelectOption>
                      <NativeSelectOption value='html'>HTML</NativeSelectOption>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='sort_order'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Sort order')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step={1}
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(
                          Number.parseInt(event.target.value, 10) || 0
                        )
                      }
                      disabled={save.isPending}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Smaller values appear first')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Published')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={save.isPending}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Unpublished guides are only visible here')}
                  </FormDescription>
                </FormItem>
              )}
            />
          </div>
          <Tabs defaultValue='edit'>
            <TabsList>
              <TabsTrigger value='edit'>{t('Edit')}</TabsTrigger>
              <TabsTrigger value='preview'>{t('Preview')}</TabsTrigger>
            </TabsList>
            <TabsContent value='edit' keepMounted>
              <FormField
                control={form.control}
                name='content'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='sr-only'>
                      {t('Guide content')}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={18}
                        className='font-mono text-sm'
                        placeholder={t(
                          'Write the guide in Markdown or paste HTML, for example request examples and parameter tables.'
                        )}
                        disabled={save.isPending}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'HTML is sanitized and rendered in isolation; scripts are removed.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </TabsContent>
            <TabsContent value='preview'>
              <div className='max-h-[60vh] min-h-48 overflow-y-auto rounded-md border p-4'>
                {content.trim() ? (
                  <RichContent
                    mode={format}
                    htmlVariant='isolated'
                    content={content}
                    className='prose-neutral dark:prose-invert max-w-none'
                  />
                ) : (
                  <p className='text-muted-foreground text-sm'>
                    {t('Nothing to preview yet')}
                  </p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </form>
      </Form>
    </Dialog>
  )
}
