from PIL import Image, ImageOps, ImageDraw
from pathlib import Path

def make(folder: str, output: str, cols: int):
    files=sorted(Path(folder).glob('*.png'))
    thumbs=[]
    for f in files:
        im=Image.open(f).convert('RGB'); im.thumbnail((360,500))
        canvas=Image.new('RGB',(380,540),'white'); canvas.paste(im,((380-im.width)//2,25))
        ImageDraw.Draw(canvas).text((12,510),f.name,fill='black')
        thumbs.append(canvas)
    rows=(len(thumbs)+cols-1)//cols
    sheet=Image.new('RGB',(cols*380,rows*540),(225,230,235))
    for i,im in enumerate(thumbs): sheet.paste(im,((i%cols)*380,(i//cols)*540))
    sheet.save(output)

make('tmp/pdfs/dev-render','tmp/pdfs/developer-contact-sheet.jpg',4)
make('tmp/pdfs/sales-render','tmp/pdfs/sales-contact-sheet.jpg',2)
make('tmp/pdfs/dev-render-v2','tmp/pdfs/developer-contact-sheet-v2.jpg',4)
make('tmp/pdfs/sales-render-v3','tmp/pdfs/sales-contact-sheet-v3.jpg',3)
make('tmp/pdfs/dev-render-v3','tmp/pdfs/developer-contact-sheet-v3.jpg',4)
make('tmp/pdfs/sales-render-v4','tmp/pdfs/sales-contact-sheet-v4.jpg',3)
