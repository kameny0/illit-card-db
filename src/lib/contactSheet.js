// Contact-sheet helpers. All processing runs locally in the browser.
const DEFAULT_CARD_RATIO = 0.68;

function grayscaleProjections(bitmap, maxSide = 720) {
  const scale = Math.min(1, maxSide / bitmap.width, maxSide / bitmap.height);
  const width = Math.max(2, Math.round(bitmap.width * scale));
  const height = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    gray[p] = Math.round(
      0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
    );
  }

  const vertical = new Float32Array(width);
  const horizontal = new Float32Array(height);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 1; x < width; x += 1) {
      vertical[x] += Math.abs(gray[row + x] - gray[row + x - 1]);
    }
  }

  for (let y = 1; y < height; y += 1) {
    const row = y * width;
    const previous = row - width;
    for (let x = 0; x < width; x += 1) {
      horizontal[y] += Math.abs(gray[row + x] - gray[previous + x]);
    }
  }

  for (let x = 0; x < width; x += 1) vertical[x] /= height;
  for (let y = 0; y < height; y += 1) horizontal[y] /= width;

  return { width, height, scale, vertical: smooth(vertical), horizontal: smooth(horizontal) };
}

function smooth(values) {
  const result = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let total = 0;
    let count = 0;
    for (let offset = -3; offset <= 3; offset += 1) {
      const index = i + offset;
      if (index >= 0 && index < values.length) {
        total += values[index];
        count += 1;
      }
    }
    result[i] = total / count;
  }
  return result;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
}

function locateCuts(projection, divisions) {
  const length = projection.length;
  const baseline = median(Array.from(projection).filter(value => value > 0));
  const cuts = [0];

  for (let division = 1; division < divisions; division += 1) {
    const expected = (length * division) / divisions;
    const radius = Math.max(3, Math.round((length / divisions) * 0.14));
    const start = Math.max(1, Math.round(expected - radius));
    const end = Math.min(length - 2, Math.round(expected + radius));
    let bestIndex = Math.round(expected);
    let bestValue = Infinity;

    for (let index = start; index <= end; index += 1) {
      if (projection[index] < bestValue) {
        bestValue = projection[index];
        bestIndex = index;
      }
    }

    // Only follow a detected valley when it is meaningfully clearer than the
    // surrounding image. Otherwise keep the evenly-spaced grid line.
    const position = bestValue < baseline * 0.9 ? bestIndex : Math.round(expected);
    cuts.push(position);
  }

  cuts.push(length);
  return cuts;
}

export async function guessContactSheetGrid(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const projections = grayscaleProjections(bitmap);
    const { width, height, vertical, horizontal } = projections;
    const xBaseline = median(Array.from(vertical).filter(value => value > 0));
    const yBaseline = median(Array.from(horizontal).filter(value => value > 0));
    let best = { rows: 1, columns: 1, score: Infinity };

    for (let rows = 1; rows <= 16; rows += 1) {
      if (height / rows < 55) continue;
      for (let columns = 1; columns <= 17; columns += 1) {
        if (width / columns < 38) continue;

        const cardRatio = (width / columns) / (height / rows);
        const ratioError = Math.abs(Math.log(cardRatio / DEFAULT_CARD_RATIO));
        if (ratioError > 0.55) continue;

        const xCuts = locateCuts(vertical, columns);
        const yCuts = locateCuts(horizontal, rows);
        let xGap = 0;
        let yGap = 0;

        for (let i = 1; i < xCuts.length - 1; i += 1) {
          xGap += vertical[xCuts[i]] / xBaseline;
        }
        for (let i = 1; i < yCuts.length - 1; i += 1) {
          yGap += horizontal[yCuts[i]] / yBaseline;
        }

        const xCount = Math.max(1, columns - 1);
        const yCount = Math.max(1, rows - 1);
        const gapScore = (
          (columns > 1 ? xGap / xCount : 0.65) +
          (rows > 1 ? yGap / yCount : 0.65)
        ) / 2;
        const separatorCount = columns + rows - 2;
        const evidencePenalty = separatorCount ? 0.11 / Math.sqrt(separatorCount) : 0.2;
        const score = ratioError * 1.7 + gapScore + evidencePenalty;

        if (score < best.score) best = { rows, columns, score };
      }
    }

    return { rows: best.rows, columns: best.columns };
  } finally {
    bitmap.close?.();
  }
}

export async function cropContactSheet(file, rows, columns, insetPercent = 3) {
  const safeRows = Math.max(1, Math.min(16, Math.floor(Number(rows) || 1)));
  const safeColumns = Math.max(1, Math.min(17, Math.floor(Number(columns) || 1)));
  const total = safeRows * safeColumns;
  if (total > 300) throw new Error('一度に切り抜けるのは300枚までです。');

  const bitmap = await createImageBitmap(file);
  try {
    const projections = grayscaleProjections(bitmap);
    const xCutsSmall = locateCuts(projections.vertical, safeColumns);
    const yCutsSmall = locateCuts(projections.horizontal, safeRows);
    const scaleX = bitmap.width / projections.width;
    const scaleY = bitmap.height / projections.height;
    const xCuts = xCutsSmall.map(value => Math.round(value * scaleX));
    const yCuts = yCutsSmall.map(value => Math.round(value * scaleY));
    const inset = Math.max(0, Math.min(12, Number(insetPercent) || 0)) / 100;
    const results = [];

    for (let row = 0; row < safeRows; row += 1) {
      for (let column = 0; column < safeColumns; column += 1) {
        const cellLeft = xCuts[column];
        const cellRight = xCuts[column + 1];
        const cellTop = yCuts[row];
        const cellBottom = yCuts[row + 1];
        const cellWidth = cellRight - cellLeft;
        const cellHeight = cellBottom - cellTop;
        const left = Math.round(cellLeft + cellWidth * inset);
        const top = Math.round(cellTop + cellHeight * inset);
        const right = Math.round(cellRight - cellWidth * inset);
        const bottom = Math.round(cellBottom - cellHeight * inset);
        const cropWidth = Math.max(1, right - left);
        const cropHeight = Math.max(1, bottom - top);
        const canvas = document.createElement('canvas');
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        const context = canvas.getContext('2d');
        context.drawImage(
          bitmap,
          left, top, cropWidth, cropHeight,
          0, 0, cropWidth, cropHeight
        );

        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            result => result ? resolve(result) : reject(new Error('切り抜き画像を作成できませんでした。')),
            'image/jpeg',
            0.94
          );
        });

        const index = results.length + 1;
        results.push(new File([blob], `contact-card-${String(index).padStart(3, '0')}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now()
        }));
      }
    }

    return results;
  } finally {
    bitmap.close?.();
  }
}
