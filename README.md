# XXX

A Chrome extension that automatically detects posts on X.com (Twitter) with exactly 4 horizontal images and provides a toggle to combine them into a single vertical image.

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select this directory
5. Navigate to x.com

## Troubleshooting

If the extension isn't working on a specific post:

1. **Enable debug mode:**
   - Open `content.js`
   - Change `const DEBUG = false;` to `const DEBUG = true;` on line 2
   - Save the file
   - Go to `chrome://extensions/` and click the reload icon on the extension
   - Open browser console (F12) and look for `[Image Combiner]` logs
