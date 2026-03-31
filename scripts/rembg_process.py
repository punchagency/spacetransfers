import sys

from rembg import remove
from PIL import Image


def main():
    if len(sys.argv) < 3:
        print("Usage: rembg_process.py <input> <output>", file=sys.stderr)
        return 2

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path, "rb") as f:
        input_bytes = f.read()

    output_bytes = remove(input_bytes)
    img = Image.open(io.BytesIO(output_bytes)).convert("RGBA")
    img.save(output_path, "PNG", optimize=True)
    return 0


if __name__ == "__main__":
    import io

    raise SystemExit(main())

