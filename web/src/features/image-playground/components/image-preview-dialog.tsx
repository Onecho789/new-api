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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'

export type ImagePreviewTarget = {
  src: string
  title: string
  /** 副标题，展示文件名或尺寸等信息 */
  description?: string
}

type ImagePreviewDialogProps = {
  target: ImagePreviewTarget | null
  onOpenChange: (open: boolean) => void
}

/** 放大查看原图。缩略图一律裁剪，需要这里看完整画面 */
export function ImagePreviewDialog({
  target,
  onOpenChange,
}: ImagePreviewDialogProps) {
  const { t } = useTranslation()
  const [naturalSize, setNaturalSize] = useState<string | null>(null)

  return (
    <Dialog
      contentClassName='sm:max-w-4xl'
      description={
        [target?.description, naturalSize].filter(Boolean).join(' · ') ||
        undefined
      }
      open={target !== null}
      title={target?.title ?? t('Image Preview')}
      onOpenChange={(open) => {
        if (!open) setNaturalSize(null)
        onOpenChange(open)
      }}
    >
      {target ? (
        <div className='bg-muted/40 flex items-center justify-center rounded-lg border p-2'>
          <img
            alt={target.title}
            className='max-h-[70vh] w-auto max-w-full object-contain'
            src={target.src}
            onLoad={(event) => {
              const node = event.currentTarget
              setNaturalSize(`${node.naturalWidth}x${node.naturalHeight}`)
            }}
          />
        </div>
      ) : null}
    </Dialog>
  )
}
