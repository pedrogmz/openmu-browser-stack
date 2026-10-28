import dnfile

try:
    pe = dnfile.dnPE("C:/Users/Poisson/Documents/openmu-browser-stack/MUnique.OpenMU.Network.dll")
    for r in pe.net.mdtables.TypeDef:
        name = str(r.TypeName)
        if any(w in name for w in ["Character", "Select", "Map", "Login", "Packet"]):
            print("TypeDef:", r.TypeNamespace, name)
except Exception as e:
    print("Error:", e)
