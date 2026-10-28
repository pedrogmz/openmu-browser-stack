import dnfile

pe = dnfile.dnPE("C:/Users/Poisson/Documents/openmu-browser-stack/MUnique.OpenMU.Network.dll")
for r in pe.net.mdtables.TypeDef:
    if "CharacterManagement" in str(r.TypeName):
        print("Found:", r.TypeName)
        for m in r.MethodList:
            print("  Method:", m.row.Name)
