//go:build windows

package generator

import (
	"fmt"
	"runtime"

	"golang.org/x/sys/windows"
)

func secureOutputRoot(path string) error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return fmt.Errorf("get current user: %w", err)
	}
	userSID := user.User.Sid.String()
	if userSID == "" {
		return fmt.Errorf("get current user SID")
	}

	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;" + userSID + ")")
	if err != nil {
		return fmt.Errorf("build current-user-only security descriptor: %w", err)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return fmt.Errorf("read current-user-only DACL: %w", err)
	}
	information := windows.SECURITY_INFORMATION(windows.DACL_SECURITY_INFORMATION | windows.PROTECTED_DACL_SECURITY_INFORMATION)
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, information, nil, nil, dacl, nil); err != nil {
		return fmt.Errorf("apply current-user-only DACL: %w", err)
	}
	runtime.KeepAlive(descriptor)
	return nil
}
