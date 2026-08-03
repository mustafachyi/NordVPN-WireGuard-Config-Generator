//go:build windows

package generator

import (
	"os"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestSecureOutputRootAppliesCurrentUserOnlyProtectedDACL(t *testing.T) {
	path, err := os.MkdirTemp(t.TempDir(), "secure-output-")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	if err := secureOutputRoot(path); err != nil {
		t.Fatalf("secureOutputRoot() error = %v", err)
	}

	descriptor, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatalf("GetNamedSecurityInfo() error = %v", err)
	}
	control, _, err := descriptor.Control()
	if err != nil {
		t.Fatalf("Control() error = %v", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatalf("security descriptor control = %#x", control)
	}

	dacl, _, err := descriptor.DACL()
	if err != nil {
		t.Fatalf("DACL() error = %v", err)
	}
	if dacl.AceCount != 1 {
		t.Fatalf("DACL ACE count = %d, want 1", dacl.AceCount)
	}

	var ace *windows.ACCESS_ALLOWED_ACE
	if err := windows.GetAce(dacl, 0, &ace); err != nil {
		t.Fatalf("GetAce() error = %v", err)
	}
	if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
		t.Fatalf("ACE type = %d", ace.Header.AceType)
	}
	wantFlags := uint8(windows.OBJECT_INHERIT_ACE | windows.CONTAINER_INHERIT_ACE)
	if ace.Header.AceFlags&wantFlags != wantFlags {
		t.Fatalf("ACE flags = %#x", ace.Header.AceFlags)
	}

	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatalf("GetTokenUser() error = %v", err)
	}
	aceSID := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
	if !aceSID.Equals(user.User.Sid) {
		t.Fatalf("ACE SID = %s, current user SID = %s", aceSID.String(), user.User.Sid.String())
	}
}
