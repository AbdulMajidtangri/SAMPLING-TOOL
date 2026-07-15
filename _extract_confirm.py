import subprocess

content = subprocess.check_output(
    ["git", "show", "5e122c4:src/App.tsx"], text=True, errors="replace"
)
needle = "step === 'confirm'"
idx = content.find(needle)
print("idx", idx)
if idx >= 0:
    print(content[idx : idx + 9000])
