# Obscura HTTP gateway: the obscura binary + a tiny Node HTTP wrapper.
# obscura is built on distroless/cc (glibc), so a glibc Node base (slim/debian)
# is used — NOT alpine (musl), which can't run the binary.
FROM h4ckf0r0day/obscura:latest AS obscura

FROM node:20-slim
COPY --from=obscura /obscura /usr/local/bin/obscura
WORKDIR /app
COPY server.mjs .
ENV OBSCURA_BIN=/usr/local/bin/obscura
ENV PORT=9223
EXPOSE 9223
CMD ["node", "server.mjs"]
