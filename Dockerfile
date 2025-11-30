FROM golang:1.25-alpine AS builder
WORKDIR /build
RUN apk add --no-cache git
COPY web-version-V2/web-version-V2-Backend/go.mod web-version-V2/web-version-V2-Backend/go.sum ./
RUN go mod download
COPY web-version-V2/web-version-V2-Backend .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -trimpath -o server main.go

FROM alpine:latest
WORKDIR /app
RUN apk add --no-cache curl ca-certificates
COPY --from=builder /build/server .
COPY --from=builder /build/public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD curl -f http://localhost:3000/api/servers || exit 1
CMD ["./server"]