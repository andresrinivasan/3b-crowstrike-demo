FROM 3b/base

RUN \
  --mount=type=cache,target=bun \
  case $(uname -m) in \
    x86_64) ARCH=linux-x64; SHA=3632a4fae998deaad2358e22ae74d1fd6c673b9be760a470e3a0044267cb4438;; \
    *) ARCH=linux-aarch64; SHA=1edcc88fd13c16471aa29ec9d5af4063e43ec9b71d34e89cb7e43dbec718aaf0;; \
  esac && \
  curl --proto '=https' --tlsv1.2 -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.3.10/bun-${ARCH}.zip" -o /tmp/bun.zip && \
  unzip -qoj /tmp/bun.zip -d . "bun-${ARCH}/bun" && \
  printf '%s  bun\n' "$SHA" | sha256sum -c - && \
  chmod +x ./bun && \
  ./bun --version >/dev/null

COPY package.json .
RUN \
  --mount=type=cache,target=node_modules \
  if [ -f package.json ]; then ./bun install; fi && \
  mkdir -p node_modules

CMD ./bun ./script.ts
