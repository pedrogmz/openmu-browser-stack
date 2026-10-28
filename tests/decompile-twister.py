import dnfile
from dncil.cil.body.reader import read_method_body_from_bytes

pe = dnfile.dnPE("C:/Users/Poisson/Documents/openmu-browser-stack/MUnique.OpenMU.Network.dll")
for r in pe.net.mdtables.TypeDef:
    if "PacketTwisterOfCharacterManagement" in str(r.TypeName):
        for m in r.MethodList:
            print("Method:", m.row.Name)
            row = m.row
            if row.Rva > 0:
                offset = pe.get_offset_from_rva(row.Rva)
                data = pe.__data__[offset:offset+4096]
                try:
                    body = read_method_body_from_bytes(data)
                    for ins in body.instructions:
                        print(f"  {ins.opcode.name} {ins.operand}")
                except Exception as ex:
                    print("  Error reading body:", ex)
