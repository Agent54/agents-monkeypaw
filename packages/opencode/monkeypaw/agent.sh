docker run --rm -it \
  -p 4097:4097 \
  -v "$PWD:/home/opencode/workspaces/repo" \
  -v "$PWD/packages/opencode/monkeypaw:/home/opencode/monkeypaw" \
  -w /home/opencode/workspaces/repo \
  opencode-monkeypaw:test