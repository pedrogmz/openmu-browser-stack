import dnfile

pe = dnfile.dnPE("C:/Users/Poisson/Documents/openmu-browser-stack/MUnique.OpenMU.Network.dll")
for r in pe.net.mdtables.TypeRef:
    if "PacketTwister" in str(r.TypeName):
        print("TypeRef:", r.TypeNamespace, r.TypeName)
for r in pe.net.mdtables.MemberRef:
    if "Twist" in str(r.Name) or "Correct" in str(r.Name):
        print("MemberRef:", r.Class.row.TypeName if hasattr(r.Class, 'row') else r.Class, r.Name)
