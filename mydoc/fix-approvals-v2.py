import json
p = "/home/ubuntu/.openclaw/exec-approvals.json"
with open(p) as f:
    d = json.load(f)
agents = d.setdefault("agents", {})

# Revert to allowlist security, but add python3 to allowlist for skill agents
for aid in ["normal_agent", "lsp_agent", "xiaomei_agent"]:
    a = agents.setdefault(aid, {})
    # Remove the full security override
    a.pop("security", None)
    # Add python3 and uv to allowlist so skills can run
    al = a.setdefault("allowlist", [])
    existing = set(e.get("pattern", "") for e in al)
    for pat in ["/usr/bin/python3", "python3", "uv", "/usr/bin/uv", "curl"]:
        if pat not in existing:
            al.append({"pattern": pat, "note": "skill-bins"})

with open(p, "w") as f:
    json.dump(d, f, indent=2)
    f.write("\n")
print("DONE")
with open(p) as f:
    print(f.read())
