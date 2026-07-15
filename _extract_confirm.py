import subprocess

# Find commits with excludeDrafts and Debit/Credit resolution UI
for rev in ["ba82f29", "5aed30a", "6138a1f", "72294ed", "49232ed", "896fdc0", "d35a1a8"]:
    try:
        content = subprocess.check_output(
            ["git", "show", f"{rev}:src/App.tsx"], text=True, errors="replace"
        )
    except Exception as e:
        print(rev, "fail", e)
        continue
    has_ex = "excludeDrafts" in content
    has_use = "Use Debit" in content or "useDebit" in content
    has_confirm = "step === 'confirm'" in content
    has_clean = "step === 'clean'" in content
    print(f"{rev}: excludeDrafts={has_ex} useDebitUI={has_use} confirm={has_confirm} clean={has_clean} len={len(content)}")

# Extract clean step exclude UI from ba82f29 or similar
content = subprocess.check_output(
    ["git", "show", "ba82f29:src/App.tsx"], text=True, errors="replace"
)
for needle in ["function excludeTransaction", "function restoreExcluded", "Use Debit", "step === 'clean'"]:
    idx = content.find(needle)
    print("\n===", needle, "at", idx, "===")
    if idx >= 0:
        print(content[idx : idx + 3500])
