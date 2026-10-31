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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { createTokenCategory, updateTokenCategory } from '../api'
import {
  getCategoryFormSchema,
  type CategoryFormValues,
} from '../lib/category-form'
import type { TokenCategory } from '../types'

interface CategoryFormDialogProps {
  category?: TokenCategory
  onClose: () => void
  onSaved: () => void
}

export function CategoryFormDialog(props: CategoryFormDialogProps) {
  const { t } = useTranslation()
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(getCategoryFormSchema(t)),
    defaultValues: { name: props.category?.name ?? '' },
  })
  const save = useMutation({
    mutationFn: async (values: CategoryFormValues) =>
      requireServerSuccess(
        props.category
          ? await updateTokenCategory(props.category.id, values)
          : await createTokenCategory(values)
      ),
    onSuccess: () => {
      toast.success(t('Key category saved successfully'))
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
      title={t(props.category ? 'Rename key category' : 'Create key category')}
      contentClassName='sm:max-w-md'
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
          <Button
            type='submit'
            form='key-category-form'
            disabled={save.isPending}
          >
            {save.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id='key-category-form'
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Category name')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete='off'
                    disabled={save.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
