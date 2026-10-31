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
/**
 * 把任意 src（data: 或 http:）取成 Blob。
 * 上游只回 b64_json，src 是数 MB 的 data URL，
 * 浏览器会拦截顶层跳转到 data URL，因此不能直接用 <a href>。
 */
async function fetchImageBlob(src: string): Promise<Blob> {
  const res = await fetch(src)
  if (!res.ok) {
    throw new Error(`Failed to read image: ${res.status}`)
  }
  return res.blob()
}

/** 经 blob URL 触发下载，用完立即释放 */
function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function downloadImage(
  src: string,
  fileName: string
): Promise<void> {
  const blob = await fetchImageBlob(src)
  triggerBlobDownload(blob, fileName)
}

/** 把生成结果转成 File，供「以此图继续编辑」塞进上传列表 */
export async function imageSrcToFile(
  src: string,
  fileName: string
): Promise<File> {
  const blob = await fetchImageBlob(src)
  return new File([blob], fileName, { type: blob.type || 'image/png' })
}
