# Gang Sheet Items Not Displaying - Debug Guide

## Issue
Gang sheet items are not displaying in the cart preview.

## What to Check

### 1. Open Browser Console
When you add a gang sheet to cart, check the console for these logs:

```
Adding gang sheet to cart. artboardData: {...}
Gang sheet item being added: {...}
CartStep - cartItems: [...]
Rendering item: gangsheet items: [...]
```

### 2. Verify Items Data Structure
The `items` array should contain objects with this structure:
```javascript
{
  id: number,
  url: string,  // ← This is critical for displaying images
  name: string,
  copies: number,
  widthIn: number,
  heightIn: number,
  // ... other properties
}
```

### 3. Common Issues

**Issue A: Items array is empty**
- Check if `artboardData?.items` has data when clicking "Add to Cart"
- Make sure you've dropped images onto the artboard before adding to cart

**Issue B: Items missing `url` property**
- The `url` property contains the image source
- Without it, images won't display

**Issue C: Items not being passed correctly**
- Check if `onDataChange` in Artboard is being called
- Verify `setArtboardData` is updating the state

## Quick Fix Steps

1. **Drop images onto the artboard**
2. **Wait for images to load**
3. **Click "Add to Cart" button**
4. **Open cart and check console logs**
5. **Look for the items array in the logs**

## Expected Console Output

```javascript
Adding gang sheet to cart. artboardData: {
  items: [
    { id: 1, url: "blob:...", name: "image1.png", copies: 1, ... },
    { id: 2, url: "blob:...", name: "image2.png", copies: 1, ... }
  ]
}

Gang sheet item being added: {
  id: 1234567890,
  type: "gangsheet",
  items: [
    { id: 1, url: "blob:...", name: "image1.png", copies: 1, ... },
    { id: 2, url: "blob:...", name: "image2.png", copies: 1, ... }
  ],
  ...
}
```

## If Items Array is Empty

The issue is that `artboardData` is not being updated. Check:
1. Is `onDataChange` prop being passed to Artboard? ✓ (Yes, in App.tsx line 157)
2. Is `setArtboardData` being called? (Check useArtboardEffects.ts)
3. Are there actually items on the artboard?

## Next Steps

Run the app and share the console output when you:
1. Drop an image on the artboard
2. Click "Add to Cart"
3. Open the cart modal

This will help identify exactly where the data is being lost.
