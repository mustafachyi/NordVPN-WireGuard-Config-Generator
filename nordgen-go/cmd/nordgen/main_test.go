package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"nordgen/internal/client"
	"nordgen/internal/constants"
	"nordgen/internal/models"
	"nordgen/internal/ui"
)

type fakeNordAPI struct {
	key         string
	keyErr      error
	coordinates models.Coordinates
	geoErr      error
	servers     []models.RawServer
	serversErr  error
}

func (api fakeNordAPI) GetKey(context.Context, string) (string, error) {
	return api.key, api.keyErr
}

func (api fakeNordAPI) GetGeo(context.Context) (models.Coordinates, error) {
	return api.coordinates, api.geoErr
}

func (api fakeNordAPI) GetServers(context.Context) ([]models.RawServer, error) {
	return api.servers, api.serversErr
}

func mainTestKey(fill byte) string {
	value := make([]byte, 32)
	for index := range value {
		value[index] = fill
	}
	return base64.StdEncoding.EncodeToString(value)
}

func mainTestServer() models.RawServer {
	return models.RawServer{
		Hostname: "us1.example.com",
		Station:  "192.0.2.1",
		Load:     10,
		Locations: []models.RawLocation{{
			Latitude:  1,
			Longitude: 1,
			Country: models.RawCountry{
				Name: "Country",
				City: models.RawCity{Name: "City"},
			},
		}},
		Groups: []models.RawGroup{{Identifier: constants.GroupStandardID}},
		Technologies: []models.RawTechnology{{Metadata: []models.RawMetadata{{
			Name:  "public_key",
			Value: mainTestKey(2),
		}}}},
	}
}

func TestResolveCommand(t *testing.T) {
	tests := []struct {
		args        []string
		wantCommand string
		wantArgs    []string
		wantErr     bool
	}{
		{wantCommand: "generate"},
		{args: []string{"-t", "token"}, wantCommand: "generate", wantArgs: []string{"-t", "token"}},
		{args: []string{"generate", "-i"}, wantCommand: "generate", wantArgs: []string{"-i"}},
		{args: []string{"get-key", "-t", "token"}, wantCommand: "get-key", wantArgs: []string{"-t", "token"}},
		{args: []string{"help"}, wantCommand: "help"},
		{args: []string{"unknown"}, wantErr: true},
		{args: []string{"help", "extra"}, wantErr: true},
	}
	for _, test := range tests {
		command, args, err := resolveCommand(test.args)
		if (err != nil) != test.wantErr {
			t.Fatalf("resolveCommand(%v) error = %v", test.args, err)
		}
		if command != test.wantCommand || !reflect.DeepEqual(args, test.wantArgs) {
			t.Errorf("resolveCommand(%v) = %q, %v", test.args, command, args)
		}
	}
}

func TestNormalizeGroupArgs(t *testing.T) {
	input := []string{"-g", "standard", "p2p", "-d", "1.1.1.1", "--group=onion"}
	want := []string{"-g", "standard", "-g", "p2p", "-d", "1.1.1.1", "--group=onion"}
	if actual := normalizeGroupArgs(input); !reflect.DeepEqual(actual, want) {
		t.Fatalf("normalizeGroupArgs() = %v, want %v", actual, want)
	}
}

func TestParseGenerateOptions(t *testing.T) {
	options, err := parseGenerateOptions([]string{"-t", strings.Repeat("a", 64), "-d", "1.1.1.1", "-k", "15", "-i", "-g", "standard", "p2p"})
	if err != nil {
		t.Fatalf("parseGenerateOptions() error = %v", err)
	}
	wantGroups := []string{constants.GroupStandardID, constants.GroupP2PID}
	if !reflect.DeepEqual(options.prefs.Groups, wantGroups) || options.prefs.Keepalive != 15 || !options.prefs.UseIP {
		t.Fatalf("options = %+v", options)
	}
	if !options.provided["token"] || !options.provided["group"] {
		t.Fatalf("provided = %v", options.provided)
	}
}

func TestParseGenerateOptionsRejectsInvalidInput(t *testing.T) {
	tests := [][]string{
		{"-g", "unknown"},
		{"-e", "-g", "dedicated"},
		{"-d", "not-an-ip"},
		{"-k", "65536"},
		{"unexpected"},
		{"-g"},
	}
	for _, args := range tests {
		if _, err := parseGenerateOptions(args); err == nil {
			t.Errorf("parseGenerateOptions(%v) succeeded", args)
		}
	}
}

func TestValidateToken(t *testing.T) {
	valid := strings.Repeat("aB", 32)
	if actual, err := validateToken(" " + valid + " "); err != nil || actual != valid {
		t.Fatalf("validateToken() = %q, %v", actual, err)
	}
	for _, value := range []string{"", strings.Repeat("a", 63), strings.Repeat("g", 64)} {
		if _, err := validateToken(value); err == nil {
			t.Errorf("validateToken(%q) succeeded", value)
		}
	}
}

func TestResolvePrivateKey(t *testing.T) {
	token := strings.Repeat("a", 64)
	manager := ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{})
	key, err := resolvePrivateKey(context.Background(), manager, fakeNordAPI{key: mainTestKey(1)}, token)
	if err != nil || key != mainTestKey(1) {
		t.Fatalf("resolvePrivateKey() = %q, %v", key, err)
	}
	_, err = resolvePrivateKey(context.Background(), manager, fakeNordAPI{keyErr: fmtError(client.ErrUnauthorized)}, token)
	if err == nil || !strings.Contains(err.Error(), "rejected") {
		t.Fatalf("resolvePrivateKey() error = %v", err)
	}
	_, err = resolvePrivateKey(context.Background(), manager, fakeNordAPI{key: "invalid"}, token)
	if err == nil || !strings.Contains(err.Error(), "invalid private key") {
		t.Fatalf("resolvePrivateKey() error = %v", err)
	}
}

func fmtError(err error) error {
	return errors.Join(errors.New("request failed"), err)
}

func TestRunHelpUnknownAndInvalidToken(t *testing.T) {
	var output bytes.Buffer
	if code := run(context.Background(), []string{"help"}, strings.NewReader(""), &output); code != 0 {
		t.Fatalf("help exit code = %d", code)
	}
	if !strings.Contains(output.String(), "USAGE:") {
		t.Fatalf("help output = %q", output.String())
	}

	output.Reset()
	if code := run(context.Background(), []string{"unknown"}, strings.NewReader(""), &output); code != 2 {
		t.Fatalf("unknown exit code = %d", code)
	}

	output.Reset()
	if code := run(context.Background(), []string{"get-key", "-t", "bad"}, strings.NewReader(""), &output); code != 1 {
		t.Fatalf("invalid token exit code = %d", code)
	}
	if !strings.Contains(output.String(), "64 hexadecimal") {
		t.Fatalf("invalid token output = %q", output.String())
	}
}

func TestRunGenerate(t *testing.T) {
	workingDir := t.TempDir()
	previousDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() error = %v", err)
	}
	if err := os.Chdir(workingDir); err != nil {
		t.Fatalf("Chdir() error = %v", err)
	}
	defer func() { _ = os.Chdir(previousDir) }()

	var output bytes.Buffer
	manager := ui.NewConsoleManager(strings.NewReader(""), &output)
	options := generateOptions{
		token:    strings.Repeat("a", 64),
		prefs:    models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25},
		provided: map[string]bool{"token": true},
	}
	code := runGenerate(context.Background(), manager, fakeNordAPI{
		key:         mainTestKey(1),
		coordinates: models.Coordinates{},
		servers:     []models.RawServer{mainTestServer()},
	}, options)
	if code != 0 {
		t.Fatalf("runGenerate() exit code = %d, output = %q", code, output.String())
	}
	matches, err := filepath.Glob(filepath.Join(workingDir, "nordvpn_configs_*"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("generated directories = %v, error = %v", matches, err)
	}
}

func TestOptionHelpers(t *testing.T) {
	if !containsHelp([]string{"generate", "--help"}) || containsHelp([]string{"generate"}) {
		t.Fatal("containsHelp() returned an unexpected result")
	}

	token := strings.Repeat("a", 64)
	parsed, err := parseGetKeyOptions([]string{"--token", token})
	if err != nil || parsed != token {
		t.Fatalf("parseGetKeyOptions() = %q, %v", parsed, err)
	}
	for _, args := range [][]string{{"--unknown"}, {"extra"}} {
		if _, err := parseGetKeyOptions(args); err == nil {
			t.Fatalf("parseGetKeyOptions(%v) succeeded", args)
		}
	}

	groups, err := normalizeGroups([]string{" Standard ", "standard", "P2P"})
	if err != nil || !reflect.DeepEqual(groups, []string{constants.GroupStandardID, constants.GroupP2PID}) {
		t.Fatalf("normalizeGroups() = %v, %v", groups, err)
	}
	if err := validateGroupConflict(models.UserPreferences{Groups: []string{constants.GroupStandardID}}); err != nil {
		t.Fatalf("validateGroupConflict() error = %v", err)
	}
	if err := validateGroupConflict(models.UserPreferences{Groups: []string{constants.GroupDedicatedID}, ExcludeDedicated: true}); err == nil {
		t.Fatal("validateGroupConflict() accepted conflicting options")
	}
}

func TestResolvePrivateKeyPromptAndTransportFailure(t *testing.T) {
	token := strings.Repeat("a", 64)
	var output bytes.Buffer
	manager := ui.NewConsoleManager(strings.NewReader(token+"\n"), &output)
	key, err := resolvePrivateKey(context.Background(), manager, fakeNordAPI{key: mainTestKey(1)}, "")
	if err != nil || key != mainTestKey(1) {
		t.Fatalf("resolvePrivateKey() = %q, %v", key, err)
	}

	manager = ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{})
	_, err = resolvePrivateKey(context.Background(), manager, fakeNordAPI{keyErr: errors.New("network unavailable")}, token)
	if err == nil || !strings.Contains(err.Error(), "retrieve NordLynx") || strings.Contains(err.Error(), "rejected") {
		t.Fatalf("resolvePrivateKey() error = %v", err)
	}
}

func TestRunGetKeyAndRuntimeErrors(t *testing.T) {
	token := strings.Repeat("a", 64)
	var output bytes.Buffer
	manager := ui.NewConsoleManager(strings.NewReader(""), &output)
	if code := runGetKey(context.Background(), manager, fakeNordAPI{key: mainTestKey(1)}, token); code != 0 {
		t.Fatalf("runGetKey() exit code = %d", code)
	}
	if !strings.Contains(output.String(), mainTestKey(1)) {
		t.Fatalf("runGetKey() output = %q", output.String())
	}

	output.Reset()
	manager = ui.NewConsoleManager(strings.NewReader(""), &output)
	if code := handleRuntimeError(manager, context.Canceled, false); code != 130 {
		t.Fatalf("handleRuntimeError(cancelled) = %d", code)
	}
	if code := handleRuntimeError(manager, errors.New("failed"), false); code != 1 {
		t.Fatalf("handleRuntimeError(failed) = %d", code)
	}
}

func TestRunGenerateInteractiveAndFailures(t *testing.T) {
	workingDir := t.TempDir()
	previousDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() error = %v", err)
	}
	if err := os.Chdir(workingDir); err != nil {
		t.Fatalf("Chdir() error = %v", err)
	}
	defer func() { _ = os.Chdir(previousDir) }()

	token := strings.Repeat("a", 64)
	input := strings.NewReader(token + "\n\n\n\n\n")
	manager := ui.NewConsoleManager(input, &bytes.Buffer{})
	options := generateOptions{
		prefs:    models.UserPreferences{DNS: defaultDNS, Keepalive: 25},
		provided: map[string]bool{},
	}
	code := runGenerate(context.Background(), manager, fakeNordAPI{
		key:         mainTestKey(1),
		coordinates: models.Coordinates{},
		servers:     []models.RawServer{mainTestServer()},
	}, options)
	if code != 0 {
		t.Fatalf("runGenerate(interactive) exit code = %d", code)
	}

	manager = ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{})
	invalid := generateOptions{
		token:    token,
		prefs:    models.UserPreferences{DNS: "invalid", Keepalive: 25},
		provided: map[string]bool{"token": true},
	}
	if code := runGenerate(context.Background(), manager, fakeNordAPI{key: mainTestKey(1)}, invalid); code != 1 {
		t.Fatalf("runGenerate(invalid preferences) exit code = %d", code)
	}

	failed := generateOptions{
		token:    token,
		prefs:    models.UserPreferences{DNS: defaultDNS, Keepalive: 25},
		provided: map[string]bool{"token": true},
	}
	if code := runGenerate(context.Background(), manager, fakeNordAPI{key: mainTestKey(1), serversErr: errors.New("failed")}, failed); code != 1 {
		t.Fatalf("runGenerate(fetch failure) exit code = %d", code)
	}
}

type mainFailingWriter struct{}

func (mainFailingWriter) Write([]byte) (int, error) {
	return 0, errors.New("write failed")
}

type mainPatternFailWriter struct {
	reject string
	buffer bytes.Buffer
}

func (writer *mainPatternFailWriter) Write(value []byte) (int, error) {
	if strings.Contains(string(value), writer.reject) {
		return 0, errors.New("write failed")
	}
	return writer.buffer.Write(value)
}

func TestRunAndCommandsRejectOutputFailure(t *testing.T) {
	for _, args := range [][]string{
		{"help"},
		{"unknown"},
		{"get-key", "--unknown"},
		{"generate", "--unknown"},
	} {
		if code := run(context.Background(), args, strings.NewReader(""), mainFailingWriter{}); code != 1 {
			t.Errorf("run(%v) exit code = %d, want 1", args, code)
		}
	}

	manager := ui.NewConsoleManager(strings.NewReader(""), mainFailingWriter{})
	if code := runGetKey(context.Background(), manager, fakeNordAPI{key: mainTestKey(1)}, strings.Repeat("a", 64)); code != 1 {
		t.Fatalf("runGetKey() exit code = %d, want 1", code)
	}
}

func TestRunCoversCommandParseFailures(t *testing.T) {
	for _, test := range []struct {
		args []string
		want int
	}{
		{args: []string{"help", "extra"}, want: 2},
		{args: []string{"get-key", "--unknown"}, want: 2},
		{args: []string{"generate", "--unknown"}, want: 2},
	} {
		if code := run(context.Background(), test.args, strings.NewReader(""), &bytes.Buffer{}); code != test.want {
			t.Errorf("run(%v) exit code = %d, want %d", test.args, code, test.want)
		}
	}
}

func TestResolvePrivateKeyRejectsOutputFailure(t *testing.T) {
	manager := ui.NewConsoleManager(strings.NewReader(""), mainFailingWriter{})
	_, err := resolvePrivateKey(
		context.Background(),
		manager,
		fakeNordAPI{key: mainTestKey(1)},
		strings.Repeat("a", 64),
	)
	if err == nil || !strings.Contains(err.Error(), "write console output") {
		t.Fatalf("resolvePrivateKey() error = %v", err)
	}
}

func TestRunGenerateStopsAfterPromptOutputFailure(t *testing.T) {
	writer := &mainPatternFailWriter{reject: "Configuration Options"}
	manager := ui.NewConsoleManager(strings.NewReader("\n\n\n\n"), writer)
	options := generateOptions{
		token:    strings.Repeat("a", 64),
		prefs:    models.UserPreferences{DNS: defaultDNS, Keepalive: 25},
		provided: map[string]bool{},
	}
	code := runGenerate(context.Background(), manager, fakeNordAPI{key: mainTestKey(1)}, options)
	if code != 1 {
		t.Fatalf("runGenerate() exit code = %d, want 1", code)
	}
	if manager.Err() == nil {
		t.Fatal("console output error was not retained")
	}
}

func TestSuccessfulExitReportsStoredOutputFailure(t *testing.T) {
	manager := ui.NewConsoleManager(strings.NewReader(""), mainFailingWriter{})
	manager.Success("done")
	if code := successfulExit(manager); code != 1 {
		t.Fatalf("successfulExit() = %d, want 1", code)
	}

	manager = ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{})
	if code := successfulExit(manager); code != 0 {
		t.Fatalf("successfulExit() = %d, want 0", code)
	}
}
