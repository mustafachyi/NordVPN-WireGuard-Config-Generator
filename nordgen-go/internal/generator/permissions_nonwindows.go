//go:build !windows

package generator

import "os"

func secureOutputRoot(path string) error {
	return os.Chmod(path, 0700)
}
