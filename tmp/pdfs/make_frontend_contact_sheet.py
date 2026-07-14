from pathlib import Path
from PIL import Image, ImageDraw

files = sorted(Path("tmp/pdfs/frontend-guide-render").glob("*.png"))
thumbs = []
for file in files:
    image = Image.open(file).convert("RGB")
    image.thumbnail((320, 460))
    canvas = Image.new("RGB", (340, 500), "white")
    canvas.paste(image, ((340 - image.width) // 2, 18))
    ImageDraw.Draw(canvas).text((12, 474), file.name, fill="black")
    thumbs.append(canvas)

cols = 2
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 340, rows * 500), (225, 230, 235))
for index, thumb in enumerate(thumbs):
    sheet.paste(thumb, ((index % cols) * 340, (index // cols) * 500))

sheet.save("tmp/pdfs/frontend-guide-contact-sheet.jpg")
