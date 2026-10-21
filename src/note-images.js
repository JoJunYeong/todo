import { IMAGE_BINARY_LIMIT, validateNoteImage } from "./image-data.js";

const blobToData = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("이미지를 읽지 못했어요."));
    reader.readAsDataURL(blob);
  });
const canvasBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(Error("이미지를 변환하지 못했어요.")),
      type,
      quality,
    ),
  );

export async function prepareNoteImage(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type))
    throw Error("PNG, JPEG, WebP 등의 이미지 파일을 선택해 주세요.");
  if (file.size > 20 * 1024 * 1024)
    throw Error("20MB 이하의 이미지를 선택해 주세요.");
  const objectURL = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = objectURL;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40000000
    )
      throw Error("이미지 해상도가 너무 큽니다.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      2560 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob = await canvasBlob(canvas, "image/png");
    if (blob.size > IMAGE_BINARY_LIMIT) {
      for (const quality of [0.94, 0.88, 0.8, 0.7]) {
        blob = await canvasBlob(canvas, "image/webp", quality);
        if (blob.size <= IMAGE_BINARY_LIMIT) break;
      }
    }
    while (
      blob.size > IMAGE_BINARY_LIMIT &&
      Math.max(canvas.width, canvas.height) > 1200
    ) {
      const resized = document.createElement("canvas");
      resized.width = Math.round(canvas.width * 0.8);
      resized.height = Math.round(canvas.height * 0.8);
      resized
        .getContext("2d")
        .drawImage(canvas, 0, 0, resized.width, resized.height);
      canvas.width = resized.width;
      canvas.height = resized.height;
      canvas.getContext("2d").drawImage(resized, 0, 0);
      blob = await canvasBlob(canvas, "image/webp", 0.82);
    }
    if (blob.size > IMAGE_BINARY_LIMIT)
      throw Error(
        "이미지가 너무 복잡해요. 필요한 부분만 잘라 붙여넣어 주세요.",
      );
    const attachment = validateNoteImage({
      id: crypto.randomUUID(),
      contentType: blob.type,
      data: await blobToData(blob),
      width: canvas.width,
      height: canvas.height,
      createdAt: Date.now(),
    });
    return { attachment, url: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

export async function imageDataURL(data) {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data))
    throw Error("지원하지 않는 이미지 형식이에요.");
  const response = await fetch(data);
  return response.blob();
}

export function savedNoteHTML(editor, sanitize) {
  const copy = editor.cloneNode(true);
  for (const image of copy.querySelectorAll("img[data-daynote-image]")) {
    image.removeAttribute("src");
    image.removeAttribute("data-image-error");
  }
  return sanitize(copy.innerHTML);
}
