
export function readOsuString(buffer: Buffer, offset: number): [string, number] {
  const indicator = buffer.readUInt8(offset);
  offset += 1;

  if (indicator === 0x00) return ["", offset];

  if (indicator !== 0x0b) {
    throw new Error(`Invalid string indicator: ${indicator}`);
  }

  let length = 0;
  let shift = 0;
  let byte = 0;
  do {
    byte = buffer.readUInt8(offset);
    offset += 1;
    length |= (byte & 0x7f) << shift;
    shift += 7;
  } while ((byte & 0x80) !== 0);

  const str = buffer.toString("utf-8", offset, offset + length);
  offset += length;

  return [str, offset];
}

export function writeOsuString(str: string): Buffer {
  if (!str || str.length === 0) {
    return Buffer.from([0x00]);
  }

  const strBuffer = Buffer.from(str, "utf-8");

  const lengthBytes: number[] = [];
  let value = strBuffer.length;
  do {
    let byte = value & 0x7f;
    value >>= 7;
    if (value !== 0) byte |= 0x80;
    lengthBytes.push(byte);
  } while (value !== 0);

  return Buffer.concat([Buffer.from([0x0b]), Buffer.from(lengthBytes), strBuffer]);
}
