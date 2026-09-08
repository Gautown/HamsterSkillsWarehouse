---
name: git-proxy-push
description: Push/pull GitHub when a VPN blocks direct port 443.
version: 1
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [git, github, vpn, proxy, cloudflare-warp, push, networking]
    related_skills: [windows-crash-dump-analysis]
---

# Git push/pull behind a blocking VPN/proxy

On some Windows hosts a VPN client — notably **Cloudflare WARP** — blocks direct outbound 443 but exposes a working **local HTTP proxy** (WARP listens on `127.0.0.1:40000`). `git push`/`git ls-remote` then fail with `Failed to connect to github.com port 443 ... Could not connect to server`, even though the machine clearly has internet (browsers work). The fix is to route git through that local proxy and authenticate with the token Git Credential Manager already stores.

## Symptoms
- `curl https://github.com` times out; `git ls-remote` / `git push` say "Could not connect to server".
- `bash -c 'exec 3<>/dev/tcp/<github-ip>/443'` times out, but `/dev/tcp/<ip>/22` (SSH) connects.
- A local proxy port is LISTENING — check `netstat -ano | findstr LISTENING | findstr -E "40000 1080 7890"`.

## Steps
1. **Find the proxy port.** For WARP it is `127.0.0.1:40000`. Confirm it reaches GitHub: `curl -x http://127.0.0.1:40000 -sS -o /dev/null -w "%{http_code}\n" https://github.com` (expect `301`/`200`, not a timeout).
2. **Point git at it** (per-session, not permanent — see pitfalls): `git -c http.proxy=http://127.0.0.1:40000 -c https.proxy=http://127.0.0.1:40000 ls-remote https://github.com/OWNER/REPO.git`. A `401` instead of a timeout means the proxy works and only auth remains.
3. **Read the stored GitHub token from Git Credential Manager** (no prompt — just query the store):
   ```bash
   TOK=$(printf 'protocol=https\nhost=github.com\nusername=Gautown\n\n' | git-credential-manager get | grep -i '^password=' | cut -d= -f2-)
   ```
   Replace `Gautown` with the GitHub username; GCM returns `password=gho_xxx`.
4. **Unset the global credential helper** — the critical gotcha. With `credential.helper=manager` set globally, git tries to *write* creds through the proxy during push and **deadlocks** (hangs to timeout). `git config --global --unset credential.helper` (or pass `-c credential.helper=` on the command).
5. **Push with the token embedded in the URL** (no interactive prompt):
   `GIT_TERMINAL_PROMPT=0 git push https://Gautown:$TOK@github.com/Gautown/REPO.git main`
6. **Restore** afterwards: `git config --global credential.helper manager`.

## Pitfalls
- **"Everything up-to-date" or a timeout does NOT mean failure.** A slow/large push can hit the timeout *after* the objects already uploaded. Always verify: `git fetch HamsterStore main && git rev-parse HEAD HamsterStore/main` — if the hashes match, it landed.
- **Missing `git-askpass.exe`** shows as `error: cannot spawn /mingw64/bin/git-askpass.exe: No such file or directory` then `could not read Username ... terminal prompts disabled`. Fix by embedding the token in the URL and setting `GIT_TERMINAL_PROMPT=0`; never rely on askpass in a non-interactive shell.
- **Do not leave `http.proxy` set globally** on a machine that sometimes has direct access — it breaks pushes when the VPN is off. Prefer the per-command `-c http.proxy=...` flag, or set it only for the session.
- **Token hygiene:** the token in the URL is visible in `ps` and `git remote -v`. Use a temporary remote (`git remote add tmppush ...` then `git remote remove tmppush`) or a throwaway URL string; never commit it and never leave it in a saved remote.
- WARP's proxy port can change across versions/installs — re-detect with `netstat` rather than hard-coding `40000`.

## Verification
```
git fetch HamsterStore main
git rev-parse HEAD HamsterStore/main   # must be identical
```
