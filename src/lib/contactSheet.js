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

function sampleGray(gray, width, height, x, y) {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(y)));
  return gray[py * width + px];
}

function borderScore(gray, width, height, box) {
  const { left, top, right, bottom } = box;
  const samples = 14;
  let score = 0;
  let count = 0;
  const contrast = (x1, y1, x2, y2) =>
    Math.abs(sampleGray(gray, width, height, x1, y1) -
             sampleGray(gray, width, height, x2, y2));

  for (let i = 1; i <= samples; i += 1) {
    const t = i / (samples + 1);
    const x = left + (right - left) * t;
    const y = top + (bottom - top) * t;
    score += contrast(x, top - 2, x, top + 2);
    score += contrast(x, bottom - 2, x, bottom + 2);
    score += contrast(left - 2, y, left + 2, y);
    score += contrast(right - 2, y, right + 2, y);
    count += 4;
  }
  return score / count;
}

function bestCardPosition(gray, width, height, centerX, centerY, cardWidth, cardHeight, rangeX, rangeY) {
  let best = null;
  let bestScore = -1;
  const stepX = Math.max(2, Math.round(Math.min(rangeX, rangeY) / 5));
  const stepY = stepX;

  for (let dy = -rangeY; dy <= rangeY; dy += stepY) {
    for (let dx = -rangeX; dx <= rangeX; dx += stepX) {
      const left = centerX + dx - cardWidth / 2;
      const top = centerY + dy - cardHeight / 2;
      const box = { left, top, right: left + cardWidth, bottom: top + cardHeight };
      if (box.left < 2 || box.top < 2 || box.right >= width - 2 || box.bottom >= height - 2) continue;
      const score = borderScore(gray, width, height, box);
      if (score > bestScore) {
        bestScore = score;
        best = { ...box, score };
      }
    }
  }
  return best || {
    left: centerX - cardWidth / 2,
    top: centerY - cardHeight / 2,
    right: centerX + cardWidth / 2,
    bottom: centerY + cardHeight / 2,
    score: 0
  };
}

export async function cropContactSheet(file, rows, columns, insetValues = 3) {
  const safeRows = Math.max(1, Math.min(16, Math.floor(Number(rows) || 1)));
  const safeColumns = Math.max(1, Math.min(17, Math.floor(Number(columns) || 1)));
  const total = safeRows * safeColumns;
  if (total > 300) throw new Error('一度に切り抜けるのは300枚までです。');

  const bitmap = await createImageBitmap(file);
  try {
    // Detect each card's position independently instead of cutting the image
    // into equal-sized cells. The grid is only a starting point for the search.
    const maxSide = 1000;
    const scale = Math.min(1, maxSide / bitmap.width, maxSide / bitmap.height);
    const scanWidth = Math.max(2, Math.round(bitmap.width * scale));
    const scanHeight = Math.max(2, Math.round(bitmap.height * scale));
    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = scanWidth;
    scanCanvas.height = scanHeight;
    const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
    scanContext.drawImage(bitmap, 0, 0, scanWidth, scanHeight);
    const pixels = scanContext.getImageData(0, 0, scanWidth, scanHeight).data;
    const gray = new Uint8Array(scanWidth * scanHeight);
    for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
      gray[p] = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    }

    const cellWidth = scanWidth / safeColumns;
    const cellHeight = scanHeight / safeRows;
    const baseWidth = Math.min(cellWidth * 0.98, cellHeight * DEFAULT_CARD_RATIO * 0.98);
    const insetConfig = typeof insetValues === 'number'
      ? { top: insetValues, right: insetValues, bottom: insetValues, left: insetValues }
      : insetValues || {};
    const inset = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [
      side,
      Math.max(0, Math.min(17, Number(insetConfig[side]) || 0)) / 100
    ]));

    // Choose one shared card size (all cards are expected to be the same size),
    // while allowing every card to shift independently inside its rough grid cell.
    const sizeFactors = [0.68, 0.74, 0.80, 0.86, 0.92, 0.98];
    let bestLayout = null;
    let bestLayoutScore = -1;
    for (const factor of sizeFactors) {
      const cardWidth = baseWidth * factor;
      const cardHeight = cardWidth / DEFAULT_CARD_RATIO;
      if (cardHeight > cellHeight * 1.08) continue;
      const boxes = [];
      let layoutScore = 0;
      for (let row = 0; row < safeRows; row += 1) {
        for (let column = 0; column < safeColumns; column += 1) {
          const centerX = (column + 0.5) * cellWidth;
          const centerY = (row + 0.5) * cellHeight;
          const found = bestCardPosition(
            gray, scanWidth, scanHeight, centerX, centerY,
            cardWidth, cardHeight, cellWidth * 0.32, cellHeight * 0.32
          );
          boxes.push(found);
          layoutScore += found.score;
        }
      }
      const averageScore = layoutScore / Math.max(1, boxes.length);
      if (averageScore > bestLayoutScore) {
        bestLayoutScore = averageScore;
        bestLayout = boxes;
      }
    }

    if (!bestLayout) throw new Error('カードの大きさを推定できませんでした。行数・列数を確認してください。');

    const scaleX = bitmap.width / scanWidth;
    const scaleY = bitmap.height / scanHeight;
    const results = [];
    for (let index = 0; index < bestLayout.length; index += 1) {
      const box = bestLayout[index];
      const width = box.right - box.left;
      const height = box.bottom - box.top;
      const left = Math.round((box.left + width * inset.left) * scaleX);
      const top = Math.round((box.top + height * inset.top) * scaleY);
      const right = Math.round((box.right - width * inset.right) * scaleX);
      const bottom = Math.round((box.bottom - height * inset.bottom) * scaleY);
      const cropWidth = Math.max(1, right - left);
      const cropHeight = Math.max(1, bottom - top);
      const canvas = document.createElement('canvas');
      canvas.width = cropWidth;
      canvas.height = cropHeight;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          result => result ? resolve(result) : reject(new Error('切り抜き画像を作成できませんでした。')),
          'image/jpeg',
          0.94
        );
      });
      results.push(new File([blob], \`contact-card-\${String(index + 1).padStart(3, '0')}.jpg\`, {
        type: 'image/jpeg',
        lastModified: Date.now()
      }));
    }
    return results;
  } finally {
    bitmap.close?.();
  }
}
