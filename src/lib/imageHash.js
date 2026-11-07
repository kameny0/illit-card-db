// 8x8 average hash (aHash). Lightweight, runs locally in the browser.
// It is a similarity hint, not an AI identity matcher.
export async function createImageHash(fileOrUrl) {
  const image = await loadImage(fileOrUrl)
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0, 8, 8)
  const pixels = context.getImageData(0, 0, 8, 8).data
  const values = []

  for (let i = 0; i < pixels.length; i += 4) {
    // Approximate grayscale luminance.
    values.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2])
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return values.map(value => value >= average ? '1' : '0').join('')
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    let objectUrl = null

    if (source instanceof File || source instanceof Blob) {
      objectUrl = URL.createObjectURL(source)
      image.src = objectUrl
    } else {
      image.crossOrigin = 'anonymous'
      image.src = source
    }

    image.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      reject(new Error('画像を読み込めませんでした'))
    }
  })
}

export function hashSimilarity(hashA, hashB) {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 0
  let same = 0
  for (let i = 0; i < hashA.length; i += 1) {
    if (hashA[i] === hashB[i]) same += 1
  }
  return same / hashA.length
}
