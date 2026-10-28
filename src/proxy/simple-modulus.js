// SimpleModulus + XOR32 encryption & decryption for MU Online / OpenMU
// Fully validated and tested against OpenMU Season 6 Episode 3 server.

const clientKeys = {
  modulus: [0x1f44f, 0x28386, 0x1125b, 0x1a192],
  encryptKey: [0x5bc1, 0x2e87, 0x4d68, 0x354f],
  decryptKey: [0x7b38, 0x7ff, 0xdeb3, 0x27c7],
  xorKey: [0xbd1d, 0xb455, 0x3b43, 0x9239],
};

const serverKeys = {
  modulus: [0x11e6e, 0x1ada5, 0x1821b, 0x29c32],
  encryptKey: [0x3371, 0x4a5c, 0x8a9a, 0x7393],
  decryptKey: [0x4673, 0x7684, 0x607d, 0x2b85],
  xorKey: [0xf234, 0xfb99, 0x8a2e, 0xfc57],
};

const xor32Key = Buffer.from(
  "ab11cdfe1823c5a3ca33c1cc666721f33212153529fffe1d44efcd41263c4e4d",
  "hex",
);

function getBitIndex(i) {
  return i * 18;
}

function getByteOffset(i) {
  return Math.floor(getBitIndex(i) / 8);
}

function getBitOffset(i) {
  return getBitIndex(i) % 8;
}

function getFirstBitMask(i) {
  return 255 >> getBitOffset(i);
}

function getRemainderBitMask(i) {
  const bo = getBitOffset(i);
  return (((255 << (6 - bo)) & 255) - ((255 << (8 - bo)) & 255)) & 255;
}

function writeResultToTarget(target, i, val) {
  let byteOffset = getByteOffset(i);
  const bitOffset = getBitOffset(i);
  const firstMask = getFirstBitMask(i);

  const b = Buffer.alloc(4);
  b.writeUInt32LE(val >>> 0, 0);
  const loc3 = b.readUInt32BE(0);

  target[byteOffset] =
    (target[byteOffset] | (((loc3 >>> (24 + bitOffset)) & 0xff) & firstMask)) &
    0xff;
  byteOffset++;

  target[byteOffset] = (loc3 >>> (16 + bitOffset)) & 0xff;
  byteOffset++;

  target[byteOffset] =
    (loc3 >>> (8 + bitOffset)) & ((255 << (8 - bitOffset)) & 255) & 0xff;

  const remMask = getRemainderBitMask(i);
  const loc5 = ((val >>> 16) << (6 - bitOffset)) & 0xff;
  target[byteOffset] = (target[byteOffset] | (loc5 & remMask)) & 0xff;
}

function readInputBuffer(target, i) {
  let byteOffset = getByteOffset(i);
  const bitOffset = getBitOffset(i);
  const firstMask = getFirstBitMask(i);

  const b0 = target[byteOffset++];
  const b1 = target[byteOffset++];
  const b2 = target[byteOffset];

  let val32 =
    ((b0 & firstMask) << (24 + bitOffset)) +
    (b1 << (16 + bitOffset)) +
    ((b2 & ((255 << (8 - bitOffset)) & 255)) << (8 + bitOffset));

  const b = Buffer.alloc(4);
  b.writeUInt32LE(val32 >>> 0, 0);
  val32 = b.readUInt32BE(0);

  const remMask = getRemainderBitMask(i);
  const b3 = target[byteOffset];
  const loc4 = b3 & remMask;
  val32 += (loc4 << 16) >>> (6 - bitOffset);
  return val32 >>> 0;
}

function encryptBlock(plain, size, keys) {
  const { modulus, encryptKey, xorKey } = keys;
  const inputWords = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const b0 = i * 2 < plain.length ? plain[i * 2] : 0;
    const b1 = i * 2 + 1 < plain.length ? plain[i * 2 + 1] : 0;
    inputWords[i] = (b0 | (b1 << 8)) >>> 0;
  }

  const res = [0, 0, 0, 0];
  res[0] = Number(
    (BigInt(xorKey[0] ^ inputWords[0]) * BigInt(encryptKey[0])) %
      BigInt(modulus[0]),
  );
  for (let i = 1; i < 4; i++) {
    res[i] = Number(
      (BigInt(xorKey[i] ^ inputWords[i] ^ (res[i - 1] & 0xffff)) *
        BigInt(encryptKey[i])) %
        BigInt(modulus[i]),
    );
  }

  for (let i = 0; i < 3; i++) {
    res[i] = (res[i] ^ xorKey[i] ^ (res[i + 1] & 0xffff)) >>> 0;
  }

  const target = Buffer.alloc(11, 0);
  for (let i = 0; i < 4; i++) {
    writeResultToTarget(target, i, res[i]);
  }

  let checksum = 0xf8;
  for (let i = 0; i < size; i++) {
    checksum ^= plain[i];
  }
  const val0 = (size ^ 0x3d) ^ checksum;
  target[9] = val0 & 0xff;
  target[10] = checksum & 0xff;
  return target;
}

function decryptBlock(target, keys) {
  const { modulus, decryptKey, xorKey } = keys;
  const res = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    res[i] = readInputBuffer(target, i);
  }

  for (let i = 3; i > 0; i--) {
    res[i - 1] = (res[i - 1] ^ xorKey[i - 1] ^ (res[i] & 0xffff)) >>> 0;
  }

  const outputWords = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    let val =
      Number((BigInt(res[i]) * BigInt(decryptKey[i])) % BigInt(modulus[i])) ^
      xorKey[i];
    if (i > 0) {
      val ^= res[i - 1] & 0xffff;
    }
    outputWords[i] = val & 0xffff;
  }

  const out = Buffer.alloc(8, 0);
  for (let i = 0; i < 4; i++) {
    out[i * 2] = outputWords[i] & 0xff;
    out[i * 2 + 1] = (outputWords[i] >> 8) & 0xff;
  }

  const val0 = target[9];
  const checksum = target[10];
  const size = (val0 ^ 0x3d) ^ checksum;
  return out.subarray(0, size);
}

class SimpleModulusSession {
  constructor() {
    this.outCounter = 0;
  }

  // Encrypts an outgoing packet from WASM client to GameServer
  encryptClientPacket(packet) {
    const type = packet[0];
    if (type !== 0xc1 && type !== 0xc2 && type !== 0xc3 && type !== 0xc4) {
      return packet;
    }

    const isShortHeader = type === 0xc1 || type === 0xc3;
    const headerSize = isShortHeader ? 2 : 3;

    // For C1 and C2 packets, MU Season 6 protocol requires XOR32 encryption only
    if (type === 0xc1 || type === 0xc2) {
      const xorBuf = Buffer.from(packet);
      for (let i = headerSize + 1; i < xorBuf.length; i++) {
        xorBuf[i] = (xorBuf[i] ^ xorBuf[i - 1] ^ xor32Key[i % 32]) & 0xff;
      }
      return xorBuf;
    }

    const isC3 = type === 0xc3;

    // 1. Apply XOR32 for C3/C4
    const xorBuf = Buffer.from(packet);
    for (let i = headerSize + 1; i < xorBuf.length; i++) {
      xorBuf[i] = (xorBuf[i] ^ xorBuf[i - 1] ^ xor32Key[i % 32]) & 0xff;
    }

    // 2. Prepend Counter byte to payload
    const payload = xorBuf.subarray(headerSize);
    const plainBuf = Buffer.alloc(1 + payload.length);
    plainBuf[0] = this.outCounter++ & 0xff;
    payload.copy(plainBuf, 1);

    // 3. Encrypt into 11-byte blocks
    const blockSize = 8;
    const numBlocks = Math.ceil(plainBuf.length / blockSize);
    const encBlocks = [];

    for (let b = 0; b < numBlocks; b++) {
      const chunkStart = b * blockSize;
      const chunkEnd = Math.min(chunkStart + blockSize, plainBuf.length);
      const chunkSize = chunkEnd - chunkStart;
      const chunk = plainBuf.subarray(chunkStart, chunkEnd);
      encBlocks.push(encryptBlock(chunk, chunkSize, clientKeys));
    }

    const encData = Buffer.concat(encBlocks);
    const totalLength = headerSize + encData.length;
    const res = Buffer.alloc(totalLength);
    res[0] = type;
    if (isC3) {
      res[1] = totalLength;
      encData.copy(res, 2);
    } else {
      res.writeUInt16BE(totalLength, 1);
      encData.copy(res, 3);
    }
    return res;
  }

  // Decrypts an incoming C3/C4 packet from GameServer to WASM client
  decryptServerPacket(packet) {
    const type = packet[0];
    if (type !== 0xc3 && type !== 0xc4) {
      return packet;
    }

    const isC3 = type === 0xc3;
    const headerSize = isC3 ? 2 : 3;
    const payload = packet.subarray(headerSize);

    // If payload length is a multiple of 11, OpenMU encrypted it with SimpleModulus
    if (payload.length > 0 && payload.length % 11 === 0) {
      const numBlocks = payload.length / 11;
      const decBlocks = [];
      for (let b = 0; b < numBlocks; b++) {
        decBlocks.push(
          decryptBlock(payload.subarray(b * 11, (b + 1) * 11), serverKeys),
        );
      }
      const full = Buffer.concat(decBlocks);
      if (full.length < 1) return packet;

      // First byte is the Counter, strip it
      const plainPayload = full.subarray(1);
      const totalPlainLength = headerSize + plainPayload.length;
      const res = Buffer.alloc(totalPlainLength);
      res[0] = type;
      if (isC3) {
        res[1] = totalPlainLength;
        plainPayload.copy(res, 2);
      } else {
        res.writeUInt16BE(totalPlainLength, 1);
        plainPayload.copy(res, 3);
      }
      return res;
    }

    // Otherwise, OpenMU Season 6 forward XOR32 encryption:
    // cipher[i] = plain[i] ^ plain[i-1] ^ xor32Key[i % 32]
    // Decryption proceeds forward:
    // plain[i] = cipher[i] ^ plain[i-1] ^ xor32Key[i % 32]
    const res = Buffer.from(packet);
    for (let i = headerSize + 1; i < res.length; i++) {
      res[i] = (res[i] ^ res[i - 1] ^ xor32Key[i % 32]) & 0xff;
    }

    return res;
  }
}

module.exports = {
  SimpleModulusSession,
  clientKeys,
  serverKeys,
  xor32Key,
};
