# Windows git push blocked/hangs behind a proxy — reproduction & transcript

Condensed from a real session (HamsterStore repo, Windows 10, git bundled under
Hermes at `…/hermes/git/`, only network path to GitHub is an HTTP proxy on
`127.0.0.1:40000`). Two independent bugs blocked `git push`; both had to be
fixed for the push to go through.

## Environment baseline (what worked)
- `curl -sS -m 12 -x http://127.0.0.1:40000 -o /dev/null -w "%{http_code}" https://github.com` → `200`
- Authenticated API via proxy: `curl -x http://127.0.0.1:40000 -H "Authorization: Bearer <PAT>" https://api.github.com/user` → `200`
- GCM has a valid stored PAT in Windows Credential Manager (account `Gautown`):
  `printf 'protocol=https\nhost=github.com\n' | git-credential-manager get` →
  `username=Gautown` / `password=gho_…` (runs in ~0.5s when invoked directly)

## Bug 1 — empty scoped proxy override (forces direct connect)
Symptom: `git ls-remote` works (GET via proxy) but `git push` times out on a
direct connection, even though `git config --global http.proxy` is correct.

GIT_CURL_VERBOSE of the failing push:
```
== Info: Host github.com:443 was resolved.
== Info: connect to 20.205.243.166 port 443 from 0.0.0.0 port 60513 failed: Timed out
== Info: Failed to connect to github.com port 443 after 21125 ms
```
Root cause found via `git config --get-regexp 'http\..*proxy'`:
```
http.proxy http://127.0.0.1:40000
http.proxystrictssl false
http.https://github.com.proxy            <-- EMPTY, overrides the global proxy
```
Fix:
```
git config --global --unset-all 'http.https://github.com.proxy'
```

## Bug 2 — bundled `helper-selector` credential helper hangs (no TTY)
After Bug 1 fixed, push still hangs. GIT_TRACE shows:
```
run-command: 'git credential-helper-selector get'        <-- hangs ~50s, no TTY
run-command: 'git credential-manager get'                <-- only runs after the hang
```
`git config --show-origin --get-all credential.helper`:
```
file:.../hermes/git/etc/gitconfig   helper-selector      <-- bundled, runs FIRST
file:/c/Users/GauTown/.gitconfig    manager
```
The selector blocks waiting on a TTY that doesn't exist in the agent session.
Fix — set the helper locally so the selector never runs:
```
git config --local credential.helper ""
git config --local --add credential.helper manager
```

## Final working push
```
GIT_TERMINAL_PROMPT=0 git push HamsterStore main
# To https://github.com/Gautown/HamsterStore.git
#   7eb67ff..bc80286  main -> main
```
Verification: `git ls-remote https://github.com/Gautown/HamsterStore.git` shows
remote `HEAD`/`main` == local `HEAD` (`bc80286`).

## Key lesson
A passing `git ls-remote` (or `curl`) through the proxy does NOT prove `git
push` will work — a write triggers credential selection that a read may not,
and the empty scoped-proxy override only matters once git actually opens the
TLS connection for the push. Always verify with an end-to-end `push` (or a
`GIT_TERMINAL_PROMPT=0` dry attempt), not just `ls-remote`.
