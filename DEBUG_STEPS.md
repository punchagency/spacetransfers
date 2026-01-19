# Debug Steps - Gang Sheet Items Not Showing

## Steps to Debug:

1. **Open your browser's Developer Console** (F12 or Right-click → Inspect → Console)

2. **Drop some images onto the artboard**
   - Make sure images are visible on the artboard

3. **Click "Add to Cart" button**

4. **Check Console Output** - You should see:
   ```
   === ADDING GANG SHEET TO CART ===
   artboardData: {items: Array(X), counter: Y}
   artboardData.items: Array(X) [...]
   gangSheetItem being added: {...}
   gangSheetItem.items: Array(X) [...]
   ```

5. **Open the Cart Modal**

6. **Check Console Output** - You should see:
   ```
   Gang sheet item: {...}
   Items array: Array(X) [...]
   Items length: X
   First item: {id: ..., url: "blob:...", ...}
   First item URL: blob:http://...
   Rendering item 0: {...} URL: blob:http://...
   Image loaded successfully: blob:http://...
   ```

## What to Look For:

### ❌ Problem 1: artboardData.items is empty or undefined
**Console shows:**
```
artboardData.items: []
```
or
```
artboardData.items: undefined
```

**Solution:** The artboard data isn't being captured. Check:
- Are there actually items on the artboard?
- Is `onDataChange` being called in the Artboard component?

### ❌ Problem 2: Items don't have `url` property
**Console shows:**
```
First item URL: undefined
```

**Solution:** Items are missing the URL. This means the artboard items aren't structured correctly.

### ❌ Problem 3: Images fail to load
**Console shows:**
```
Image failed to load: blob:http://...
```

**Solution:** The blob URLs might be revoked or invalid.

### ✅ Success: Everything works
**Console shows:**
```
Items length: 3
First item URL: blob:http://localhost:5173/abc123...
Rendering item 0: {...} URL: blob:http://...
Image loaded successfully: blob:http://...
Rendering item 1: {...} URL: blob:http://...
Image loaded successfully: blob:http://...
```

## Next Steps:

After running the app and checking the console:
1. Copy ALL the console output
2. Share it so we can identify exactly where the issue is
3. We'll fix the specific problem based on what the logs show

## Quick Test:

Run this in the browser console after adding to cart:
```javascript
// Check cart items
console.log('Cart items:', window.localStorage.getItem('cartItems'));

// Or if using React DevTools, find the App component and check:
// - artboardData state
// - cartItems state
```
