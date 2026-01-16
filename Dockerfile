FROM golang:1.25.6-alpine3.23 AS builder
WORKDIR /build
RUN apk add --no-cache git ca-certificates
RUN adduser --disabled-password --gecos "" --home "/nonexistent" --shell "/sbin/nologin" --no-create-home --uid 10001 appuser
COPY web-version-V2/web-version-V2-Backend/go.mod web-version-V2/web-version-V2-Backend/go.sum ./
RUN go mod download
COPY web-version-V2/web-version-V2-Backend .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -trimpath -o server main.go

FROM scratch
WORKDIR /app
COPY --from=builder /etc/passwd /etc/passwd
COPY --from=builder /etc/group /etc/group
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /build/server .
COPY --from=builder /build/public ./public
USER appuser:appuser
EXPOSE 3000
ENTRYPOINT ["./server"]
