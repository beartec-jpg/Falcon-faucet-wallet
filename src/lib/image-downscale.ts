// Browser-only: re-encode a picked photo/screenshot as JPEG, at most `maxSide` px on the long
// edge, under `maxBytes`. Re-encoding through a canvas drops EXIF/GPS and other metadata.
// createImageBitmap with imageOrientation 'from-image' applies the camera rotation first.

export async function downscaleImage(file: File, maxSide = 1600, maxBytes = 1_400_000): Promise<File> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  let w = Math.max(1, Math.round(bmp.width * scale))
  let h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  const toBlob = (q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', q))
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = w
    canvas.height = h
    ctx.fillStyle = '#ffffff' // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    for (const q of [0.85, 0.75, 0.65]) {
      const blob = await toBlob(q)
      if (blob && blob.size <= maxBytes) {
        bmp.close?.()
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
      }
    }
    w = Math.round(w * 0.8)
    h = Math.round(h * 0.8)
  }
  bmp.close?.()
  throw new Error('Image is too large even after compression.')
}
