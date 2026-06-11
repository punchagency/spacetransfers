export const readDPI = async (file: File): Promise<{ dpiX?: number; dpiY?: number }> => {
  try {
    const buf = await file.arrayBuffer();
    const dv = new DataView(buf);

    if (dv.getUint16(0, false) === 0xffd8) {
      let off = 2;
      while (off + 4 <= dv.byteLength) {
        if (dv.getUint8(off) !== 0xff) break;
        const marker = dv.getUint8(off + 1);
        const len = dv.getUint16(off + 2, false);
        const segStart = off + 4;

        // JFIF APP0
        if (marker === 0xe0 && segStart + 11 <= dv.byteLength) {
          if (dv.getUint8(segStart)===0x4a && dv.getUint8(segStart+1)===0x46 &&
              dv.getUint8(segStart+2)===0x49 && dv.getUint8(segStart+3)===0x46 &&
              dv.getUint8(segStart+4)===0x00) {
            const units = dv.getUint8(segStart + 7);
            const xd = dv.getUint16(segStart + 8, false);
            const yd = dv.getUint16(segStart + 10, false);
            if (units === 1) return { dpiX: xd, dpiY: yd };
            if (units === 2) return { dpiX: Math.round(xd * 2.54), dpiY: Math.round(yd * 2.54) };
          }
        }

        // EXIF APP1 — covers DPI stored in EXIF, which readDPI previously missed
        if (marker === 0xe1 && segStart + 14 <= dv.byteLength) {
          if (dv.getUint8(segStart)===0x45 && dv.getUint8(segStart+1)===0x78 &&
              dv.getUint8(segStart+2)===0x69 && dv.getUint8(segStart+3)===0x66 &&
              dv.getUint8(segStart+4)===0x00 && dv.getUint8(segStart+5)===0x00) {
            const tiffOff = segStart + 6;
            const byteOrder = dv.getUint16(tiffOff, false);
            const le = byteOrder === 0x4949;
            const ifd0 = tiffOff + dv.getUint32(tiffOff + 4, le);
            if (ifd0 + 2 <= dv.byteLength) {
              const numEntries = dv.getUint16(ifd0, le);
              let xRes: number | null = null;
              let yRes: number | null = null;
              let resUnit = 2; // 2 = inch (default), 3 = cm
              for (let i = 0; i < numEntries && i < 256; i++) {
                const eOff = ifd0 + 2 + i * 12;
                if (eOff + 12 > dv.byteLength) break;
                const tag = dv.getUint16(eOff, le);
                if (tag === 0x011a || tag === 0x011b) { // XResolution / YResolution
                  if (dv.getUint16(eOff + 2, le) === 5) { // RATIONAL type
                    const valOff = tiffOff + dv.getUint32(eOff + 8, le);
                    if (valOff + 8 <= dv.byteLength) {
                      const num = dv.getUint32(valOff, le);
                      const den = dv.getUint32(valOff + 4, le);
                      if (den > 0) { if (tag === 0x011a) xRes = num / den; else yRes = num / den; }
                    }
                  }
                } else if (tag === 0x0128) {
                  resUnit = dv.getUint16(eOff + 8, le);
                }
              }
              if (xRes !== null || yRes !== null) {
                const factor = resUnit === 3 ? 2.54 : 1;
                const dpiX = Math.round((xRes ?? yRes ?? 0) * factor);
                const dpiY = Math.round((yRes ?? xRes ?? 0) * factor);
                if (dpiX > 0 && dpiY > 0) return { dpiX, dpiY };
              }
            }
          }
        }

        off += len > 0 ? len + 2 : 2;
      }
    }

    const PNG_SIG = 0x89504e47;
    if (dv.getUint32(0, false) === PNG_SIG) {
      let off = 8;
      while (off + 12 <= dv.byteLength) {
        const length = dv.getUint32(off, false);
        const type = dv.getUint32(off + 4, false);
        if (type === 0x70485973 && length === 9) {
          const xppu = dv.getUint32(off + 8, false);
          const yppu = dv.getUint32(off + 12, false);
          const unit = dv.getUint8(off + 16);
          if (unit === 1) {
            const dpiX = Math.round(xppu * 0.0254);
            const dpiY = Math.round(yppu * 0.0254);
            return { dpiX, dpiY };
          }
          break;
        }
        off += 12 + length + 4;
      }
    }
  } catch { }
  return {};
};

export const loadImageSize = (file: File): Promise<{ widthPx: number; heightPx: number; url: string }> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        widthPx: img.naturalWidth,
        heightPx: img.naturalHeight,
        url,
      });
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
};
