import imageCompression from 'browser-image-compression'
import { supabase } from './supabase'
import { createImageHash } from './imageHash'

export async function prepareAndUploadImage(file, userId) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('画像ファイルを選択してください')
  }

  // Hash the original image before compression.
  const imageHash = await createImageHash(file)

  const compressed = await imageCompression(file, {
    maxSizeMB: 0.25,
    maxWidthOrHeight: 1400,
    useWebWorker: true,
    fileType: 'image/webp',
  })

  const path = `${userId}/${crypto.randomUUID()}.webp`
  const { error } = await supabase.storage
    .from('card-images')
    .upload(path, compressed, {
      contentType: 'image/webp',
      upsert: false,
    })

  if (error) throw error

  const { data } = supabase.storage.from('card-images').getPublicUrl(path)

  return {
    imagePath: path,
    imageUrl: data.publicUrl,
    imageHash,
    compressedBytes: compressed.size,
  }
}
