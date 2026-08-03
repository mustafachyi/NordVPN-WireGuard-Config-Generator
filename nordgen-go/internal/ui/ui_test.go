package ui

import (
	"bytes"
	"errors"
	"io"
	"os"
	"strings"
	"testing"

	"golang.org/x/term"

	"nordgen/internal/models"
)

func createTestInput(t *testing.T, content []byte) *os.File {
	t.Helper()

	input, err := os.CreateTemp(t.TempDir(), "input")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	t.Cleanup(func() {
		if err := input.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})

	if _, err := input.Write(content); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if _, err := input.Seek(0, 0); err != nil {
		t.Fatalf("Seek() error = %v", err)
	}
	return input
}

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) {
	return 0, errors.New("write failed")
}

func TestPromptSecretNonTerminal(t *testing.T) {
	var output bytes.Buffer
	manager := NewConsoleManager(strings.NewReader("  secret-value  \n"), &output)

	value, err := manager.PromptSecret("Token")
	if err != nil {
		t.Fatalf("PromptSecret() error = %v", err)
	}
	if value != "secret-value" {
		t.Fatalf("PromptSecret() = %q", value)
	}
	if !strings.Contains(output.String(), "Token: ") {
		t.Fatalf("output = %q", output.String())
	}
}

func TestPromptSecretNonTerminalBoundaries(t *testing.T) {
	exact := strings.Repeat("a", maxTokenReadBytes)
	manager := NewConsoleManager(strings.NewReader(exact+"\n"), &bytes.Buffer{})
	value, err := manager.PromptSecret("Token")
	if err != nil || value != exact {
		t.Fatalf("PromptSecret(exact) = %d bytes, %v", len(value), err)
	}

	manager = NewConsoleManager(strings.NewReader(exact+"a\n"), &bytes.Buffer{})
	if _, err := manager.PromptSecret("Token"); !errors.Is(err, ErrInputTooLong) {
		t.Fatalf("PromptSecret(too long) error = %v", err)
	}
}

func TestPromptSecretAcceptsUnterminatedNonTerminalInput(t *testing.T) {
	manager := NewConsoleManager(strings.NewReader(" secret "), &bytes.Buffer{})
	value, err := manager.PromptSecret("Token")
	if err != nil || value != "secret" {
		t.Fatalf("PromptSecret() = %q, %v", value, err)
	}
}

func TestPromptPreferencesRepromptsInvalidValues(t *testing.T) {
	input := strings.Join([]string{
		"",
		"maybe",
		"yes",
		"bad",
		"70000",
		"15",
		"no",
		"",
	}, "\n")

	var output bytes.Buffer
	manager := NewConsoleManager(strings.NewReader(input), &output)
	defaults := models.UserPreferences{
		DNS:       "1.1.1.1",
		Keepalive: 25,
	}

	preferences := manager.PromptPreferences(defaults, map[string]bool{})
	if preferences.DNS != "1.1.1.1" ||
		!preferences.UseIP ||
		preferences.Keepalive != 15 ||
		preferences.ExcludeDedicated {
		t.Fatalf("PromptPreferences() = %+v", preferences)
	}
	if !strings.Contains(output.String(), "Enter yes or no") ||
		!strings.Contains(output.String(), "Enter a value between 0 and 65535") {
		t.Fatalf("output = %q", output.String())
	}
}

func TestPromptPreferencesRepromptsInvalidDNS(t *testing.T) {
	input := strings.NewReader("invalid\n2001:0db8::1\n")
	manager := NewConsoleManager(input, &bytes.Buffer{})

	preferences := manager.PromptPreferences(
		models.UserPreferences{
			DNS:       "1.1.1.1",
			Keepalive: 25,
		},
		map[string]bool{
			"use_ip":            true,
			"keepalive":         true,
			"exclude_dedicated": true,
		},
	)

	if preferences.DNS != "2001:db8::1" {
		t.Fatalf("DNS = %q", preferences.DNS)
	}
}

func TestNonTerminalStatusAndProgress(t *testing.T) {
	var output bytes.Buffer
	manager := NewConsoleManager(strings.NewReader(""), &output)

	manager.StartStatus("Working...")
	manager.StopStatus()
	if manager.StartProgress(10, "Writing") {
		t.Fatal("StartProgress() enabled non-terminal progress")
	}
	manager.UpdateProgress(5, 10, "Writing")
	manager.StopProgress()

	if output.String() != "Working...\n" {
		t.Fatalf("output = %q", output.String())
	}
}

func TestSummary(t *testing.T) {
	var output bytes.Buffer
	manager := NewConsoleManager(strings.NewReader(""), &output)
	manager.Summary("configs", models.GenerationStats{Total: 2, Best: 1}, 1.25)

	text := output.String()
	for _, expected := range []string{
		"Output Directory:    configs",
		"Total Files Written: 3",
		"Standard:       2",
		"Optimized:      1",
		"1.25s",
	} {
		if !strings.Contains(text, expected) {
			t.Errorf("summary missing %q", expected)
		}
	}
}

func TestPromptSecretRawTerminal(t *testing.T) {
	input := createTestInput(t, []byte{'a', 'b', 127, 'c', 'd', '\r'})

	var output bytes.Buffer
	manager := NewConsoleManager(input, &output)
	manager.inputTerminal = true
	restored := false
	manager.makeRaw = func(int) (*term.State, error) {
		return &term.State{}, nil
	}
	manager.restore = func(int, *term.State) error {
		restored = true
		return nil
	}

	value, err := manager.PromptSecret("Token")
	if err != nil {
		t.Fatalf("PromptSecret() error = %v", err)
	}
	if value != "acd" || !restored {
		t.Fatalf("PromptSecret() = %q, restored = %v", value, restored)
	}
	if !strings.Contains(output.String(), "**\b \b**") {
		t.Fatalf("output = %q", output.String())
	}
}

func TestPromptSecretRawTerminalBoundaries(t *testing.T) {
	exact := strings.Repeat("a", maxTokenReadBytes)
	input := createTestInput(t, []byte(exact+"\n"))
	manager := NewConsoleManager(input, &bytes.Buffer{})
	manager.inputTerminal = true
	manager.makeRaw = func(int) (*term.State, error) { return &term.State{}, nil }
	manager.restore = func(int, *term.State) error { return nil }
	value, err := manager.PromptSecret("Token")
	if err != nil || value != exact {
		t.Fatalf("PromptSecret(exact) = %d bytes, %v", len(value), err)
	}

	input = createTestInput(t, []byte(exact+"a"))
	manager = NewConsoleManager(input, &bytes.Buffer{})
	manager.inputTerminal = true
	manager.makeRaw = func(int) (*term.State, error) { return &term.State{}, nil }
	manager.restore = func(int, *term.State) error { return nil }
	if _, err := manager.PromptSecret("Token"); !errors.Is(err, ErrInputTooLong) {
		t.Fatalf("PromptSecret(too long) error = %v", err)
	}
}

func TestPromptSecretRawTerminalErrors(t *testing.T) {
	restoreFailure := errors.New("restore failed")
	tests := []struct {
		name       string
		input      []byte
		restoreErr error
		wantErr    error
	}{
		{name: "cancelled", input: []byte{3}, wantErr: ErrCancelled},
		{name: "empty read", input: nil, wantErr: io.EOF},
		{name: "restore", input: []byte("secret\n"), restoreErr: restoreFailure, wantErr: restoreFailure},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := createTestInput(t, test.input)
			manager := NewConsoleManager(input, &bytes.Buffer{})
			manager.inputTerminal = true
			manager.makeRaw = func(int) (*term.State, error) { return &term.State{}, nil }
			manager.restore = func(int, *term.State) error { return test.restoreErr }

			_, err := manager.PromptSecret("Token")
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("PromptSecret() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestPromptSecretFailsClosedWhenRawModeFails(t *testing.T) {
	input := createTestInput(t, []byte(" secret \n"))
	manager := NewConsoleManager(input, &bytes.Buffer{})
	manager.inputTerminal = true
	manager.makeRaw = func(int) (*term.State, error) { return nil, errors.New("unsupported") }

	value, err := manager.PromptSecret("Token")
	if err == nil || value != "" || !strings.Contains(err.Error(), "enable masked terminal input") {
		t.Fatalf("PromptSecret() = %q, %v", value, err)
	}
}

func TestOutputErrorsAreSticky(t *testing.T) {
	manager := NewConsoleManager(strings.NewReader(""), failingWriter{})
	manager.Success("first")
	first := manager.Err()
	if first == nil {
		t.Fatal("Err() = nil")
	}
	manager.Info("second")
	if !errors.Is(manager.Err(), first) && manager.Err().Error() != first.Error() {
		t.Fatalf("Err() changed from %v to %v", first, manager.Err())
	}

	manager = NewConsoleManager(strings.NewReader("secret\n"), failingWriter{})
	if _, err := manager.PromptSecret("Token"); err == nil {
		t.Fatal("PromptSecret() ignored output failure")
	}
}

func TestTerminalPresentation(t *testing.T) {
	var output bytes.Buffer
	manager := NewConsoleManager(strings.NewReader("\n"), &output)
	manager.inputTerminal = true
	manager.outputTerminal = true

	manager.ClearScreen()
	manager.Header()
	manager.Success("Done")
	manager.ShowKey("key")
	manager.StartStatus("Working")
	manager.StartStatus("Ignored")
	manager.StopStatus()
	if !manager.StartProgress(2, "Writing") {
		t.Fatal("StartProgress() did not enable terminal progress")
	}
	if manager.StartProgress(2, "Writing") {
		t.Fatal("StartProgress() enabled duplicate progress")
	}
	manager.UpdateProgress(-1, 2, "Writing")
	manager.UpdateProgress(3, 2, "Writing")
	manager.StopProgress()
	manager.Wait()

	text := output.String()
	for _, expected := range []string{
		"\x1b[2J",
		"NordVPN Configuration Generator",
		"Done",
		"key",
		"Working",
		"2/2",
		"Press Enter to exit",
	} {
		if !strings.Contains(text, expected) {
			t.Errorf("terminal output missing %q: %q", expected, text)
		}
	}
	if strings.Contains(text, "Ignored") {
		t.Fatalf("duplicate status was rendered: %q", text)
	}
}

func TestTerminalStatusProgressAndWaitHandleOutputFailure(t *testing.T) {
	manager := NewConsoleManager(strings.NewReader("\n"), failingWriter{})
	manager.inputTerminal = true
	manager.outputTerminal = true

	manager.StartStatus("Working")
	manager.StopStatus()
	if manager.StartProgress(1, "Writing") {
		t.Fatal("StartProgress() succeeded after output failure")
	}
	if manager.StartProgress(0, "Writing") {
		t.Fatal("StartProgress() accepted zero total")
	}
	manager.UpdateProgress(1, 1, "Writing")
	manager.StopProgress()
	manager.Wait()
	if manager.Err() == nil {
		t.Fatal("output failure was not retained")
	}
}

func TestPromptSecretRawTerminalBoundsControlInput(t *testing.T) {
	input := createTestInput(t, bytes.Repeat([]byte{0}, maxRawSecretReadBytes))
	manager := NewConsoleManager(input, &bytes.Buffer{})
	manager.inputTerminal = true
	manager.makeRaw = func(int) (*term.State, error) { return &term.State{}, nil }
	manager.restore = func(int, *term.State) error { return nil }

	if _, err := manager.PromptSecret("Token"); !errors.Is(err, ErrInputTooLong) {
		t.Fatalf("PromptSecret() error = %v", err)
	}
}

func TestPromptHelpersUseDefaults(t *testing.T) {
	manager := NewConsoleManager(strings.NewReader("\n"), &bytes.Buffer{})
	if !manager.promptBool("Enabled?", true) {
		t.Fatal("promptBool() did not use true default")
	}

	manager = NewConsoleManager(strings.NewReader("n\n"), &bytes.Buffer{})
	if manager.promptBool("Enabled?", true) {
		t.Fatal("promptBool() did not accept no")
	}

	manager = NewConsoleManager(strings.NewReader(""), &bytes.Buffer{})
	if manager.promptString("Value", "default") != "default" {
		t.Fatal("promptString() did not use default after EOF")
	}
	if manager.promptInt("Number", 7, 0, 10) != 7 {
		t.Fatal("promptInt() did not use default after EOF")
	}
}
