package wg

import (
	"bytes"
	"io"
	"strconv"
	"sync"

	"nordgen/internal/types"
)

var bufPool = sync.Pool{
	New: func() interface{} {
		return new(bytes.Buffer)
	},
}

func WriteConfig(w io.Writer, server types.ProcessedServer, pubKey string, opts types.ValidatedConfig) {
	endpoint := server.Hostname
	if opts.UseStation {
		endpoint = server.Station
	}

	buf := bufPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer bufPool.Put(buf)

	buf.WriteString("[Interface]\nPrivateKey=")
	buf.WriteString(opts.PrivateKey)
	buf.WriteString("\nAddress=10.5.0.2/16\nDNS=")
	buf.WriteString(opts.DNS)
	buf.WriteString("\n\n[Peer]\nPublicKey=")
	buf.WriteString(pubKey)
	buf.WriteString("\nAllowedIPs=0.0.0.0/0,::/0\nEndpoint=")
	buf.WriteString(endpoint)
	buf.WriteString(":51820\nPersistentKeepalive=")
	buf.WriteString(strconv.Itoa(opts.KeepAlive))

	w.Write(buf.Bytes())
}

func Build(server types.ProcessedServer, pubKey string, opts types.ValidatedConfig) []byte {
	buf := bufPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer bufPool.Put(buf)

	WriteConfig(buf, server, pubKey, opts)

	out := make([]byte, buf.Len())
	copy(out, buf.Bytes())
	return out
}
