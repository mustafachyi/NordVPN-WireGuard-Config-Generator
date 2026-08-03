package generator

import (
	"bytes"
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode"
	"unicode/utf8"

	"nordgen/internal/constants"
	"nordgen/internal/models"
	"nordgen/internal/ui"
)

type fakeServerClient struct {
	coordinates models.Coordinates
	geoErr      error
	servers     []models.RawServer
	serversErr  error
}

func (client fakeServerClient) GetGeo(context.Context) (models.Coordinates, error) {
	return client.coordinates, client.geoErr
}

func (client fakeServerClient) GetServers(context.Context) ([]models.RawServer, error) {
	return client.servers, client.serversErr
}

func TestSanitizePathSegment(t *testing.T) {
	tests := map[string]string{
		"":               "unknown",
		"   ":            "unknown",
		".":              "unknown",
		"..":             "unknown",
		"New York":       "new_york",
		"A/B:C*D?":       "a_b_c_d_",
		"name.":          "name",
		"CON":            "_con",
		"lpt9.txt":       "_lpt9.txt",
		"München":        "münchen",
		"line\nbreak":    "line_break",
		"tab\tseparated": "tab_separated",
		"name\u202econf": "name_conf",
		"CONIN$":         "_conin$",
		"COM¹":           "_com¹",
	}
	for input, expected := range tests {
		if actual := sanitizePathSegment(input); actual != expected {
			t.Errorf("sanitizePathSegment(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestTruncateUTF8(t *testing.T) {
	if actual := truncateUTF8("ééé", 5); actual != "éé" {
		t.Fatalf("truncateUTF8() = %q", actual)
	}
	if actual := truncateUTF8("abc", 5); actual != "abc" {
		t.Fatalf("truncateUTF8() = %q", actual)
	}
	if actual := truncateUTF8("é", 1); actual != "" {
		t.Fatalf("truncateUTF8() = %q", actual)
	}
}

func TestProcessWritesAtomicPrivateOutput(t *testing.T) {
	standard := constants.GroupStandardID
	servers := []models.RawServer{
		rawServer("us2.example.com", 20, 1, 1, standard),
		rawServer("us1.example.com", 10, 1, 1, standard),
		rawServer("us1.example.com", 50, 1, 1, standard),
	}
	var output bytes.Buffer
	manager := ui.NewConsoleManager(strings.NewReader(""), &output)
	generator := NewGenerator(fakeServerClient{
		coordinates: models.Coordinates{Latitude: 0, Longitude: 0},
		servers:     servers,
	}, manager)
	generator.workingDir = t.TempDir()
	generator.now = func() time.Time {
		return time.Date(2026, 8, 1, 12, 0, 0, 123456789, time.UTC)
	}

	preferences := models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25}
	path, err := generator.Process(context.Background(), parserKey(1), preferences)
	if err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if generator.Stats.Total != 2 || generator.Stats.Best != 1 {
		t.Fatalf("Stats = %+v", generator.Stats)
	}
	if filepath.Base(path) != "nordvpn_configs_20260801_120000_123456789" {
		t.Fatalf("path = %q", path)
	}

	if runtime.GOOS != "windows" {
		info, statErr := os.Stat(path)
		if statErr != nil {
			t.Fatalf("Stat() error = %v", statErr)
		}
		if info.Mode().Perm() != 0700 {
			t.Fatalf("output directory mode = %o", info.Mode().Perm())
		}
	}

	var configPaths []string
	err = filepath.WalkDir(path, func(current string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".conf") {
			configPaths = append(configPaths, current)
			if runtime.GOOS != "windows" {
				info, infoErr := entry.Info()
				if infoErr != nil {
					return infoErr
				}
				if info.Mode().Perm() != 0600 {
					t.Errorf("mode for %s = %o", current, info.Mode().Perm())
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("WalkDir() error = %v", err)
	}
	if len(configPaths) != 3 {
		t.Fatalf("configuration count = %d, want 3", len(configPaths))
	}

	bestMatches, err := filepath.Glob(filepath.Join(path, "best_configs", "*", "*", "*", "*.conf"))
	if err != nil || len(bestMatches) != 1 {
		t.Fatalf("best matches = %v, error = %v", bestMatches, err)
	}
	bestContent, err := os.ReadFile(bestMatches[0])
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if !strings.Contains(string(bestContent), "Endpoint = us1.example.com:51820") {
		t.Fatalf("best configuration = %s", bestContent)
	}
	if temporary, _ := filepath.Glob(filepath.Join(generator.workingDir, ".nordgen-*")); len(temporary) != 0 {
		t.Fatalf("temporary directories remain: %v", temporary)
	}
}

func TestProcessFallsBackWhenGeoFails(t *testing.T) {
	standard := constants.GroupStandardID
	servers := []models.RawServer{
		rawServer("z.example.com", 10, 50, 50, standard),
		rawServer("a.example.com", 10, -50, -50, standard),
	}
	var output bytes.Buffer
	generator := NewGenerator(fakeServerClient{
		geoErr:  errors.New("unavailable"),
		servers: servers,
	}, ui.NewConsoleManager(strings.NewReader(""), &output))
	generator.workingDir = t.TempDir()
	generator.now = func() time.Time { return time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC) }

	path, err := generator.Process(context.Background(), parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25})
	if err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	matches, err := filepath.Glob(filepath.Join(path, "best_configs", "*", "*", "*", "*.conf"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("matches = %v, error = %v", matches, err)
	}
	content, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if !strings.Contains(string(content), "Endpoint = a.example.com:51820") {
		t.Fatalf("best configuration = %s", content)
	}
	if !strings.Contains(output.String(), "Location unavailable") {
		t.Fatalf("output = %q", output.String())
	}
}

func TestProcessCleansTemporaryOutputOnCommitFailure(t *testing.T) {
	standard := constants.GroupStandardID
	workingDir := t.TempDir()
	fixedTime := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	finalPath := filepath.Join(workingDir, "nordvpn_configs_20260801_120000_000000000")
	if err := os.Mkdir(finalPath, 0700); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(finalPath, "existing"), []byte("x"), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	generator := NewGenerator(fakeServerClient{
		coordinates: models.Coordinates{},
		servers:     []models.RawServer{rawServer("us1.example.com", 10, 1, 1, standard)},
	}, ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}))
	generator.workingDir = workingDir
	generator.now = func() time.Time { return fixedTime }

	_, err := generator.Process(context.Background(), parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25})
	if err == nil {
		t.Fatal("Process() succeeded")
	}
	if temporary, _ := filepath.Glob(filepath.Join(workingDir, ".nordgen-*")); len(temporary) != 0 {
		t.Fatalf("temporary directories remain: %v", temporary)
	}
}

func TestProcessRejectsInvalidInputAndFetchErrors(t *testing.T) {
	manager := ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{})
	generator := NewGenerator(fakeServerClient{serversErr: errors.New("failed")}, manager)
	if _, err := generator.Process(context.Background(), "bad", models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25}); err == nil {
		t.Fatal("Process() accepted invalid key")
	}
	if _, err := generator.Process(context.Background(), parserKey(1), models.UserPreferences{DNS: "bad", Keepalive: 25}); err == nil {
		t.Fatal("Process() accepted invalid preferences")
	}
	if _, err := generator.Process(context.Background(), parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25}); err == nil {
		t.Fatal("Process() accepted server fetch failure")
	}
}

func TestProcessRejectsInvalidGroups(t *testing.T) {
	standard := constants.GroupStandardID
	generator := NewGenerator(fakeServerClient{}, ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}))
	tests := []models.UserPreferences{
		{DNS: "1.1.1.1", Keepalive: 25, Groups: []string{"unknown"}},
		{DNS: "1.1.1.1", Keepalive: 25, Groups: []string{standard, standard}},
		{DNS: "1.1.1.1", Keepalive: 25, Groups: []string{constants.GroupDedicatedID}, ExcludeDedicated: true},
	}
	for _, preferences := range tests {
		if _, err := generator.Process(context.Background(), parserKey(1), preferences); err == nil {
			t.Fatalf("Process() accepted %+v", preferences)
		}
	}
}

func TestProcessHonorsCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	generator := NewGenerator(fakeServerClient{}, ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}))
	if _, err := generator.Process(ctx, parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25}); !errors.Is(err, context.Canceled) {
		t.Fatalf("Process() error = %v", err)
	}
}

func TestBuildJobsResolvesFilenameCollisions(t *testing.T) {
	generator := NewGenerator(fakeServerClient{}, ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}))
	servers := []models.Server{
		{Name: "same", Hostname: "same.one.example", Country: "Country", City: "City", Combo: "standard", PublicKey: parserKey(2)},
		{Name: "same", Hostname: "same.two.example", Country: "Country", City: "City", Combo: "standard", PublicKey: parserKey(3)},
		{Name: "same_1", Hostname: "same.three.example", Country: "Country", City: "City", Combo: "standard", PublicKey: parserKey(4)},
		{Name: "abcdefghijklmno-one", Hostname: "long.one.example", Country: "Country", City: "City", Combo: "standard", PublicKey: parserKey(5)},
		{Name: "abcdefghijklmno-two", Hostname: "long.two.example", Country: "Country", City: "City", Combo: "standard", PublicKey: parserKey(6)},
		{Name: "a/b", Hostname: "sanitized.one.example", Country: "Country", City: "City", Combo: "standard", PublicKey: parserKey(7)},
		{Name: "a:b", Hostname: "sanitized.two.example", Country: "Country", City: "City", Combo: "standard", PublicKey: parserKey(8)},
	}
	jobs, err := generator.buildJobs(t.TempDir(), servers, "configs", parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25})
	if err != nil {
		t.Fatalf("buildJobs() error = %v", err)
	}
	want := []string{
		"same.conf",
		"same_1.conf",
		"same_1_1.conf",
		"abcdefghijklmno.conf",
		"abcdefghijklmno_1.conf",
		"a_b.conf",
		"a_b_1.conf",
	}
	if len(jobs) != len(want) {
		t.Fatalf("job count = %d, want %d", len(jobs), len(want))
	}
	seen := make(map[string]struct{}, len(jobs))
	for index, job := range jobs {
		name := filepath.Base(job.path)
		if name != want[index] {
			t.Errorf("job %d name = %q, want %q", index, name, want[index])
		}
		if _, duplicate := seen[job.path]; duplicate {
			t.Errorf("duplicate path allocated: %s", job.path)
		}
		seen[job.path] = struct{}{}
	}
}

func TestBuildJobsBoundsDirectorySegments(t *testing.T) {
	generator := NewGenerator(fakeServerClient{}, ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}))
	longSegment := strings.Repeat("a", directoryMaxLength+20)
	servers := []models.Server{{
		Name: "server", Hostname: "server.example.com", Country: longSegment, City: longSegment, Combo: "standard", PublicKey: parserKey(2),
	}}
	jobs, err := generator.buildJobs(t.TempDir(), servers, "configs", parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25})
	if err != nil {
		t.Fatalf("buildJobs() error = %v", err)
	}
	city := filepath.Base(filepath.Dir(jobs[0].path))
	country := filepath.Base(filepath.Dir(filepath.Dir(jobs[0].path)))
	if len(city) != directoryMaxLength || len(country) != directoryMaxLength {
		t.Fatalf("country length = %d, city length = %d", len(country), len(city))
	}

	multibyte := strings.Repeat("界", directoryMaxLength)
	servers[0].Country = multibyte
	servers[0].City = multibyte
	jobs, err = generator.buildJobs(t.TempDir(), servers, "configs", parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25})
	if err != nil {
		t.Fatalf("buildJobs() error = %v", err)
	}
	city = filepath.Base(filepath.Dir(jobs[0].path))
	country = filepath.Base(filepath.Dir(filepath.Dir(jobs[0].path)))
	if len(city) > directoryMaxLength || len(country) > directoryMaxLength || !utf8.ValidString(city) || !utf8.ValidString(country) {
		t.Fatalf("multibyte segments are invalid: country=%q city=%q", country, city)
	}
}

func TestServerLessOrdering(t *testing.T) {
	base := models.Server{
		Load: 10, Distance: 5, Hostname: "b.example.com", Combo: "standard",
		Country: "A", City: "A", Station: "192.0.2.1", PublicKey: parserKey(1),
	}
	tests := []models.Server{
		{Load: 11, Distance: 0, Hostname: "a.example.com", Combo: "p2p"},
		{Load: 10, Distance: 6, Hostname: "a.example.com", Combo: "p2p"},
		{Load: 10, Distance: 5, Hostname: "c.example.com", Combo: "p2p"},
		{Load: 10, Distance: 5, Hostname: "b.example.com", Combo: "standard_p2p"},
		{Load: 10, Distance: 5, Hostname: "b.example.com", Combo: "standard", Country: "B"},
		{Load: 10, Distance: 5, Hostname: "b.example.com", Combo: "standard", Country: "A", City: "B"},
		{Load: 10, Distance: 5, Hostname: "b.example.com", Combo: "standard", Country: "A", City: "A", Station: "192.0.2.2"},
		{Load: 10, Distance: 5, Hostname: "b.example.com", Combo: "standard", Country: "A", City: "A", Station: "192.0.2.1", PublicKey: parserKey(2)},
	}
	for _, candidate := range tests {
		if !serverLess(base, candidate) {
			t.Fatalf("serverLess(%+v, %+v) = false", base, candidate)
		}
	}
	if serverLess(base, base) {
		t.Fatal("serverLess() considered equal values ordered")
	}
}

func TestBuildJobsUsesIPAndRejectsInvalidServer(t *testing.T) {
	generator := NewGenerator(fakeServerClient{}, ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}))
	server := models.Server{
		Name: "server", Hostname: "server.example.com", Station: "2001:db8::1", Country: "Country", City: "City", Combo: "standard", PublicKey: parserKey(2),
	}
	jobs, err := generator.buildJobs(t.TempDir(), []models.Server{server}, "configs", parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25, UseIP: true})
	if err != nil {
		t.Fatalf("buildJobs() error = %v", err)
	}
	if !strings.Contains(string(jobs[0].content), "Endpoint = [2001:db8::1]:51820") {
		t.Fatalf("configuration = %s", jobs[0].content)
	}
	server.PublicKey = "invalid"
	if _, err := generator.buildJobs(t.TempDir(), []models.Server{server}, "configs", parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25}); err == nil {
		t.Fatal("buildJobs() accepted an invalid server key")
	}
}

func TestWriteJobsParallelErrorsAndCancellation(t *testing.T) {
	generator := NewGenerator(fakeServerClient{}, ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}))
	if err := generator.writeJobsParallel(context.Background(), nil); err != nil {
		t.Fatalf("writeJobsParallel(nil) error = %v", err)
	}

	root := t.TempDir()
	blocker := filepath.Join(root, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if err := generator.writeJobsParallel(context.Background(), []fileJob{{path: filepath.Join(blocker, "child.conf"), content: []byte("x")}}); err == nil {
		t.Fatal("writeJobsParallel() accepted an invalid directory path")
	}

	directoryPath := filepath.Join(root, "directory")
	if err := os.Mkdir(directoryPath, 0700); err != nil {
		t.Fatalf("Mkdir() error = %v", err)
	}
	if err := generator.writeJobsParallel(context.Background(), []fileJob{{path: directoryPath, content: []byte("x")}}); err == nil {
		t.Fatal("writeJobsParallel() accepted a directory as a file")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := generator.writeJobsParallel(ctx, []fileJob{{path: filepath.Join(root, "cancelled.conf"), content: []byte("x")}}); !errors.Is(err, context.Canceled) {
		t.Fatalf("writeJobsParallel() error = %v", err)
	}
}

func FuzzSanitizePathSegment(f *testing.F) {
	for _, value := range []string{"", "CON", "New York", "a/b", "name\u202econf", "界界界"} {
		f.Add(value)
	}
	f.Fuzz(func(t *testing.T, value string) {
		result := sanitizePathSegment(value)
		if result == "" || result == "." || result == ".." || !utf8.ValidString(result) {
			t.Fatalf("sanitizePathSegment(%q) = %q", value, result)
		}
		for _, r := range result {
			if unicode.Is(unicode.C, r) || unicode.IsSpace(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
				t.Fatalf("sanitizePathSegment(%q) retained forbidden rune %q in %q", value, r, result)
			}
		}
	})
}

type blockingGeoClient struct {
	serverErr error
	cancelled chan struct{}
}

func (client blockingGeoClient) GetGeo(ctx context.Context) (models.Coordinates, error) {
	<-ctx.Done()
	close(client.cancelled)
	return models.Coordinates{}, ctx.Err()
}

func (client blockingGeoClient) GetServers(context.Context) ([]models.RawServer, error) {
	return nil, client.serverErr
}

type generatorFailingWriter struct{}

func (generatorFailingWriter) Write([]byte) (int, error) {
	return 0, errors.New("write failed")
}

func TestCanonicalPathSegmentRevalidatesAfterTruncation(t *testing.T) {
	value := strings.Repeat("a", directoryMaxLength-1) + ".suffix"
	actual := canonicalPathSegment(value, directoryMaxLength)
	if strings.HasSuffix(actual, ".") || len(actual) > directoryMaxLength {
		t.Fatalf("canonicalPathSegment() = %q", actual)
	}
	if actual != strings.Repeat("a", directoryMaxLength-1) {
		t.Fatalf("canonicalPathSegment() = %q", actual)
	}
}

func TestProcessRejectsInvalidObserverCoordinates(t *testing.T) {
	for _, coordinates := range []models.Coordinates{
		{Latitude: math.NaN(), Longitude: 0},
		{Latitude: math.Inf(1), Longitude: 0},
		{Latitude: math.Inf(-1), Longitude: 0},
		{Latitude: 91, Longitude: 0},
		{Latitude: 0, Longitude: 181},
	} {
		t.Run("invalid", func(t *testing.T) {
			servers := []models.RawServer{
				rawServer("z.example.com", 10, 50, 50, constants.GroupStandardID),
				rawServer("a.example.com", 10, -50, -50, constants.GroupStandardID),
			}
			var output bytes.Buffer
			generator := NewGenerator(
				fakeServerClient{coordinates: coordinates, servers: servers},
				ui.NewConsoleManager(strings.NewReader(""), &output),
			)
			generator.workingDir = t.TempDir()
			path, err := generator.Process(context.Background(), parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25})
			if err != nil {
				t.Fatalf("Process() error = %v", err)
			}
			matches, err := filepath.Glob(filepath.Join(path, "best_configs", "*", "*", "*", "*.conf"))
			if err != nil || len(matches) != 1 {
				t.Fatalf("matches = %v, error = %v", matches, err)
			}
			content, err := os.ReadFile(matches[0])
			if err != nil {
				t.Fatalf("ReadFile() error = %v", err)
			}
			if !strings.Contains(string(content), "Endpoint = a.example.com:51820") {
				t.Fatalf("best configuration = %s", content)
			}
			if !strings.Contains(output.String(), "Location unavailable") {
				t.Fatalf("output = %q", output.String())
			}
		})
	}
}

func TestProcessCancelsOptionalGeoWhenServerFetchFails(t *testing.T) {
	cancelled := make(chan struct{})
	generator := NewGenerator(
		blockingGeoClient{serverErr: errors.New("server failed"), cancelled: cancelled},
		ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}),
	)
	_, err := generator.Process(context.Background(), parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25})
	if err == nil || !strings.Contains(err.Error(), "server failed") {
		t.Fatalf("Process() error = %v", err)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("geolocation request was not cancelled")
	}
}

func TestProcessRejectsOutputFailureAndUnusableServerData(t *testing.T) {
	preferences := models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25}
	generator := NewGenerator(fakeServerClient{}, ui.NewConsoleManager(strings.NewReader(""), generatorFailingWriter{}))
	if _, err := generator.Process(context.Background(), parserKey(1), preferences); err == nil || !strings.Contains(err.Error(), "console output") {
		t.Fatalf("Process() error = %v", err)
	}

	generator = NewGenerator(fakeServerClient{servers: []models.RawServer{rawServer("invalid", 10, 1, 1, constants.GroupStandardID)}}, ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}))
	if _, err := generator.Process(context.Background(), parserKey(1), preferences); err == nil || !strings.Contains(err.Error(), "no servers matched") {
		t.Fatalf("Process() error = %v", err)
	}
}

func TestProcessRejectsInvalidWorkingDirectory(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "file")
	if err := os.WriteFile(filePath, []byte("x"), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	generator := NewGenerator(
		fakeServerClient{servers: []models.RawServer{rawServer("us1.example.com", 10, 1, 1, constants.GroupStandardID)}},
		ui.NewConsoleManager(strings.NewReader(""), &bytes.Buffer{}),
	)
	generator.workingDir = filePath
	if _, err := generator.Process(context.Background(), parserKey(1), models.UserPreferences{DNS: "1.1.1.1", Keepalive: 25}); err == nil {
		t.Fatal("Process() accepted a file as the working directory")
	}
}

func TestWriteFileExclusiveDoesNotOverwrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.conf")
	if err := os.WriteFile(path, []byte("existing"), 0600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if err := writeFileExclusive(path, []byte("replacement")); err == nil {
		t.Fatal("writeFileExclusive() overwrote an existing path")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(content) != "existing" {
		t.Fatalf("content = %q", content)
	}
}

func TestWriteJobsParallelPropagatesOutputFailure(t *testing.T) {
	generator := NewGenerator(fakeServerClient{}, ui.NewConsoleManager(strings.NewReader(""), generatorFailingWriter{}))
	path := filepath.Join(t.TempDir(), "config.conf")
	if err := generator.writeJobsParallel(context.Background(), []fileJob{{path: path, content: []byte("x")}}); err == nil || !strings.Contains(err.Error(), "console output") {
		t.Fatalf("writeJobsParallel() error = %v", err)
	}
}
