const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1800;

export interface ImageGpsMetadata {
  latitude: number;
  longitude: number;
  altitudeM?: number;
  capturedAt?: string;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare image for upload"));
    }, "image/jpeg", quality);
  });
}

function readAscii(view: DataView, offset: number, length: number) {
  let text = "";
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
}

function readRational(view: DataView, offset: number, littleEndian: boolean) {
  const numerator = view.getUint32(offset, littleEndian);
  const denominator = view.getUint32(offset + 4, littleEndian);
  return denominator ? numerator / denominator : 0;
}

function readExifValue(view: DataView, tiffStart: number, valueOffset: number, type: number, count: number, littleEndian: boolean) {
  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
  const totalBytes = (typeSize[type] ?? 1) * count;
  return totalBytes <= 4 ? valueOffset : tiffStart + view.getUint32(valueOffset, littleEndian);
}

function readGpsCoordinate(view: DataView, offset: number, littleEndian: boolean, ref: string) {
  const degrees = readRational(view, offset, littleEndian);
  const minutes = readRational(view, offset + 8, littleEndian);
  const seconds = readRational(view, offset + 16, littleEndian);
  const value = degrees + minutes / 60 + seconds / 3600;
  return ref === "S" || ref === "W" ? -value : value;
}

export async function extractImageGpsMetadata(file: File): Promise<ImageGpsMetadata | null> {
  if (!["image/jpeg", "image/jpg"].includes(file.type.toLowerCase())) return null;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 16 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && readAscii(view, offset + 4, 6) === "Exif\0\0") {
      const tiffStart = offset + 10;
      const littleEndian = readAscii(view, tiffStart, 2) === "II";
      if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;
      const ifd0 = tiffStart + view.getUint32(tiffStart + 4, littleEndian);
      const entries = view.getUint16(ifd0, littleEndian);
      let gpsIfd = 0;
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd0 + 2 + i * 12;
        if (view.getUint16(entry, littleEndian) === 0x8825) gpsIfd = tiffStart + view.getUint32(entry + 8, littleEndian);
      }
      if (!gpsIfd) return null;
      const gpsEntries = view.getUint16(gpsIfd, littleEndian);
      const tags: Record<number, { type: number; count: number; offset: number }> = {};
      for (let i = 0; i < gpsEntries; i += 1) {
        const entry = gpsIfd + 2 + i * 12;
        const tag = view.getUint16(entry, littleEndian);
        tags[tag] = {
          type: view.getUint16(entry + 2, littleEndian),
          count: view.getUint32(entry + 4, littleEndian),
          offset: readExifValue(view, tiffStart, entry + 8, view.getUint16(entry + 2, littleEndian), view.getUint32(entry + 4, littleEndian), littleEndian),
        };
      }
      const latRef = tags[1] ? readAscii(view, tags[1].offset, 1) : "";
      const lat = tags[2] ? readGpsCoordinate(view, tags[2].offset, littleEndian, latRef) : Number.NaN;
      const lngRef = tags[3] ? readAscii(view, tags[3].offset, 1) : "";
      const lng = tags[4] ? readGpsCoordinate(view, tags[4].offset, littleEndian, lngRef) : Number.NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const altitudeM = tags[6] ? readRational(view, tags[6].offset, littleEndian) * (tags[5] && view.getUint8(tags[5].offset) === 1 ? -1 : 1) : undefined;
      return { latitude: lat, longitude: lng, altitudeM };
    }
    offset += 2 + length;
  }
  return null;
}

export async function prepareImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= MAX_UPLOAD_BYTES) return file;

  const image = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image compression is not available on this device");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();

  let blob = await canvasToBlob(canvas, 0.82);
  if (blob.size > MAX_UPLOAD_BYTES) blob = await canvasToBlob(canvas, 0.68);
  const name = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}
