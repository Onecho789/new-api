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
import { AlertCircleIcon, SparklesIcon, SquareIcon } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

import { ApiKeyField } from './components/api-key-field'
import { ImageModeTabs } from './components/image-mode-tabs'
import { ImageModelSelect } from './components/image-model-select'
import { ImageParameterForm } from './components/image-parameter-form'
import { ImageResultGallery } from './components/image-result-gallery'
import { ImageUploadPanel } from './components/image-upload-panel'
import {
  useImageGeneration,
  useImageModels,
  useImagePlaygroundState,
  useImageUploads,
} from './hooks'
import { buildDownloadFileName, imageSrcToFile } from './lib'
import type { GeneratedImage } from './types'

export function ImagePlayground() {
  const { t } = useTranslation()

  const {
    config,
    updateConfig,
    setMode,
    parameterEnabled,
    updateParameterEnabled,
    apiKey,
    setApiKey,
    rememberApiKey,
    setRememberApiKey,
  } = useImagePlaygroundState()

  const { models, imageModels, isLoading: isLoadingModels } = useImageModels()

  const {
    images: uploadedImages,
    mask,
    uploadError,
    addImages,
    replaceImages,
    removeImage: removeUploadedImage,
    clearImages: clearUploadedImages,
    setMaskFile,
    clearMask,
  } = useImageUploads()

  const {
    images,
    isGenerating,
    error,
    generate,
    regenerate,
    setError,
    stop,
    clearImages,
    removeImage,
  } = useImageGeneration({
    apiKey,
    config,
    mask,
    parameterEnabled,
    uploadedImages,
  })

  const isEditMode = config.mode === 'edit'

  // 结果按模式隔离展示，另一模式的历史保留但不混进来
  const visibleImages = useMemo(
    () => images.filter((image) => image.mode === config.mode),
    [config.mode, images]
  )
  const otherModeCount = images.length - visibleImages.length

  const canGenerate =
    !isGenerating &&
    config.prompt.trim() !== '' &&
    apiKey.trim() !== '' &&
    (!isEditMode || uploadedImages.length > 0)

  /** 拿生成结果当新的原图，切到图生图接着改 */
  const handleContinueEditing = useCallback(
    async (image: GeneratedImage) => {
      try {
        const file = await imageSrcToFile(
          image.src,
          buildDownloadFileName(image)
        )
        replaceImages([file])
        updateConfig('prompt', '')
        setMode('edit')
        setError(null)
        toast.success(t('Loaded into image to image, describe your changes'))
      } catch {
        toast.error(t('Failed to load this image for editing'))
      }
    },
    [replaceImages, setError, setMode, t, updateConfig]
  )

  const handleReusePrompt = useCallback(
    (prompt: string) => {
      updateConfig('prompt', prompt)
      toast.success(t('Prompt copied into the input'))
    },
    [t, updateConfig]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Image Playground')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {/* 超宽屏下限制总宽并居中，避免内容被拉散在左侧 */}
        <div className='mx-auto w-full max-w-[90rem] space-y-4'>
          <div className='flex justify-center'>
            <ImageModeTabs
              disabled={isGenerating}
              mode={config.mode}
              onModeChange={setMode}
            />
          </div>

          <div className='grid gap-4 @4xl/content:grid-cols-[20rem_minmax(0,1fr)]'>
            {/* 左侧：配置区 */}
            <div className='space-y-4'>
              <Card>
                <CardHeader>
                  <CardTitle>{t('Request settings')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <ApiKeyField
                    apiKey={apiKey}
                    disabled={isGenerating}
                    onApiKeyChange={setApiKey}
                    onRememberChange={setRememberApiKey}
                    remember={rememberApiKey}
                  />

                  <Separator />

                  <ImageModelSelect
                    disabled={isGenerating}
                    imageModels={imageModels}
                    isLoading={isLoadingModels}
                    models={models}
                    value={config.model}
                    onChange={(value) => updateConfig('model', value)}
                  />

                  <Separator />

                  <ImageParameterForm
                    config={config}
                    disabled={isGenerating}
                    showIgnoredNotes
                    onConfigChange={updateConfig}
                    onParameterEnabledChange={updateParameterEnabled}
                    parameterEnabled={parameterEnabled}
                  />
                </CardContent>
              </Card>
            </div>

            {/* 右侧：输入与结果 */}
            <div className='min-w-0 space-y-4'>
              {isEditMode ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('Input images')}</CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <ImageUploadPanel
                      disabled={isGenerating}
                      images={uploadedImages}
                      mask={mask}
                      onAddImages={addImages}
                      onClearImages={clearUploadedImages}
                      onClearMask={clearMask}
                      onRemoveImage={removeUploadedImage}
                      onSetMask={setMaskFile}
                    />
                    {uploadError ? (
                      <Alert variant='destructive'>
                        <AlertCircleIcon className='size-4' />
                        <AlertDescription>{uploadError}</AlertDescription>
                      </Alert>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>{t('Prompt')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <div className='space-y-1.5'>
                    <Label className='sr-only' htmlFor='image-prompt'>
                      {t('Prompt')}
                    </Label>
                    <Textarea
                      className='min-h-28 resize-y'
                      disabled={isGenerating}
                      id='image-prompt'
                      placeholder={
                        isEditMode
                          ? t('Describe the edit you want to apply...')
                          : t('Describe the image you want to generate...')
                      }
                      value={config.prompt}
                      onChange={(e) => updateConfig('prompt', e.target.value)}
                    />
                  </div>

                  {error ? (
                    <Alert variant='destructive'>
                      <AlertCircleIcon className='size-4' />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}

                  <div className='flex flex-wrap gap-2'>
                    <Button
                      disabled={!canGenerate}
                      onClick={() => void generate()}
                    >
                      <SparklesIcon className='size-4' />
                      {isEditMode ? t('Apply edit') : t('Generate')}
                    </Button>
                    {isGenerating ? (
                      <Button variant='outline' onClick={stop}>
                        <SquareIcon className='size-4' />
                        {t('Stop')}
                      </Button>
                    ) : null}
                    {images.length > 0 ? (
                      <Button
                        disabled={isGenerating}
                        variant='ghost'
                        onClick={clearImages}
                      >
                        {t('Clear results')}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('Results')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ImageResultGallery
                    images={visibleImages}
                    isGenerating={isGenerating}
                    otherModeCount={otherModeCount}
                    onContinueEditing={(image) =>
                      void handleContinueEditing(image)
                    }
                    onRegenerate={(image) => void regenerate(image)}
                    onRemove={removeImage}
                    onReusePrompt={handleReusePrompt}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
