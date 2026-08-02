FROM golang:1.26.5-alpine3.24@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN GOTOOLCHAIN=local GOFLAGS=-mod=readonly go mod download && go mod verify
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux GOFLAGS=-mod=readonly go build -buildvcs=false -trimpath -ldflags="-s -w -buildid=" -o /out/nordgen ./cmd/nordgen \
    && mkdir -p /out/data \
    && chmod 0700 /out/data

FROM scratch
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder /out/nordgen /usr/local/bin/nordgen
COPY --from=builder --chown=65532:65532 /out/data /data
USER 65532:65532
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/nordgen"]