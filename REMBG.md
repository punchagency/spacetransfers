## AI Cropping (rembg)

This project supports optional AI-powered background removal and tight auto-cropping using `rembg`.

When enabled, uploads are processed as:
1. Background removal (rembg) → RGBA PNG with transparency
2. Alpha-based tight crop (removes all transparent padding)
3. QA pass to ensure the crop is tight on all edges

### Enable

1. Install Python 3.10+ and `pip`
2. Install the dependencies:

```bash
python3 -m pip install -r scripts/requirements-rembg.txt
```

3. Start the API with:

```bash
REMBG_ENABLED=1 npm run dev
```

### Configuration

- `REMBG_ENABLED`: `1|true|yes` enables AI background removal
- `REMBG_PYTHON`: python executable path (defaults to `python3`)
- `REMBG_TIMEOUT_MS`: per-image timeout (defaults to `60000`)
- `TRIM_ALPHA_THRESHOLD`: alpha threshold for cropping (defaults to `10`)
- `TRIM_MAX_PROBE`: downsample size used for cropping scan (defaults to `800`)

### Endpoints

- `POST /api/customer/assets` (upload)
  - When `REMBG_ENABLED=1`, returns `trimmedUrl` generated from rembg output.
- `POST /api/customer/assets/trim`
  - Trims an existing `/uploads/...` asset URL; uses rembg when enabled.

### Notes

- rembg is compute-heavy. For large batches, expect higher CPU usage.
- If rembg is disabled, the API falls back to the existing non-AI trim behavior.

