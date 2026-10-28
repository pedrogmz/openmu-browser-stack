import struct

def get_bit_index(i):
    return i * 18

def get_byte_offset(i):
    return get_bit_index(i) // 8

def get_bit_offset(i):
    return get_bit_index(i) % 8

def get_first_bit_mask(i):
    return 255 >> get_bit_offset(i)

def get_remainder_bit_mask(i):
    bo = get_bit_offset(i)
    return ((255 << (6 - bo)) & 255) - ((255 << (8 - bo)) & 255)

def write_result_to_target(target, i, val):
    byte_offset = get_byte_offset(i)
    bit_offset = get_bit_offset(i)
    first_mask = get_first_bit_mask(i)
    
    # ReverseEndianness of 32-bit uint
    loc3 = struct.unpack('>I', struct.pack('<I', val & 0xFFFFFFFF))[0]
    
    # byte 0
    target[byte_offset] = (target[byte_offset] | (((loc3 >> (24 + bit_offset)) & 0xFF) & first_mask)) & 0xFF
    byte_offset += 1
    
    # byte 1
    target[byte_offset] = ((loc3 >> (16 + bit_offset)) & 0xFF)
    byte_offset += 1
    
    # byte 2
    target[byte_offset] = ((loc3 >> (8 + bit_offset)) & ((255 << (8 - bit_offset)) & 255)) & 0xFF
    
    # remainder
    rem_mask = get_remainder_bit_mask(i)
    loc5 = ((val >> 16) << (6 - bit_offset)) & 0xFF
    target[byte_offset] = (target[byte_offset] | (loc5 & rem_mask)) & 0xFF

def read_input_buffer(target, i):
    byte_offset = get_byte_offset(i)
    bit_offset = get_bit_offset(i)
    first_mask = get_first_bit_mask(i)
    
    b0 = target[byte_offset]
    byte_offset += 1
    b1 = target[byte_offset]
    byte_offset += 1
    b2 = target[byte_offset]
    
    val32 = ((b0 & first_mask) << (24 + bit_offset)) + (b1 << (16 + bit_offset)) + ((b2 & ((255 << (8 - bit_offset)) & 255)) << (8 + bit_offset))
    # ReverseEndianness
    val32 = struct.unpack('>I', struct.pack('<I', val32 & 0xFFFFFFFF))[0]
    
    rem_mask = get_remainder_bit_mask(i)
    b3 = target[byte_offset]
    loc4 = b3 & rem_mask
    val32 += ((loc4 << 16) >> (6 - bit_offset))
    return val32 & 0xFFFFFFFF

# Test roundtrip of write and read
target = bytearray(11)
vals = [0x12345, 0x23456, 0x34567, 0x1ABCD]
for i in range(4):
    write_result_to_target(target, i, vals[i])

read_vals = [read_input_buffer(target, i) for i in range(4)]
print("Original:", [hex(v) for v in vals])
print("Read:    ", [hex(v) for v in read_vals])
assert vals == read_vals, f"Mismatch: {vals} != {read_vals}"
print("Bit packing test passed 100%!")

modulus = [0x11e6e, 0x1ada5, 0x1821b, 0x29c32]
encrypt_key = [0x3371, 0x4a5c, 0x8a9a, 0x7393]
decrypt_key = [0x4673, 0x7684, 0x607d, 0x2b85]
xor_key = [0xf234, 0xfb99, 0x8a2e, 0xfc57]

def encrypt_block(plain, size):
    input_words = [0, 0, 0, 0]
    for i in range(4):
        if i*2 < len(plain):
            b0 = plain[i*2]
            b1 = plain[i*2+1] if i*2+1 < len(plain) else 0
            input_words[i] = b0 | (b1 << 8)
            
    res = [0, 0, 0, 0]
    res[0] = ((xor_key[0] ^ input_words[0]) * encrypt_key[0]) % modulus[0]
    for i in range(1, 4):
        res[i] = ((xor_key[i] ^ input_words[i] ^ (res[i-1] & 0xFFFF)) * encrypt_key[i]) % modulus[i]
        
    for i in range(3):
        res[i] = res[i] ^ xor_key[i] ^ (res[i+1] & 0xFFFF)
        
    target = bytearray(11)
    for i in range(4):
        write_result_to_target(target, i, res[i])
        
    # Checksum
    checksum = 0xF8
    for i in range(size):
        checksum ^= plain[i]
    val0 = (size ^ 0x3D) ^ checksum
    target[9] = val0 & 0xFF
    target[10] = checksum & 0xFF
    return target

def decrypt_block(target):
    res = [read_input_buffer(target, i) for i in range(4)]
    for i in range(3, 0, -1):
        res[i-1] = res[i-1] ^ xor_key[i-1] ^ (res[i] & 0xFFFF)
        
    output_words = [0, 0, 0, 0]
    for i in range(4):
        val = xor_key[i] ^ ((res[i] * decrypt_key[i]) % modulus[i])
        if i > 0:
            val ^= (res[i-1] & 0xFFFF)
        output_words[i] = val & 0xFFFF
        
    out = bytearray(8)
    for i in range(4):
        out[i*2] = output_words[i] & 0xFF
        out[i*2+1] = (output_words[i] >> 8) & 0xFF
        
    # verify
    val0 = target[9]
    checksum = target[10]
    size = (val0 ^ 0x3D) ^ checksum
    
    chk = 0xF8
    for i in range(size):
        chk ^= out[i]
    assert chk == checksum, f'Checksum error: {chk} != {checksum}'
    return bytes(out[:size])

orig = b'Hello MU'
enc = encrypt_block(orig, 8)
dec = decrypt_block(enc)
print('Original:', orig)
print('Decrypted:', dec)
assert orig == dec
print('Block Encryption + Decryption PASSED 100%!')
