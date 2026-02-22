package wg

import (
	"io"
	"strconv"
	"sync"

	"nordgen/internal/types"
)

var (
	headerStatic = []byte("[Interface]\nPrivateKey=")
	addrStatic   = []byte("\nAddress=10.5.0.2/16\nDNS=")
	peerStatic   = []byte("\n\n[Peer]\nPublicKey=")
	allowStatic  = []byte("\nAllowedIPs=0.0.0.0/0,::/0\nEndpoint=")
	portStatic   = []byte(":51820\nPersistentKeepalive=")

	pool = sync.Pool{
		New: func() interface{} {
			b := make([]byte, 0, 1024)
			return &b
		},
	}
)

func WriteConfig(w io.Writer, server types.ProcessedServer, pubKey string, opts types.ValidatedConfig) {
	bufPtr := pool.Get().(*[]byte)
	buf := *bufPtr
	buf = buf[:0]

	endpoint := server.Hostname
	if opts.UseStation {
		endpoint = server.Station
	}

	buf = append(buf, headerStatic...)
	buf = append(buf, opts.PrivateKey...)
	buf = append(buf, addrStatic...)
	buf = append(buf, opts.DNS...)
	buf = append(buf, peerStatic...)
	buf = append(buf, pubKey...)
	buf = append(buf, allowStatic...)
	buf = append(buf, endpoint...)
	buf = append(buf, portStatic...)
	buf = strconv.AppendInt(buf, int64(opts.KeepAlive), 10)

	w.Write(buf)

	*bufPtr = buf
	pool.Put(bufPtr)
}

func Build(server types.ProcessedServer, pubKey string, opts types.ValidatedConfig) []byte {
	endpoint := server.Hostname
	if opts.UseStation {
		endpoint = server.Station
	}

	size := len(headerStatic) + len(opts.PrivateKey) +
		len(addrStatic) + len(opts.DNS) +
		len(peerStatic) + len(pubKey) +
		len(allowStatic) + len(endpoint) +
		len(portStatic) + 5

	buf := make([]byte, 0, size)

	buf = append(buf, headerStatic...)
	buf = append(buf, opts.PrivateKey...)
	buf = append(buf, addrStatic...)
	buf = append(buf, opts.DNS...)
	buf = append(buf, peerStatic...)
	buf = append(buf, pubKey...)
	buf = append(buf, allowStatic...)
	buf = append(buf, endpoint...)
	buf = append(buf, portStatic...)
	buf = strconv.AppendInt(buf, int64(opts.KeepAlive), 10)

	return buf
}
