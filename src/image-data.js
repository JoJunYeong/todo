export const IMAGE_DATA_LIMIT = 660000;
export const IMAGE_BINARY_LIMIT = 480 * 1024;
export const MAX_NOTE_IMAGES = 30;
export const imageId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
export function validateNoteImage(image) {
  if (
    !image ||
    Object.keys(image).some(
      (key) =>
        ![
          "id",
          "contentType",
          "data",
          "width",
          "height",
          "createdAt",
          "importHash",
        ].includes(key),
    ) ||
    !imageId(image.id) ||
    !["image/png", "image/jpeg", "image/webp"].includes(image.contentType) ||
    typeof image.data !== "string" ||
    image.data.length > IMAGE_DATA_LIMIT ||
    !image.data.startsWith("data:" + image.contentType + ";base64,") ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
      image.data,
    ) ||
    !Number.isInteger(image.width) ||
    image.width < 1 ||
    image.width > 2560 ||
    !Number.isInteger(image.height) ||
    image.height < 1 ||
    image.height > 2560 ||
    !Number.isInteger(image.createdAt)
  )
    throw Error("이미지 정보 또는 크기가 올바르지 않습니다.");
  return image;
}

export function noteImageIds(note = "") {
  return [
    ...new Set(
      [
        ...String(note).matchAll(
          /\bdata-daynote-image\s*=\s*["']([a-zA-Z0-9_-]{1,120})["']/g,
        ),
      ].map((match) => match[1]),
    ),
  ];
}
