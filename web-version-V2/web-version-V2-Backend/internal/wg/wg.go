package wg

import (
	"fmt"
	"strings"

	"nordgen/internal/types"
)

func Build(server types.ProcessedServer, pubKey string, opts types.ValidatedConfig) string {
	var sb strings.Builder
	endpoint := server.Hostname
	if opts.UseStation {
		endpoint = server.Station
	}

	sb.WriteString("[Interface]\nPrivateKey=")
	sb.WriteString(opts.PrivateKey)
	sb.WriteString("\nAddress=10.5.0.2/16\nDNS=")
	sb.WriteString(opts.DNS)
	sb.WriteString("\n\n[Peer]\nPublicKey=")
	sb.WriteString(pubKey)
	sb.WriteString("\nAllowedIPs=0.0.0.0/0,::/0\nEndpoint=")
	sb.WriteString(endpoint)
	sb.WriteString(":51820\nPersistentKeepalive=")
	sb.WriteString(fmt.Sprintf("%d", opts.KeepAlive))

	return sb.String()
}