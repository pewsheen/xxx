// Tolerance for blank/letterbox detection using Euclidean distance
const BLANK_TOLERANCE = 35;

// Logger function - can be overridden
let _log = function (...args) {
  console.log('[Image Analysis]', ...args);
};

function setLogger(logFn) {
  _log = logFn;
}

// Calculate Euclidean distance between two RGB colors
function colorDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Check if a row of pixel data is blank (solid color with tolerance)
function isRowBlank(rowData) {
  const firstR = rowData[0];
  const firstG = rowData[1];
  const firstB = rowData[2];

  for (let i = 4; i < rowData.length; i += 4) {
    const dist = colorDistance(
      firstR,
      firstG,
      firstB,
      rowData[i],
      rowData[i + 1],
      rowData[i + 2]
    );
    if (dist > BLANK_TOLERANCE) {
      return false;
    }
  }
  return true;
}

// Extract edge pixels from an image (top and bottom rows, skipping letterboxing)
function getEdgePixels(img) {
  const canvas = document.createElement('canvas');
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  // Max rows to skip for letterboxing (10% of height or 50 rows, whichever is smaller)
  const maxLetterboxRows = Math.min(Math.floor(height * 0.1), 50);

  // Find top content edge (skip letterboxing)
  let hasBlankTop = false;
  let topY = 0;
  for (let y = 0; y < maxLetterboxRows; y++) {
    const rowData = ctx.getImageData(0, y, width, 1).data;
    if (!isRowBlank(rowData)) {
      topY = y;
      break;
    }
    topY = y + 1;
  }
  if (topY > 0) {
    hasBlankTop = true;
    _log(`Skipped ${topY} letterbox rows from top`);
  }

  // Find bottom content edge (skip letterboxing)
  let hasBlankBottom = false;
  let bottomY = height - 1;
  for (let y = height - 1; y >= height - maxLetterboxRows; y--) {
    const rowData = ctx.getImageData(0, y, width, 1).data;
    if (!isRowBlank(rowData)) {
      bottomY = y;
      break;
    }
    bottomY = y - 1;
  }
  if (bottomY < height - 1) {
    hasBlankBottom = true;
    _log(`Skipped ${height - 1 - bottomY} letterbox rows from bottom`);
  }

  // Get top row pixels (sample every 10th pixel for performance)
  const topRowData = ctx.getImageData(0, topY, width, 1).data;
  const topPixels = [];
  for (let i = 0; i < topRowData.length; i += 40) {
    topPixels.push(topRowData[i], topRowData[i + 1], topRowData[i + 2]);
  }

  // Get bottom row pixels
  const bottomRowData = ctx.getImageData(0, bottomY, width, 1).data;
  const bottomPixels = [];
  for (let i = 0; i < bottomRowData.length; i += 40) {
    bottomPixels.push(
      bottomRowData[i],
      bottomRowData[i + 1],
      bottomRowData[i + 2]
    );
  }

  return {
    topPixels,
    bottomPixels,
    topY,
    bottomY,
    hasBlankTop,
    hasBlankBottom,
  };
}

// Calculate similarity between two pixel arrays using MSE (lower = more similar)
function calculatePixelDifference(pixels1, pixels2) {
  const len = Math.min(pixels1.length, pixels2.length);

  let totalDiff = 0;
  for (let i = 0; i < len; i++) {
    const diff = pixels1[i] - pixels2[i];
    totalDiff += diff * diff;
  }

  return totalDiff / len;
}

// Generate all permutations of an array
function getPermutations(arr) {
  if (arr.length <= 1) return [arr];

  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
    const remainingPerms = getPermutations(remaining);

    for (let j = 0; j < remainingPerms.length; j++) {
      result.push([current].concat(remainingPerms[j]));
    }
  }

  return result;
}

// Find optimal image order based on edge pixel similarity
function findOptimalOrder(imageElements) {
  _log('Analyzing edge pixels to find optimal order...');

  // Extract edge pixels for all images
  const edgeData = [];
  for (let i = 0; i < imageElements.length; i++) {
    edgeData.push(getEdgePixels(imageElements[i]));
    _log(`Extracted edge pixels for image ${i + 1}`);
  }

  // Detect blank edges to identify first, last, and floating images
  let firstIdx = -1;
  let lastIdx = -1;
  const floatingIndices = []; // Images with blank on BOTH sides

  _log('Checking for blank edges...');
  for (let i = 0; i < imageElements.length; i++) {
    const hasBlankTop = edgeData[i].hasBlankTop;
    const hasBlankBottom = edgeData[i].hasBlankBottom;

    if (hasBlankTop) _log(`Image ${i + 1} has blank TOP`);
    if (hasBlankBottom) _log(`Image ${i + 1} has blank BOTTOM`);

    if (hasBlankTop && hasBlankBottom) {
      _log(`Image ${i + 1} has blank BOTH sides - FLOATING`);
      floatingIndices.push(i);
    } else if (hasBlankTop && !hasBlankBottom) {
      _log(`Image ${i + 1} has blank TOP only - candidate for FIRST`);
      firstIdx = i;
    } else if (hasBlankBottom && !hasBlankTop) {
      _log(`Image ${i + 1} has blank BOTTOM only - candidate for LAST`);
      lastIdx = i;
    }
  }

  // Use blank edge detection if we found BOTH first and last (among non-floating)
  if (firstIdx !== -1 && lastIdx !== -1 && firstIdx !== lastIdx) {
    _log(`Detected first image: ${firstIdx + 1}, last image: ${lastIdx + 1}`);

    // Find middle indices (excluding first, last, and floating)
    const middleIndices = [];
    for (let i = 0; i < imageElements.length; i++) {
      if (
        i !== firstIdx &&
        i !== lastIdx &&
        floatingIndices.indexOf(i) === -1
      ) {
        middleIndices.push(i);
      }
    }

    _log(`Middle images: [${middleIndices.map((i) => i + 1).join(', ')}]`);

    let baseOrder;
    if (middleIndices.length === 0) {
      // No middle images, just first and last
      baseOrder = [firstIdx, lastIdx];
    } else if (middleIndices.length === 1) {
      // One middle image
      baseOrder = [firstIdx, middleIndices[0], lastIdx];
    } else {
      // Two middle images - find best order
      const m0 = middleIndices[0];
      const m1 = middleIndices[1];

      // Option 1: first -> m0 -> m1 -> last
      const score1 =
        calculatePixelDifference(
          edgeData[firstIdx].bottomPixels,
          edgeData[m0].topPixels
        ) +
        calculatePixelDifference(
          edgeData[m0].bottomPixels,
          edgeData[m1].topPixels
        ) +
        calculatePixelDifference(
          edgeData[m1].bottomPixels,
          edgeData[lastIdx].topPixels
        );

      // Option 2: first -> m1 -> m0 -> last
      const score2 =
        calculatePixelDifference(
          edgeData[firstIdx].bottomPixels,
          edgeData[m1].topPixels
        ) +
        calculatePixelDifference(
          edgeData[m1].bottomPixels,
          edgeData[m0].topPixels
        ) +
        calculatePixelDifference(
          edgeData[m0].bottomPixels,
          edgeData[lastIdx].topPixels
        );

      _log(
        `Middle order option 1 [${m0 + 1}, ${m1 + 1}] score: ${score1.toFixed(
          2
        )}`
      );
      _log(
        `Middle order option 2 [${m1 + 1}, ${m0 + 1}] score: ${score2.toFixed(
          2
        )}`
      );

      if (score1 <= score2) {
        baseOrder = [firstIdx, m0, m1, lastIdx];
      } else {
        baseOrder = [firstIdx, m1, m0, lastIdx];
      }
    }

    // Append floating images at the end
    const finalOrder = baseOrder.concat(floatingIndices);

    if (floatingIndices.length > 0) {
      _log(
        `Final order (with floating at end): [${finalOrder
          .map((i) => i + 1)
          .join(', ')}]`
      );
    } else {
      _log(
        `Final order (blank-edge detected): [${finalOrder
          .map((i) => i + 1)
          .join(', ')}]`
      );
    }

    const orderedImages = [];
    for (let i = 0; i < finalOrder.length; i++) {
      orderedImages.push(imageElements[finalOrder[i]]);
    }
    return orderedImages;
  }

  // Fallback: test all permutations (excluding floating images)
  _log('No first/last detected, testing permutations...');

  // Build indices excluding floating images
  const indices = [];
  for (let i = 0; i < imageElements.length; i++) {
    if (floatingIndices.indexOf(i) === -1) {
      indices.push(i);
    }
  }

  if (floatingIndices.length > 0) {
    _log(
      `Floating images: [${floatingIndices
        .map((i) => i + 1)
        .join(', ')}] (will be placed last)`
    );
    _log(`Non-floating images: [${indices.map((i) => i + 1).join(', ')}]`);
  }

  const permutations = getPermutations(indices);

  _log(`Testing ${permutations.length} permutations...`);

  let bestPermutation = indices;
  let bestScore = Infinity;

  for (let p = 0; p < permutations.length; p++) {
    const perm = permutations[p];
    let totalDiff = 0;

    for (let i = 0; i < perm.length - 1; i++) {
      const currentIdx = perm[i];
      const nextIdx = perm[i + 1];

      const diff = calculatePixelDifference(
        edgeData[currentIdx].bottomPixels,
        edgeData[nextIdx].topPixels
      );
      totalDiff += diff;
    }

    if (totalDiff < bestScore) {
      bestScore = totalDiff;
      bestPermutation = perm;
    }
  }

  _log(
    `Best order for non-floating: [${bestPermutation
      .map((i) => i + 1)
      .join(', ')}] with score: ${bestScore.toFixed(2)}`
  );

  // Append floating images at the end
  const finalOrder = bestPermutation.concat(floatingIndices);

  if (floatingIndices.length > 0) {
    _log(
      `Final order (with floating at end): [${finalOrder
        .map((i) => i + 1)
        .join(', ')}]`
    );
  }

  const orderedImages = [];
  for (let i = 0; i < finalOrder.length; i++) {
    orderedImages.push(imageElements[finalOrder[i]]);
  }

  return orderedImages;
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.ImageAnalysis = {
    setLogger,
    colorDistance,
    isRowBlank,
    getEdgePixels,
    calculatePixelDifference,
    getPermutations,
    findOptimalOrder,
    BLANK_TOLERANCE,
  };
}
