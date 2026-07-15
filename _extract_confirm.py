import subprocess

content = subprocess.check_output(
    ["git", "show", "ba82f29:src/App.tsx"], text=True, errors="replace"
)
for needle in [
    "function resolveRow",
    "function excludeRow",
    "function restoreRow",
    "function continueFromClean",
    "const unresolvedCount",
    "const flaggedTotals",
]:
    idx = content.find(needle)
    print("\n===", needle, "at", idx, "===")
    if idx >= 0:
        print(content[idx : idx + 1200])
