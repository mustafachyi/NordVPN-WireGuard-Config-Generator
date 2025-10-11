FROM oven/bun:1.3.0

RUN apt-get update && \
    apt-get install -y curl git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN git clone https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator .

WORKDIR /app/web-version-V2/web-version-V2-Backend

RUN bun install && bun run build

EXPOSE 3000

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

CMD ["bun", "start"]
