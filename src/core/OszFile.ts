import { closeSync, createWriteStream, openSync, readSync, unlinkSync } from "fs";
import _path from "path";
import { Response } from "undici";
import OcdlError from "../struct/OcdlError";
import { replaceForbiddenChars } from "../util";

export function getOszFilename(response: Response): string {
  const contentDisposition = response.headers.get("content-disposition");

  let fileName = "Untitled.osz";
  if (contentDisposition) {
    const result = /filename=([^;]+)/g.exec(contentDisposition);
    if (result) {
      try {
        fileName = replaceForbiddenChars(decodeURIComponent(result[1]));
      } catch (e) {
        throw new OcdlError("FILE_NAME_EXTRACTION_FAILED", e);
      }
    }
  }

  return fileName;
}

export function isCompleteOsz(filePath: string, fileSize: number): boolean {
  if (fileSize < 22) return false;
  const EOCD_SIG = 0x06054b50;
  const tailLen = Math.min(fileSize, 22 + 0xffff);
  const buf = Buffer.alloc(tailLen);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, tailLen, fileSize - tailLen);
  } finally {
    closeSync(fd);
  }
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      const commentLen = buf.readUInt16LE(i + 20);
      const eocdOffset = fileSize - tailLen + i;
      if (eocdOffset + 22 + commentLen === fileSize) return true;
    }
  }
  return false;
}

export async function streamResponseToOsz(
  response: Response,
  destDir: string,
  onChunk: () => void
): Promise<void> {
  const filePath = _path.join(destDir, getOszFilename(response));
  try {
    const file = createWriteStream(filePath);

    let bytesWritten = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        onChunk();
        file.write(chunk);
        bytesWritten += (chunk as Buffer).length;
      }
    } else {
      throw "res.body is null";
    }

    await new Promise<void>((resolve, reject) => {
      file.end(() => resolve());
      file.on("error", reject);
    });

    if (bytesWritten < 1024) {
      throw `Downloaded file is too small (${bytesWritten} bytes)`;
    }

    if (!isCompleteOsz(filePath, bytesWritten)) {
      throw "Downloaded archive is incomplete (no zip end-of-central-directory)";
    }
  } catch (e) {
    try { unlinkSync(filePath); } catch { }
    throw e;
  }
}
