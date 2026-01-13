// Debug mode - set to true to see console logs
const DEBUG = false;

function log(...args) {
  if (DEBUG) console.log('[Image Combiner]', ...args);
}

// Store processed posts to avoid reprocessing
const processedPosts = new WeakSet();

// Cache the level where padding-bottom element is found
let cachedPaddingBottomLevel = null;

// Extract edge pixels from an image (top and bottom rows)
function getEdgePixels(img) {
  const canvas = document.createElement('canvas');
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  // Get top row pixels (sample every 10th pixel for performance)
  const topRowData = ctx.getImageData(0, 0, width, 1).data;
  const topPixels = [];
  for (let i = 0; i < topRowData.length; i += 40) { // Every 10th pixel (4 values per pixel: RGBA)
    topPixels.push(topRowData[i], topRowData[i + 1], topRowData[i + 2]);
  }

  // Get bottom row pixels
  const bottomRowData = ctx.getImageData(0, height - 1, width, 1).data;
  const bottomPixels = [];
  for (let i = 0; i < bottomRowData.length; i += 40) {
    bottomPixels.push(bottomRowData[i], bottomRowData[i + 1], bottomRowData[i + 2]);
  }

  return { topPixels, bottomPixels };
}

// Calculate similarity between two pixel arrays (lower = more similar)
function calculatePixelDifference(pixels1, pixels2) {
  const len = Math.min(pixels1.length, pixels2.length);
  let totalDiff = 0;

  for (let i = 0; i < len; i++) {
    totalDiff += Math.abs(pixels1[i] - pixels2[i]);
  }

  return totalDiff / len; // Average difference per channel
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
  log('Analyzing edge pixels to find optimal order...');

  // Extract edge pixels for all images
  const edgeData = [];
  for (let i = 0; i < imageElements.length; i++) {
    edgeData.push(getEdgePixels(imageElements[i]));
    log(`Extracted edge pixels for image ${i + 1}`);
  }

  // Generate all permutations of indices [0, 1, 2, 3]
  const indices = [];
  for (let i = 0; i < imageElements.length; i++) {
    indices.push(i);
  }
  const permutations = getPermutations(indices);

  log(`Testing ${permutations.length} permutations...`);

  // Find permutation with minimum total edge difference
  let bestPermutation = indices;
  let bestScore = Infinity;

  for (let p = 0; p < permutations.length; p++) {
    const perm = permutations[p];
    let totalDiff = 0;

    // Calculate total difference between adjacent images
    for (let i = 0; i < perm.length - 1; i++) {
      const currentIdx = perm[i];
      const nextIdx = perm[i + 1];

      // Compare bottom of current with top of next
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

  log(`Best order: [${bestPermutation.map(i => i + 1).join(', ')}] with score: ${bestScore.toFixed(2)}`);

  // Reorder images according to best permutation
  const orderedImages = [];
  for (let i = 0; i < bestPermutation.length; i++) {
    orderedImages.push(imageElements[bestPermutation[i]]);
  }

  return orderedImages;
}

// Wait for images to load and process posts
function init() {
  log('Initializing...');

  // Use MutationObserver to detect new posts being loaded
  const observer = new MutationObserver((mutations) => {
    // Debounce the processing
    if (window.combinerTimeout) clearTimeout(window.combinerTimeout);
    window.combinerTimeout = setTimeout(() => {
      processPosts();
    }, 100);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial processing
  setTimeout(processPosts, 1000);

  // Also process periodically to catch any missed posts
  setInterval(processPosts, 3000);

  // Process on scroll (for timeline)
  let scrollTimeout;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(processPosts, 200);
    },
    { passive: true }
  );
}

// Process all posts on the page
function processPosts() {
  // Find all article elements (tweets/posts on X.com)
  const posts = document.querySelectorAll('article[data-testid="tweet"]');
  log(`Found ${posts.length} posts`);

  posts.forEach((post) => {
    // Skip if already processed using WeakSet
    if (processedPosts.has(post)) return;

    // Find image container - X.com uses different layouts
    const imageContainers = post.querySelectorAll('[data-testid="tweetPhoto"]');

    // Only process posts with exactly 4 images
    if (imageContainers.length !== 4) return;

    log(`Found post with 4 images`);

    // Mark as being processed
    processedPosts.add(post);

    // Get all images
    const images = Array.from(imageContainers)
      .map((container) => {
        return container.querySelector('img');
      })
      .filter((img) => img !== null);

    if (images.length !== 4) {
      log(`Only ${images.length} valid img tags found`);
      return;
    }

    // Wait for all images to load before checking dimensions
    Promise.all(
      images.map((img) => {
        return new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve(img);
          } else {
            const loadHandler = () => {
              img.removeEventListener('load', loadHandler);
              resolve(img);
            };
            const errorHandler = () => {
              img.removeEventListener('error', errorHandler);
              resolve(null);
            };
            img.addEventListener('load', loadHandler);
            img.addEventListener('error', errorHandler);

            // Also set a timeout in case the image never fires load event
            setTimeout(() => {
              if (img.complete && img.naturalWidth > 0) {
                resolve(img);
              }
            }, 100);
          }
        });
      })
    ).then((loadedImages) => {
      // Filter out failed loads
      const validImages = loadedImages.filter(
        (img) => img !== null && img.naturalWidth > 0
      );
      if (validImages.length !== 4) {
        log(`Only ${validImages.length} images loaded successfully`);
        return;
      }

      // Check if all images are horizontal (width > height) and have same dimensions
      const dimensions = validImages.map((img) => ({
        w: img.naturalWidth,
        h: img.naturalHeight,
        horizontal: img.naturalWidth > img.naturalHeight,
      }));

      log('Image dimensions:', dimensions);

      const allHorizontal = validImages.every((img) => {
        return img.naturalWidth > img.naturalHeight;
      });

      // Check if all images have similar aspect ratios (within 10% tolerance)
      const firstDim = dimensions[0];
      const firstRatio = firstDim.w / firstDim.h;
      log(`First image ratio: ${firstRatio.toFixed(3)}`);

      const allSimilarRatio = dimensions.every((d, index) => {
        const ratio = d.w / d.h;
        const difference = Math.abs(ratio - firstRatio) / firstRatio;
        const withinTolerance = difference <= 0.1; // 10% tolerance
        log(`Image ${index + 1}: ratio=${ratio.toFixed(3)}, diff=${(difference * 100).toFixed(1)}%, pass=${withinTolerance}`);
        return withinTolerance;
      });

      if (allHorizontal && allSimilarRatio) {
        log(
          'All images are horizontal and similar ratio, adding combine feature'
        );
        addCombineFeature(post, validImages);
      } else if (!allHorizontal) {
        log('Not all images are horizontal, skipping');
      } else {
        log('Images have different ratios, skipping');
      }
    });
  });
}

// Add the combine feature to a post
function addCombineFeature(post, images) {
  // Check if button already exists
  if (post.querySelector('.image-combiner-toggle')) {
    log('Button already exists, skipping');
    return;
  }

  // Find the image grid container - try multiple approaches
  let imageGrid = null;
  const firstPhoto = post.querySelector('[data-testid="tweetPhoto"]');

  if (firstPhoto) {
    // Try going up several levels to find a container with all 4 images
    let current = firstPhoto;
    for (let i = 0; i < 8; i++) {
      if (!current) break;
      current = current.parentElement;
      if (current) {
        const photosInContainer = current.querySelectorAll(
          '[data-testid="tweetPhoto"]'
        );
        if (photosInContainer.length === 4) {
          imageGrid = current;
          log(`Found image grid at level ${i + 1}`);
          break;
        }
      }
    }
  }

  if (!imageGrid) {
    log('Could not find image grid container');
    return;
  }

  log('Found image grid container');

  // Find the element with padding-bottom (aspect ratio hack)
  // Check all hierarchy parents' siblings (up to 5 levels)
  let paddingBottomElement = null;
  let originalPaddingBottom = '';

  // Helper function to check for padding-bottom at a specific level
  const checkLevelForPaddingBottom = (startElement, targetLevel) => {
    let current = startElement;

    // Navigate to the target level
    for (let i = 0; i < targetLevel; i++) {
      if (!current.parentElement) return null;
      current = current.parentElement;
    }

    const parent = current.parentElement;
    if (!parent) return null;

    const siblings = Array.from(parent.children);

    for (const sibling of siblings) {
      if (sibling === current) continue; // Skip self

      if (
        sibling.style.paddingBottom &&
        sibling.style.paddingBottom === '56.25%'
      ) {
        return { element: sibling, paddingBottom: '56.25%' };
      }
    }

    return null;
  };

  // Try cached level first if available
  if (cachedPaddingBottomLevel !== null) {
    log(`Trying cached level ${cachedPaddingBottomLevel + 1}`);
    const result = checkLevelForPaddingBottom(
      imageGrid,
      cachedPaddingBottomLevel
    );

    if (result) {
      paddingBottomElement = result.element;
      originalPaddingBottom = result.paddingBottom;
      log(
        `Found padding-bottom element at cached level: ${originalPaddingBottom}`
      );
    }
  }

  // If not found at cached level, do full search
  if (!paddingBottomElement) {
    let current = imageGrid;

    for (let level = 0; level < 5; level++) {
      if (!current.parentElement) break;

      const parent = current.parentElement;

      // Check siblings of the current element (children of parent)
      const siblings = Array.from(parent.children);

      for (const sibling of siblings) {
        if (sibling === current) continue; // Skip self

        if (
          sibling.style.paddingBottom &&
          sibling.style.paddingBottom === '56.25%'
        ) {
          paddingBottomElement = sibling;
          originalPaddingBottom = '56.25%';
          cachedPaddingBottomLevel = level; // Cache the level
          log(
            `Found padding-bottom element at level ${
              level + 1
            } (cached for future)`
          );
          break;
        }
      }

      if (paddingBottomElement) break;

      current = parent;
    }
  }

  if (!paddingBottomElement) {
    log('Could not find padding-bottom element within 5 levels');
  }

  // Create toggle button
  const toggleButton = document.createElement('button');
  toggleButton.className = 'image-combiner-toggle';
  toggleButton.textContent = 'Combining...';
  toggleButton.dataset.state = 'original';

  // Position the button relative to the image container
  imageGrid.style.position = 'relative';
  imageGrid.appendChild(toggleButton);

  // Store original display state
  const originalChildren = Array.from(imageGrid.children).filter(
    (child) => child !== toggleButton
  );
  let combinedContainer = null;
  let combinedImageDimensions = null;

  // Function to show combined view
  const showCombinedView = async () => {
    if (!combinedImageDimensions) {
      toggleButton.textContent = 'Analyzing...';
      combinedImageDimensions = await combineImages(images);
    }

    if (combinedImageDimensions) {
      log('Showing combined view');

      // Update padding-bottom if element was found
      if (
        paddingBottomElement &&
        combinedImageDimensions.width &&
        combinedImageDimensions.height
      ) {
        const aspectRatioPercent =
          (combinedImageDimensions.height / combinedImageDimensions.width) *
          100;
        paddingBottomElement.style.paddingBottom = `${aspectRatioPercent}%`;
        log(
          `Updated padding-bottom to ${aspectRatioPercent}% (was ${originalPaddingBottom})`
        );
      }

      // Hide original children
      originalChildren.forEach((child) => {
        child.style.display = 'none';
      });

      // Create or show combined container
      if (!combinedContainer) {
        combinedContainer = document.createElement('div');
        combinedContainer.className = 'combined-image-container';

        const combinedImg = document.createElement('img');
        combinedImg.src = combinedImageDimensions.url;
        combinedImg.alt = 'Combined image';

        combinedContainer.appendChild(combinedImg);
        imageGrid.insertBefore(combinedContainer, toggleButton);
      } else {
        combinedContainer.style.display = 'block';
      }

      toggleButton.textContent = 'Show Original';
      toggleButton.dataset.state = 'combined';
    }
  };

  // Function to show original view
  const showOriginalView = () => {
    log('Showing original view');

    // Restore original padding-bottom
    if (paddingBottomElement && originalPaddingBottom) {
      paddingBottomElement.style.paddingBottom = originalPaddingBottom;
      log(`Restored padding-bottom to ${originalPaddingBottom}`);
    }

    // Hide combined container
    if (combinedContainer) {
      combinedContainer.style.display = 'none';
    }

    // Show original children
    originalChildren.forEach((child) => {
      child.style.display = '';
    });

    toggleButton.textContent = 'Combine';
    toggleButton.dataset.state = 'original';
  };

  // Toggle functionality
  toggleButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (toggleButton.dataset.state === 'original') {
      await showCombinedView();
    } else {
      showOriginalView();
    }
  });

  // Auto-combine by default
  showCombinedView();
}

// Combine images vertically using canvas
async function combineImages(images) {
  try {
    log('Starting to combine images...');

    // Load high-resolution versions of images
    const imageElements = await Promise.all(
      images.map((img, index) => {
        return new Promise((resolve, reject) => {
          const newImg = new Image();
          newImg.crossOrigin = 'anonymous';

          // Try to get the original image URL (remove size parameters)
          let src = img.src;
          // X.com image URLs often have format and size parameters
          const originalSrc = src;
          if (src.includes('&name=')) {
            src = src.split('&name=')[0] + '&name=large';
          } else if (src.includes('?format=')) {
            src = src.split('?')[0] + '?format=jpg&name=large';
          }

          log(`Loading image ${index + 1}: ${src}`);

          newImg.onload = () => {
            log(
              `Image ${index + 1} loaded: ${newImg.naturalWidth}x${
                newImg.naturalHeight
              }`
            );
            resolve(newImg);
          };
          newImg.onerror = () => {
            log(
              `Failed to load high-res image ${index + 1}, trying original...`
            );
            // Fallback to original src
            const fallbackImg = new Image();
            fallbackImg.crossOrigin = 'anonymous';
            fallbackImg.onload = () => {
              log(`Fallback image ${index + 1} loaded`);
              resolve(fallbackImg);
            };
            fallbackImg.onerror = () => {
              log(`Failed to load fallback image ${index + 1}`);
              reject(new Error(`Failed to load image ${index + 1}`));
            };
            fallbackImg.src = originalSrc;
          };
          newImg.src = src;
        });
      })
    );

    // Find optimal order based on edge pixel analysis
    const orderedImages = findOptimalOrder(imageElements);

    // Calculate canvas dimensions
    const maxWidth = Math.max(...orderedImages.map((img) => img.naturalWidth));
    const totalHeight = orderedImages.reduce(
      (sum, img) => sum + img.naturalHeight,
      0
    );

    log(`Creating canvas: ${maxWidth}x${totalHeight}`);

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');

    // Draw images vertically in optimal order
    let currentY = 0;
    orderedImages.forEach((img, index) => {
      const scaledWidth = maxWidth;
      const scaledHeight = (img.naturalHeight / img.naturalWidth) * maxWidth;
      log(
        `Drawing image ${
          index + 1
        } at Y=${currentY}, size=${scaledWidth}x${scaledHeight}`
      );
      ctx.drawImage(img, 0, currentY, scaledWidth, scaledHeight);
      currentY += scaledHeight;
    });

    log('Canvas drawing complete, creating blob...');

    // Convert canvas to blob URL and return with dimensions
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        log('Combined image created:', url);
        resolve({
          url: url,
          width: maxWidth,
          height: currentY, // currentY is the total height after drawing all images
        });
      }, 'image/png');
    });
  } catch (error) {
    console.error('[Image Combiner] Error combining images:', error);
    return null;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
